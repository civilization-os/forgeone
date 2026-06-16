use std::collections::HashMap;

use forgeone_model::{
    ModelError,
    ModelAction, ModelAdapter, ModelCapabilities, ModelRequest, ModelRequestEstimate, ModelResponse, PromptMessage, ToolCall, ContextSnapshot
};

/// Ollama local model adapter.
///
/// Connects to a local Ollama instance (default `http://localhost:11434`).
/// Also provides management methods (`OllamaClient`) for listing,
/// pulling, and checking local models.
///
/// Model naming follows Ollama conventions (e.g. `qwen2.5-coder:7b`,
/// `llama3.2:3b`). The model selection is passed via `model_name`
/// in `ModelRequest`.
pub struct OllamaModelAdapter {
    endpoint: String,
}

impl OllamaModelAdapter {
    /// Create a new adapter connected to the given Ollama endpoint.
    pub fn new(endpoint: impl Into<String>) -> Self {
        Self {
            endpoint: endpoint.into(),
        }
    }

    /// Create from environment variables.
    ///
    /// - `OLLAMA_ENDPOINT` (optional, defaults to `http://localhost:11434`)
    pub fn from_env() -> Self {
        let endpoint = std::env::var("OLLAMA_ENDPOINT")
            .unwrap_or_else(|_| "http://localhost:11434".to_string());
        Self::new(endpoint)
    }

    /// Return a client for model management operations.
    pub fn client(&self) -> OllamaClient {
        OllamaClient {
            endpoint: self.endpoint.clone(),
        }
    }
}

impl ModelAdapter for OllamaModelAdapter {
    fn capabilities(&self, model_name: &str) -> ModelCapabilities {
        let normalized = model_name.to_ascii_lowercase();
        if normalized.contains("qwen2.5-coder:32b") || normalized.contains("qwen2.5-coder:14b") {
            return ModelCapabilities {
                context_window: 32_000,
                reserved_output_tokens: 4_000,
                supports_vision: false,
                supports_tool_role: false,
            };
        }
        if normalized.contains("qwen2.5-coder:7b")
            || normalized.contains("deepseek")
            || normalized.contains("llama")
        {
            return ModelCapabilities {
                context_window: 16_000,
                reserved_output_tokens: 2_000,
                supports_vision: false,
                supports_tool_role: false,
            };
        }
        ModelCapabilities {
            context_window: 16_000,
            reserved_output_tokens: 2_000,
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

    fn respond(&self, snapshot: &ContextSnapshot, request: &ModelRequest) -> Result<ModelResponse, ModelError> {
        let response_id = format!("ollama-{}", chrono_id());
        let formatted = self.format_messages(snapshot);
        let payload = build_ollama_payload(request, &formatted);
        let url = format!("{}/api/chat", self.endpoint.trim_end_matches('/'));

        let response_body: serde_json::Value = match ureq::post(&url)
            .set("Content-Type", "application/json")
            .send_json(&payload)
        {
            Ok(response) => match response.into_json() {
                Ok(json) => json,
                Err(error) => {
                    return Err(ModelError::FormatError(error.to_string()));
                }
            },
            Err(error) => {
                return Err(ModelError::NetworkError(error.to_string()));
            }
        };

        // Extract content from Ollama response format
        let raw_content = response_body["message"]["content"]
            .as_str()
            .unwrap_or("")
            .to_string();

        // Strip markdown code fences (```json ... ``` or ``` ... ```)
        let content = strip_code_fence(&raw_content);

        // Try to extract dynamic JSON block, or fall back to code-fence stripped content
        let content_to_parse = extract_json_block(&content).unwrap_or(content);

        // Try to parse as structured tool-call JSON (same format as OpenAI adapter)
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&content_to_parse)
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
            return Ok(ModelResponse {
                response_id,
                action: ModelAction::RequestTools {
                    content: None,
                    tool_calls: vec![ToolCall {
                        id: format!("tool-{tool_name}"),
                        tool_name: tool_name.to_string(),
                        arguments,
                    }],
                },
                summary: format!("ollama requested tool={tool_name}"),
            })
        }

        // Fall through to final response.
        // Use raw_content (with code fences) so the model's full output is preserved.
        let content_stripped = strip_code_fence(&raw_content);
        let summary = truncate_summary(&content_stripped);

        Ok(ModelResponse {
            response_id,
            action: ModelAction::FinalResponse {
                content: raw_content,
            },
            summary,
        })
    }
}

fn extract_json_block(text: &str) -> Option<String> {
    let start_idx = text.find("{\"tool\"")
        .or_else(|| text.find("{\"tool\":"))
        .or_else(|| text.find("{ \"tool\""))?;

    let mut depth = 0;
    let bytes = text.as_bytes();
    for i in start_idx..bytes.len() {
        if bytes[i] == b'{' {
            depth += 1;
        } else if bytes[i] == b'}' {
            depth -= 1;
            if depth == 0 {
                return Some(text[start_idx..=i].to_string());
            }
        }
    }
    None
}

