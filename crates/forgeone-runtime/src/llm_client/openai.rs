use crate::llm_client::types::{LlmBlock, LlmChunk, LlmContent, LlmRequest, LlmResponse, LlmToolCall};
use crate::llm_client::LlmClient;
use serde_json::{json, Value};

/// 构建 OpenAI 兼容 messages：tool_use → tool_calls 字段，tool_result → role=tool 消息
/// （OpenAI/DeepSeek 规范：function.arguments 必须是 JSON 字符串，不能是对象）
fn build_openai_messages(req: &LlmRequest) -> Vec<Value> {
    let mut messages: Vec<Value> = vec![json!({
        "role": "system",
        "content": req.system,
    })];
    for m in req.messages.iter().filter(|m| m.role != "system") {
        match &m.content {
            LlmContent::Text(t) => {
                messages.push(json!({ "role": m.role, "content": t }));
            }
            LlmContent::Blocks(blocks) => {
                let mut content_parts: Vec<String> = vec![];
                let mut tool_calls: Vec<Value> = vec![];
                for b in blocks {
                    match b.block_type.as_str() {
                        "thinking" => {
                            // OpenAI 无 thinking 块，忽略（reasoning 由 API 自行返回）
                        }
                        "text" => {
                            if let Some(t) = &b.text {
                                content_parts.push(t.clone());
                            }
                        }
                        "tool_use" => {
                            tool_calls.push(build_openai_tool_call(b));
                        }
                        "tool_result" => {
                            messages.push(json!({
                                "role": "tool",
                                "content": b.content.clone().unwrap_or_default(),
                                "tool_call_id": b.tool_use_id,
                            }));
                        }
                        _ => {}
                    }
                }
                if !tool_calls.is_empty() {
                    // OpenAI 规范：带 tool_calls 的 assistant 消息 content 为空
                    let mut msg = json!({ "role": m.role, "content": "" });
                    msg["tool_calls"] = json!(tool_calls);
                    messages.push(msg);
                } else if !content_parts.is_empty() {
                    let text = content_parts.join("\n");
                    messages.push(json!({ "role": m.role, "content": text }));
                }
            }
        }
    }
    messages
}

/// 构造单条 tool_call：arguments 必须是 JSON 字符串（OpenAI/DeepSeek 规范）
fn build_openai_tool_call(b: &LlmBlock) -> Value {
    let arguments = b
        .input
        .as_ref()
        .map(|v| v.to_string())
        .unwrap_or_else(|| "{}".to_string());
    json!({
        "id": b.id,
        "type": "function",
        "function": { "name": b.name, "arguments": arguments },
    })
}

impl LlmClient {
    pub(crate) async fn call_openai(
        &self,
        req: &LlmRequest,
        tx: tokio::sync::mpsc::Sender<LlmChunk>,
    ) -> Result<(), String> {
        let base = req.base_url.trim_end_matches('/');
        let url = if base.ends_with("/v1") {
            format!("{}/chat/completions", base)
        } else {
            format!("{}/v1/chat/completions", base)
        };

        let messages = build_openai_messages(req);

        let tools: Vec<Value> = req
            .tools
            .iter()
            .map(|t| {
                json!({
                    "type": "function",
                    "function": {
                        "name": t.name,
                        "description": t.description,
                        "parameters": t.input_schema,
                    }
                })
            })
            .collect();

        let mut body = json!({
            "model": req.model,
            "messages": messages,
            "tools": tools,
            "stream": true,
            "stream_options": { "include_usage": true },
        });

        // DeepSeek / OpenAI 格式相同
        if tools.is_empty() {
            body.as_object_mut().map(|o| o.remove("tools"));
        }

        let api_key = req.api_key.as_deref().unwrap_or("");
        let resp = self
            .http
            .post(&url)
            .header("Authorization", format!("Bearer {}", api_key))
            .header("content-type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("OpenAI HTTP error: {e}"))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("OpenAI HTTP {status}: {body}"));
        }

        parse_openai_sse(resp, tx).await
    }

    // ── Ollama ────────────────────────────────────────────────────
}

