//! 测试与调试用最小 MCP stdio server（JSON-RPC 2.0 over stdio）。
//!
//! 实现 MCP 协议子集：`initialize` / `notifications/initialized` /
//! `tools/list` / `tools/call`，可作为 ForgeOne MCP 客户端的参考 server，
//! 也可在集成测试中作为 fixture 使用（`CARGO_BIN_EXE_mcp_mock_server`）。

use std::io::{BufRead, BufReader, Write};

use serde_json::{Value, json};

fn main() {
    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    let mut reader = BufReader::new(stdin.lock());
    let mut out = stdout.lock();

    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).unwrap_or(0) == 0 {
            break; // EOF：客户端关闭管道
        }
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        let msg: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let id = msg.get("id").cloned();
        let method = msg.get("method").and_then(|m| m.as_str()).unwrap_or("");

        let response = match method {
            "initialize" => Some(json!({
                "jsonrpc": "2.0",
                "id": id.unwrap_or(Value::Null),
                "result": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {},
                    "serverInfo": { "name": "forgeone-mock", "version": "0.1.0" }
                }
            })),
            // notification：无需响应
            "notifications/initialized" => None,
            "tools/list" => Some(json!({
                "jsonrpc": "2.0",
                "id": id.unwrap_or(Value::Null),
                "result": {
                    "tools": [
                        {
                            "name": "echo",
                            "description": "Echo the given text back",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "text": { "type": "string", "description": "text to echo" }
                                },
                                "required": ["text"]
                            }
                        },
                        {
                            "name": "add",
                            "description": "Add two numbers",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "a": { "type": "number" },
                                    "b": { "type": "number" }
                                },
                                "required": ["a", "b"]
                            }
                        }
                    ]
                }
            })),
            "tools/call" => {
                let params = msg.get("params").cloned().unwrap_or(Value::Null);
                let name = params.get("name").and_then(|n| n.as_str()).unwrap_or("");
                let args = params.get("arguments").cloned().unwrap_or(Value::Null);
                let result = match name {
                    "echo" => {
                        let text = args.get("text").and_then(|t| t.as_str()).unwrap_or("");
                        json!({ "content": [{ "type": "text", "text": format!("echo: {text}") }] })
                    }
                    "add" => {
                        let num = |key: &str| {
                            args.get(key)
                                .and_then(|v| {
                                    v.as_f64()
                                        .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
                                })
                                .unwrap_or(0.0)
                        };
                        let a = num("a");
                        let b = num("b");
                        json!({ "content": [{ "type": "text", "text": format!("sum: {}", a + b) }] })
                    }
                    _ => json!({ "content": [], "isError": true }),
                };
                Some(json!({
                    "jsonrpc": "2.0",
                    "id": id.unwrap_or(Value::Null),
                    "result": result
                }))
            }
            _ => Some(json!({
                "jsonrpc": "2.0",
                "id": id.unwrap_or(Value::Null),
                "error": { "code": -32601, "message": format!("method not found: {method}") }
            })),
        };

        if let Some(resp) = response {
            let mut s = serde_json::to_string(&resp).unwrap();
            s.push('\n');
            if out.write_all(s.as_bytes()).is_err() {
                break;
            }
            let _ = out.flush();
        }
    }
}
