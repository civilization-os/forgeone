use super::*;

use std::collections::BTreeMap;

pub(crate) fn format_agent_events(events: &[AgentEvent]) -> String {
    let mut output = String::new();
    let mut text_by_loop: BTreeMap<u32, String> = BTreeMap::new();

    for event in events {
        match event {
            AgentEvent::Plan {
                goal,
                steps,
                loop_index,
            } => {
                output.push_str(&format!(
                    "\n========== LOOP {loop_index} / PLAN ==========\n\
                     Goal: {goal}\n\
                     Steps:\n"
                ));

                for (index, step) in steps.iter().enumerate() {
                    output.push_str(&format!("  {}. {}\n", index + 1, step));
                }
            }

            AgentEvent::Text { delta, loop_index } => {
                text_by_loop.entry(*loop_index).or_default().push_str(delta);
            }

            AgentEvent::ToolStart { .. } | AgentEvent::ToolResult { .. } => {
                output.push_str(&format!("\n{event:#?}\n"));
            }

            other => {
                output.push_str(&format!("\n{other:#?}\n"));
            }
        }
    }

    for (loop_index, text) in text_by_loop {
        output.push_str(&format!(
            "\n========== LOOP {loop_index} / TEXT ==========\n\
             {text}\n"
        ));
    }

    output
}

/// 相对路径应解析为工作区根下的绝对路径；绝对路径原样保留
#[test]
fn join_workspace_path_resolves_relative_and_keeps_absolute() {
    let ws = "d:\\project\\forgeone";
    assert_eq!(
        join_workspace_path(ws, "src/main.rs"),
        "d:/project/forgeone/src/main.rs"
    );
    assert_eq!(
        join_workspace_path(ws, "crates/forgeone-runtime/src/lib.rs"),
        "d:/project/forgeone/crates/forgeone-runtime/src/lib.rs"
    );
    assert_eq!(
        join_workspace_path(ws, "d:\\other\\abs.rs"),
        "d:\\other\\abs.rs"
    );
}

/// execute_tool 应把模型给出的相对路径拼接工作区根后再执行，
/// 解决"模型带了文件名但工具在进程 cwd 下找不到文件"的问题
#[test]
fn execute_tool_resolves_relative_path_against_workspace() {
    let agent = AgentLoop::default();
    let workspace = std::env::current_dir()
        .expect("cwd")
        .to_string_lossy()
        .to_string();

    // 模拟模型只给了文件名（相对路径）的场景
    let tool_call = LlmToolCall {
        id: "t1".to_string(),
        name: "read_file".to_string(),
        input: serde_json::json!({ "path": "Cargo.toml" }),
    };
    let out = agent
        .execute_tool(&tool_call, &workspace, 0)
        .expect("read_file 应成功读取工作区根下的 Cargo.toml");
    assert!(
        out.contains("members") || out.contains("workspace"),
        "读取内容应包含 workspace 清单，实际输出: {out}"
    );

    // 绝对路径原样使用
    let abs = workspace.clone() + "/Cargo.toml";
    let tool_call_abs = LlmToolCall {
        id: "t2".to_string(),
        name: "read_file".to_string(),
        input: serde_json::json!({ "path": abs }),
    };
    let out_abs = agent
        .execute_tool(&tool_call_abs, &workspace, 0)
        .expect("绝对路径也应读取成功");
    assert!(!out_abs.is_empty());
}

/// 文件定位工具（glob / search_files / directory_tree）未传 path 时，
/// 必须默认指向工作区根，而不是进程 cwd —— 复现 DeepSeek 端到端搜错目录的问题
#[test]
fn locate_tools_default_to_workspace_when_path_missing() {
    let agent = AgentLoop::default();
    let workspace = std::env::current_dir()
        .expect("cwd")
        .to_string_lossy()
        .to_string();

    // 模型只给 pattern，不给 path —— 旧行为会落到进程 cwd，新行为应注入 workspace
    let tool_call = LlmToolCall {
        id: "g1".to_string(),
        name: "glob".to_string(),
        input: serde_json::json!({ "pattern": "Cargo.toml" }),
    };
    let out = agent
        .execute_tool(&tool_call, &workspace, 0)
        .expect("glob 应执行成功");
    assert!(
        out.contains("Cargo.toml"),
        "glob 应在工作区根找到 Cargo.toml，实际输出: {out}"
    );

    // search_files 同样：只给 pattern，应在工作区根找到自身源码
    let tool_call_search = LlmToolCall {
        id: "s1".to_string(),
        name: "search_files".to_string(),
        input: serde_json::json!({ "pattern": "agent_loop.rs" }),
    };
    let out_search = agent
        .execute_tool(&tool_call_search, &workspace, 0)
        .expect("search_files 应执行成功");
    assert!(
        out_search.contains("agent_loop.rs"),
        "search_files 应在工作区找到 agent_loop.rs，实际输出: {out_search}"
    );
}

