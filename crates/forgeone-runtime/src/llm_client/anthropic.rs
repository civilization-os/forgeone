use crate::llm_client::types::{LlmChunk, LlmContent, LlmRequest, LlmResponse, LlmToolCall};
use crate::llm_client::LlmClient;
use serde_json::{json, Value};

impl LlmClient {
    pub(crate) async fn call_anthropic(
        &self,
        req: &LlmRequest,
        tx: tokio::sync::mpsc::Sender<LlmChunk>,
    ) -> Result<(), String> {
        let base = req.base_url.trim_end_matches('/');
        let url = format!("{}/v1/messages", base);
        let api_key = req.api_key.as_deref().unwrap_or("");

        // 构建 Anthropic messages（过滤 system role，system 单独传）
        // LlmBlock → Anthropic 原生 content 块：text / tool_use / tool_result
        let mut messages: Vec<Value> = Vec::new();
        for m in req.messages.iter().filter(|m| m.role != "system") {
            match &m.content {
                LlmContent::Text(t) => {
                    messages.push(json!({ "role": m.role, "content": t }));
                }
                LlmContent::Blocks(blocks) => {
                    let mut content: Vec<Value> = vec![];
                    let mut tool_results: Vec<Value> = vec![];
                    for b in blocks {
                        match b.block_type.as_str() {
                            // thinking 块不回传（未启用 thinking 参数时回传会 400）
                            "thinking" => {}
                            "text" => {
                                content.push(json!({ "type": "text", "text": b.text }));
                            }
                            "tool_use" => {
                                content.push(json!({
                                    "type": "tool_use",
                                    "id": b.id,
                                    "name": b.name,
                                    "input": b.input,
                                }));
                            }
                            "tool_result" => {
                                tool_results.push(json!({
                                    "type": "tool_result",
                                    "tool_use_id": b.tool_use_id,
                                    "content": b.content,
                                }));
                            }
                            _ => {}
                        }
                    }
                    if !tool_results.is_empty() {
                        // Anthropic 规范：tool_result 必须放在 user role 消息中
                        messages.push(json!({ "role": "user", "content": tool_results }));
                    }
                    if !content.is_empty() {
                        messages.push(json!({ "role": m.role, "content": content }));
                    }
                }
            }
        }

        let tools: Vec<Value> = req
            .tools
            .iter()
            .map(|t| {
                json!({
                    "name": t.name,
                    "description": t.description,
                    "input_schema": t.input_schema,
                })
            })
            .collect();

        let body = json!({
            "model": req.model,
            "max_tokens": req.max_tokens,
            "system": req.system,
            "messages": messages,
            "tools": tools,
            "stream": true,
        });

        let resp = self
            .http
            .post(&url)
            .header("x-api-key", api_key)
            .header("anthropic-version", "2023-06-01")
            .header("anthropic-dangerous-direct-browser-access", "true")
            .header("content-type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Anthropic HTTP error: {e}"))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Anthropic HTTP {status}: {body}"));
        }

        // 解析 SSE 流
        parse_anthropic_sse(resp, tx).await
    }

    // ── OpenAI ────────────────────────────────────────────────────
}

async fn parse_anthropic_sse(
    resp: reqwest::Response,
    tx: tokio::sync::mpsc::Sender<LlmChunk>,
) -> Result<(), String> {
    use futures_util::StreamExt;

    let mut stream = resp.bytes_stream();
    let mut buf = String::new();

    // 积累用于构造最终 LlmResponse
    let mut acc_text = String::new();
    let mut acc_thinking = String::new();
    let mut tool_calls: Vec<LlmToolCall> = vec![];
    let mut current_tool: Option<(String, String, String)> = None; // (id, name, input_buf)
    let mut stop_reason = "end_turn".to_string();

    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| format!("stream read error: {e}"))?;
        buf.push_str(&String::from_utf8_lossy(&bytes));

        // 按行处理 SSE
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

            let event_type = val["type"].as_str().unwrap_or("");

            match event_type {
                "content_block_start" => {
                    let block = &val["content_block"];
                    let t = block["type"].as_str().unwrap_or("");
                    if t == "tool_use" {
                        let id = block["id"].as_str().unwrap_or("").to_string();
                        let name = block["name"].as_str().unwrap_or("").to_string();
                        let _ = tx.send(LlmChunk::ToolCallStart { id: id.clone(), name: name.clone() }).await;
                        current_tool = Some((id, name, String::new()));
                    }
                }
                "content_block_delta" => {
                    let delta = &val["delta"];
                    let dtype = delta["type"].as_str().unwrap_or("");
                    match dtype {
                        "text_delta" => {
                            let text = delta["text"].as_str().unwrap_or("").to_string();
                            acc_text.push_str(&text);
                            let _ = tx.send(LlmChunk::TextDelta(text)).await;
                        }
                        "thinking_delta" => {
                            let thinking = delta["thinking"].as_str().unwrap_or("").to_string();
                            acc_thinking.push_str(&thinking);
                            let _ = tx.send(LlmChunk::ThinkingDelta(thinking)).await;
                        }
                        "input_json_delta" => {
                            if let Some((ref id, _, ref mut input_buf)) = current_tool {
                                let delta_str = delta["partial_json"].as_str().unwrap_or("");
                                input_buf.push_str(delta_str);
                                let _ = tx.send(LlmChunk::ToolCallInputDelta {
                                    id: id.clone(),
                                    delta: delta_str.to_string(),
                                }).await;
                            }
                        }
                        _ => {}
                    }
                }
                "content_block_stop" => {
                    if let Some((id, name, input_buf)) = current_tool.take() {
                        let input = serde_json::from_str(&input_buf).unwrap_or(Value::Object(Default::default()));
                        tool_calls.push(LlmToolCall { id, name, input });
                    }
                }
                "message_delta" => {
                    if let Some(reason) = val["delta"]["stop_reason"].as_str() {
                        stop_reason = reason.to_string();
                    }
                }
                _ => {}
            }
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
