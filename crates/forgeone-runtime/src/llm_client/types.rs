use serde::{Deserialize, Serialize};
use serde_json::Value;

// ── 请求 / 响应数据结构 ────────────────────────────────────────────

/// 发送给 LLM 的单条消息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmMessage {
    pub role: String,
    pub content: LlmContent,
}

/// 消息内容：简单文本或结构化 block 列表
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum LlmContent {
    Text(String),
    Blocks(Vec<LlmBlock>),
}

/// 消息内的内容块（tool_use / tool_result / text）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmBlock {
    #[serde(rename = "type")]
    pub block_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_use_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
}

/// 工具 JSON Schema 定义（传给 LLM 的 tools 参数）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmToolDef {
    pub name: String,
    pub description: String,
    pub input_schema: Value,
}

/// LLM 调用请求
#[derive(Debug, Clone)]
pub struct LlmRequest {
    pub model: String,
    pub protocol: LlmProtocol,
    pub api_key: Option<String>,
    pub base_url: String,
    pub system: String,
    pub messages: Vec<LlmMessage>,
    pub tools: Vec<LlmToolDef>,
    pub max_tokens: u32,
}

/// 支持的 LLM 协议
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LlmProtocol {
    OpenAi,
    Anthropic,
    Ollama,
}

/// LLM 返回的一个工具调用
#[derive(Debug, Clone)]
pub struct LlmToolCall {
    pub id: String,
    pub name: String,
    pub input: Value,
}

/// LLM 响应的完整结果（流式积累完毕后得到）
#[derive(Debug, Clone)]
pub struct LlmResponse {
    pub thinking: Option<String>,
    pub text: Option<String>,
    pub tool_calls: Vec<LlmToolCall>,
    pub stop_reason: String,
}

/// 流式 chunk 事件，用于逐步推送给 AgentLoop
#[derive(Debug, Clone)]
pub enum LlmChunk {
    ThinkingDelta(String),
    TextDelta(String),
    ToolCallStart { id: String, name: String },
    ToolCallInputDelta { id: String, delta: String },
    Done(LlmResponse),
    Error(String),
}
