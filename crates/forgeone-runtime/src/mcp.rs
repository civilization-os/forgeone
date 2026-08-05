use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, mpsc};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use forgeone_tools::{
    McpServerConfig, ToolDescriptor, ToolExecutor, ToolKind, ToolProviderDescriptor,
    ToolProviderSource, ToolRegistry,
};
use serde_json::Value;

/// MCP 传输层抽象：stdio（子进程）与 sse（HTTP+SSE）共用同一接口
trait McpTransport: Send + Sync {
    /// 发送请求并等待响应（阻塞）
    fn call(&self, id: u64, method: &str, params: Value) -> Result<Value, String>;
    /// 发送 notification（无需响应）
    fn notify(&self, method: &str, params: Value) -> Result<(), String>;
    /// 底层连接是否仍存活（子进程未退出 / SSE 流未断开）
    fn is_alive(&self) -> bool;
    /// 主动关闭连接（kill 子进程 / 断开 SSE）
    fn shutdown(&self);
}

// ── stdio 传输：子进程 stdin/stdout 上走 JSON-RPC ─────────────────

struct StdioTransport {
    writer: Mutex<std::process::ChildStdin>,
    child: Mutex<Child>,
    /// 常驻 reader 线程按行推送的 JSON-RPC 响应（notification 被过滤）
    response_rx: Mutex<mpsc::Receiver<Result<Value, String>>>,
    /// 单次请求-响应超时
    timeout: Duration,
}

impl StdioTransport {
    fn spawn(config: &McpServerConfig) -> Result<Self, String> {
        let (cmd, args_str) = if let Some(ref c) = config.command {
            if c.trim().is_empty() {
                if let Some(ref ep) = config.endpoint {
                    parse_endpoint_fallback(ep)?
                } else {
                    return Err("command and endpoint are empty".to_string());
                }
            } else {
                (c.clone(), config.args.clone().unwrap_or_default())
            }
        } else if let Some(ref ep) = config.endpoint {
            parse_endpoint_fallback(ep)?
        } else {
            return Err("command or endpoint is required".to_string());
        };

        let args: Vec<String> = args_str
            .split_whitespace()
            .map(|s| s.trim_matches('"').to_string())
            .collect();

        #[cfg(windows)]
        let mut command = {
            let mut c = Command::new("cmd");
            c.arg("/C").arg(&cmd).args(&args);
            c
        };

        #[cfg(not(windows))]
        let mut command = {
            let mut c = Command::new(&cmd);
            c.args(&args);
            c
        };

        if let Some(ref envs) = config.env {
            for var in envs {
                command.env(&var.key, &var.value);
            }
        }

        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());

        let mut child = command
            .spawn()
            .map_err(|e| format!("Failed to spawn MCP process '{}' with args '{:?}': {}", cmd, args, e))?;

        let stdin = child.stdin.take().ok_or("Failed to open stdin of MCP process")?;
        let stdout = child.stdout.take().ok_or("Failed to open stdout of MCP process")?;

        // 常驻 reader 线程：独占 stdout，按行解析 JSON-RPC；仅推送带 id 的响应
        // （server 主动推送的 notification 会被过滤，避免与请求-响应错位）。
        // child 被 kill 或进程退出（EOF）时线程自然结束。
        let (response_tx, response_rx) = mpsc::channel::<Result<Value, String>>();
        std::thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            loop {
                let mut line = String::new();
                match reader.read_line(&mut line) {
                    Ok(0) => break, // EOF：进程退出或管道关闭
                    Ok(_) => {
                        let parsed = match serde_json::from_str::<Value>(&line) {
                            Ok(v) if v.get("id").is_some() => Ok(v),
                            Ok(_) => continue, // notification：忽略
                            Err(e) => Err(format!("解析 MCP 响应失败: {e}")),
                        };
                        if response_tx.send(parsed).is_err() {
                            break; // 接收端已关闭
                        }
                    }
                    Err(e) => {
                        let _ = response_tx.send(Err(format!("读取 MCP 响应失败: {e}")));
                        break;
                    }
                }
            }
        });

        Ok(Self {
            writer: Mutex::new(stdin),
            child: Mutex::new(child),
            response_rx: Mutex::new(response_rx),
            timeout: Duration::from_secs(config.timeout.unwrap_or(30)),
        })
    }

    fn write_request(&self, msg: &Value) -> Result<(), String> {
        let mut line = serde_json::to_string(msg).map_err(|e| e.to_string())?;
        line.push('\n');
        let mut writer = self.writer.lock().map_err(|e| e.to_string())?;
        writer.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
        writer.flush().map_err(|e| e.to_string())?;
        Ok(())
    }

    fn read_response(&self) -> Result<Value, String> {
        self.response_rx
            .lock()
            .unwrap()
            .recv_timeout(self.timeout)
            .unwrap_or_else(|_| Err("等待 MCP 响应超时".to_string()))
    }
}

impl Drop for StdioTransport {
    fn drop(&mut self) {
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
        }
    }
}

