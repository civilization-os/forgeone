use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use forgeone_tools::{McpServerConfig, ToolDescriptor, ToolExecutor, ToolKind};
use serde_json::Value;

pub struct ActiveMcpClient {
    pub name: String,
    pub writer: Mutex<std::process::ChildStdin>,
    pub reader: Mutex<BufReader<std::process::ChildStdout>>,
    pub child: Mutex<Child>,
    pub tools: Vec<ToolDescriptor>,
}

impl Drop for ActiveMcpClient {
    fn drop(&mut self) {
        let _ = self.kill();
    }
}

impl ActiveMcpClient {
    pub fn new(config: &McpServerConfig) -> Result<Self, String> {
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
        let reader = BufReader::new(stdout);

        let client = Self {
            name: config.name.clone(),
            writer: Mutex::new(stdin),
            reader: Mutex::new(reader),
            child: Mutex::new(child),
            tools: Vec::new(),
        };

        // 1. initialize 握手
        let init_req = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {
                    "name": "forgeone-runtime",
                    "version": "0.1.0"
                }
            }
        });
        
        let mut init_line = serde_json::to_string(&init_req).map_err(|e| e.to_string())?;
        init_line.push('\n');

        {
            let mut writer = client.writer.lock().map_err(|e| e.to_string())?;
            writer.write_all(init_line.as_bytes()).map_err(|e| e.to_string())?;
            writer.flush().map_err(|e| e.to_string())?;
        }

        let mut init_resp_line = String::new();
        {
            let mut reader = client.reader.lock().map_err(|e| e.to_string())?;
            reader.read_line(&mut init_resp_line).map_err(|e| e.to_string())?;
        }

        // 2. notifications/initialized 握手
        let init_notif = serde_json::json!({
            "jsonrpc": "2.0",
            "method": "notifications/initialized"
        });
        let mut notif_line = serde_json::to_string(&init_notif).map_err(|e| e.to_string())?;
        notif_line.push('\n');
        {
            let mut writer = client.writer.lock().map_err(|e| e.to_string())?;
            writer.write_all(notif_line.as_bytes()).map_err(|e| e.to_string())?;
            writer.flush().map_err(|e| e.to_string())?;
        }

        // 3. tools/list 获取工具定义列表
        let tools_req = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/list"
        });
        let mut tools_line = serde_json::to_string(&tools_req).map_err(|e| e.to_string())?;
        tools_line.push('\n');
        {
            let mut writer = client.writer.lock().map_err(|e| e.to_string())?;
            writer.write_all(tools_line.as_bytes()).map_err(|e| e.to_string())?;
            writer.flush().map_err(|e| e.to_string())?;
        }

        let mut tools_resp_line = String::new();
        {
            let mut reader = client.reader.lock().map_err(|e| e.to_string())?;
            reader.read_line(&mut tools_resp_line).map_err(|e| e.to_string())?;
        }

        let tools_resp: Value = serde_json::from_str(&tools_resp_line).map_err(|e| e.to_string())?;
        let mut discovered_tools = Vec::new();
        if let Some(tools_arr) = tools_resp.get("result").and_then(|r| r.get("tools")).and_then(|t| t.as_array()) {
            for tool_val in tools_arr {
                if let Some(name) = tool_val.get("name").and_then(|n| n.as_str()) {
                    let desc = tool_val.get("description").and_then(|d| d.as_str()).unwrap_or_default();
                    discovered_tools.push(ToolDescriptor {
                        tool_name: format!("{}__{}", config.name, name),
                        description: desc.to_string(),
                        kind: ToolKind::Mcp,
                        required_permissions: vec![],
                    });
                }
            }
        }

        let mut client = client;
        client.tools = discovered_tools;
        Ok(client)
    }

    pub fn call_tool(&self, name: &str, arguments: Value) -> Result<Value, String> {
        let req = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 3,
            "method": "tools/call",
            "params": {
                "name": name,
                "arguments": arguments
            }
        });
        let mut line = serde_json::to_string(&req).map_err(|e| e.to_string())?;
        line.push('\n');

        {
            let mut writer = self.writer.lock().map_err(|e| e.to_string())?;
            writer.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
            writer.flush().map_err(|e| e.to_string())?;
        }

        let mut response_line = String::new();
        {
            let mut reader = self.reader.lock().map_err(|e| e.to_string())?;
            reader.read_line(&mut response_line).map_err(|e| e.to_string())?;
        }

        let resp: Value = serde_json::from_str(&response_line).map_err(|e| e.to_string())?;
        if let Some(err) = resp.get("error") {
            return Err(err.get("message").and_then(|v| v.as_str()).unwrap_or("Unknown error").to_string());
        }
        Ok(resp.get("result").cloned().unwrap_or(Value::Null))
    }

    pub fn kill(&self) -> Result<(), String> {
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
        }
        Ok(())
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
