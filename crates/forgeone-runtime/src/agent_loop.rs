//! Agent Loop 核心：LLM 调用 → 工具执行 → 循环
//!
//! 这是 ForgeOne Runtime 的核心执行单元。
//! 每一轮：调用 LLM（携带 tools schema）→ 解析响应 →
//!   若 tool_use → 检查 Policy → 执行工具 → 追加 tool_result → 再次调用 LLM
//!   若 text    → 发送 done 事件，结束循环

pub mod events;
pub mod plan;

pub use events::*;
pub(crate) use plan::*;

use crate::llm_client::{
    LlmBlock, LlmChunk, LlmClient, LlmContent, LlmMessage, LlmProtocol, LlmRequest, LlmResponse,
    LlmToolCall, builtin_tool_defs,
};
use forgeone_tools::{ToolCallRequest, ToolCallStatus, ToolRegistry};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

/// 连续自评「未完成」的最大次数，超过则强制结束（防止模型原地打转）
const MAX_UNCONSUMED_REVIEWS: u32 = 3;

// ── 危险工具列表（需要用户审批）────────────────────────────────────

const APPROVAL_REQUIRED_TOOLS: &[&str] = &["shell", "write_file", "edit_file", "diff"];

// ── 循环安全阀 ─────────────────────────────────────────────────────
// 目标驱动的 Agent Loop 不再依赖用户配置 max_loops；该值仅为防止
// 模型失控空转的硬性保护（达到后以 stop_reason=loop_guard_reached 收尾）。
const MAX_LOOPS_GUARD: u32 = 40;
/// 总输出 token 预算（粗估：字符数/4），超出强制结束，防止单轮任务无限膨胀
const MAX_TOTAL_TOKENS: u32 = 65536;

// ── 请求结构 ──────────────────────────────────────────────────────

