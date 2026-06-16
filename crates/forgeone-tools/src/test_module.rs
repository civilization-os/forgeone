#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::{SkillTool, 
        DiffTool, DirectoryTreeTool, EditFileTool, GitTool, GlobTool, SearchContentTool, ShellTool,
        ToolCallRequest, ToolCallStatus, ToolExecutor, ToolRegistry, next_tool_call_id,
    };

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
        assert_eq!(result.structured_output.get("exit_code").map(String::as_str), Some("0"));
        assert!(result.structured_output.contains_key("stdout"));
    }

    #[cfg(windows)]
    #[test]
    fn decode_windows_console_output_handles_utf16le() {
        let bytes = "C:\u{76d8}\u{7b26}\r\n".encode_utf16()
            .flat_map(|unit| unit.to_le_bytes()).collect::<Vec<_>>();
        assert_eq!(super::decode_windows_console_output(&bytes), "C:\u{76d8}\u{7b26}\r\n");
    }

    #[test]
    fn edit_file_replaces_unique_text() {
        let path = "_edit_test_tmp.txt";
        std::fs::write(path, "hello world\nfoo bar\nhello world\n").unwrap();
        let mut arguments = HashMap::new();
        arguments.insert("path".to_string(), path.to_string());
        arguments.insert("search".to_string(), "foo bar".to_string());
        arguments.insert("replace".to_string(), "baz qux".to_string());
        let result = EditFileTool.execute(&ToolCallRequest {
            call_id: next_tool_call_id(),
            session_id: "session-1".to_string(),
            agent_id: "agent-1".to_string(),
            loop_index: 1,
            tool_name: "edit_file".to_string(),
            arguments,
            requested_by: "runtime".to_string(),
        });
assert_eq!(result.status, ToolCallStatus::Success);
        assert_eq!(result.structured_output.get("lines_changed").map(String::as_str), Some("1"));
        let content = std::fs::read_to_string(path).unwrap();
        assert_eq!(content, "hello world\nbaz qux\nhello world\n");
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn edit_file_reports_not_found_for_missing_text() {
        let path = "_edit_test_notfound.txt";
        std::fs::write(path, "hello world\n").unwrap();
        let mut arguments = HashMap::new();
        arguments.insert("path".to_string(), path.to_string());
        arguments.insert("search".to_string(), "not in file".to_string());
        arguments.insert("replace".to_string(), "anything".to_string());
        let result = EditFileTool.execute(&ToolCallRequest {
            call_id: next_tool_call_id(),
            session_id: "session-1".to_string(),
            agent_id: "agent-1".to_string(),
            loop_index: 1,
            tool_name: "edit_file".to_string(),
            arguments,
            requested_by: "runtime".to_string(),
        });
        assert_eq!(result.status, ToolCallStatus::ValidationError);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn glob_tool_returns_matching_files() {
        let mut arguments = HashMap::new();
        arguments.insert("pattern".to_string(), "**/Cargo.toml".to_string());
        let result = GlobTool.execute(&ToolCallRequest {
            call_id: next_tool_call_id(),
            session_id: "session-1".to_string(),
            agent_id: "agent-1".to_string(),
            loop_index: 1,
            tool_name: "glob".to_string(),
            arguments,
            requested_by: "runtime".to_string(),
        });
assert_eq!(result.status, ToolCallStatus::Success);
        assert!(result.structured_output.contains_key("file_count"));
        let files = result.structured_output.get("files").map(String::as_str).unwrap_or("");
        assert!(files.contains("Cargo.toml"));
    }

    #[test]
    fn glob_tool_reports_zero_for_nonexistent_pattern() {
        let mut arguments = HashMap::new();
        arguments.insert("pattern".to_string(), "**/nonexistent_file_xyz".to_string());
        let result = GlobTool.execute(&ToolCallRequest {
            call_id: next_tool_call_id(),
            session_id: "session-1".to_string(),
            agent_id: "agent-1".to_string(),
            loop_index: 1,
            tool_name: "glob".to_string(),
            arguments,
            requested_by: "runtime".to_string(),
        });
assert_eq!(result.status, ToolCallStatus::Success);
        assert_eq!(result.structured_output.get("file_count").map(String::as_str), Some("0"));
    }

    #[test]
    fn directory_tree_shows_root_entries() {
        let mut arguments = HashMap::new();
        arguments.insert("path".to_string(), ".".to_string());
        arguments.insert("max_depth".to_string(), "1".to_string());
        let result = DirectoryTreeTool.execute(&ToolCallRequest {
            call_id: next_tool_call_id(),
            session_id: "session-1".to_string(),
            agent_id: "agent-1".to_string(),
            loop_index: 1,
            tool_name: "directory_tree".to_string(),
            arguments,
            requested_by: "runtime".to_string(),
        });
assert_eq!(result.status, ToolCallStatus::Success);
        let tree = result.structured_output.get("tree").map(String::as_str).unwrap_or("");
        assert!(tree.contains("Cargo.toml") || tree.contains("crates/"));
    }

    #[test]
    fn directory_tree_reports_within_depth() {
        let mut arguments = HashMap::new();
        arguments.insert("path".to_string(), ".".to_string());
        arguments.insert("max_depth".to_string(), "0".to_string());
        let result = DirectoryTreeTool.execute(&ToolCallRequest {
            call_id: next_tool_call_id(),
            session_id: "session-1".to_string(),
            agent_id: "agent-1".to_string(),
            loop_index: 1,
            tool_name: "directory_tree".to_string(),
            arguments,
            requested_by: "runtime".to_string(),
        });
assert_eq!(result.status, ToolCallStatus::Success);
        let tree = result.structured_output.get("tree").map(String::as_str).unwrap_or("");
        let has_subdir = tree.lines().any(|l| l.starts_with("  "));
        assert!(!has_subdir, "depth 0 should not show indented children");
    }

    #[test]
    fn git_tool_reports_error_without_git_repo() {
        let tmp = std::env::temp_dir();
        let mut arguments = HashMap::new();
        arguments.insert("command".to_string(), "status".to_string());
        arguments.insert("path".to_string(), tmp.to_string_lossy().to_string());
        let result = GitTool.execute(&ToolCallRequest {
            call_id: next_tool_call_id(),
            session_id: "session-1".to_string(),
            agent_id: "agent-1".to_string(),
            loop_index: 1,
            tool_name: "git".to_string(),
            arguments,
            requested_by: "runtime".to_string(),
        });
        assert_eq!(result.status, ToolCallStatus::Failed);
        assert!(result.structured_output.contains_key("stderr"));
    }

    #[test]
    fn git_tool_reports_missing_command() {
        let arguments = HashMap::new();
        let result = GitTool.execute(&ToolCallRequest {
            call_id: next_tool_call_id(),
            session_id: "session-1".to_string(),
            agent_id: "agent-1".to_string(),
            loop_index: 1,
            tool_name: "git".to_string(),
            arguments,
            requested_by: "runtime".to_string(),
        });
        assert_eq!(result.status, ToolCallStatus::ValidationError);
    }

    // ── DiffTool tests ──

    #[test]
    fn diff_tool_reports_missing_paths() {
        let arguments = HashMap::new();
        let result = DiffTool.execute(&ToolCallRequest {
            call_id: next_tool_call_id(),
            session_id: "session-1".to_string(),
            agent_id: "agent-1".to_string(),
            loop_index: 1,
            tool_name: "diff".to_string(),
            arguments,
            requested_by: "runtime".to_string(),
        });
        assert_eq!(result.status, ToolCallStatus::ValidationError);
    }

    #[test]
    fn diff_tool_shows_differences() {
        let path_a = "_diff_test_a.txt";
        let path_b = "_diff_test_b.txt";
        std::fs::write(path_a, "line1\nline2\nline3\n").unwrap();
        std::fs::write(path_b, "line1\nline2_modified\nline3\nline4\n").unwrap();

        let mut arguments = HashMap::new();
        arguments.insert("path_a".to_string(), path_a.to_string());
        arguments.insert("path_b".to_string(), path_b.to_string());
        let result = DiffTool.execute(&ToolCallRequest {
            call_id: next_tool_call_id(),
            session_id: "session-1".to_string(),
            agent_id: "agent-1".to_string(),
            loop_index: 1,
            tool_name: "diff".to_string(),
            arguments,
            requested_by: "runtime".to_string(),
        });

assert_eq!(result.status, ToolCallStatus::Success);
        let output = result.structured_output.get("hunks").map(String::as_str).unwrap_or("");
        assert!(output.contains("line2") || output.contains("line2_modified") || output.contains("line4"));
        let _ = std::fs::remove_file(path_a);
        let _ = std::fs::remove_file(path_b);
    }

    // ── Search enhancement tests ──

    #[test]
    fn search_content_accepts_pattern_only() {
        let mut arguments = HashMap::new();
        arguments.insert("pattern".to_string(), "Cargo.toml".to_string());
        arguments.insert("limit".to_string(), "5".to_string());
        let result = SearchContentTool.execute(&ToolCallRequest {
            call_id: next_tool_call_id(),
            session_id: "session-1".to_string(),
            agent_id: "agent-1".to_string(),
            loop_index: 1,
            tool_name: "search_content".to_string(),
            arguments,
            requested_by: "runtime".to_string(),
        });
assert_eq!(result.status, ToolCallStatus::Success);
        assert!(result.structured_output.contains_key("match_count"));
    }


    // ── SkillTool tests ──

    #[test]
    fn skill_tool_loads_skill_file() {
        let mut arguments = HashMap::new();
        arguments.insert("name".to_string(), "test-skill".to_string());
        // Use CARGO_MANIFEST_DIR to find the skill file
let result = SkillTool.execute(&ToolCallRequest {
            call_id: next_tool_call_id(),
            session_id: "session-1".to_string(),
            agent_id: "agent-1".to_string(),
            loop_index: 1,
            tool_name: "invoke_skill".to_string(),
            arguments,
            requested_by: "runtime".to_string(),
        });
assert_eq!(result.status, ToolCallStatus::Success);
        let c = result.structured_output.get("content").map(String::as_str).unwrap_or("");
        assert!(c.contains("test-skill"), "should contain skill content");
    }

    #[test]
    fn skill_tool_reports_not_found() {
        let mut arguments = HashMap::new();
        arguments.insert("name".to_string(), "nonexistent_skill".to_string());
        // Use CARGO_MANIFEST_DIR to find the skill file
let result = SkillTool.execute(&ToolCallRequest {
            call_id: next_tool_call_id(),
            session_id: "session-1".to_string(),
            agent_id: "agent-1".to_string(),
            loop_index: 1,
            tool_name: "invoke_skill".to_string(),
            arguments,
            requested_by: "runtime".to_string(),
        });
        assert_eq!(result.status, ToolCallStatus::ValidationError);
    }
}