impl McpTransport for StdioTransport {
    fn call(&self, id: u64, method: &str, params: Value) -> Result<Value, String> {
        // JSON-RPC 的 params 可选：null 时应省略字段，否则部分 MCP server 会拒绝/忽略
        let msg = if params.is_null() {
            serde_json::json!({ "jsonrpc": "2.0", "id": id, "method": method })
        } else {
            serde_json::json!({
                "jsonrpc": "2.0",
                "id": id,
                "method": method,
                "params": params
            })
        };
        self.write_request(&msg)?;
        parse_mcp_response(&self.read_response()?)
    }

    fn notify(&self, method: &str, params: Value) -> Result<(), String> {
        let msg = if params.is_null() {
            serde_json::json!({ "jsonrpc": "2.0", "method": method })
        } else {
            serde_json::json!({ "jsonrpc": "2.0", "method": method, "params": params })
        };
        self.write_request(&msg)
    }

    fn is_alive(&self) -> bool {
        // 进程仍在运行（未退出）
        self.child
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .try_wait()
            .map(|status| status.is_none())
            .unwrap_or(false)
    }

    fn shutdown(&self) {
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
        }
    }
}

// ── HTTP+SSE 传输：GET {endpoint}/sse 建流，POST 发请求，响应经 SSE 返回 ──

struct HttpSseTransport {
    http: reqwest::blocking::Client,
    message_endpoint: String,
    pending: Arc<Mutex<HashMap<u64, mpsc::Sender<Result<Value, String>>>>>,
    shutdown: Arc<AtomicBool>,
    reader_handle: Option<std::thread::JoinHandle<()>>,
}

impl HttpSseTransport {
    fn connect(config: &McpServerConfig) -> Result<Self, String> {
        let endpoint = config
            .endpoint
            .as_deref()
            .filter(|e| !e.trim().is_empty())
            .ok_or_else(|| format!("sse 传输需要 endpoint 配置（server={}）", config.name))?;

        let http = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(config.timeout.unwrap_or(60)))
            .connect_timeout(Duration::from_secs(10))
            .build()
            .map_err(|e| format!("构建 HTTP client 失败: {e}"))?;

        let base = endpoint.trim_end_matches('/').to_string();
        let sse_url = if base.ends_with("/sse") {
            base.clone()
        } else {
            format!("{base}/sse")
        };

        let mut req = http.get(&sse_url);
        if let Some(headers) = &config.headers {
            for h in headers {
                req = req.header(&h.key, &h.value);
            }
        }
        let resp = req
            .send()
            .map_err(|e| format!("连接 SSE 端点 {sse_url} 失败: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!("SSE 端点 {sse_url} 返回 HTTP {}", resp.status()));
        }

        let pending: Arc<Mutex<HashMap<u64, mpsc::Sender<Result<Value, String>>>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let shutdown = Arc::new(AtomicBool::new(false));

        let (ep_tx, ep_rx) = mpsc::channel::<String>();
        // 读线程持有 response 独占读取；Drop 时通过 shutdown 标志与 pending 清理完成回收
        let reader_handle = spawn_sse_reader(resp, pending.clone(), shutdown.clone(), ep_tx, base);

        // 阻塞等待服务器下发 message endpoint（endpoint 事件）
        let message_endpoint = ep_rx
            .recv_timeout(Duration::from_secs(15))
            .map_err(|_| format!("SSE 端点 {sse_url} 未在超时内返回 endpoint 事件"))?;

        Ok(Self {
            http,
            message_endpoint,
            pending,
            shutdown,
            reader_handle: Some(reader_handle),
        })
    }
}

impl Drop for HttpSseTransport {
    fn drop(&mut self) {
        self.shutdown();
        // 读线程在连接断开/收到 shutdown 后自行退出，此处仅回收句柄
        if let Some(handle) = self.reader_handle.take() {
            drop(handle);
        }
    }
}

impl McpTransport for HttpSseTransport {
    fn call(&self, id: u64, method: &str, params: Value) -> Result<Value, String> {
        // JSON-RPC 的 params 可选：null 时应省略字段
        let msg = if params.is_null() {
            serde_json::json!({ "jsonrpc": "2.0", "id": id, "method": method })
        } else {
            serde_json::json!({
                "jsonrpc": "2.0",
                "id": id,
                "method": method,
                "params": params
            })
        };
        let (tx, rx) = mpsc::channel::<Result<Value, String>>();
        self.pending.lock().unwrap().insert(id, tx);

        let post = self
            .http
            .post(&self.message_endpoint)
            .header("Content-Type", "application/json")
            .header("Accept", "application/json, text/event-stream")
            .body(msg.to_string())
            .send();

        match post {
            Ok(resp) => {
                // 兼容：部分实现直接在 HTTP 响应体返回 JSON-RPC 响应
                let status = resp.status();
                let text = resp.text().unwrap_or_default();
                if status.is_success() {
                    if let Ok(v) = serde_json::from_str::<Value>(&text) {
                        if v.get("id").and_then(|i| i.as_u64()) == Some(id) {
                            self.pending.lock().unwrap().remove(&id);
                            return parse_mcp_response(&v);
                        }
                    }
                }
                // 标准行为：响应经 SSE 流返回
                rx.recv_timeout(Duration::from_secs(120)).unwrap_or_else(|_| {
                    self.pending.lock().unwrap().remove(&id);
                    Err(format!("等待 MCP 响应超时（method={method}）"))
                })
            }
            Err(e) => {
                self.pending.lock().unwrap().remove(&id);
                Err(format!("POST {} 失败: {e}", self.message_endpoint))
            }
        }
    }