/// 前端发来的 Agent 运行请求
#[derive(Debug, Clone, Deserialize)]
pub struct AgentRunRequest {
    pub session_id: String,
    pub prompt: String,
    pub model: String,
    /// 协议："anthropic" | "openai" | "ollama"
    pub protocol: String,
    pub api_key: Option<String>,
    pub base_url: String,
    /// 系统提示词（由前端 buildForgeOneSystemPrompt 生成）
    pub system_prompt: String,
    /// 工作区路径
    pub workspace: String,
    /// 历史消息（可选，多轮对话时传入）
    #[serde(default)]
    pub history: Vec<HistoryMessage>,
    /// 是否允许危险工具（不审批直接执行）
    #[serde(default)]
    pub allow_dangerous_tools: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryMessage {
    pub role: String,
    pub content: String,
}

// ── Agent Loop ────────────────────────────────────────────────────

pub struct AgentLoop {
    llm: LlmClient,
    tools: ToolRegistry,
    /// 待审批工具调用表：tool_call_id → oneshot 发送端（前端 /api/agent/approve 投递决定）
    pending_approvals: tokio::sync::Mutex<std::collections::HashMap<String, tokio::sync::oneshot::Sender<bool>>>,
}

impl Default for AgentLoop {
    fn default() -> Self {
        Self {
            llm: LlmClient::new(),
            tools: ToolRegistry::with_builtin_tools(),
            pending_approvals: tokio::sync::Mutex::new(std::collections::HashMap::new()),
        }
    }
}

impl AgentLoop {
    /// 运行完整 Agent Loop，通过 tx 推送 AgentEvent
    pub async fn run(&self, req: AgentRunRequest, tx: tokio::sync::mpsc::Sender<AgentEvent>) {
        let mut unconsumed_reviews: u32 = 0;

        let protocol = match req.protocol.as_str() {
            "anthropic" => LlmProtocol::Anthropic,
            "ollama" => LlmProtocol::Ollama,
            _ => LlmProtocol::OpenAi,
        };

        // 构建初始消息列表
        let mut messages: Vec<LlmMessage> = req
            .history
            .iter()
            .map(|h| LlmMessage {
                role: h.role.clone(),
                content: LlmContent::Text(h.content.clone()),
            })
            .collect();

        // 追加当前用户消息
        messages.push(LlmMessage {
            role: "user".to_string(),
            content: LlmContent::Text(req.prompt.clone()),
        });

        let tools = builtin_tool_defs();

        // ── 规划阶段：提炼目标并分解执行计划 ────────────────────────
        // 简单任务（短问句/无复杂意图）跳过规划调用，直接以用户原话为目标执行，省一次 LLM 调用
        let (goal, steps) = if Self::needs_planning(&req.prompt) {
            match self.plan_goal(&req, &protocol).await {
                Ok(plan) => plan,
                Err(e) => {
                    eprintln!("[AgentLoop] 规划阶段失败，退化为直接执行: {e}");
                    (req.prompt.clone(), Vec::new())
                }
            }
        } else {
            (req.prompt.clone(), Vec::new())
        };
        if tx
            .send(AgentEvent::Plan {
                goal: goal.clone(),
                steps: steps.clone(),
                loop_index: 0,
            })
            .await.is_err() { return; }

        // 目标 + 计划注入每轮 system 上下文（目标锚定）
        let goal_system = build_goal_system(&req.system_prompt, &goal, &steps);

        // 本轮运行是否执行过工具（纯问答任务跳过自评，省一次 LLM 调用）
        let mut tools_executed = false;
        // 累计输出 token（粗估），超出预算强制结束
        let mut total_output_tokens: u32 = 0;

        for loop_index in 1..=MAX_LOOPS_GUARD {
            // 调用 LLM
            let llm_req = LlmRequest {
                model: req.model.clone(),
                protocol: protocol.clone(),
                api_key: req.api_key.clone(),
                base_url: req.base_url.clone(),
                system: goal_system.clone(),
                messages: messages.clone(),
                tools: tools.clone(),
                max_tokens: 8192,
            };

            // 通过 channel 接收流式 chunks
            let (chunk_tx, mut chunk_rx) = tokio::sync::mpsc::channel::<LlmChunk>(128);

            let llm_ref = &self.llm;
            let llm_req_clone = llm_req.clone();

            // 异步调用 LLM（在同一个 task 里用 join）。
            // 注意：chunk_tx 必须 move 进 llm_task，不能在外层残留副本——
            // 否则 join! 中的 chunk_rx.recv() 永远等不到全部 sender drop，造成死锁。
            let llm_task = async move {
                let result = llm_ref
                    .call_streaming(&llm_req_clone, chunk_tx.clone())
                    .await;
                if let Err(e) = result {
                    let _ = chunk_tx.send(LlmChunk::Error(e)).await;
                }
                // 此处 chunk_tx drop，chunk_rx.recv() 返回 None
            };

            // 收集 LLM 响应并推送事件
            let mut final_response: Option<LlmResponse> = None;
            let mut had_error = false;

            tokio::join!(
                async {
                    while let Some(chunk) = chunk_rx.recv().await {
                        match chunk {
                            LlmChunk::ThinkingDelta(delta) => {
                                if tx.send(AgentEvent::Thinking { delta, loop_index }).await.is_err() { return; }
                            }
                            LlmChunk::TextDelta(delta) => {
                                if tx.send(AgentEvent::Text { delta, loop_index }).await.is_err() { return; }
                            }
                            LlmChunk::ToolCallStart { .. } => {
                                // 等待 Done 才处理工具调用
                            }
                            LlmChunk::ToolCallInputDelta { .. } => {}
                            LlmChunk::Done(resp) => {
                                final_response = Some(resp);
                            }
                            LlmChunk::Error(e) => {
                                if tx.send(AgentEvent::Error { message: e }).await.is_err() { return; }
                                had_error = true;
                            }
                        }
                    }
                },
                llm_task,
            );

            if had_error {
                return;
            }

            let Some(response) = final_response else {
                if tx
                    .send(AgentEvent::Error {
                        message: "LLM 无响应".to_string(),
                    })
                    .await.is_err() { return; }
                return;
            };

            // token 预算检查：累计本轮输出（粗估：字符数/4），超出强制结束
            if let Some(text) = &response.text {
                total_output_tokens += (text.chars().count() / 4) as u32;
            }
            if let Some(thinking) = &response.thinking {
                total_output_tokens += (thinking.chars().count() / 4) as u32;
            }
            if total_output_tokens >= MAX_TOTAL_TOKENS {
                if tx
                    .send(AgentEvent::Done {
                        loops: loop_index + 1,
                        stop_reason: "token_budget_exceeded".to_string(),
                    })
                    .await.is_err() { return; }
                return;
            }

            // 无工具调用时结束循环。
            // 注意：不能依赖 stop_reason —— Ollama 在返回 tool_calls 时 done_reason 仍可能是 "stop"，
            // 而 Anthropic 的 "end_turn" / OpenAI 的 "stop" 在 tool_calls 为空时才出现。
            if response.tool_calls.is_empty() {
                // 把本轮回答追加为 assistant 消息，作为后续续写的上下文
                if let Some(text) = &response.text {
                    messages.push(LlmMessage {
                        role: "assistant".to_string(),
                        content: LlmContent::Text(text.clone()),
                    });
                }

                // 纯问答任务（从未执行过工具）：无需自评，直接完成
                if !tools_executed {
                    if tx
                        .send(AgentEvent::Done {
                            loops: loop_index + 1,
                            stop_reason: response.stop_reason,
                        })
                        .await.is_err() { return; }
                    return;
                }

                match self
                    .evaluate_completion(&req, &protocol, &goal, &steps, &messages)
                    .await
                {
                    Ok((true, _reason, _)) => {
                        if tx
                            .send(AgentEvent::Done {
                                loops: loop_index + 1,
                                stop_reason: response.stop_reason,
                            })
                            .await.is_err() { return; }
                        return;
                    }
                    Ok((false, reason, next_action)) => {
                        // 模型明确表示需要用户提供/澄清信息时，不再回灌空转，
                        // 直接把球踢回用户（用户看到模型的真实问题并回复即可）
                        if Self::completion_needs_user_input(&reason) || Self::completion_needs_user_input(&next_action) {
                            if tx
                                .send(AgentEvent::Done {
                                    loops: loop_index + 1,
                                    stop_reason: "need_user_input".to_string(),
                                })
                                .await.is_err() { return; }
                            return;
                        }
                        unconsumed_reviews += 1;
                        if unconsumed_reviews >= MAX_UNCONSUMED_REVIEWS {
                            if tx
                                .send(AgentEvent::Done {
                                    loops: loop_index + 1,
                                    stop_reason: "goal_not_reached_guard".to_string(),
                                })
                                .await.is_err() { return; }
                            return;
                        }
                        // 回灌：告知未完成原因与下一步，让模型继续执行
                        messages.push(LlmMessage {
                            role: "user".to_string(),
                            content: LlmContent::Text(format!(
                                "目标尚未完成：{reason}。请继续推进：{next_action}。不要重复已做过的操作。"
                            )),
                        });
                        continue;
                    }
                    Err(e) => {
                        // 自评解析失败：保守视为完成，避免死循环
                        eprintln!("[AgentLoop] 目标完成度自评失败，按完成处理: {e}");
                        if tx
                            .send(AgentEvent::Done {
                                loops: loop_index + 1,
                                stop_reason: response.stop_reason,
                            })
                            .await.is_err() { return; }
                        return;
                    }
                }
            }

            // 有工具调用：执行工具，追加 tool_result 到 messages
            tools_executed = true;
            let assistant_blocks = build_assistant_blocks(&response);
            messages.push(LlmMessage {
                role: "assistant".to_string(),
                content: LlmContent::Blocks(assistant_blocks),
            });

            let mut tool_result_blocks: Vec<LlmBlock> = vec![];

            unconsumed_reviews = 0;

            for tool_call in &response.tool_calls {
                // 安全模式：shell / write_file / edit_file / diff 全部需审批；
                // 危险模式：普通命令直接执行，仅高危命令（shell 内容匹配危险特征）仍需审批
                let requires_approval = if req.allow_dangerous_tools {
                    tool_call.name == "shell" && is_dangerous_command(&tool_call.input)
                } else {
                    APPROVAL_REQUIRED_TOOLS.contains(&tool_call.name.as_str())
                };

                if tx
                    .send(AgentEvent::ToolStart {
                        tool_call_id: tool_call.id.clone(),
                        tool: tool_call.name.clone(),
                        args: tool_call.input.clone(),
                        loop_index,
                        requires_approval,
                    })
                    .await.is_err() { return; }

                if requires_approval {
                    // 发送审批请求，注册等待者，暂停直到前端 /api/agent/approve 投递决定
                    if tx
                        .send(AgentEvent::ApprovalRequired {
                            tool_call_id: tool_call.id.clone(),
                            tool: tool_call.name.clone(),
                            args: tool_call.input.clone(),
                            reason: format!("工具 {} 需要用户授权才能执行", tool_call.name),
                            loop_index,
                        })
                        .await.is_err() { return; }

                    let (approve_tx, approve_rx) = tokio::sync::oneshot::channel::<bool>();
                    self.pending_approvals
                        .lock()
                        .await
                        .insert(tool_call.id.clone(), approve_tx);
                    // 等待前端决定；超时（5 分钟）或通道关闭（会话断开）一律视为拒绝，避免死等
                    let approved = match tokio::time::timeout(
                        std::time::Duration::from_secs(300),
                        approve_rx,
                    )
                    .await
                    {
                        Ok(Ok(v)) => v,
                        _ => false,
                    };
                    self.pending_approvals.lock().await.remove(&tool_call.id);

                    let (output, ok) = if approved {
                        match self.execute_tool(tool_call, &req.workspace, loop_index) {
                            Ok(out) => (out, true),
                            Err(e) => (format!("工具执行失败: {}", e), false),
                        }
                    } else {
                        ("用户拒绝了此工具调用。".to_string(), false)
                    };

                    if tx
                        .send(AgentEvent::ToolResult {
                            tool_call_id: tool_call.id.clone(),
                            tool: tool_call.name.clone(),
                            output: output.clone(),
                            loop_index,
                            ok,
                        })
                        .await.is_err() { return; }

                    tool_result_blocks.push(LlmBlock {
                        block_type: "tool_result".to_string(),
                        text: None,
                        id: None,
                        name: None,
                        input: None,
                        tool_use_id: Some(tool_call.id.clone()),
                        content: Some(output),
                    });
                } else {
                    // 执行工具
                    let result = self.execute_tool(tool_call, &req.workspace, loop_index);

                    let (output, ok) = match &result {
                        Ok(out) => (out.clone(), true),
                        Err(e) => (format!("工具执行失败: {}", e), false),
                    };

                    if tx
                        .send(AgentEvent::ToolResult {
                            tool_call_id: tool_call.id.clone(),
                            tool: tool_call.name.clone(),
                            output: output.clone(),
                            loop_index,
                            ok,
                        })
                        .await.is_err() { return; }

                    tool_result_blocks.push(LlmBlock {
                        block_type: "tool_result".to_string(),
                        text: None,
                        id: None,
                        name: None,
                        input: None,
                        tool_use_id: Some(tool_call.id.clone()),
                        content: Some(output),
                    });
                }
            }

            // 把 tool_result 追加到 messages（user role，符合 Anthropic 规范）
            messages.push(LlmMessage {
                role: "user".to_string(),
                content: LlmContent::Blocks(tool_result_blocks),
            });
        }

        // 触发循环安全阀（模型持续调用工具但未收尾）
        if tx
            .send(AgentEvent::Done {
                loops: MAX_LOOPS_GUARD,
                stop_reason: "loop_guard_reached".to_string(),
            })
            .await.is_err() { return; }
    }

