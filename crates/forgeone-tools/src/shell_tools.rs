use std::collections::HashMap;
#[cfg(windows)]
use std::os::windows::process::CommandExt;

use crate::types::{ToolCallRequest, ToolCallResult, ToolCallStatus, ToolDescriptor, ToolKind, ToolExecutor};
use crate::util::{decode_windows_console_output, error_result, now_ms, truncate_output};

#[derive(Debug, Clone, Copy)]
pub struct ShellTool;

impl ToolExecutor for ShellTool {
    fn descriptor(&self) -> ToolDescriptor {
        ToolDescriptor {
            tool_name: "shell".to_string(),
            description: "Run a shell command and capture output".to_string(),
            kind: ToolKind::Builtin,
            required_permissions: vec!["cmd_exec".to_string()],
        input_schema: None,
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
        let cwd = request.arguments.get("cwd").cloned().unwrap_or_default();

        #[cfg(windows)]
        let output = {
            let mut shell = std::process::Command::new("cmd");
            shell.arg("/D").arg("/S").arg("/U").arg("/C");
            let cmd = if cwd.is_empty() {
                command.clone()
            } else {
                format!("cd /d \"{}\" && {}", cwd, command)
            };
            shell.raw_arg(&cmd);
            shell.output()
        };

        #[cfg(not(windows))]
        let output = {
            let cmd = if cwd.is_empty() {
                command.clone()
            } else {
                format!("cd \"{}\" && {}", cwd, command)
            };
            std::process::Command::new("sh").args(["-c", &cmd]).output()
        };

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
                    structured_output.insert("stderr".to_string(), stderr_truncated.clone());
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



#[derive(Debug, Clone, Copy)]
pub struct GitTool;

impl ToolExecutor for GitTool {
    fn descriptor(&self) -> ToolDescriptor {
        ToolDescriptor {
            tool_name: "git".to_string(),
            description: "Run git commands (status, diff, log, show, branch)".to_string(),
            kind: ToolKind::Builtin,
            required_permissions: vec!["cmd_exec".to_string()],
        input_schema: None,
        }
    }

    fn execute(&self, request: &ToolCallRequest) -> ToolCallResult {
        let command = match request.arguments.get("command") {
            Some(v) => v,
            None => return error_result(request, "missing_argument=command"),
        };
        let args_str = request.arguments.get("args").map(String::as_str).unwrap_or("");
        let path = request.arguments.get("path").map(String::as_str).unwrap_or(".");

        let mut cmd = std::process::Command::new("git");
        cmd.arg(command);
        cmd.current_dir(path);

        // Parse additional args separated by spaces
        for arg in args_str.split_whitespace() {
            if !arg.is_empty() {
                cmd.arg(arg);
            }
        }

        match cmd.output() {
            Ok(output) => {
                let stdout = String::from_utf8_lossy(&output.stdout).to_string();
                let stderr = String::from_utf8_lossy(&output.stderr).to_string();
                let exit_code = output.status.code().unwrap_or(-1);

                let stdout_truncated = truncate_output(&stdout, 16000);
                let stderr_truncated = truncate_output(&stderr, 2000);

                let mut structured_output = std::collections::HashMap::new();
                structured_output.insert("exit_code".to_string(), exit_code.to_string());
                structured_output.insert("stdout".to_string(), stdout_truncated);
                if !stderr.is_empty() {
                    structured_output.insert("stderr".to_string(), stderr_truncated.clone());
                }
                structured_output.insert("git_command".to_string(), format!("git {}", command));

                let status = if exit_code == 0 {
                    ToolCallStatus::Success
                } else {
                    ToolCallStatus::Failed
                };

                ToolCallResult {
                    call_id: request.call_id.clone(),
                    status,
                    structured_output,
                    error: if !stderr.is_empty() { Some(stderr_truncated) } else { None },
                    completed_at_ms: now_ms(),
                }
            }
            Err(e) => error_result(request, &format!("git_exec_failed={e}")),
        }
    }
}



#[derive(Debug, Clone, Copy)]
pub struct DiagnosticsTool;

impl ToolExecutor for DiagnosticsTool {
    fn descriptor(&self) -> ToolDescriptor {
        ToolDescriptor {
            tool_name: "diagnostics".to_string(),
            description: "Run cargo check and return structured compiler diagnostics".to_string(),
            kind: ToolKind::Builtin,
            required_permissions: vec!["cmd_exec".to_string()],
        input_schema: None,
        }
    }

    fn execute(&self, request: &ToolCallRequest) -> ToolCallResult {
        let path = request.arguments.get("path").cloned().unwrap_or_else(|| ".".to_string());
        let extra_args = request.arguments.get("args").cloned().unwrap_or_default();

        let mut cmd = std::process::Command::new("cargo");
        cmd.arg("check");
        cmd.current_dir(&path);

        // Pass through extra args like --tests or --all-targets
        for arg in extra_args.split_whitespace() {
            if !arg.is_empty() {
                cmd.arg(arg);
            }
        }

        // Use message-format json for structured output
        cmd.args(["--message-format", "json"]);

        match cmd.output() {
            Ok(output) => {
                let stdout = String::from_utf8_lossy(&output.stdout);
                let stderr = String::from_utf8_lossy(&output.stderr);
                let exit_code = output.status.code().unwrap_or(-1);

                let mut errors = Vec::new();
                let mut warnings = Vec::new();

                // Parse JSON lines from cargo output
                for line in stdout.lines() {
                    if let Ok(msg) = serde_json::from_str::<serde_json::Value>(line)
                        && let Some(reason) = msg.get("reason").and_then(|v| v.as_str())
                        && reason == "compiler-message"
                        && let Some(message) = msg.get("message")
                    {
                        let level = message.get("level").and_then(|v| v.as_str()).unwrap_or("");
                        let msg_text = message.get("rendered").and_then(|v| v.as_str())
                            .or_else(|| message.get("message").and_then(|v| v.as_str()))
                            .unwrap_or("")
                            .to_string();

                        if level == "error" {
                            errors.push(msg_text);
                        } else if level == "warning" {
                            warnings.push(msg_text);
                        }
                    }
                }

                // Also parse any human-readable output in stderr
                let stderr_text = stderr.to_string();

                let mut structured_output = std::collections::HashMap::new();
                structured_output.insert("exit_code".to_string(), exit_code.to_string());
                structured_output.insert(
                    "error_count".to_string(),
                    errors.len().to_string(),
                );
                structured_output.insert(
                    "warning_count".to_string(),
                    warnings.len().to_string(),
                );
                if !errors.is_empty() {
                    structured_output.insert(
                        "errors".to_string(),
                        errors.join("\n---\n"),
                    );
                }
                if !warnings.is_empty() {
                    structured_output.insert(
                        "warnings".to_string(),
                        warnings.join("\n---\n"),
                    );
                }
                if !stderr_text.is_empty() {
                    structured_output.insert("stderr".to_string(), truncate_output(&stderr_text, 4000));
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
                    error: if errors.is_empty() { None } else { Some(format!("{} errors", errors.len())) },
                    completed_at_ms: now_ms(),
                }
            }
            Err(e) => error_result(request, &format!("cargo_exec_failed={e}")),
        }
    }
}