    fn notify(&self, method: &str, params: Value) -> Result<(), String> {
        let msg = if params.is_null() {
            serde_json::json!({ "jsonrpc": "2.0", "method": method })
        } else {
            serde_json::json!({ "jsonrpc": "2.0", "method": method, "params": params })
        };
        self.http
            .post(&self.message_endpoint)
            .header("Content-Type", "application/json")
            .body(msg.to_string())
            .send()
            .map(|_| ())
            .map_err(|e| format!("发送 notification {method} 失败: {e}"))
    }

    fn is_alive(&self) -> bool {
        // SSE 读线程仍在运行即认为连接存活（连接断开/出错时线程会退出）
        self.reader_handle
            .as_ref()
            .map(|handle| !handle.is_finished())
            .unwrap_or(false)
    }

    fn shutdown(&self) {
        self.shutdown.store(true, Ordering::SeqCst);
        // 唤醒所有等待中的调用
        for (_, tx) in self.pending.lock().unwrap_or_else(|p| p.into_inner()).drain() {
            let _ = tx.send(Err("MCP 连接已关闭".to_string()));
        }
    }
}

/// 后台线程：解析 SSE 流，先发回 `endpoint` 事件中的 message endpoint，
/// 之后按 `id` 把 JSON-RPC 响应分发到对应等待通道。
/// 线程持有 response 独占读取；连接断开（EOF/错误）或收到 shutdown 时退出。
#[allow(clippy::type_complexity)]
fn spawn_sse_reader(
    resp: reqwest::blocking::Response,
    pending: Arc<Mutex<HashMap<u64, mpsc::Sender<Result<Value, String>>>>>,
    shutdown: Arc<AtomicBool>,
    ep_tx: mpsc::Sender<String>,
    base: String,
) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        let mut reader = BufReader::new(resp);
        let mut current_event = String::new();
        let mut data_lines: Vec<String> = Vec::new();
        let mut endpoint_sent = false;

        loop {
            if shutdown.load(Ordering::SeqCst) {
                break;
            }
            let mut line = String::new();
            match reader.read_line(&mut line) {
                Ok(0) => break, // EOF：连接关闭
                Ok(_) => {}
                Err(_) => break,
            }
            let line = line.trim_end_matches(['\r', '\n']);
            if line.is_empty() {
                let data = data_lines.join("\n");
                if current_event == "endpoint" && !endpoint_sent {
                    endpoint_sent = true;
                    let _ = ep_tx.send(resolve_endpoint_url(&base, &data));
                } else if !data.trim().is_empty() {
                    if let Ok(msg) = serde_json::from_str::<Value>(&data) {
                        dispatch_sse_message(&pending, &msg);
                    }
                }
                current_event.clear();
                data_lines.clear();
                continue;
            }
            if let Some(rest) = line.strip_prefix("event:") {
                current_event = rest.trim().to_string();
            } else if let Some(rest) = line.strip_prefix("data:") {
                data_lines.push(rest.trim_start().to_string());
            }
        }
        drop(ep_tx);
    })
}

/// 把 endpoint 事件里的地址解析为完整 URL：
/// - 绝对 URL：原样使用
/// - 以 `/` 开头的绝对路径：基于 base 的 `scheme://host`（与 `new URL(path, sse_url)` 一致，
///   例如 base=`http://host:3002/sse` + `/messages` → `http://host:3002/messages`）
/// - 相对路径：基于 base 目录
fn resolve_endpoint_url(base: &str, data: &str) -> String {
    let data = data.trim();
    if data.starts_with("http://") || data.starts_with("https://") {
        return data.to_string();
    }
    if data.starts_with('/') {
        if let Some(scheme_end) = base.find("://") {
            let after_scheme = &base[scheme_end + 3..];
            if let Some(host_end) = after_scheme.find('/') {
                let host = &base[..scheme_end + 3 + host_end];
                return format!("{host}{data}");
            }
        }
        return format!("{}{}", base.trim_end_matches('/'), data);
    }
    format!("{}{}", base.trim_end_matches('/'), data)
}

/// 按 id 把 SSE 到达的 JSON-RPC 响应分发给等待通道（无 id 的 notification 忽略）
fn dispatch_sse_message(
    pending: &Mutex<HashMap<u64, mpsc::Sender<Result<Value, String>>>>,
    msg: &Value,
) {
    let Some(id) = msg.get("id").and_then(|v| v.as_u64()) else {
        return;
    };
    if let Some(tx) = pending.lock().unwrap().remove(&id) {
        let _ = tx.send(parse_mcp_response(msg));
    }
}

/// 解析 MCP JSON-RPC 响应：有 error 返回 Err，否则返回 result
fn parse_mcp_response(resp: &Value) -> Result<Value, String> {
    if let Some(err) = resp.get("error") {
        return Err(
            err.get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("Unknown error")
                .to_string(),
        );
    }
    Ok(resp.get("result").cloned().unwrap_or(Value::Null))
}