    /// 调用 forgeone-tools 执行工具
    fn execute_tool(
        &self,
        tool_call: &LlmToolCall,
        workspace: &str,
        loop_index: u32,
    ) -> Result<String, String> {
        // 将 JSON Value 中的 string 字段转换为 HashMap<String, String>
        let mut args: HashMap<String, String> = HashMap::new();
        if let Value::Object(map) = &tool_call.input {
            for (k, v) in map {
                args.insert(
                    k.clone(),
                    v.as_str()
                        .map(str::to_string)
                        .unwrap_or_else(|| v.to_string()),
                );
            }
        }

        // 工作区感知：相对路径统一解析为「工作区根 + 相对路径」。
        // 否则 read_file / glob / search 等会把相对路径解析到进程 cwd
        // （Tauri 应用目录，而非用户绑定的工作区），导致"文件找不到"。
        if !workspace.is_empty() {
            for key in ["path", "path_a", "path_b", "root"] {
                if let Some(v) = args.get(key) {
                    let p = std::path::Path::new(v);
                    if p.is_relative() {
                        args.insert(key.to_string(), join_workspace_path(workspace, v));
                    }
                }
            }
        }

        // 注入工作区路径（shell 工具以 cwd 作为命令工作目录）
        if !args.contains_key("cwd") {
            args.insert("cwd".to_string(), workspace.to_string());
        }

        // 关键修复：文件定位工具（glob / search_files / directory_tree）未传 root 时，
        // 默认指向工作区根，而不是进程 cwd。
        // 否则在桌面/Tauri 场景下 cwd 不可控，工具会搜错目录（搜到工作区外、漏掉工作区内），
        // 返回的路径还与 workspace 不一致，导致后续 read_file 失败。
        if !workspace.is_empty() {
            match tool_call.name.as_str() {
                "glob" | "search_files" | "directory_tree" => {
                    args.entry("path".to_string())
                        .or_insert_with(|| workspace.to_string());
                }
                _ => {}
            }
        }

        let request = ToolCallRequest {
            call_id: format!("call_{}_{}", loop_index, tool_call.id),
            session_id: "agent_loop".to_string(),
            agent_id: "forgeone".to_string(),
            loop_index,
            tool_name: tool_call.name.clone(),
            arguments: args,
            requested_by: "agent_loop".to_string(),
        };

        let result = self.tools.execute(&request);

        match result.status {
            ToolCallStatus::Success => {
                // 将结构化输出序列化为可读文本
                let output = result
                    .structured_output
                    .get("content")
                    .or_else(|| result.structured_output.get("preview"))
                    .or_else(|| result.structured_output.get("output"))
                    .cloned()
                    .unwrap_or_else(|| {
                        serde_json::to_string(&result.structured_output).unwrap_or_default()
                    });
                Ok(output)
            }
            ToolCallStatus::PermissionDenied => {
                Err(result.error.unwrap_or_else(|| "权限拒绝".to_string()))
            }
            ToolCallStatus::ValidationError => {
                Err(result.error.unwrap_or_else(|| "参数验证失败".to_string()))
            }
            ToolCallStatus::Failed => {
                Err(result.error.unwrap_or_else(|| "工具执行失败".to_string()))
            }
        }
    }