/// Extract the bare model name from a prefixed name.
/// e.g. "ollama:qwen2.5-coder:7b" → "qwen2.5-coder:7b"
///      "qwen2.5-coder:7b" → "qwen2.5-coder:7b"
fn strip_model_prefix(name: &str) -> &str {
    name.split_once(':')
        .map(
            |(prefix, rest)| {
                if prefix == "ollama" { rest } else { name }
            },
        )
        .unwrap_or(name)
}

fn build_ollama_payload(request: &ModelRequest, messages: &[PromptMessage]) -> serde_json::Value {
    let message_values: Vec<serde_json::Value> = messages
        .iter()
        .map(|msg| {
            serde_json::json!({
                "role": msg.role,
                "content": msg.content,
            })
        })
        .collect();

    let mut payload = serde_json::json!({
        "model": strip_model_prefix(&request.model_name),
        "messages": message_values,
        "stream": false,
        "options": {
            "temperature": 0.2
        }
    });

    if let Some(max_output_tokens) = request.max_output_tokens {
        payload["options"]["num_predict"] = serde_json::json!(max_output_tokens);
    }

    payload
}

/// Client for Ollama model management (list, pull, check).
#[derive(Clone)]
pub struct OllamaClient {
    endpoint: String,
}

impl OllamaClient {
    /// List all models currently available in the local Ollama instance.
    pub fn list_models(&self) -> Result<Vec<String>, String> {
        let url = format!("{}/api/tags", self.endpoint.trim_end_matches('/'));

        let body: serde_json::Value = ureq::get(&url)
            .call()
            .map_err(|e| format!("failed to list ollama models: {e}"))?
            .into_json()
            .map_err(|e| format!("failed to parse response: {e}"))?;

        let models = body["models"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|m| m["name"].as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default();

        Ok(models)
    }

    /// Check if a specific model is available locally.
    pub fn has_model(&self, model_name: &str) -> Result<bool, String> {
        let models = self.list_models()?;
        Ok(models
            .iter()
            .any(|m| m == model_name || m.starts_with(model_name)))
    }

    /// Pull a model from the Ollama registry (blocks until complete).
    pub fn pull_model(&self, model_name: &str) -> Result<(), String> {
        let url = format!("{}/api/pull", self.endpoint.trim_end_matches('/'));
        let payload = serde_json::json!({ "name": model_name });

        let _body: serde_json::Value = ureq::post(&url)
            .set("Content-Type", "application/json")
            .send_json(&payload)
            .map_err(|e| format!("failed to pull model {model_name}: {e}"))?
            .into_json()
            .map_err(|e| format!("failed to parse pull response: {e}"))?;

        Ok(())
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
        let after_fence = trimmed.strip_prefix("```").unwrap_or(trimmed);
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
    use forgeone_model::PromptMessage;
    use forgeone_model::{ModelAdapter, next_model_request_id};

    #[test]
    fn strips_prefix_in_payload() {
        // model_name comes from Runtime as "ollama:qwen2.5-coder:7b"
        let request = ModelRequest {
            request_id: next_model_request_id(),
            model_name: "ollama:qwen2.5-coder:7b".to_string(),
            prompt_token_estimate: 5,
            context_window: 16_000,
            max_output_tokens: Some(4096),
        };
        let messages = vec![PromptMessage {
            message_id: "m1".to_string(),
            role: "user".to_string(),
            content: "Hello".to_string(),
            source_segment_refs: vec![],
            tool_call_id: None,
        }];

        let payload = build_ollama_payload(&request, &messages);
        // Prefix "ollama:" must be stripped
        assert_eq!(payload["model"], "qwen2.5-coder:7b");
        assert_eq!(payload["messages"][0]["role"], "user");
        assert_eq!(payload["stream"], false);
        assert_eq!(payload["options"]["num_predict"], 4096);
    }

    #[test]
    fn strip_model_prefix_works() {
        assert_eq!(
            strip_model_prefix("ollama:qwen2.5-coder:7b"),
            "qwen2.5-coder:7b"
        );
        assert_eq!(strip_model_prefix("qwen2.5-coder:7b"), "qwen2.5-coder:7b");
        assert_eq!(strip_model_prefix("mock"), "mock");
    }

    #[test]
    fn ollama_adapter_reports_capabilities_and_estimate() {
        let adapter = OllamaModelAdapter::new("http://localhost:11434");
        let request = ModelRequest {
            request_id: next_model_request_id(),
            model_name: "ollama:qwen2.5-coder:7b".to_string(),
            prompt_token_estimate: 20,
            context_window: 16_000,
            max_output_tokens: None,
        };

        let caps = adapter.capabilities(&request.model_name);
        let estimate = adapter.estimate(&request);
        assert_eq!(caps.context_window, 16_000);
        assert!(estimate.within_context_window);
        assert!(estimate.total_expected_tokens > estimate.prompt_tokens);
    }
}