/// 统一 MCP 客户端：连接（stdio / sse）+ 握手 + 工具发现 + 调用
pub struct ActiveMcpClient {
    pub name: String,
    transport: Box<dyn McpTransport>,
    next_id: AtomicU64,
    pub tools: Vec<ToolDescriptor>,
}

impl ActiveMcpClient {
    pub fn new(config: &McpServerConfig) -> Result<Self, String> {
        // 按 transport 选择传输层：stdio（默认）或 sse（HTTP+SSE）
        let transport: Box<dyn McpTransport> = match config.transport.as_str() {
            "sse" | "http" | "streamable-http" => Box::new(HttpSseTransport::connect(config)?),
            _ => Box::new(StdioTransport::spawn(config)?),
        };

        let client = Self {
            name: config.name.clone(),
            transport,
            next_id: AtomicU64::new(1),
            tools: Vec::new(),
        };

        // 1. initialize 握手
        let init_params = serde_json::json!({
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {
                "name": "forgeone-runtime",
                "version": "0.1.0"
            }
        });
        client.request("initialize", init_params)?;

        // 2. notifications/initialized 握手
        let _ = client.transport.notify("notifications/initialized", Value::Null);

        // 3. tools/list 获取工具定义列表
        let tools_resp = client.request("tools/list", Value::Null)?;
        let mut discovered_tools = Vec::new();
        if let Some(tools_arr) = tools_resp.get("tools").and_then(|t| t.as_array()) {
            for tool_val in tools_arr {
                if let Some(name) = tool_val.get("name").and_then(|n| n.as_str()) {
                    let desc = tool_val
                        .get("description")
                        .and_then(|d| d.as_str())
                        .unwrap_or_default();
                    // MCP tools/list 返回的 inputSchema 是 JSON Schema，转发给 LLM 时使用
                    let input_schema = tool_val.get("inputSchema").cloned();
                    discovered_tools.push(ToolDescriptor {
                        tool_name: format!("{}__{}", config.name, name),
                        description: desc.to_string(),
                        kind: ToolKind::Mcp,
                        required_permissions: vec![],
                        input_schema,
                    });
                }
            }
        }

        let mut client = client;
        client.tools = discovered_tools;
        Ok(client)
    }

    fn request(&self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        self.transport.call(id, method, params)
    }

    pub fn call_tool(&self, name: &str, arguments: Value) -> Result<Value, String> {
        let params = serde_json::json!({ "name": name, "arguments": arguments });
        self.request("tools/call", params)
    }

    /// 底层连接是否存活（子进程未退出 / SSE 流未断开）
    pub fn is_alive(&self) -> bool {
        self.transport.is_alive()
    }

    /// 主动关闭连接（kill 子进程 / 断开 SSE）
    pub fn kill(&self) {
        self.transport.shutdown();
    }
}

pub struct McpExecutor {
    pub client: Arc<ActiveMcpClient>,
    pub original_name: String,
    pub descriptor: ToolDescriptor,
}

