use std::collections::HashMap;
use std::fmt;
use std::fs;
#[cfg(windows)]
use encoding_rs::GBK;
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

pub mod extensions;
pub use extensions::*;

static TOOL_CALL_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolKind {
    Builtin,
    Mcp,
    Plugin,
    Skill,
    Workflow,
}

impl ToolKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Builtin => "builtin",
            Self::Mcp => "mcp",
            Self::Plugin => "plugin",
            Self::Skill => "skill",
            Self::Workflow => "workflow",
        }
    }

    pub fn from_manifest_value(value: &str) -> Option<Self> {
        match value {
            "builtin" => Some(Self::Builtin),
            "mcp" => Some(Self::Mcp),
            "plugin" => Some(Self::Plugin),
            "skill" => Some(Self::Skill),
            "workflow" => Some(Self::Workflow),
            _ => None,
        }
    }
}

impl fmt::Display for ToolKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolCallStatus {
    Success,
    ValidationError,
    PermissionDenied,
    Failed,
}

impl fmt::Display for ToolCallStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Success => write!(f, "success"),
            Self::ValidationError => write!(f, "validation_error"),
            Self::PermissionDenied => write!(f, "permission_denied"),
            Self::Failed => write!(f, "failed"),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolDescriptor {
    pub tool_name: String,
    pub description: String,
    pub kind: ToolKind,
    pub required_permissions: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct ToolCallRequest {
    pub call_id: String,
    pub session_id: String,
    pub agent_id: String,
    pub loop_index: u32,
    pub tool_name: String,
    pub arguments: HashMap<String, String>,
    pub requested_by: String,
}

#[derive(Debug, Clone)]
pub struct ToolCallResult {
    pub call_id: String,
    pub status: ToolCallStatus,
    pub structured_output: HashMap<String, String>,
    pub error: Option<String>,
    pub completed_at_ms: u128,
}

impl ToolCallResult {
    pub fn summary(&self) -> String {
        let keys = self
            .structured_output
            .keys()
            .map(String::as_str)
            .collect::<Vec<_>>()
            .join(",");

        format!(
            "call_id={} status={} output_keys=[{}]",
            self.call_id, self.status, keys
        )
    }
}

#[derive(Debug, Clone)]
pub struct Observation {
    pub tool_name: String,
    pub summary: String,
    /// Full tool output content, if available.
    /// For read_file this is the file preview text.
    pub content: Option<String>,
}

pub trait ToolExecutor: Send + Sync {
    fn descriptor(&self) -> ToolDescriptor;
    fn execute(&self, request: &ToolCallRequest) -> ToolCallResult;
}

#[derive(Default)]
pub struct ToolRegistry {
    executors: HashMap<String, Arc<dyn ToolExecutor>>,
    providers: HashMap<String, ToolProviderDescriptor>,
    tool_providers: HashMap<String, String>,
}

impl ToolRegistry {
    pub fn with_builtin_tools() -> Self {
        let mut registry = Self::default();
        registry
            .register_provider(ToolProviderDescriptor::builtin())
            .expect("builtin provider registration should succeed");
        registry.register(ReadFileTool);
        registry.register(SearchContentTool);
        registry.register(SearchFilesTool);
        registry.register(WriteFileTool);
        registry.register(ShellTool);
        registry
    }

    pub fn register<T>(&mut self, tool: T)
    where
        T: ToolExecutor + 'static,
    {
        self.ensure_builtin_provider();
        self.register_with_provider(BUILTIN_PROVIDER_ID, tool)
            .expect("builtin tool registration should succeed");
    }

    pub fn register_provider(&mut self, provider: ToolProviderDescriptor) -> Result<(), String> {
        if let Some(existing) = self.providers.get(&provider.provider_id) {
            if existing != &provider {
                return Err(format!(
                    "provider={} already registered with different metadata",
                    provider.provider_id
                ));
            }
            return Ok(());
        }

        self.providers
            .insert(provider.provider_id.clone(), provider);
        Ok(())
    }

    pub fn register_with_provider<T>(&mut self, provider_id: &str, tool: T) -> Result<(), String>
    where
        T: ToolExecutor + 'static,
    {
        let descriptor = tool.descriptor();
        self.register_executor(provider_id, descriptor, Arc::new(tool))
    }

    pub fn provider_descriptors(&self) -> Vec<ToolProviderDescriptor> {
        let mut list: Vec<ToolProviderDescriptor> = self.providers.values().cloned().collect();
        list.sort_by(|a, b| a.provider_id.cmp(&b.provider_id));
        list
    }

    pub fn descriptors(&self) -> Vec<ToolDescriptor> {
        let mut list: Vec<ToolDescriptor> = self
            .executors
            .values()
            .map(|executor| executor.descriptor())
            .collect();
        list.sort_by(|a, b| a.tool_name.cmp(&b.tool_name));
        list
    }

    pub fn registered_tools(&self) -> Vec<RegisteredToolDescriptor> {
        let mut list = Vec::new();
        for tool in self.descriptors() {
            let Some(provider_id) = self.tool_providers.get(&tool.tool_name) else {
                continue;
            };
            let Some(provider) = self.providers.get(provider_id) else {
                continue;
            };

            list.push(RegisteredToolDescriptor {
                provider: provider.clone(),
                tool,
            });
        }
        list
    }

    pub fn execute(&self, request: &ToolCallRequest) -> ToolCallResult {
        let Some(executor) = self.executors.get(&request.tool_name) else {
            return ToolCallResult {
                call_id: request.call_id.clone(),
                status: ToolCallStatus::ValidationError,
                structured_output: HashMap::new(),
                error: Some(format!("unknown_tool={}", request.tool_name)),
                completed_at_ms: now_ms(),
            };
        };

        executor.execute(request)
    }

    fn register_executor(
        &mut self,
        provider_id: &str,
        descriptor: ToolDescriptor,
        executor: Arc<dyn ToolExecutor>,
    ) -> Result<(), String> {
        if !self.providers.contains_key(provider_id) {
            return Err(format!("provider={} is not registered", provider_id));
        }

        if let Some(existing_provider_id) = self.tool_providers.get(&descriptor.tool_name)
            && existing_provider_id != provider_id
        {
            return Err(format!(
                "tool={} already registered by provider={}",
                descriptor.tool_name, existing_provider_id
            ));
        }

        let tool_name = descriptor.tool_name.clone();
        self.executors.insert(tool_name.clone(), executor);
        self.tool_providers
            .insert(tool_name, provider_id.to_string());
        Ok(())
    }

    fn ensure_builtin_provider(&mut self) {
        if !self.providers.contains_key(BUILTIN_PROVIDER_ID) {
            self.providers.insert(
                BUILTIN_PROVIDER_ID.to_string(),
                ToolProviderDescriptor::builtin(),
            );
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct ReadFileTool;

impl ToolExecutor for ReadFileTool {
    fn descriptor(&self) -> ToolDescriptor {
        ToolDescriptor {
            tool_name: "read_file".to_string(),
            description: "Read a file from the local workspace".to_string(),
            kind: ToolKind::Builtin,
            required_permissions: vec!["fs_read".to_string()],
        }
    }

    fn execute(&self, request: &ToolCallRequest) -> ToolCallResult {
        let Some(path) = request.arguments.get("path") else {
            return ToolCallResult {
                call_id: request.call_id.clone(),
                status: ToolCallStatus::ValidationError,
                structured_output: HashMap::new(),
                error: Some("missing_argument=path".to_string()),
                completed_at_ms: now_ms(),
            };
        };

        let path_buf = PathBuf::from(path);
        match fs::read_to_string(&path_buf) {
            Ok(content) => {
                let mut structured_output = HashMap::new();
                structured_output.insert("path".to_string(), path.clone());
                structured_output.insert(
                    "preview".to_string(),
                    content.lines().take(50).collect::<Vec<_>>().join("\n"),
                );
                structured_output.insert("bytes".to_string(), content.len().to_string());

                ToolCallResult {
                    call_id: request.call_id.clone(),
                    status: ToolCallStatus::Success,
                    structured_output,
                    error: None,
                    completed_at_ms: now_ms(),
                }
            }
            Err(error) => ToolCallResult {
                call_id: request.call_id.clone(),
                status: ToolCallStatus::Failed,
                structured_output: HashMap::new(),
                error: Some(error.to_string()),
                completed_at_ms: now_ms(),
            },
        }
    }
}

// ── search_content ────────────────────────────────────────────────

#[derive(Debug, Clone, Copy)]
pub struct SearchContentTool;

impl ToolExecutor for SearchContentTool {
    fn descriptor(&self) -> ToolDescriptor {
        ToolDescriptor {
            tool_name: "search_content".to_string(),
            description: "Search file contents by regex pattern across the workspace".to_string(),
            kind: ToolKind::Builtin,
            required_permissions: vec!["fs_read".to_string()],
        }
    }

    fn execute(&self, request: &ToolCallRequest) -> ToolCallResult {
        let pattern = match request.arguments.get("pattern") {
            Some(v) => v,
            None => return error_result(request, "missing_argument=pattern"),
        };
        let root = request
            .arguments
            .get("path")
            .cloned()
            .unwrap_or_else(|| ".".to_string());
        let glob_filter = request.arguments.get("glob");
        let context_lines: usize = request
            .arguments
            .get("context")
            .and_then(|v| v.parse().ok())
            .unwrap_or(0);

        let re = match regex_lite::Regex::new(pattern) {
            Ok(re) => re,
            Err(e) => return error_result(request, &format!("invalid_regex={e}")),
        };

        let root_path = PathBuf::from(&root);
        let mut matches = Vec::new();
        let mut file_count = 0usize;
        let max_matches = 200;

        for entry in walkdir::WalkDir::new(&root_path)
            .follow_links(false)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            if !entry.file_type().is_file() {
                continue;
            }
            let path = entry.path();
            // Skip common binary/dependency directories
            let p_str = path.to_string_lossy();
            if p_str.contains("/node_modules/")
                || p_str.contains("/target/")
                || p_str.contains("/.git/")
                || p_str.contains("\\.git\\")
                || p_str.contains("\\target\\")
                || p_str.contains("\\node_modules\\")
            {
                continue;
            }
            if let Some(glob) = glob_filter
                && !p_str.contains(glob)
                && !path
                    .file_name()
                    .map(|n| n.to_string_lossy().contains(glob.as_str()))
                    .unwrap_or(false)
            {
                continue;
            }

            file_count += 1;
            if file_count > 500 {
                // Limit file scan to avoid hanging on huge projects
                break;
            }

            let content = match fs::read_to_string(path) {
                Ok(c) => c,
                Err(_) => continue,
            };

            for (line_no, line) in content.lines().enumerate() {
                if re.is_match(line) {
                    let mut snippet = String::new();
                    // Context lines before
                    let lines: Vec<&str> = content.lines().collect();
                    let start = line_no.saturating_sub(context_lines);
                    let end = (line_no + 1 + context_lines).min(lines.len());
                    for (ctx_line_no, ctx_line) in lines[start..end].iter().enumerate() {
                        snippet.push_str(&format!(
                            "{}:{}:{}\n",
                            path.display(),
                            start + ctx_line_no + 1,
                            ctx_line
                        ));
                    }

                    matches.push(format!("{}:{}:{}", path.display(), line_no + 1, line));

                    if matches.len() >= max_matches {
                        break;
                    }
                }
            }
            if matches.len() >= max_matches {
                break;
            }
        }

        let mut structured_output = HashMap::new();
        structured_output.insert(
            "matches".to_string(),
            format!("{}\n{}", matches.len(), matches.join("\n")),
        );
        structured_output.insert("match_count".to_string(), matches.len().to_string());

        ToolCallResult {
            call_id: request.call_id.clone(),
            status: ToolCallStatus::Success,
            structured_output,
            error: None,
            completed_at_ms: now_ms(),
        }
    }
}

// ── search_files ──────────────────────────────────────────────────

#[derive(Debug, Clone, Copy)]
pub struct SearchFilesTool;

impl ToolExecutor for SearchFilesTool {
    fn descriptor(&self) -> ToolDescriptor {
        ToolDescriptor {
            tool_name: "search_files".to_string(),
            description: "Find files by name pattern in the workspace".to_string(),
            kind: ToolKind::Builtin,
            required_permissions: vec!["fs_read".to_string()],
        }
    }

    fn execute(&self, request: &ToolCallRequest) -> ToolCallResult {
        let pattern = match request.arguments.get("pattern") {
            Some(v) => v,
            None => return error_result(request, "missing_argument=pattern"),
        };
        let root = request
            .arguments
            .get("path")
            .cloned()
            .unwrap_or_else(|| ".".to_string());

        let root_path = PathBuf::from(&root);
        let pattern_lower = pattern.to_lowercase();
        let mut results = Vec::new();
        let max_results = 200;

        for entry in walkdir::WalkDir::new(&root_path)
            .follow_links(false)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            if !entry.file_type().is_file() {
                continue;
            }
            let path = entry.path();
            let p_str = path.to_string_lossy();
            if p_str.contains("/node_modules/")
                || p_str.contains("/target/")
                || p_str.contains("/.git/")
                || p_str.contains("\\.git\\")
                || p_str.contains("\\target\\")
                || p_str.contains("\\node_modules\\")
            {
                continue;
            }

            let name = path
                .file_name()
                .map(|n| n.to_string_lossy())
                .unwrap_or_default();
            if name.to_lowercase().contains(&pattern_lower) {
                results.push(path.display().to_string());
                if results.len() >= max_results {
                    break;
                }
            }
        }

        let mut structured_output = HashMap::new();
        structured_output.insert(
            "files".to_string(),
            format!("{}\n{}", results.len(), results.join("\n")),
        );
        structured_output.insert("file_count".to_string(), results.len().to_string());

        ToolCallResult {
            call_id: request.call_id.clone(),
            status: ToolCallStatus::Success,
            structured_output,
            error: None,
            completed_at_ms: now_ms(),
        }
    }
}

// ── write_file ────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy)]
pub struct WriteFileTool;

impl ToolExecutor for WriteFileTool {
    fn descriptor(&self) -> ToolDescriptor {
        ToolDescriptor {
            tool_name: "write_file".to_string(),
            description: "Write content to a file, overwriting if it exists".to_string(),
            kind: ToolKind::Builtin,
            required_permissions: vec!["fs_write".to_string()],
        }
    }

    fn execute(&self, request: &ToolCallRequest) -> ToolCallResult {
        let path = match request.arguments.get("path") {
            Some(v) => v,
            None => return error_result(request, "missing_argument=path"),
        };
        let content = match request.arguments.get("content") {
            Some(v) => v,
            None => return error_result(request, "missing_argument=content"),
        };
        let create_parents = request
            .arguments
            .get("create_parents")
            .map(|v| v == "true")
            .unwrap_or(false);

        let path_buf = PathBuf::from(path);

        if create_parents
            && let Some(parent) = path_buf.parent()
            && !parent.as_os_str().is_empty()
            && let Err(e) = fs::create_dir_all(parent)
        {
            return error_result(request, &format!("create_parents_failed={e}"));
        }

        match fs::write(&path_buf, content) {
            Ok(()) => {
                let mut structured_output = HashMap::new();
                structured_output.insert("path".to_string(), path.clone());
                structured_output.insert("bytes".to_string(), content.len().to_string());
                ToolCallResult {
                    call_id: request.call_id.clone(),
                    status: ToolCallStatus::Success,
                    structured_output,
                    error: None,
                    completed_at_ms: now_ms(),
                }
            }
            Err(e) => error_result(request, &format!("write_failed={e}")),
        }
    }
}

// ── shell ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy)]
pub struct ShellTool;

impl ToolExecutor for ShellTool {
    fn descriptor(&self) -> ToolDescriptor {
        ToolDescriptor {
            tool_name: "shell".to_string(),
            description: "Run a shell command and capture output".to_string(),
            kind: ToolKind::Builtin,
            required_permissions: vec!["cmd_exec".to_string()],
        }
    }

    fn execute(&self, request: &ToolCallRequest) -> ToolCallResult {
        let command = match request.arguments.get("command") {
            Some(v) => v,
            None => return error_result(request, "missing_argument=command"),
        };
        let _timeout_sec: u64 = request
            .arguments
            .get("timeout_sec")
            .and_then(|v| v.parse().ok())
            .unwrap_or(30);

        #[cfg(windows)]
        let output = {
            let mut shell = std::process::Command::new("cmd");
            shell.arg("/D").arg("/S").arg("/U").arg("/C");
            shell.raw_arg(command);
            shell.output()
        };

        #[cfg(not(windows))]
        let output = std::process::Command::new("sh")
            .args(["-c", command])
            .output();

        match output {
            Ok(output) => {
                #[cfg(windows)]
                let stdout = decode_windows_console_output(&output.stdout);
                #[cfg(not(windows))]
                let stdout = String::from_utf8_lossy(&output.stdout).to_string();

                #[cfg(windows)]
                let stderr = decode_windows_console_output(&output.stderr);
                #[cfg(not(windows))]
                let stderr = String::from_utf8_lossy(&output.stderr).to_string();
                let exit_code = output.status.code().unwrap_or(-1);

                // Truncate if too long
                let stdout_truncated = truncate_output(&stdout, 8000);
                let stderr_truncated = truncate_output(&stderr, 2000);

                let mut structured_output = HashMap::new();
                structured_output.insert("exit_code".to_string(), exit_code.to_string());
                structured_output.insert("stdout".to_string(), stdout_truncated);
                if !stderr.is_empty() {
                    structured_output.insert("stderr".to_string(), stderr_truncated);
                }

                let status = if exit_code == 0 {
                    ToolCallStatus::Success
                } else {
                    ToolCallStatus::Failed
                };

                ToolCallResult {
                    call_id: request.call_id.clone(),
                    status,
                    structured_output,
                    error: None,
                    completed_at_ms: now_ms(),
                }
            }
            Err(e) => error_result(request, &format!("command_failed={e}")),
        }
    }
}

// ── helpers ───────────────────────────────────────────────────────

fn error_result(request: &ToolCallRequest, msg: &str) -> ToolCallResult {
    ToolCallResult {
        call_id: request.call_id.clone(),
        status: ToolCallStatus::ValidationError,
        structured_output: HashMap::new(),
        error: Some(msg.to_string()),
        completed_at_ms: now_ms(),
    }
}

#[cfg(windows)]
fn decode_windows_console_output(bytes: &[u8]) -> String {
    if bytes.is_empty() {
        return String::new();
    }

    if looks_like_utf16le(bytes) {
        let utf16 = bytes
            .chunks_exact(2)
            .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
            .collect::<Vec<_>>();
        return String::from_utf16_lossy(&utf16);
    }

    if let Ok(text) = String::from_utf8(bytes.to_vec()) {
        return text;
    }

    let (decoded, _, _) = GBK.decode(bytes);
    decoded.into_owned()
}

#[cfg(windows)]
fn looks_like_utf16le(bytes: &[u8]) -> bool {
    if bytes.len() < 4 || bytes.len() % 2 != 0 {
        return false;
    }

    let zero_high_bytes = bytes
        .iter()
        .skip(1)
        .step_by(2)
        .filter(|&&byte| byte == 0)
        .count();

    zero_high_bytes * 2 >= bytes.len() / 2
}

fn truncate_output(text: &str, max_len: usize) -> String {
    if text.len() > max_len {
        let mut end = max_len;
        while !text.is_char_boundary(end) {
            end += 1;
        }
        format!("{}...\n[output truncated at {max_len} bytes]", &text[..end])
    } else {
        text.to_string()
    }
}

pub fn next_tool_call_id() -> String {
    let counter = TOOL_CALL_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("tool-call-{counter}")
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time should be after unix epoch")
        .as_millis()
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct McpServerConfig {
    pub name: String,
    pub transport: String,
    pub command: Option<String>,
    pub args: Option<String>,
    pub env: Option<Vec<McpEnvVar>>,
    pub endpoint: Option<String>,
    pub headers: Option<Vec<McpHeader>>,
    pub timeout: Option<u64>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct McpEnvVar {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub struct McpHeader {
    pub key: String,
    pub value: String,
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::{ShellTool, ToolCallRequest, ToolCallStatus, ToolExecutor, ToolRegistry, next_tool_call_id};

    #[test]
    fn read_file_tool_returns_preview() {
        let registry = ToolRegistry::with_builtin_tools();
        let mut arguments = HashMap::new();
        arguments.insert("path".to_string(), "Cargo.toml".to_string());

        let result = registry.execute(&ToolCallRequest {
            call_id: next_tool_call_id(),
            session_id: "session-1".to_string(),
            agent_id: "agent-1".to_string(),
            loop_index: 1,
            tool_name: "read_file".to_string(),
            arguments,
            requested_by: "runtime".to_string(),
        });

        assert_eq!(result.status, ToolCallStatus::Success);
        assert!(result.structured_output.contains_key("preview"));
    }

    #[cfg(windows)]
    #[test]
    fn shell_tool_handles_trailing_backslash_arguments() {
        let mut arguments = HashMap::new();
        arguments.insert("command".to_string(), "dir C:\\".to_string());

        let result = ShellTool.execute(&ToolCallRequest {
            call_id: next_tool_call_id(),
            session_id: "session-1".to_string(),
            agent_id: "agent-1".to_string(),
            loop_index: 1,
            tool_name: "shell".to_string(),
            arguments,
            requested_by: "runtime".to_string(),
        });

        assert_eq!(result.status, ToolCallStatus::Success);
        assert_eq!(
            result.structured_output.get("exit_code").map(String::as_str),
            Some("0")
        );
        assert!(result.structured_output.contains_key("stdout"));
    }

    #[cfg(windows)]
    #[test]
    fn decode_windows_console_output_handles_utf16le() {
        let bytes = "C:\\盘符\r\n".encode_utf16().flat_map(|unit| unit.to_le_bytes()).collect::<Vec<_>>();
        assert_eq!(super::decode_windows_console_output(&bytes), "C:\\盘符\r\n");
    }
}
