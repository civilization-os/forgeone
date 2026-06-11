use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};

pub use forgeone_context::PromptMessage;

static RESPONSE_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone)]
pub struct ModelRequest {
    pub request_id: String,
    pub model_name: String,
    pub messages: Vec<PromptMessage>,
    pub prompt_token_estimate: u32,
}

impl ModelRequest {
    pub fn summary(&self) -> String {
        let roles = self
            .messages
            .iter()
            .map(|message| message.role.as_str())
            .collect::<Vec<_>>()
            .join(",");
        let source_refs = self
            .messages
            .iter()
            .map(|message| message.source_segment_refs.len())
            .sum::<usize>();

        format!(
            "request_id={} messages={} roles=[{}] source_refs={} prompt_tokens={}",
            self.request_id,
            self.messages.len(),
            roles,
            source_refs,
            self.prompt_token_estimate
        )
    }
}

#[derive(Debug, Clone)]
pub struct ModelResponse {
    pub response_id: String,
    pub action: ModelAction,
    pub summary: String,
}

#[derive(Debug, Clone)]
pub enum ModelAction {
    RequestTool {
        tool_name: String,
        arguments: HashMap<String, String>,
    },
    FinalResponse {
        content: String,
    },
}

pub trait ModelAdapter {
    fn respond(&self, request: &ModelRequest) -> ModelResponse;
}

#[derive(Debug, Clone, Default)]
pub struct MockModelAdapter;

impl ModelAdapter for MockModelAdapter {
    fn respond(&self, request: &ModelRequest) -> ModelResponse {
        let has_observation = request
            .messages
            .iter()
            .any(|message| message.content.contains("tool=read_file"));

        if has_observation {
            return ModelResponse {
                response_id: next_response_id(),
                action: ModelAction::FinalResponse {
                    content: "Mock model produced final response after observation".to_string(),
                },
                summary: "mock model finalized after observation".to_string(),
            };
        }

        let mut arguments = HashMap::new();
        arguments.insert(
            "path".to_string(),
            "crates/forgeone-runtime/src/lib.rs".to_string(),
        );

        ModelResponse {
            response_id: next_response_id(),
            action: ModelAction::RequestTool {
                tool_name: "read_file".to_string(),
                arguments,
            },
            summary: "mock model requested read_file for runtime source".to_string(),
        }
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
    use super::{MockModelAdapter, ModelAction, ModelAdapter, ModelRequest, PromptMessage, next_model_request_id};

    #[test]
    fn mock_model_requests_tool_before_observation() {
        let adapter = MockModelAdapter;
        let response = adapter.respond(&ModelRequest {
            request_id: next_model_request_id(),
            model_name: "mock-model".to_string(),
            messages: vec![PromptMessage {
                message_id: "message-1".to_string(),
                role: "user".to_string(),
                content: "inspect runtime".to_string(),
                source_segment_refs: vec!["segment-1".to_string()],
            }],
            prompt_token_estimate: 8,
        });

        assert!(matches!(response.action, ModelAction::RequestTool { .. }));
    }
}
