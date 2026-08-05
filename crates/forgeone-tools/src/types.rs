use std::collections::HashMap;
use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolKind {
    Builtin,
    Mcp,
    Plugin,
    Skill,
    Workflow,
}

impl ToolKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Builtin => "builtin",
            Self::Mcp => "mcp",
            Self::Plugin => "plugin",
            Self::Skill => "skill",
            Self::Workflow => "workflow",
        }
    }

    pub fn from_manifest_value(value: &str) -> Option<Self> {
        match value {
            "builtin" => Some(Self::Builtin),
            "mcp" => Some(Self::Mcp),
            "plugin" => Some(Self::Plugin),
            "skill" => Some(Self::Skill),
            "workflow" => Some(Self::Workflow),
            _ => None,
        }
    }
}

impl fmt::Display for ToolKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolCallStatus {
    Success,
    ValidationError,
    PermissionDenied,
    Failed,
}

impl fmt::Display for ToolCallStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Success => write!(f, "success"),
            Self::ValidationError => write!(f, "validation_error"),
            Self::PermissionDenied => write!(f, "permission_denied"),
            Self::Failed => write!(f, "failed"),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolDescriptor {
    pub tool_name: String,
    pub description: String,
    pub kind: ToolKind,
    pub required_permissions: Vec<String>,
    /// JSON Schema（`{"type":"object",...}`），传给 LLM 的 tools 参数。
    /// 内置工具由 `builtin_tool_defs()` 静态表提供；MCP / Plugin / Skill
    /// 等外部工具在注册/发现时填充。
    pub input_schema: Option<serde_json::Value>,
}

#[derive(Debug, Clone)]
pub struct ToolCallRequest {
    pub call_id: String,
    pub session_id: String,
    pub agent_id: String,
    pub loop_index: u32,
    pub tool_name: String,
    pub arguments: HashMap<String, String>,
    pub requested_by: String,
}

#[derive(Debug, Clone)]
pub struct ToolCallResult {
    pub call_id: String,
    pub status: ToolCallStatus,
    pub structured_output: HashMap<String, String>,
    pub error: Option<String>,
    pub completed_at_ms: u128,
}

impl ToolCallResult {
    pub fn summary(&self) -> String {
        let keys = self
            .structured_output
            .keys()
            .map(String::as_str)
            .collect::<Vec<_>>()
            .join(",");

        format!(
            "call_id={} status={} output_keys=[{}]",
            self.call_id, self.status, keys
        )
    }
}

#[derive(Debug, Clone)]
pub struct Observation {
    pub tool_name: String,
    pub summary: String,
    /// Full tool output content, if available.
    /// For read_file this is the file preview text.
    pub content: Option<String>,
}

pub trait ToolExecutor: Send + Sync {
    fn descriptor(&self) -> ToolDescriptor;
    fn execute(&self, request: &ToolCallRequest) -> ToolCallResult;

    /// 类型下探：运行时用于识别具体执行器（如 MCP 执行器做健康检查）
    fn as_any(&self) -> &dyn std::any::Any {
        &()
    }
}