/// 内置工具表应暴露 invoke_skill，使模型能看到 Skill 能力
#[test]
fn builtin_tool_defs_include_invoke_skill() {
    let defs = builtin_tool_defs();
    assert!(
        defs.iter().any(|d| d.name == "invoke_skill"),
        "builtin_tool_defs 应包含 invoke_skill"
    );
}

/// AgentLoop 应拦截 invoke_skill：以 workspace 根解析 SKILL.md 并渲染模板参数，
/// 不依赖进程 cwd（SkillTool 本体无 workspace 感知，仅作兜底）
#[test]
fn execute_tool_intercepts_invoke_skill_with_workspace() {
    let agent = AgentLoop::default();
    let root = std::env::temp_dir().join(format!("forgeone_skill_test_{}", std::process::id()));
    let skill_dir = root.join(".forgeone").join("skills").join("demo");
    std::fs::create_dir_all(&skill_dir).expect("create skill dir");
    std::fs::write(
        skill_dir.join("SKILL.md"),
        "---\nname: demo\ndescription: demo skill\n---\nReview {{path}} now.",
    )
    .expect("write SKILL.md");

    let tool_call = LlmToolCall {
        id: "s1".to_string(),
        name: "invoke_skill".to_string(),
        input: serde_json::json!({ "name": "demo", "path": "src/main.rs" }),
    };
    let out = agent
        .execute_tool(&tool_call, &root.to_string_lossy().as_ref(), 0)
        .expect("invoke_skill 应成功");
    assert!(
        out.contains("Review src/main.rs now."),
        "应渲染 {{path}} 占位符，实际输出: {out}"
    );

    let _ = std::fs::remove_dir_all(&root);
}

/// 不存在的 skill 应返回明确的错误语义
#[test]
fn execute_tool_invoke_skill_reports_not_found() {
    let agent = AgentLoop::default();
    let tool_call = LlmToolCall {
        id: "s2".to_string(),
        name: "invoke_skill".to_string(),
        input: serde_json::json!({ "name": "no_such_skill" }),
    };
    let err = agent
        .execute_tool(&tool_call, "", 0)
        .expect_err("不存在的 skill 应报错");
    assert!(
        err.contains("skill_not_found"),
        "错误信息应包含 skill_not_found，实际: {err}"
    );
}

/// 前后端契约：AgentEvent 序列化为 snake_case tag 的 SSE 事件
#[test]
fn agent_event_serde_snake_case_roundtrip() {
    let ev = AgentEvent::ToolStart {
        tool_call_id: "t1".to_string(),
        tool: "read_file".to_string(),
        args: serde_json::json!({ "path": "src/main.rs" }),
        loop_index: 0,
        requires_approval: false,
    };
    let json = serde_json::to_string(&ev).expect("serialize");
    assert!(json.contains("\"type\":\"tool_start\""), "got: {json}");
    assert!(json.contains("\"tool_call_id\":\"t1\""), "got: {json}");

    let back: AgentEvent = serde_json::from_str(&json).expect("deserialize");
    match back {
        AgentEvent::ToolStart { tool, .. } => assert_eq!(tool, "read_file"),
        other => panic!("unexpected variant: {other:?}"),
    }

    let done = AgentEvent::Done {
        loops: 3,
        stop_reason: "stop".to_string(),
    };
    let json = serde_json::to_string(&done).expect("serialize");
    assert!(json.contains("\"type\":\"done\""), "got: {json}");
}

