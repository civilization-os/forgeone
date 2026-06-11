use std::collections::HashMap;
use std::fmt;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static TOOL_CALL_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolKind {
    Builtin,
    Mcp,
    Plugin,
    Skill,
    Workflow,
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

#[derive(Debug, Clone)]
pub struct ToolDescriptor {
    pub tool_name: String,
    pub description: String,
    pub kind: ToolKind,
    pub required_permissions: Vec<String>,
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
}

pub trait ToolExecutor: Send + Sync {
    fn descriptor(&self) -> ToolDescriptor;
    fn execute(&self, request: &ToolCallRequest) -> ToolCallResult;
}

#[derive(Default)]
pub struct ToolRegistry {
    executors: HashMap<String, Arc<dyn ToolExecutor>>,
}

impl ToolRegistry {
    pub fn with_builtin_tools() -> Self {
        let mut registry = Self::default();
        registry.register(ReadFileTool);
        registry
    }

    pub fn register<T>(&mut self, tool: T)
    where
        T: ToolExecutor + 'static,
    {
        let name = tool.descriptor().tool_name.clone();
        self.executors.insert(name, Arc::new(tool));
    }

    pub fn execute(&self, request: &ToolCallRequest) -> ToolCallResult {
        let Some(executor) = self.executors.get(&request.tool_name) else {
            return ToolCallResult {
                call_id: request.call_id.clone(),
                status: ToolCallStatus::ValidationError,
                structured_output: HashMap::new(),
                error: Some(format!("unknown_tool={}", request.tool_name)),
                completed_at_ms: now_ms(),
            };
        };

        executor.execute(request)
    }
}

#[derive(Debug, Clone, Copy)]
pub struct ReadFileTool;

impl ToolExecutor for ReadFileTool {
    fn descriptor(&self) -> ToolDescriptor {
        ToolDescriptor {
            tool_name: "read_file".to_string(),
            description: "Read a file from the local workspace".to_string(),
            kind: ToolKind::Builtin,
            required_permissions: vec!["fs_read".to_string()],
        }
    }

    fn execute(&self, request: &ToolCallRequest) -> ToolCallResult {
        let Some(path) = request.arguments.get("path") else {
            return ToolCallResult {
                call_id: request.call_id.clone(),
                status: ToolCallStatus::ValidationError,
                structured_output: HashMap::new(),
                error: Some("missing_argument=path".to_string()),
                completed_at_ms: now_ms(),
            };
        };

        let path_buf = PathBuf::from(path);
        match fs::read_to_string(&path_buf) {
            Ok(content) => {
                let mut structured_output = HashMap::new();
                structured_output.insert("path".to_string(), path.clone());
                structured_output.insert(
                    "preview".to_string(),
                    content.lines().take(12).collect::<Vec<_>>().join("\n"),
                );
                structured_output.insert("bytes".to_string(), content.len().to_string());

                ToolCallResult {
                    call_id: request.call_id.clone(),
                    status: ToolCallStatus::Success,
                    structured_output,
                    error: None,
                    completed_at_ms: now_ms(),
                }
            }
            Err(error) => ToolCallResult {
                call_id: request.call_id.clone(),
                status: ToolCallStatus::Failed,
                structured_output: HashMap::new(),
                error: Some(error.to_string()),
                completed_at_ms: now_ms(),
            },
        }
    }
}

pub fn next_tool_call_id() -> String {
    let counter = TOOL_CALL_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("tool-call-{counter}")
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time should be after unix epoch")
        .as_millis()
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::{ToolCallRequest, ToolCallStatus, ToolRegistry, next_tool_call_id};

    #[test]
    fn read_file_tool_returns_preview() {
        let registry = ToolRegistry::with_builtin_tools();
        let mut arguments = HashMap::new();
        arguments.insert("path".to_string(), "Cargo.toml".to_string());

        let result = registry.execute(&ToolCallRequest {
            call_id: next_tool_call_id(),
            session_id: "session-1".to_string(),
            agent_id: "agent-1".to_string(),
            loop_index: 1,
            tool_name: "read_file".to_string(),
            arguments,
            requested_by: "runtime".to_string(),
        });

        assert_eq!(result.status, ToolCallStatus::Success);
        assert!(result.structured_output.contains_key("preview"));
    }
}