    /// 判断任务是否需要规划阶段（简单问句/短请求跳过，避免每轮都花一次规划 LLM 调用）
    fn needs_planning(prompt: &str) -> bool {
        let p = prompt.trim();
        if p.is_empty() {
            return false;
        }
        // 短请求（<30 字符）通常是简单问答，无需规划
        if p.chars().count() < 30 {
            return false;
        }
        // 多行输入或包含复杂任务意图关键词才触发规划
        const COMPLEX_KEYWORDS: &[&str] = &[
            "分析", "修复", "重构", "实现", "优化", "排查", "构建", "部署", "测试",
            "迁移", "设计", "调试", "性能", "架构", "为什么", "怎么", "如何", "方案",
        ];
        p.lines().count() > 1 || COMPLEX_KEYWORDS.iter().any(|k| p.contains(k))
    }

    /// 规划阶段：单独调用 LLM 提炼目标并分解执行计划。
    /// 规划调用不携带 tools，只取最终文本中的 JSON。
    async fn plan_goal(
        &self,
        req: &AgentRunRequest,
        protocol: &LlmProtocol,
    ) -> Result<(String, Vec<String>), String> {
        let llm_req = LlmRequest {
            model: req.model.clone(),
            protocol: protocol.clone(),
            api_key: req.api_key.clone(),
            base_url: req.base_url.clone(),
            system: PLAN_SYSTEM_PROMPT.to_string(),
            messages: vec![LlmMessage {
                role: "user".to_string(),
                content: LlmContent::Text(format!(
                    "用户的目标请求：\n{}\n\n请提炼目标并分解执行计划。只输出 JSON。",
                    req.prompt
                )),
            }],
            tools: vec![],
            max_tokens: 1024,
        };

        let (chunk_tx, mut chunk_rx) = tokio::sync::mpsc::channel::<LlmChunk>(64);

        let llm_ref = &self.llm;
        let llm_req_clone = llm_req.clone();
        let llm_task = async move {
            let result = llm_ref
                .call_streaming(&llm_req_clone, chunk_tx.clone())
                .await;
            if let Err(e) = result {
                let _ = chunk_tx.send(LlmChunk::Error(e)).await;
            }
        };

        let mut plan_text = String::new();
        let mut plan_error: Option<String> = None;

        tokio::join!(
            async {
                while let Some(chunk) = chunk_rx.recv().await {
                    match chunk {
                        LlmChunk::TextDelta(delta) => plan_text.push_str(&delta),
                        LlmChunk::Error(e) => plan_error = Some(e),
                        _ => {}
                    }
                }
            },
            llm_task,
        );

        if let Some(e) = plan_error {
            return Err(e);
        }
        parse_plan_json(&plan_text)
    }

