use crate::llm_client::types::{LlmChunk, LlmContent, LlmRequest, LlmResponse, LlmToolCall};
use crate::llm_client::LlmClient;
use serde_json::{json, Value};

impl LlmClient {
    pub(crate) async fn call_ollama(
        &self,
        req: &LlmRequest,
        tx: tokio::sync::mpsc::Sender<LlmChunk>,
    ) -> Result<(), String> {
        let base = req.base_url.trim_end_matches('/');
        let url = format!("{}/api/chat", base);

        // 构造 OpenAI 兼容的 messages（Ollama /api/chat 支持 tool role 与 tool_calls）
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
                    let mut content_parts: Vec<Value> = vec![];
                    let mut tool_calls: Vec<Value> = vec![];

                    for b in blocks {
                        match b.block_type.as_str() {
                            "tool_use" => {
                                tool_calls.push(json!({
                                    "id": b.id,
                                    "type": "function",
                                    "function": { "name": b.name, "arguments": b.input },
                                }));
                            }
                            "tool_result" => {
                                // OpenAI 风格：role=tool 独立消息承载工具结果
                                messages.push(json!({
                                    "role": "tool",
                                    "content": b.content,
                                    "tool_call_id": b.tool_use_id,
                                }));
                            }
                            _ => {
                                if let Some(t) = &b.text {
                                    content_parts.push(json!(t));
                                }
                            }
                        }
                    }

                    if !tool_calls.is_empty() {
                        // Ollama 要求 content 为 string；带 tool_calls 时 content 置空
                        let mut msg = json!({ "role": m.role, "content": "" });
                        msg["tool_calls"] = json!(tool_calls);
                        messages.push(msg);
                    } else if content_parts
                        .iter()
                        .any(|p| !p.as_str().unwrap_or("").is_empty())
                    {
                        let text = content_parts
                            .iter()
                            .filter_map(|p| p.as_str().map(str::to_string))
                            .collect::<Vec<_>>()
                            .join("\n");
                        messages.push(json!({ "role": m.role, "content": text }));
                    }
                }
            }
        }

        // 工具定义（OpenAI 兼容格式）
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
            "stream": true,
        });
        if !tools.is_empty() {
            body["tools"] = json!(tools);
        }

        let resp = self
            .http
            .post(&url)
            .header("content-type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Ollama HTTP error: {e}"))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Ollama HTTP {status}: {body}"));
        }

        parse_ollama_ndjson(resp, tx).await
    }
}

async fn parse_ollama_ndjson(
    resp: reqwest::Response,
    tx: tokio::sync::mpsc::Sender<LlmChunk>,
) -> Result<(), String> {
    use futures_util::StreamExt;

    let mut stream = resp.bytes_stream();
    let mut buf = String::new();
    let mut acc_text = String::new();
    let mut tool_calls: Vec<LlmToolCall> = vec![];
    let mut stop_reason = "stop".to_string();

    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| format!("stream read error: {e}"))?;
        buf.push_str(&String::from_utf8_lossy(&bytes));

        while let Some(pos) = buf.find('\n') {
            let line = buf[..pos].trim().to_string();
            buf = buf[pos + 1..].to_string();

            if line.is_empty() {
                continue;
            }

            let Ok(val): Result<Value, _> = serde_json::from_str(&line) else {
                continue;
            };

            if let Some(content) = val["message"]["content"].as_str() {
                if !content.is_empty() {
                    acc_text.push_str(content);
                    let _ = tx.send(LlmChunk::TextDelta(content.to_string())).await;
                }
            }

            // Ollama 工具调用：可能出现在任意 message chunk（arguments 为对象而非字符串）
            if let Some(tcs) = val["message"]["tool_calls"].as_array() {
                for tc in tcs {
                    let name = tc["function"]["name"].as_str().unwrap_or("").to_string();
                    if name.is_empty() {
                        continue;
                    }
                    let id = format!("ollama_tc_{}", tool_calls.len());
                    let _ = tx.send(LlmChunk::ToolCallStart { id: id.clone(), name: name.clone() }).await;
                    tool_calls.push(LlmToolCall {
                        id,
                        name,
                        input: tc["function"]["arguments"].clone(),
                    });
                }
            }

            if let Some(reason) = val["done_reason"].as_str() {
                if !reason.is_empty() {
                    stop_reason = reason.to_string();
                }
            }

            if val["done"].as_bool().unwrap_or(false) {
                break;
            }
        }
    }

    // 兼容文本格式的工具调用：qwen2.5-coder 等模型经 Ollama 时经常
    // 把工具调用输出为 content 里的文本 JSON（{"name":"...","arguments":{...}}），
    // 而非原生 message.tool_calls 字段。若原生字段为空，则尝试从文本中提取。
    if tool_calls.is_empty() && !acc_text.trim().is_empty() {
        let (clean_text, text_calls) = extract_text_tool_calls(&acc_text);
        if !text_calls.is_empty() {
            for tc in &text_calls {
                let _ = tx.send(LlmChunk::ToolCallStart { id: tc.id.clone(), name: tc.name.clone() }).await;
            }
            tool_calls.extend(text_calls);
            acc_text = clean_text;
        }
    }

    let response = LlmResponse {
        thinking: None,
        text: if acc_text.is_empty() { None } else { Some(acc_text) },
        tool_calls,
        stop_reason,
    };
    let _ = tx.send(LlmChunk::Done(response)).await;
    Ok(())
}