impl ToolExecutor for McpExecutor {
    fn descriptor(&self) -> ToolDescriptor {
        self.descriptor.clone()
    }

    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn execute(&self, request: &forgeone_tools::ToolCallRequest) -> forgeone_tools::ToolCallResult {
        let args_val = serde_json::to_value(&request.arguments).unwrap_or(Value::Null);
        match self.client.call_tool(&self.original_name, args_val) {
            Ok(res) => {
                let mut structured_output = HashMap::new();
                if let Some(content_arr) = res.get("content").and_then(|c| c.as_array()) {
                    let mut text_out = String::new();
                    for item in content_arr {
                        if let Some(text) = item.get("text").and_then(|t| t.as_str()) {
                            text_out.push_str(text);
                        }
                    }
                    structured_output.insert("content".to_string(), text_out);
                } else {
                    structured_output.insert("content".to_string(), serde_json::to_string(&res).unwrap_or_default());
                }

                forgeone_tools::ToolCallResult {
                    call_id: request.call_id.clone(),
                    status: forgeone_tools::ToolCallStatus::Success,
                    structured_output,
                    error: None,
                    completed_at_ms: now_ms(),
                }
            }
            Err(e) => {
                forgeone_tools::ToolCallResult {
                    call_id: request.call_id.clone(),
                    status: forgeone_tools::ToolCallStatus::Failed,
                    structured_output: HashMap::new(),
                    error: Some(e),
                    completed_at_ms: now_ms(),
                }
            }
        }
    }
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn parse_endpoint_fallback(ep: &str) -> Result<(String, String), String> {
    let parts: Vec<&str> = ep.split_whitespace().collect();
    if parts.is_empty() {
        return Err("endpoint string is empty".to_string());
    }
    let cmd = parts[0].to_string();
    let args = parts[1..].iter().map(|s| s.to_string()).collect::<Vec<_>>().join(" ");
    Ok((cmd, args))
}

pub fn discover_workspace_mcp_configs(workspace_root: impl AsRef<Path>) -> Vec<McpServerConfig> {
    let mut configs = Vec::new();
    if let Ok(discovered) = forgeone_tools::discover_workspace_extensions(workspace_root) {
        for ext in discovered {
            if ext.provider.kind == ToolKind::Mcp {
                if let Some(entrypoint) = ext.entrypoint {
                    let parts: Vec<&str> = entrypoint.split_whitespace().collect();
                    if !parts.is_empty() {
                        let cmd = parts[0].to_string();
                        let args = parts[1..].iter().map(|s| s.to_string()).collect::<Vec<_>>().join(" ");
                        configs.push(McpServerConfig {
                            name: ext.provider.provider_id,
                            transport: "stdio".to_string(),
                            command: Some(cmd),
                            args: Some(args),
                            env: None,
                            endpoint: None,
                            headers: None,
                            timeout: None,
                        });
                    }
                }
            }
        }
    }
    configs
}

/// 幂等注册 MCP server：先项目级（`{workspace}/.forgeone/mcp/*.json`），
/// 再全局级（`{user_home}/.forgeone/mcp/*.json`）。同名时项目级覆盖全局级。
/// 发现 manifest → 拉起子进程并完成 initialize/tools/list 握手 → 以
/// `{server}__{tool}` 命名注册为 `ToolKind::Mcp` 工具。已注册的 server 自动跳过。
///
/// `workspace_root` 为空时仅处理全局级。
/// 返回 `(成功注册的 server 名列表, 失败信息列表)`。
pub fn register_workspace_mcp_servers(
    registry: &mut ToolRegistry,
    workspace_root: impl AsRef<Path>,
) -> (Vec<String>, Vec<String>) {
    let mut ok = Vec::new();
    let mut errors = Vec::new();

    // 候选列表：项目级在前（同名覆盖全局），全局级去重后追加
    let mut candidates: Vec<forgeone_tools::DiscoveredExtension> = Vec::new();
    if !workspace_root.as_ref().as_os_str().is_empty() {
        match forgeone_tools::discover_workspace_extensions(workspace_root.as_ref()) {
            Ok(list) => candidates.extend(
                list.into_iter()
                    .filter(|e| e.provider.kind == ToolKind::Mcp),
            ),
            Err(e) => errors.push(format!("mcp: 发现项目扩展清单失败: {e}")),
        }
    }
    match forgeone_tools::discover_global_extensions() {
        Ok(list) => {
            let mut seen: std::collections::HashSet<String> = candidates
                .iter()
                .map(|e| e.provider.provider_id.clone())
                .collect();
            for ext in list.into_iter().filter(|e| e.provider.kind == ToolKind::Mcp) {
                if seen.insert(ext.provider.provider_id.clone()) {
                    candidates.push(ext);
                }
            }
        }
        Err(e) => errors.push(format!("mcp: 发现全局扩展清单失败: {e}")),
    }

    for ext in candidates {
        let name = ext.provider.provider_id.clone();
        if registry.has_provider(&name) {
            continue;
        }

        let transport = ext.transport.as_deref().unwrap_or("stdio");
        let config = match transport {
            "sse" | "http" => {
                let Some(endpoint) = ext.endpoint else {
                    errors.push(format!("mcp:{name} sse 传输需要 endpoint 配置，跳过"));
                    continue;
                };
                McpServerConfig {
                    name: name.clone(),
                    transport: "sse".to_string(),
                    command: None,
                    args: None,
                    env: None,
                    endpoint: Some(endpoint),
                    headers: None,
                    timeout: None,
                }
            }
            _ => {
                let Some(entrypoint) = ext.entrypoint else {
                    errors.push(format!("mcp:{name} 未声明 entrypoint，跳过"));
                    continue;
                };
                let parts: Vec<&str> = entrypoint.split_whitespace().collect();
                if parts.is_empty() {
                    errors.push(format!("mcp:{name} entrypoint 为空，跳过"));
                    continue;
                }
                McpServerConfig {
                    name: name.clone(),
                    transport: "stdio".to_string(),
                    command: Some(parts[0].to_string()),
                    args: Some(parts[1..].join(" ")),
                    env: None,
                    endpoint: None,
                    headers: None,
                    timeout: None,
                }
            }
        };

        let client = match ActiveMcpClient::new(&config) {
            Ok(c) => c,
            Err(e) => {
                errors.push(format!("mcp:{name} 启动失败: {e}"));
                continue;
            }
        };

        let provider = ToolProviderDescriptor {
            provider_id: name.clone(),
            display_name: ext.provider.display_name.clone(),
            kind: ToolKind::Mcp,
            version: ext.provider.version.clone(),
            description: ext.provider.description.clone(),
            source: ext.provider.source.clone(),
        };
        if let Err(e) = registry.register_provider(provider) {
            errors.push(format!("mcp:{name} 注册 provider 失败: {e}"));
            continue;
        }

        let shared = Arc::new(client);
        let prefix = format!("{}__", name);
        for tool in &shared.tools {
            let Some(original_name) = tool.tool_name.strip_prefix(&prefix) else {
                continue;
            };
            let executor = McpExecutor {
                client: shared.clone(),
                original_name: original_name.to_string(),
                descriptor: tool.clone(),
            };
            if let Err(e) = registry.register_with_provider(&name, executor) {
                errors.push(format!(
                    "mcp:{name} 注册工具 {} 失败: {e}",
                    tool.tool_name
                ));
            }
        }
        ok.push(name);
    }

    (ok, errors)
}

/// 已注册 MCP server 的对外展示信息
#[derive(Debug, Clone, serde::Serialize)]
pub struct McpServerInfo {
    pub name: String,
    /// 配置层级："global"（用户级）| "project"（项目级）
    pub scope: String,
    /// 传输类型："stdio" | "sse"
    pub transport: String,
    /// "running"（已注册）| "failed"（有 manifest 但未注册成功）
    pub status: String,
    pub tool_count: usize,
    pub entrypoint: Option<String>,
}

/// MCP 工具信息（详情展示用）
#[derive(Debug, Clone, serde::Serialize)]
pub struct McpToolInfo {
    /// 完整工具名：`{server}__{tool}`
    pub name: String,
    pub description: String,
    pub input_schema: Option<Value>,
}

/// MCP server 详细信息
#[derive(Debug, Clone, serde::Serialize)]
pub struct McpServerDetail {
    #[serde(flatten)]
    pub info: McpServerInfo,
    pub tools: Vec<McpToolInfo>,
    pub manifest_path: Option<String>,
}

fn provider_to_info(registry: &ToolRegistry, provider: &ToolProviderDescriptor) -> McpServerInfo {
    let tool_count = registry
        .registered_tools()
        .iter()
        .filter(|t| t.provider.provider_id == provider.provider_id)
        .count();
    let entrypoint = match &provider.source {
        ToolProviderSource::WorkspaceManifest { manifest_path }
        | ToolProviderSource::GlobalManifest { manifest_path } => {
            read_manifest_entrypoint(manifest_path)
        }
        _ => None,
    };
    let scope = match &provider.source {
        ToolProviderSource::GlobalManifest { .. } => "global",
        ToolProviderSource::WorkspaceManifest { .. } => "project",
        _ => "unknown",
    };
    let transport = match &provider.source {
        ToolProviderSource::WorkspaceManifest { manifest_path }
        | ToolProviderSource::GlobalManifest { manifest_path } => {
            read_manifest_transport(manifest_path).unwrap_or_else(|| "stdio".to_string())
        }
        _ => "stdio".to_string(),
    };
    McpServerInfo {
        name: provider.provider_id.clone(),
        scope: scope.to_string(),
        transport,
        status: "running".to_string(),
        tool_count,
        entrypoint,
    }
}

fn read_manifest_field(manifest_path: &Path, field: &str) -> Option<String> {
    let content = std::fs::read_to_string(manifest_path).ok()?;
    let value: Value = serde_json::from_str(&content).ok()?;
    value
        .get(field)
        .and_then(|e| e.as_str())
        .map(|s| s.to_string())
}

fn read_manifest_entrypoint(manifest_path: &Path) -> Option<String> {
    read_manifest_field(manifest_path, "entrypoint")
}

fn read_manifest_transport(manifest_path: &Path) -> Option<String> {
    read_manifest_field(manifest_path, "transport")
}

/// 列出 MCP server：已注册的标 `running`；磁盘上存在 manifest 但未注册成功的
/// 标 `failed`（tool_count=0）一并返回——否则会出现"设置里看不到、又因配置已存在
/// 无法重新添加"的死锁。
pub fn list_workspace_mcp_servers(
    registry: &ToolRegistry,
    workspace: &str,
) -> Vec<McpServerInfo> {
    let mut servers = Vec::new();
    let mut registered_names: std::collections::HashSet<String> = std::collections::HashSet::new();

    for provider in registry.provider_descriptors() {
        if provider.kind != ToolKind::Mcp {
            continue;
        }
        registered_names.insert(provider.provider_id.clone());
        servers.push(provider_to_info(registry, &provider));
    }

    // 补充：磁盘存在 manifest 但未注册的 server（failed）
    let mut discovered: Vec<forgeone_tools::DiscoveredExtension> = Vec::new();
    if !workspace.trim().is_empty() {
        if let Ok(list) = forgeone_tools::discover_workspace_extensions(workspace) {
            discovered.extend(list);
        }
    }
    if let Ok(list) = forgeone_tools::discover_global_extensions() {
        discovered.extend(list);
    }
    for ext in discovered.into_iter().filter(|e| e.provider.kind == ToolKind::Mcp) {
        let name = ext.provider.provider_id.clone();
        if registered_names.contains(&name) {
            continue;
        }
        let transport = ext
            .transport
            .clone()
            .unwrap_or_else(|| "stdio".to_string());
        let entrypoint = match transport.as_str() {
            "sse" | "http" => ext.endpoint,
            _ => ext.entrypoint,
        };
        let scope = match &ext.provider.source {
            ToolProviderSource::GlobalManifest { .. } => "global",
            ToolProviderSource::WorkspaceManifest { .. } => "project",
            _ => "unknown",
        };
        servers.push(McpServerInfo {
            name,
            scope: scope.to_string(),
            transport,
            status: "failed".to_string(),
            tool_count: 0,
            entrypoint,
        });
    }

    servers.sort_by(|a, b| a.name.cmp(&b.name));
    servers
}

/// 校验 MCP server 名称：仅允许字母/数字/`_`/`-`/`.`，且不能以 `.` 开头（防止路径穿越）
fn validate_mcp_server_name(name: &str) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("server name 不能为空".to_string());
    }
    if name.starts_with('.') {
        return Err("server name 不能以 '.' 开头".to_string());
    }
    if !name
        .chars()
        .all(|c| c.is_alphanumeric() || matches!(c, '_' | '-' | '.'))
    {
        return Err(format!(
            "server name '{name}' 含非法字符（仅允许字母、数字、_、-、.）"
        ));
    }
    Ok(())
}