    /// 前端审批接口：按 tool_call_id 找到等待中的审批并投递决定（true=批准 / false=拒绝）
    /// 返回是否成功投递（false 表示该工具不在等待中或已超时）
    pub async fn resolve_approval(&self, tool_call_id: &str, approved: bool) -> bool {
        let mut map = self.pending_approvals.lock().await;
        if let Some(sender) = map.remove(tool_call_id) {
            let _ = sender.send(approved);
            true
        } else {
            false
        }
    }

    /// 判断自评结果是否表明"模型需要用户提供/澄清信息"（此时不再回灌，直接结束等用户回复）
    fn completion_needs_user_input(text: &str) -> bool {
        const SIGNALS: &[&str] = &[
            "用户", "请提供", "需要提供", "需要你", "澄清", "具体需求", "无法确定",
            "缺少", "等待用户", "请告知", "请补充", "先问", "请先", "需要确认", "询问",
        ];
        SIGNALS.iter().any(|s| text.contains(s))
    }

    /// 目标完成度自评：不带 tools 的轻量 LLM 调用，返回 (是否完成, 依据, 下一步)
    async fn evaluate_completion(
        &self,
        req: &AgentRunRequest,
        protocol: &LlmProtocol,
        goal: &str,
        steps: &[String],
        messages: &[LlmMessage],
    ) -> Result<(bool, String, String), String> {
        // 只带最近若干条消息，控制自评成本
        let start = messages.len().saturating_sub(8);
        let mut eval_messages: Vec<LlmMessage> = messages[start..].to_vec();

        let steps_text = steps
            .iter()
            .enumerate()
            .map(|(i, s)| format!("{}. {}", i + 1, s))
            .collect::<Vec<_>>()
            .join("\n");

        eval_messages.push(LlmMessage {
            role: "user".to_string(),
            content: LlmContent::Text(format!(
                "【目标】{}\n【执行计划】\n{}\n\n请依据以上上下文判断目标是否完成。",
                goal, steps_text
            )),
        });

        let llm_req = LlmRequest {
            model: req.model.clone(),
            protocol: protocol.clone(),
            api_key: req.api_key.clone(),
            base_url: req.base_url.clone(),
            system: COMPLETION_CHECK_PROMPT.to_string(),
            messages: eval_messages,
            tools: vec![], // 自评不提供工具
            max_tokens: 512,
        };

        // 非流式收集：只取最终文本
        let (chunk_tx, mut chunk_rx) = tokio::sync::mpsc::channel::<LlmChunk>(16);
        let llm_ref = &self.llm;
        let llm_req_clone = llm_req.clone();
        let llm_task = async move {
            if let Err(e) = llm_ref
                .call_streaming(&llm_req_clone, chunk_tx.clone())
                .await
            {
                let _ = chunk_tx.send(LlmChunk::Error(e)).await;
            }
        };
        let mut final_response: Option<LlmResponse> = None;
        tokio::join!(llm_task, async {
            while let Some(chunk) = chunk_rx.recv().await {
                if let LlmChunk::Done(resp) = chunk {
                    final_response = Some(resp);
                }
                // 忽略 TextDelta/ThinkingDelta（自评过程不需要推送）
            }
        });
        let resp = final_response.ok_or("自评 LLM 无响应")?;
        let raw = resp.text.unwrap_or_default();
        parse_completion_check(&raw)
    }
}

/// 危险模式下的高危命令检测：匹配危险特征（删除根目录/格式化/磁盘分区/递归强删等）仍需审批
fn is_dangerous_command(input: &serde_json::Value) -> bool {
    let cmd = input
        .get("command")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_lowercase();
    const DANGEROUS_PATTERNS: &[&str] = &[
        "rm -rf /",
        "rm -fr",
        "del /q /s",
        "format ",
        "mkfs",
        "dd if=",
        "shutdown",
        "reboot",
        "fdisk",
        "rd /s",
        ":(){:|:&};:",
        "git push --force",
        "reg delete",
        "diskpart",
        "net user",
        "vol c:",
        "chmod -r 777 /",
    ];
    DANGEROUS_PATTERNS.iter().any(|p| cmd.contains(p))
}

fn join_workspace_path(workspace: &str, path: &str) -> String {
    let p = std::path::Path::new(path);
    if p.is_absolute() {
        return path.to_string();
    }
    let ws = workspace
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_string();
    let rel = path.replace('\\', "/");
    format!("{}/{}", ws, rel)
}

fn build_assistant_blocks(response: &LlmResponse) -> Vec<LlmBlock> {
    let mut blocks = vec![];

    if let Some(thinking) = &response.thinking {
        blocks.push(LlmBlock {
            block_type: "thinking".to_string(),
            text: Some(thinking.clone()),
            id: None,
            name: None,
            input: None,
            tool_use_id: None,
            content: None,
        });
    }

    if let Some(text) = &response.text {
        blocks.push(LlmBlock {
            block_type: "text".to_string(),
            text: Some(text.clone()),
            id: None,
            name: None,
            input: None,
            tool_use_id: None,
            content: None,
        });
    }

    for tc in &response.tool_calls {
        blocks.push(LlmBlock {
            block_type: "tool_use".to_string(),
            text: None,
            id: Some(tc.id.clone()),
            name: Some(tc.name.clone()),
            input: Some(tc.input.clone()),
            tool_use_id: None,
            content: None,
        });
    }

    blocks
}

#[cfg(test)]
mod tests;
#[cfg(test)]
mod deepseek_tests;