/// 解析 OpenAI SSE 流（兼容 DeepSeek）
async fn parse_openai_sse(
    resp: reqwest::Response,
    tx: tokio::sync::mpsc::Sender<LlmChunk>,
) -> Result<(), String> {
    use futures_util::StreamExt;

    let mut stream = resp.bytes_stream();
    let mut buf = String::new();

    let mut acc_text = String::new();
    let mut acc_thinking = String::new();
    let mut tool_call_map: std::collections::HashMap<usize, (String, String, String)> = Default::default();
    let mut stop_reason = "stop".to_string();

    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| format!("stream read error: {e}"))?;
        buf.push_str(&String::from_utf8_lossy(&bytes));

        while let Some(pos) = buf.find('\n') {
            let line = buf[..pos].trim().to_string();
            buf = buf[pos + 1..].to_string();

            if !line.starts_with("data: ") {
                continue;
            }
            let data = &line["data: ".len()..];
            if data == "[DONE]" {
                break;
            }

            let Ok(val): Result<Value, _> = serde_json::from_str(data) else {
                continue;
            };

            if let Some(choice) = val["choices"].as_array().and_then(|c| c.first()) {
                if let Some(reason) = choice["finish_reason"].as_str() {
                    if !reason.is_empty() {
                        stop_reason = reason.to_string();
                    }
                }

                let delta = &choice["delta"];

                // 普通文本
                if let Some(content) = delta["content"].as_str() {
                    if !content.is_empty() {
                        acc_text.push_str(content);
                        let _ = tx.send(LlmChunk::TextDelta(content.to_string())).await;
                    }
                }

                // reasoning_content (DeepSeek R1)
                if let Some(reasoning) = delta["reasoning_content"].as_str() {
                    if !reasoning.is_empty() {
                        acc_thinking.push_str(reasoning);
                        let _ = tx.send(LlmChunk::ThinkingDelta(reasoning.to_string())).await;
                    }
                }

                // tool_calls
                if let Some(tcs) = delta["tool_calls"].as_array() {
                    for tc in tcs {
                        let idx = tc["index"].as_u64().unwrap_or(0) as usize;
                        let entry = tool_call_map.entry(idx).or_insert_with(|| {
                            let id = tc["id"].as_str().unwrap_or("").to_string();
                            let name = tc["function"]["name"].as_str().unwrap_or("").to_string();
                            if !id.is_empty() {
                                // 注意: 在 Rust async 中不能在这里直接 await，记录后统一处理
                            }
                            (id, name, String::new())
                        });

                        if let Some(args) = tc["function"]["arguments"].as_str() {
                            entry.2.push_str(args);
                        }

                        // 如果 id/name 刚刚填入
                        if let Some(id) = tc["id"].as_str() {
                            if !id.is_empty() && entry.0.is_empty() {
                                entry.0 = id.to_string();
                            }
                        }
                        if let Some(name) = tc["function"]["name"].as_str() {
                            if !name.is_empty() && entry.1.is_empty() {
                                entry.1 = name.to_string();
                            }
                        }
                    }
                }
            }
        }
    }

    // 发送 tool call 事件
    let mut tool_calls: Vec<LlmToolCall> = vec![];
    let mut indices: Vec<usize> = tool_call_map.keys().copied().collect();
    indices.sort();
    for idx in indices {
        if let Some((id, name, input_buf)) = tool_call_map.remove(&idx) {
            let _ = tx.send(LlmChunk::ToolCallStart { id: id.clone(), name: name.clone() }).await;
            let input = serde_json::from_str(&input_buf).unwrap_or(Value::Object(Default::default()));
            tool_calls.push(LlmToolCall { id, name, input });
        }
    }

    let response = LlmResponse {
        thinking: if acc_thinking.is_empty() { None } else { Some(acc_thinking) },
        text: if acc_text.is_empty() { None } else { Some(acc_text) },
        tool_calls,
        stop_reason,
    };
    let _ = tx.send(LlmChunk::Done(response)).await;
    Ok(())
}


#[cfg(test)]
mod tests {
    use super::*;
    use crate::llm_client::types::{LlmBlock, LlmMessage};

    /// OpenAI/DeepSeek 规范：tool_calls[].function.arguments 必须是 JSON 字符串，
    /// tool_result 的 content 必须是字符串 —— 复现 DeepSeek 400 错误场景
    #[test]
    fn build_openai_messages_encodes_arguments_as_json_string() {
        let req = LlmRequest {
            model: "deepseek-chat".to_string(),
            protocol: crate::llm_client::types::LlmProtocol::OpenAi,
            api_key: Some("sk-test".to_string()),
            base_url: "https://api.deepseek.com".to_string(),
            system: "system".to_string(),
            messages: vec![
                LlmMessage {
                    role: "assistant".to_string(),
                    content: LlmContent::Blocks(vec![LlmBlock {
                        block_type: "tool_use".to_string(),
                        text: None,
                        id: Some("call_1".to_string()),
                        name: Some("search_files".to_string()),
                        input: Some(json!({"pattern": "repo-report.md"})),
                        tool_use_id: None,
                        content: None,
                    }]),
                },
                LlmMessage {
                    role: "user".to_string(),
                    content: LlmContent::Blocks(vec![LlmBlock {
                        block_type: "tool_result".to_string(),
                        text: None,
                        id: None,
                        name: None,
                        input: None,
                        tool_use_id: Some("call_1".to_string()),
                        content: Some("0 个文件".to_string()),
                    }]),
                },
            ],
            tools: vec![],
            max_tokens: 1024,
        };

        let msgs = build_openai_messages(&req);
        // messages: [system, assistant(tool_calls), user(tool_result)]
        assert_eq!(msgs.len(), 3);

        let assistant = &msgs[1];
        let arguments = &assistant["tool_calls"][0]["function"]["arguments"];
        assert!(
            arguments.is_string(),
            "arguments 必须是字符串，实际是 {arguments}"
        );
        let parsed: Value = serde_json::from_str(arguments.as_str().unwrap()).unwrap();
        assert_eq!(parsed["pattern"], "repo-report.md");

        let tool_msg = &msgs[2];
        assert_eq!(tool_msg["role"], "tool");
        assert_eq!(tool_msg["tool_call_id"], "call_1");
        assert!(
            tool_msg["content"].is_string(),
            "tool_result content 必须是字符串"
        );
    }
}