/// 添加 MCP server：按 `scope` 写入对应目录的 `mcp/{name}.json` 并注册。
///
/// - `scope = "global"`：写入 `{user_home}/.forgeone/mcp/`，对所有项目生效（无需 workspace）
/// - `scope = "project"`：写入 `{workspace}/.forgeone/mcp/`，仅当前项目生效
/// - `transport = "stdio"`（默认）：使用 `entrypoint` 启动子进程
/// - `transport = "sse"`：使用 `endpoint` 连接 HTTP+SSE 站点
///
/// 若注册失败（如 server 无法启动/连接），回滚已写入的 manifest 并返回错误。
pub fn add_workspace_mcp_server(
    registry: &mut ToolRegistry,
    scope: &str,
    workspace: &str,
    name: &str,
    transport: &str,
    entrypoint: &str,
    endpoint: &str,
) -> Result<McpServerInfo, String> {
    validate_mcp_server_name(name)?;
    let transport = transport.trim();
    if transport.is_empty() {
        return Err("transport 不能为空".to_string());
    }
    match transport {
        "stdio" => {
            if entrypoint.trim().is_empty() {
                return Err("stdio 传输需要 entrypoint 启动命令".to_string());
            }
        }
        "sse" | "http" => {
            let ep = endpoint.trim();
            if !(ep.starts_with("http://") || ep.starts_with("https://")) {
                return Err("sse 传输需要 http(s) 协议的 endpoint 地址".to_string());
            }
        }
        other => {
            return Err(format!("transport 必须是 stdio 或 sse，收到: {other}"));
        }
    }

    let mcp_dir = match scope {
        "global" => match forgeone_tools::user_forgeone_dir() {
            Some(dir) => dir.join("mcp"),
            None => {
                return Err("无法定位用户主目录（USERPROFILE/HOME 未设置）".to_string());
            }
        },
        "project" => {
            if workspace.trim().is_empty() {
                return Err("project scope 需要提供 workspace".to_string());
            }
            Path::new(workspace).join(".forgeone").join("mcp")
        }
        other => return Err(format!("scope 必须是 global 或 project，收到: {other}")),
    };
    let manifest_path = mcp_dir.join(format!("{name}.json"));
    if manifest_path.exists() {
        return Err(format!(
            "MCP server '{name}' 的配置已存在（{}）",
            manifest_path.display()
        ));
    }

    std::fs::create_dir_all(&mcp_dir)
        .map_err(|e| format!("创建 {} 失败: {e}", mcp_dir.display()))?;

    let mut manifest = serde_json::json!({
        "api_version": "forgeone/v1",
        "name": name,
        "kind": "mcp",
        "description": format!("MCP server: {name}"),
        "transport": transport,
        "tools": []
    });
    match transport {
        "sse" | "http" => {
            manifest["endpoint"] = Value::String(endpoint.trim().to_string());
        }
        _ => {
            manifest["entrypoint"] = Value::String(entrypoint.trim().to_string());
        }
    }
    std::fs::write(
        &manifest_path,
        serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?,
    )
    .map_err(|e| format!("写入 {} 失败: {e}", manifest_path.display()))?;

    // 重新注册（幂等）：新 manifest 会被发现并拉起；workspace 为空时仅注册全局
    let (ok, errors) = register_workspace_mcp_servers(registry, workspace);
    if !ok.iter().any(|n| n == name) {
        // 回滚：删除刚写入的 manifest
        let _ = std::fs::remove_file(&manifest_path);
        let detail = errors
            .iter()
            .find(|e| e.starts_with(&format!("mcp:{name}")))
            .cloned()
            .unwrap_or_else(|| format!("mcp:{name} 注册失败但无详细信息"));
        return Err(detail);
    }

    let tool_count = registry
        .registered_tools()
        .iter()
        .filter(|t| t.provider.provider_id == name)
        .count();
    Ok(McpServerInfo {
        name: name.to_string(),
        scope: scope.to_string(),
        transport: match transport {
            "sse" | "http" => "sse".to_string(),
            _ => "stdio".to_string(),
        },
        status: "running".to_string(),
        tool_count,
        entrypoint: match transport {
            "sse" | "http" => Some(endpoint.trim().to_string()),
            _ => Some(entrypoint.trim().to_string()),
        },
    })
}