/// 前后端契约：前端 AgentRunRequestPayload 可被 AgentRunRequest 反序列化
#[test]
fn agent_run_request_deserializes_frontend_payload() {
    let payload = r#"{
            "session_id": "sess_1",
            "prompt": "查看一下这个文件",
            "model": "qwen2.5-coder:14b",
            "protocol": "ollama",
            "api_key": null,
            "base_url": "http://localhost:11434",
            "system_prompt": "你是 ForgeOne Agent",
            "workspace": "d:\\project\\forgeone",
            "history": [{"role": "user", "content": "hi"}],
            "allow_dangerous_tools": false
        }"#;
    let req: AgentRunRequest = serde_json::from_str(payload).expect("deserialize");
    assert_eq!(req.prompt, "查看一下这个文件");
    assert_eq!(req.model, "qwen2.5-coder:14b");
    assert_eq!(req.protocol, "ollama");
    assert_eq!(req.history.len(), 1);
    assert!(!req.allow_dangerous_tools);
    assert_eq!(req.api_key.as_deref(), None);
}

/// 规划 JSON 解析：正常 JSON / markdown 代码块包裹 / 缺失字段
#[test]
fn parse_plan_json_extracts_goal_and_steps() {
    let (goal, steps) =
        parse_plan_json(r#"{"goal": "读取 Cargo.toml", "steps": ["定位文件", "读取内容"]}"#)
            .expect("plain json");
    assert_eq!(goal, "读取 Cargo.toml");
    assert_eq!(steps, vec!["定位文件", "读取内容"]);

    let wrapped = "好的，规划如下：\n```json\n{\"goal\":\"修复编译错误\",\"steps\":[\"运行 diagnostics\",\"定位错误\",\"修改代码\"]}\n```";
    let (goal2, steps2) = parse_plan_json(wrapped).expect("code block json");
    assert_eq!(goal2, "修复编译错误");
    assert_eq!(steps2.len(), 3);

    assert!(parse_plan_json("抱歉，我无法规划").is_err());
}

/// 端到端：mock OpenAI 服务器 → AgentLoop「规划 → tool_calls → 工具执行 → 回灌 → 最终回答」完整闭环
#[tokio::test(flavor = "multi_thread")]
async fn agent_loop_runs_tool_call_loop_end_to_end() {
    use axum::{Json, Router, body::Body, extract::State, http::Response, routing::post};
    use std::sync::Arc;
    use std::sync::atomic::{AtomicU8, Ordering};

    async fn mock_chat_handler(
        State(round): State<Arc<AtomicU8>>,
        Json(_payload): Json<serde_json::Value>,
    ) -> Response<Body> {
        let r = round.fetch_add(1, Ordering::SeqCst);
        let body = match r {
            // 第 0 次调用：规划阶段，返回目标 + 步骤 JSON
            0 => {
                r#"data: {"choices":[{"delta":{"content":"{\"goal\":\"读取 Cargo.toml\",\"steps\":[\"定位文件\",\"读取内容\"]}"},"index":0}]}
data: {"choices":[{"delta":{},"index":0,"finish_reason":"stop"}]}
data: [DONE]
"#
            }
            // 第 1 次调用：执行阶段，返回 read_file 工具调用
            1 => {
                r#"data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"read_file","arguments":"{\"path\":\"Cargo.toml\"}"}}]},"index":0}]}
data: {"choices":[{"delta":{},"index":0,"finish_reason":"tool_calls"}]}
data: [DONE]
"#
            }
            // 第 2 次调用：最终文本回答
            _ => {
                r#"data: {"choices":[{"delta":{"content":"最终回答"},"index":0}]}
data: {"choices":[{"delta":{},"index":0,"finish_reason":"stop"}]}
data: [DONE]
"#
            }
        };
        Response::builder()
            .header("content-type", "text/event-stream")
            .body(Body::from(body))
            .unwrap()
    }

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind mock server");
    let addr = listener.local_addr().expect("addr");
    let app = Router::new()
        .route("/v1/chat/completions", post(mock_chat_handler))
        .with_state(Arc::new(AtomicU8::new(0)));
    tokio::spawn(async move {
        axum::serve(listener, app)
            .await
            .expect("mock server crashed");
    });

    // 运行 AgentLoop（read_file 真实执行，读取 workspace 根下的 Cargo.toml）
    let agent = AgentLoop::default();
    let req = AgentRunRequest {
        session_id: "sess_e2e".to_string(),
        prompt: "读取 Cargo.toml 并分析其中各个依赖库的用途和版本号".to_string(),
        model: "mock-model".to_string(),
        protocol: "openai".to_string(),
        api_key: Some("sk-test".to_string()),
        base_url: format!("http://{addr}"),
        system_prompt: "test".to_string(),
        workspace: ".".to_string(),
        history: vec![],
        allow_dangerous_tools: true,
    };
    let (tx, mut rx) = tokio::sync::mpsc::channel::<AgentEvent>(64);
    tokio::spawn(async move {
        agent.run(req, tx).await;
    });

    let mut events: Vec<AgentEvent> = vec![];
    while let Some(ev) = rx.recv().await {
        events.push(ev);
    }

    // 断言完整工具循环
    assert!(
        events.iter().any(|e| matches!(
            e,
            AgentEvent::Plan { goal, steps, .. } if goal == "读取 Cargo.toml" && steps.len() == 2
        )),
        "应收到规划事件（目标+步骤），实际事件: {events:#?}"
    );
    assert!(
        events
            .iter()
            .any(|e| matches!(e, AgentEvent::ToolStart { tool, .. } if tool == "read_file")),
        "应收到 read_file 的 ToolStart，实际事件: {events:#?}"
    );
    assert!(
        events
            .iter()
            .any(|e| matches!(e, AgentEvent::ToolResult { ok: true, .. })),
        "应收到成功的 ToolResult，实际事件: {events:#?}"
    );
    assert!(
        events
            .iter()
            .any(|e| matches!(e, AgentEvent::Text { delta, .. } if delta == "最终回答")),
        "应收到第二轮最终回答，实际事件: {events:#?}"
    );
    assert!(
        events.iter().any(|e| matches!(e, AgentEvent::Done { .. })),
        "应以 Done 收尾"
    );
}

/// 真实 Ollama 端到端：需要本地 Ollama 服务与 qwen2.5-coder 模型。
/// 复现用户场景「看一个只给文件名的文件」，验证模型触发的工具调用能被识别并执行。
#[tokio::test(flavor = "multi_thread")]
#[ignore = "需要本地 Ollama 服务与 qwen2.5-coder 模型"]
async fn agent_loop_ollama_real_end_to_end() {
    let agent = AgentLoop::default();
    let req = AgentRunRequest {
            session_id: "sess_real_ollama".to_string(),
            prompt: "看看文件 repo-report-9dbfc56d-76c8-4137-a532-097900ab5e56-zh-CN.md".to_string(),
            model: "qwen2.5-coder:14b".to_string(),
            protocol: "ollama".to_string(),
            api_key: None,
            base_url: "http://localhost:11434".to_string(),
            system_prompt: "你是 ForgeOne Coding Agent，具备文件工具。用户提到文件时，先调用 search_files 或 glob 定位真实路径，再 read_file 读取；若定位结果为空，尝试换一种查找方式（换 pattern / 列目录），不要只描述意图。".to_string(),
            workspace: "C:\\Users\\14724\\Desktop".to_string(),
            history: vec![],
            allow_dangerous_tools: true,
        };
    let (tx, mut rx) = tokio::sync::mpsc::channel::<AgentEvent>(64);
    let handle = tokio::spawn(async move {
        agent.run(req, tx).await;
    });

    let mut events: Vec<AgentEvent> = vec![];
    while let Some(ev) = rx.recv().await {
        events.push(ev);
    }

    // 确保 Agent 任务本身没有 panic。
    handle.await.expect("AgentLoop 后台任务执行失败");

    // 将所有事件组装成一条完整日志，避免 println! 被拆散。
    let event_log = format_agent_events(&events);

    println!(
        "\n\
         ==================== AGENT EVENT LOG ====================\n\
         {event_log}\n\
         =========================================================\n"
    );

    assert!(
        events
            .iter()
            .any(|e| matches!(e, AgentEvent::ToolStart { .. })),
        "模型应触发工具调用（search_files / read_file），实际事件: {events:#?}"
    );
}
