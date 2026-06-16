use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};

pub use forgeone_context::{ContextSnapshot, PromptMessage, ModelCapabilities};

static RESPONSE_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ModelRequestEstimate {
    pub prompt_tokens: u32,
    pub total_expected_tokens: u32,
    pub within_context_window: bool,
}

#[derive(Debug, Clone)]
pub struct ModelRequest {
    pub request_id: String,
    pub model_name: String,
    pub prompt_token_estimate: u32,
    pub context_window: u32,
    pub max_output_tokens: Option<u32>,
}

impl ModelRequest {
    pub fn summary(&self) -> String {
        format!(
            "request_id={} prompt_tokens={} context_window={} max_output_tokens={}",
            self.request_id,
            self.prompt_token_estimate,
            self.context_window,
            self.max_output_tokens
                .map(|value| value.to_string())
                .unwrap_or_else(|| "auto".to_string())
        )
    }
}

#[derive(Debug, Clone)]
pub struct ModelResponse {
    pub response_id: String,
    pub action: ModelAction,
    pub summary: String,
}

/// A single tool call requested by the model.
#[derive(Debug, Clone)]
pub struct ToolCall {
    pub id: String,
    pub tool_name: String,
    pub arguments: HashMap<String, String>,
}

#[derive(Debug, Clone)]
pub enum ModelAction {
    /// Model requests tools (zero or more) with optional text content.
    RequestTools {
        content: Option<String>,
        tool_calls: Vec<ToolCall>,
    },
    FinalResponse {
        content: String,
    },
}

#[derive(Debug, Clone)]
pub enum ModelError {
    FormatError(String),
    NetworkError(String),
    RateLimit,
    Timeout,
    ProviderUnavailable(String),
}

impl std::fmt::Display for ModelError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::FormatError(msg) => write!(f, "format error: {msg}"),
            Self::NetworkError(msg) => write!(f, "network error: {msg}"),
            Self::RateLimit => write!(f, "rate limit exceeded"),
            Self::Timeout => write!(f, "request timed out"),
            Self::ProviderUnavailable(msg) => write!(f, "provider unavailable: {msg}"),
        }
    }
}

impl std::error::Error for ModelError {}


pub trait ModelAdapter {
    fn capabilities(&self, model_name: &str) -> ModelCapabilities;
    fn estimate(&self, request: &ModelRequest) -> ModelRequestEstimate;
    fn format_messages(&self, snapshot: &ContextSnapshot) -> Vec<PromptMessage> {
        snapshot.prompt_messages.clone()
    }
    fn respond(&self, snapshot: &ContextSnapshot, request: &ModelRequest) -> Result<ModelResponse, ModelError>;
}

#[derive(Debug, Clone, Default)]
pub struct MockModelAdapter;

impl MockModelAdapter {
    fn format_messages(&self, snapshot: &ContextSnapshot) -> Vec<PromptMessage> {
        snapshot.prompt_messages.clone()
    }
}

impl ModelAdapter for MockModelAdapter {
    fn capabilities(&self, _model_name: &str) -> ModelCapabilities {
        ModelCapabilities {
            context_window: 32_000,
            reserved_output_tokens: 4_000,
            supports_vision: false,
            supports_tool_role: false,
        }
    }

    fn estimate(&self, request: &ModelRequest) -> ModelRequestEstimate {
        let caps = self.capabilities(&request.model_name);
        let total_expected_tokens = request
            .prompt_token_estimate
            .saturating_add(caps.reserved_output_tokens);
        ModelRequestEstimate {
            prompt_tokens: request.prompt_token_estimate,
            total_expected_tokens,
            within_context_window: total_expected_tokens <= caps.context_window,
        }
    }

    fn respond(&self, snapshot: &ContextSnapshot, _request: &ModelRequest) -> Result<ModelResponse, ModelError> {
        let formatted = self.format_messages(snapshot);
        let has_observation = formatted
            .iter()
            .any(|message| message.content.contains("tool=read_file"));

        if has_observation {
            return Ok(ModelResponse {
                response_id: next_response_id(),
                action: ModelAction::FinalResponse {
                    content: "Mock model produced final response after observation".to_string(),
                },
                summary: "mock model finalized after observation".to_string(),
            });
        }

        let mut arguments = HashMap::new();
        arguments.insert(
            "path".to_string(),
            "crates/forgeone-runtime/src/lib.rs".to_string(),
        );

        Ok(ModelResponse {
            response_id: next_response_id(),
            action: ModelAction::RequestTools {
                content: None,
                tool_calls: vec![ToolCall {
                    id: "mock-call-1".to_string(),
                    tool_name: "read_file".to_string(),
                    arguments,
                }],
            },
            summary: "mock model requested read_file for runtime source".to_string(),
        })
    }
}

pub fn next_model_request_id() -> String {
    let counter = RESPONSE_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("model-request-{counter}")
}

fn next_response_id() -> String {
    let counter = RESPONSE_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("model-response-{counter}")
}

#[cfg(test)]
mod tests {
    use super::{
        MockModelAdapter, ModelAction, ModelAdapter, ModelRequest, PromptMessage,
        next_model_request_id,
    };
    use forgeone_context::{ContextBudget, ContextSnapshot};

    #[test]
    fn mock_model_requests_tool_before_observation() {
        let adapter = MockModelAdapter;
        let snapshot = ContextSnapshot {
            snapshot_id: "snap-1".to_string(),
            session_id: "s-1".to_string(),
            agent_id: "a-1".to_string(),
            loop_index: 0,
            sources: vec![],
            selected_segments: vec![],
            compression_events: vec![],
            layers: vec![],
            prompt_messages: vec![PromptMessage {
                message_id: "m-1".to_string(),
                role: "user".to_string(),
                content: "inspect runtime".to_string(),
                source_segment_refs: vec![],
                tool_call_id: None,
            }],
            budget: ContextBudget {
                total_tokens: 32000,
                reserved_system_tokens: 0,
                reserved_working_memory_tokens: 0,
                reserved_recent_tokens: 0,
                reserved_observation_tokens: 0,
            },
            budget_estimate: 8,
        };
        let response = adapter.respond(&snapshot, &ModelRequest {
            request_id: next_model_request_id(),
            model_name: "mock-model".to_string(),
            prompt_token_estimate: 8,
            context_window: 32_000,
            max_output_tokens: None,
        }).unwrap();

        assert!(matches!(response.action, ModelAction::RequestTools { .. }));
    }

    #[test]
    fn infers_model_capabilities_by_provider_prefix() {
        let adapter = MockModelAdapter;
        let fallback = adapter.capabilities("mock-model");

        assert_eq!(fallback.context_window, 32_000);
        assert!(fallback.input_budget() < fallback.context_window);
    }
}