// ── 文本 JSON 工具调用兼容层 ────────────────────────────────────────
// qwen2.5-coder 等模型经 Ollama 时，工具调用可能以文本 JSON 输出：
//   {"name": "search_files", "arguments": {"pattern": "..."}}
//   或 {"tool": "search_files", "arguments": {...}}
// 该层从累积文本中提取这类调用，返回剥离后的文本与结构化的 LlmToolCall。

/// 查找文本中形如 {"name"/{"tool" 开头的对象起点
fn find_tool_json_start(s: &str) -> Option<usize> {
    let b = s.as_bytes();
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'{' {
            let rest = s[i + 1..].trim_start();
            if let Some(r) = rest.strip_prefix('"') {
                let key_end = r.find('"').unwrap_or(0);
                let key = &r[..key_end];
                if key == "name" || key == "tool" {
                    return Some(i);
                }
            }
        }
        i += 1;
    }
    None
}

/// 从 start 位置做括号平衡扫描，提取完整的 JSON 对象
fn extract_balanced_object(s: &str, start: usize) -> Option<(String, usize)> {
    let bytes = s.as_bytes();
    let mut depth = 0usize;
    let mut in_str = false;
    let mut escaped = false;
    for (i, &b) in bytes.iter().enumerate().skip(start) {
        if in_str {
            if escaped {
                escaped = false;
            } else if b == b'\\' {
                escaped = true;
            } else if b == b'"' {
                in_str = false;
            }
        } else {
            match b {
                b'"' => in_str = true,
                b'{' => depth += 1,
                b'}' => {
                    depth = depth.saturating_sub(1);
                    if depth == 0 {
                        return Some((s[start..=i].to_string(), i + 1));
                    }
                }
                _ => {}
            }
        }
    }
    None
}

/// 从文本中提取文本格式的工具调用；返回（剥离后的文本, 提取出的工具调用）
pub(crate) fn extract_text_tool_calls(raw: &str) -> (String, Vec<LlmToolCall>) {
    let mut calls = Vec::new();
    let mut cleaned = String::new();
    let mut remaining = raw;

    loop {
        let Some(start) = find_tool_json_start(remaining) else {
            break;
        };
        let Some((obj_str, end)) = extract_balanced_object(remaining, start) else {
            break;
        };

        match serde_json::from_str::<Value>(&obj_str) {
            Ok(v) => {
                let name = v
                    .get("name")
                    .or_else(|| v.get("tool"))
                    .and_then(|n| n.as_str())
                    .unwrap_or("");
                if name.is_empty() {
                    cleaned.push_str(&remaining[..start + 1]);
                    remaining = &remaining[start + 1..];
                    continue;
                }
                let args = v
                    .get("arguments")
                    .cloned()
                    .unwrap_or_else(|| Value::Object(Default::default()));
                let id = format!("text_tc_{}", calls.len());
                calls.push(LlmToolCall {
                    id,
                    name: name.to_string(),
                    input: args,
                });
                cleaned.push_str(&remaining[..start]);
                remaining = &remaining[end..];
            }
            Err(_) => {
                cleaned.push_str(&remaining[..start + 1]);
                remaining = &remaining[start + 1..];
            }
        }
    }

    cleaned.push_str(remaining);
    (cleaned.trim().to_string(), calls)
}
