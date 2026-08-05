//! HTTP+SSE 传输集成测试：
//! 起一个本地 mock MCP HTTP+SSE server（axum），验证客户端按
//! `transport = "sse"` + `endpoint` 连接、握手、工具发现与调用。

use std::net::SocketAddr;
use std::time::Duration;

use axum::{
    extract::State,
    response::sse::{Event, Sse},
    routing::{get, post},
    Router,
};
use forgeone_runtime::mcp::ActiveMcpClient;
use forgeone_tools::McpServerConfig;
use futures::stream::{self, Stream};
use futures::StreamExt;
use serde_json::{Value, json};
use std::convert::Infallible;
use tokio::sync::broadcast;

/// 同一进程内 USERPROFILE/HOME 是进程级共享的，测试串行隔离
static HOME_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// 用临时目录模拟用户主目录，避免 register 扫描到真实全局 MCP 配置
fn isolate_home() -> std::path::PathBuf {
    let home = std::env::temp_dir().join(format!(
        "forgeone-mcp-sse-home-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&home).unwrap();
    unsafe {
        #[cfg(windows)]
        std::env::set_var("USERPROFILE", &home);
        #[cfg(not(windows))]
        std::env::set_var("HOME", &home);
    }
    home
}

#[derive(Clone)]
struct MockState {
    /// POST /messages 处理结果广播给 SSE 流
    btx: broadcast::Sender<Value>,
}

/// GET /sse：先下发 endpoint 事件，之后透传 POST 处理结果
async fn sse_handler(
    State(state): State<MockState>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let endpoint_event = stream::once(async move {
        Ok::<Event, Infallible>(Event::default().event("endpoint").data("/messages"))
    });
    let brx = state.btx.subscribe();
    let msgs = stream::unfold(brx, |mut brx| async move {
        match brx.recv().await {
            Ok(msg) => Some((
                Ok::<Event, Infallible>(Event::default().data(serde_json::to_string(&msg).unwrap())),
                brx,
            )),
            Err(_) => None,
        }
    });
    Sse::new(endpoint_event.chain(msgs))
}

fn handle_mcp_message(msg: &Value) -> Option<Value> {
    let id = msg.get("id").cloned()?;
    let method = msg.get("method").and_then(|m| m.as_str())?;
    if method == "notifications/initialized" {
        return None;
    }
    let result = match method {
        "initialize" => json!({
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "serverInfo": { "name": "forgeone-mock-sse", "version": "0.1.0" }
        }),
        "tools/list" => json!({
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
        }),
        "tools/call" => {
            let params = msg.get("params").cloned().unwrap_or(Value::Null);
            let name = params.get("name").and_then(|n| n.as_str()).unwrap_or("");
            let args = params.get("arguments").cloned().unwrap_or(Value::Null);
            match name {
                "echo" => {
                    let text = args.get("text").and_then(|t| t.as_str()).unwrap_or("");
                    json!({ "content": [{ "type": "text", "text": format!("echo: {text}") }] })
                }
                "add" => {
                    let num = |k: &str| {
                        args.get(k)
                            .and_then(|v| v.as_f64().or_else(|| v.as_str().and_then(|s| s.parse().ok())))
                            .unwrap_or(0.0)
                    };
                    json!({ "content": [{ "type": "text", "text": format!("sum: {}", num("a") + num("b")) }] })
                }
                _ => json!({ "content": [], "isError": true }),
            }
        }
        _ => return None,
    };
    Some(json!({ "jsonrpc": "2.0", "id": id, "result": result }))
}

/// POST /messages：处理 JSON-RPC 请求，结果经 broadcast 广播给 SSE 流
async fn messages_handler(
    State(state): State<MockState>,
    body: String,
) -> axum::http::StatusCode {
    if let Ok(msg) = serde_json::from_str::<Value>(&body) {
        if let Some(resp) = handle_mcp_message(&msg) {
            let _ = state.btx.send(resp);
        }
    }
    axum::http::StatusCode::ACCEPTED
}

/// 起 mock HTTP+SSE server，返回 base endpoint
fn spawn_mock_sse_server() -> String {
    let (addr_tx, addr_rx) = std::sync::mpsc::channel::<SocketAddr>();
    std::thread::spawn(move || {
        let rt = tokio::runtime::Runtime::new().expect("tokio runtime");
        rt.block_on(async move {
            let (btx, _brx) = broadcast::channel::<Value>(64);
            let state = MockState { btx };
            let app = Router::new()
                .route("/sse", get(sse_handler))
                .route("/messages", post(messages_handler))
                .with_state(state);
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
                .await
                .expect("bind");
            let addr = listener.local_addr().expect("local_addr");
            let _ = addr_tx.send(addr);
            axum::serve(listener, app).await.expect("serve");
        });
    });
    let addr = addr_rx.recv_timeout(Duration::from_secs(10)).expect("server addr");
    format!("http://{addr}")
}

fn sse_config(endpoint: &str) -> McpServerConfig {
    McpServerConfig {
        name: "sse-server".to_string(),
        transport: "sse".to_string(),
        command: None,
        args: None,
        env: None,
        endpoint: Some(endpoint.to_string()),
        headers: None,
        timeout: Some(30),
    }
}

#[test]
fn connects_and_calls_over_sse_transport() {
    let _guard = HOME_LOCK.lock().unwrap();
    let test_home = isolate_home();
    // endpoint 带 /sse 后缀：回归验证 resolve_endpoint_url（绝对路径拼接）
    let endpoint = format!("{}/sse", spawn_mock_sse_server());

    // 连接 + 握手（initialize / notifications/initialized / tools/list）
    let client = ActiveMcpClient::new(&sse_config(&endpoint))
        .expect("连接 SSE MCP server 应成功");
    assert_eq!(client.tools.len(), 2, "应发现 2 个工具: {:?}", client.tools);

    // 工具调用（tools/call 响应经 SSE 流返回）
    let res = client
        .call_tool("echo", json!({ "text": "hi" }))
        .expect("echo 调用应成功");
    assert_eq!(res["content"][0]["text"], "echo: hi");

    let res = client
        .call_tool("add", json!({ "a": 2, "b": 3 }))
        .expect("add 调用应成功");
    assert_eq!(res["content"][0]["text"], "sum: 5");
    let _ = std::fs::remove_dir_all(&test_home);
}

#[test]
fn registers_sse_server_via_manifest() {
    let _guard = HOME_LOCK.lock().unwrap();
    let test_home = isolate_home();
    // endpoint 带 /sse 后缀（贴近真实站点如 http://127.0.0.1:3002/sse）
    let endpoint = format!("{}/sse", spawn_mock_sse_server());

    // 临时 workspace 写 sse 类型 manifest
    let ws = std::env::temp_dir().join(format!(
        "forgeone-mcp-sse-ws-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let mcp_dir = ws.join(".forgeone").join("mcp");
    std::fs::create_dir_all(&mcp_dir).unwrap();
    let manifest = json!({
        "api_version": "forgeone/v1",
        "name": "sse-server",
        "kind": "mcp",
        "description": "SSE MCP server for test",
        "transport": "sse",
        "endpoint": endpoint,
        "tools": []
    });
    std::fs::write(
        mcp_dir.join("sse-server.json"),
        serde_json::to_string_pretty(&manifest).unwrap(),
    )
    .unwrap();

    let mut registry = forgeone_tools::ToolRegistry::with_builtin_tools();
    let (ok, errors) = forgeone_runtime::mcp::register_workspace_mcp_servers(&mut registry, &ws);
    assert!(errors.is_empty(), "注册不应失败: {errors:?}");
    assert!(ok.contains(&"sse-server".to_string()), "应注册 sse-server: {ok:?}");

    // 工具可用
    let result = registry.execute(&forgeone_tools::ToolCallRequest {
        call_id: "call_sse".to_string(),
        session_id: "test".to_string(),
        agent_id: "test".to_string(),
        loop_index: 0,
        tool_name: "sse-server__echo".to_string(),
        arguments: std::collections::HashMap::from([("text".to_string(), "sse".to_string())]),
        requested_by: "test".to_string(),
    });
    assert_eq!(
        result.structured_output.get("content").map(|s| s.as_str()),
        Some("echo: sse")
    );

    let _ = std::fs::remove_dir_all(&test_home);
    let _ = std::fs::remove_dir_all(&ws);
}
