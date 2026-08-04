use serde::{Deserialize, Serialize};
use serde_json::Value;

// ── 事件类型 ──────────────────────────────────────────────────────

/// Agent Loop 向前端推送的事件
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentEvent {
    /// 思考链增量
    Thinking {
        delta: String,
        loop_index: u32,
    },
    /// 文本回复增量
    Text {
        delta: String,
        loop_index: u32,
    },
    /// 工具调用开始
    ToolStart {
        tool_call_id: String,
        tool: String,
        args: Value,
        loop_index: u32,
        requires_approval: bool,
    },
    /// 工具执行结果
    ToolResult {
        tool_call_id: String,
        tool: String,
        output: String,
        loop_index: u32,
        ok: bool,
    },
    /// 需要用户审批（危险工具）
    ApprovalRequired {
        tool_call_id: String,
        tool: String,
        args: Value,
        reason: String,
        loop_index: u32,
    },
    /// 用户拒绝了工具调用
    ToolRejected {
        tool_call_id: String,
        tool: String,
        loop_index: u32,
    },
    /// 目标与执行计划（Agent Loop 规划阶段产出）
    Plan {
        goal: String,
        steps: Vec<String>,
        loop_index: u32,
    },
    /// 循环完成
    Done {
        loops: u32,
        stop_reason: String,
    },
    /// 发生错误
    Error {
        message: String,
    },
}


// ── 审批状态存储 ──────────────────────────────────────────────────

/// 等待用户审批的工具调用
#[derive(Debug, Clone)]
pub struct PendingApproval {
    pub tool_call_id: String,
    pub tool_name: String,
    pub args: Value,
    /// approved / rejected / None（等待中）
    pub decision: Option<bool>,
}
