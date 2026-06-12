use std::collections::HashMap;

use forgeone_model::{
    ModelAction, ModelAdapter, ModelCapabilities, ModelRequest, ModelRequestEstimate,
    ModelResponse,
};

/// OpenAI-compatible model adapter.
///
/// Connects to any OpenAI-compatible chat completions endpoint
/// (OpenAI, Azure, or local proxies). Reads API key from
/// `OPENAI_API_KEY` environment variable and base URL from
/// `OPENAI_BASE_URL` (defaults to `https://api.openai.com/v1`).
///
/// The model is expected to output tool requests in a structured
/// JSON format embedded in the response text.
pub struct OpenAiModelAdapter {
    api_key: String,
    model: String,
    base_url: String,
}

impl OpenAiModelAdapter {
    /// Create a new adapter with explicit configuration.
    pub fn new(
        api_key: impl Into<String>,
        model: impl Into<String>,
        base_url: impl Into<String>,
    ) -> Self {
        Self {
            api_key: api_key.into(),
            model: model.into(),
            base_url: base_url.into(),
        }
    }

    /// Create from environment variables. Panics if `OPENAI_API_KEY` is not set.
    ///
    /// - `OPENAI_API_KEY` (required)
    /// - `OPENAI_BASE_URL` (optional, defaults to `https://api.openai.com/v1`)
    /// - `OPENAI_MODEL` (optional, defaults to `gpt-4o`)
    pub fn from_env() -> Self {
        let api_key = std::env::var("OPENAI_API_KEY")
            .expect("OPENAI_API_KEY must be set when using OpenAiModelAdapter::from_env()");
        let base_url = std::env::var("OPENAI_BASE_URL")
            .unwrap_or_else(|_| "https://api.openai.com/v1".to_string());
        let model = std::env::var("OPENAI_MODEL").unwrap_or_else(|_| "gpt-4o".to_string());
        Self::new(api_key, model, base_url)
    }
}

impl ModelAdapter for OpenAiModelAdapter {
    fn capabilities(&self, model_name: &str) -> ModelCapabilities {
        let normalized = model_name.to_ascii_lowercase();
        if normalized.contains("gpt-4.1") {
            return ModelCapabilities {
                context_window: 1_000_000,
                reserved_output_tokens: 32_000,
            };
        }
        if normalized.contains("gpt-4o-mini") {
            return ModelCapabilities {
                context_window: 128_000,
                reserved_output_tokens: 12_000,
            };
        }
        ModelCapabilities {
            context_window: 128_000,
            reserved_output_tokens: 16_000,
        }
    }

    fn estimate(&self, request: &ModelRequest) -> ModelRequestEstimate {
        let caps = self.capabilities(&request.model_name);
        let message_overhead = request.messages.len() as u32 * 12;
        let total_expected_tokens = request
            .prompt_token_estimate
            .saturating_add(message_overhead)
            .saturating_add(caps.reserved_output_tokens);
        ModelRequestEstimate {
            prompt_tokens: request.prompt_token_estimate.saturating_add(message_overhead),
            total_expected_tokens,
            within_context_window: total_expected_tokens <= caps.context_window,
        }
    }

    fn respond(&self, request: &ModelRequest) -> ModelResponse {
        let response_id = format!("openai-{}", chrono_id());
        let payload = build_payload(request, &self.model);
        let url = format!("{}/chat/completions", self.base_url.trim_end_matches('/'));

        let response_body: serde_json::Value =
            match ureq::post(&url)
                .set("Authorization", &format!("Bearer {}", self.api_key))
                .set("Content-Type", "application/json")
                .send_json(&payload)
            {
                Ok(response) => match response.into_json() {
                    Ok(json) => json,
                    Err(error) => {
                        return ModelResponse {
                            response_id,
                            action: ModelAction::FinalResponse {
                                content: format!(
                                    "[openai adapter] failed to parse response: {error}"
                                ),
                            },
                            summary: format!("openai parse error: {error}"),
                        };
                    }
                },
                Err(error) => {
                    return ModelResponse {
                        response_id,
                        action: ModelAction::FinalResponse {
                            content: format!("[openai adapter] request failed: {error}"),
                        },
                        summary: format!("openai request error: {error}"),
                    };
                }
            };

        parse_response(&response_body, &response_id)
    }
}

fn build_payload(request: &ModelRequest, model: &str) -> serde_json::Value {
    let messages: Vec<serde_json::Value> = request
        .messages
        .iter()
        .map(|msg| {
            serde_json::json!({
                "role": msg.role,
                "content": msg.content,
            })
        })
        .collect();

    serde_json::json!({
        "model": model,
        "messages": messages,
        "temperature": 0.2,
    })
}