/// 删除 MCP server：按 `scope` 移除对应目录的 `mcp/{name}.json` 并从注册表注销
/// （注销会 drop 执行器并 kill 对应子进程）。
pub fn remove_workspace_mcp_server(
    registry: &mut ToolRegistry,
    scope: &str,
    workspace: &str,
    name: &str,
) -> Result<(), String> {
    let manifest_path = match scope {
        "global" => match forgeone_tools::user_forgeone_dir() {
            Some(dir) => dir.join("mcp").join(format!("{name}.json")),
            None => {
                return Err("无法定位用户主目录（USERPROFILE/HOME 未设置）".to_string());
            }
        },
        "project" => Path::new(workspace)
            .join(".forgeone")
            .join("mcp")
            .join(format!("{name}.json")),
        other => return Err(format!("scope 必须是 global 或 project，收到: {other}")),
    };
    if manifest_path.exists() {
        std::fs::remove_file(&manifest_path)
            .map_err(|e| format!("删除 {} 失败: {e}", manifest_path.display()))?;
    }

    if registry.has_provider(name) {
        registry.remove_provider(name)?;
    }
    Ok(())
}

/// 定位 `{scope}` 对应目录下 `{name}.json` 的 manifest 路径
fn manifest_path_for(scope: &str, workspace: &str, name: &str) -> Result<std::path::PathBuf, String> {
    let path = match scope {
        "global" => match forgeone_tools::user_forgeone_dir() {
            Some(dir) => dir.join("mcp").join(format!("{name}.json")),
            None => {
                return Err("无法定位用户主目录（USERPROFILE/HOME 未设置）".to_string());
            }
        },
        "project" => Path::new(workspace)
            .join(".forgeone")
            .join("mcp")
            .join(format!("{name}.json")),
        other => return Err(format!("scope 必须是 global 或 project，收到: {other}")),
    };
    Ok(path)
}

/// 查询单个 MCP server 的详细信息：配置 + 工具列表。
/// 已注册的从 registry 取工具；未注册的（failed）从 manifest 读取配置，工具列表为空。
pub fn get_mcp_server_detail(
    registry: &ToolRegistry,
    scope: &str,
    workspace: &str,
    name: &str,
) -> Result<McpServerDetail, String> {
    let manifest_path = manifest_path_for(scope, workspace, name)?;
    if !manifest_path.exists() {
        return Err(format!("MCP server '{name}' 的配置不存在（{}）", manifest_path.display()));
    }

    // 已注册：provider + 工具
    if let Some(provider) = registry
        .provider_descriptors()
        .into_iter()
        .find(|p| p.kind == ToolKind::Mcp && p.provider_id == name)
    {
        let tools = registry
            .registered_tools()
            .into_iter()
            .filter(|t| t.provider.provider_id == name)
            .map(|t| McpToolInfo {
                name: t.tool.tool_name,
                description: t.tool.description,
                input_schema: t.tool.input_schema,
            })
            .collect();
        return Ok(McpServerDetail {
            info: provider_to_info(registry, &provider),
            tools,
            manifest_path: Some(manifest_path.display().to_string()),
        });
    }

    // 未注册：从 manifest 读配置
    let transport = read_manifest_transport(&manifest_path).unwrap_or_else(|| "stdio".to_string());
    let entrypoint = match transport.as_str() {
        "sse" | "http" => read_manifest_field(&manifest_path, "endpoint"),
        _ => read_manifest_field(&manifest_path, "entrypoint"),
    };
    Ok(McpServerDetail {
        info: McpServerInfo {
            name: name.to_string(),
            scope: scope.to_string(),
            transport,
            status: "failed".to_string(),
            tool_count: 0,
            entrypoint,
        },
        tools: Vec::new(),
        manifest_path: Some(manifest_path.display().to_string()),
    })
}

/// 重连 MCP server：**无论当前状态都重建连接**（kill 旧连接 → 重新注册），
/// 用于应用 manifest 的最新配置更新；磁盘上没有 manifest 时返回错误。
/// 注册失败时保留 manifest（不会误删配置）。
pub fn reconnect_mcp_server(
    registry: &mut ToolRegistry,
    scope: &str,
    workspace: &str,
    name: &str,
) -> Result<McpServerInfo, String> {
    let manifest_path = manifest_path_for(scope, workspace, name)?;
    if !manifest_path.exists() {
        return Err(format!("MCP server '{name}' 的配置不存在（{}）", manifest_path.display()));
    }

    // 已注册的先注销（kill 旧连接），再按最新 manifest 重建
    if registry.has_provider(name) {
        registry.remove_provider(name)?;
    }

    // 触发全量幂等注册（workspace 为空时仅全局），检查该 server 是否注册成功
    let (ok, errors) = register_workspace_mcp_servers(registry, workspace);
    if ok.iter().any(|n| n == name) {
        let provider = registry
            .provider_descriptors()
            .into_iter()
            .find(|p| p.kind == ToolKind::Mcp && p.provider_id == name)
            .ok_or_else(|| format!("mcp:{name} 注册返回成功但 provider 缺失"))?;
        return Ok(provider_to_info(registry, &provider));
    }
    let detail = errors
        .iter()
        .find(|e| e.starts_with(&format!("mcp:{name}")))
        .cloned()
        .unwrap_or_else(|| format!("mcp:{name} 重连失败但无详细信息"));
    Err(detail)
}