fn parse_response(body: &serde_json::Value, response_id: &str) -> ModelResponse {
    // Extract the response content
    let raw_content = body["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("")
        .to_string();

    // Strip markdown code fences (```json ... ``` or ``` ... ```)
    // Models often wrap JSON tool calls in code blocks
    let content = strip_code_fence(&raw_content);

    // Try to parse as a structured tool-call JSON
    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&content)
        && let Some(tool_name) = parsed.get("tool").and_then(|v| v.as_str())
    {
        let mut arguments = HashMap::new();
        if let Some(args) = parsed.get("arguments").and_then(|v| v.as_object()) {
            for (key, value) in args {
                arguments.insert(
                    key.clone(),
                    value.as_str().unwrap_or(&value.to_string()).to_string(),
                );
            }
        }
        return ModelResponse {
            response_id: response_id.to_string(),
            action: ModelAction::RequestTool {
                tool_name: tool_name.to_string(),
                arguments,
            },
            summary: format!("openai requested tool={tool_name}"),
        };
    }

    // Could not parse as a tool call — treat as final response.
    // Use raw_content (with code fences) so the model's full output is preserved.
    let summary = truncate_summary(&content);

    ModelResponse {
        response_id: response_id.to_string(),
        action: ModelAction::FinalResponse { content: raw_content },
        summary,
    }
}

/// Truncate a string for summary display, safe for multi-byte characters.
fn truncate_summary(content: &str) -> String {
    if content.len() > 120 {
        // Use char boundary for safe slicing
        let mut end = 117;
        while !content.is_char_boundary(end) {
            end += 1;
        }
        format!("{}...", &content[..end])
    } else {
        content.to_string()
    }
}

/// Strip markdown code fences from the beginning/end of content.
/// Models often wrap JSON tool calls in ```json ... ``` blocks.
fn strip_code_fence(text: &str) -> String {
    let trimmed = text.trim();
    if trimmed.starts_with("```") {
        // Remove opening fence (```json, ```, etc.) and closing fence
        let after_fence = trimmed
            .strip_prefix("```")
            .unwrap_or(trimmed);
        // Skip optional language identifier line
        let body = if let Some(pos) = after_fence.find('\n') {
            &after_fence[pos + 1..]
        } else {
            after_fence
        };
        // Strip trailing ``` if present
        if let Some(end) = body.rfind("```") {
            body[..end].trim().to_string()
        } else {
            body.trim().to_string()
        }
    } else {
        text.to_string()
    }
}

fn chrono_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("{nanos}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use forgeone_model::{ModelAdapter, next_model_request_id};
    use forgeone_model::PromptMessage;

    #[test]
    fn parses_tool_call_json_from_response() {
        let body: serde_json::Value = serde_json::json!({
            "choices": [{
                "message": {
                    "content": r#"{"tool": "read_file", "arguments": {"path": "Cargo.toml"}}"#
                }
            }]
        });

        let response = parse_response(&body, "test-1");
        assert!(matches!(response.action, ModelAction::RequestTool { .. }));
        match response.action {
            ModelAction::RequestTool {
                ref tool_name,
                ref arguments,
            } => {
                assert_eq!(tool_name, "read_file");
                assert_eq!(
                    arguments.get("path").map(String::as_str),
                    Some("Cargo.toml")
                );
            }
            _ => unreachable!(),
        }
    }

    #[test]
    fn parses_final_response_when_no_tool_call() {
        let body: serde_json::Value = serde_json::json!({
            "choices": [{
                "message": {
                    "content": "I found the answer. The project has 7 crates."
                }
            }]
        });

        let response = parse_response(&body, "test-2");
        assert!(matches!(response.action, ModelAction::FinalResponse { .. }));
    }

    #[test]
    fn builds_payload_with_correct_structure() {
        let request = ModelRequest {
            request_id: next_model_request_id(),
            model_name: "gpt-4o".to_string(),
            messages: vec![
                PromptMessage {
                    message_id: "m1".to_string(),
                    role: "system".to_string(),
                    content: "You are an agent.".to_string(),
                    source_segment_refs: vec![],
                },
                PromptMessage {
                    message_id: "m2".to_string(),
                    role: "user".to_string(),
                    content: "Hello".to_string(),
                    source_segment_refs: vec![],
                },
            ],
            prompt_token_estimate: 10,
            context_window: 128_000,
        };

        let payload = build_payload(&request, "gpt-4o-mini");
        assert_eq!(payload["model"], "gpt-4o-mini");
        assert_eq!(payload["messages"].as_array().unwrap().len(), 2);
        assert_eq!(payload["messages"][0]["role"], "system");
        assert_eq!(payload["messages"][1]["content"], "Hello");
    }

    #[test]
    fn openai_adapter_reports_capabilities_and_estimate() {
        let adapter = OpenAiModelAdapter::new("", "gpt-4o", "https://api.openai.com/v1");
        let request = ModelRequest {
            request_id: next_model_request_id(),
            model_name: "openai:gpt-4o".to_string(),
            messages: vec![PromptMessage {
                message_id: "m1".to_string(),
                role: "user".to_string(),
                content: "Hello".to_string(),
                source_segment_refs: vec![],
            }],
            prompt_token_estimate: 20,
            context_window: 128_000,
        };

        let caps = adapter.capabilities(&request.model_name);
        let estimate = adapter.estimate(&request);
        assert!(caps.context_window >= 128_000);
        assert!(estimate.within_context_window);
        assert!(estimate.total_expected_tokens > estimate.prompt_tokens);
    }
}
