#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use crate::{SkillTool, 
        DiffTool, DirectoryTreeTool, EditFileTool, GitTool, GlobTool, SearchContentTool, ShellTool,
        ToolCallRequest, ToolCallStatus, ToolExecutor, ToolRegistry, next_tool_call_id,
        discover_skills, load_skill, parse_skill, render_skill,
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
        assert_eq!(crate::decode_windows_console_output(&bytes), "C:\u{76d8}\u{7b26}\r\n");
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
        assert!(c.contains("When invoked"), "should contain skill body");
        assert_eq!(
            result.structured_output.get("description").map(String::as_str),
            Some("A test skill for ForgeOne")
        );
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

    // ── skill 解析 / 渲染 / 发现 ──
    // 注意：发现/加载测试使用运行时创建的临时目录，不依赖被 .gitignore
    // 忽略的 .forgeone/ 目录，保证 clone 后测试可复现。

    #[test]
    fn parse_skill_parses_frontmatter_and_body() {
        let content = "---\nname: demo\nversion: 1.0.0\n---\n\nBody text here.";
        let skill = parse_skill(content).unwrap();
        assert_eq!(skill.name, "demo");
        assert_eq!(skill.description, "");
        assert_eq!(skill.version.as_deref(), Some("1.0.0"));
        assert_eq!(skill.body, "Body text here.");
    }

    #[test]
    fn parse_skill_accepts_quoted_values() {
        let content = "---\nname: \"demo\"\ndescription: '中文描述'\n---\nbody";
        let skill = parse_skill(content).unwrap();
        assert_eq!(skill.name, "demo");
        assert_eq!(skill.description, "中文描述");
    }

    #[test]
    fn parse_skill_requires_valid_frontmatter() {
        assert!(parse_skill("---\ndescription: no name\n---\nbody").is_err());
        assert!(parse_skill("no frontmatter at all").is_err());
        assert!(parse_skill("---\nname: x").is_err(), "missing closing delimiter");
    }

    #[test]
    fn render_skill_substitutes_parameters() {
        let skill = parse_skill("---\nname: demo\n---\nReview {{path}} with {{depth}} depth.").unwrap();
        let mut args = HashMap::new();
        args.insert("path".to_string(), "src/main.rs".to_string());
        let rendered = render_skill(&skill, &args);
        assert!(rendered.contains("Review src/main.rs with {{depth}} depth."));
    }

    /// 临时工作区：创建 .forgeone/skills 下的若干 SKILL.md，返回根路径
    fn make_temp_workspace() -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!(
            "forgeone_skill_test_{}_{}",
            std::process::id(),
            next_tool_call_id()
        ));
        std::fs::create_dir_all(root.join(".forgeone").join("skills")).expect("create skills dir");
        root
    }

    #[test]
    fn discover_skills_finds_workspace_skills_sorted_by_name() {
        let root = make_temp_workspace();
        let skills_dir = root.join(".forgeone").join("skills");

        // 目录名与 frontmatter name 解耦：beta 目录里放 name=alpha-skill
        std::fs::create_dir_all(skills_dir.join("beta")).unwrap();
        std::fs::write(
            skills_dir.join("beta").join("SKILL.md"),
            "---\nname: alpha-skill\ndescription: a\n---\nbody",
        )
        .unwrap();
        std::fs::create_dir_all(skills_dir.join("alpha")).unwrap();
        std::fs::write(
            skills_dir.join("alpha").join("SKILL.md"),
            "---\nname: beta-skill\ndescription: b\n---\nbody",
        )
        .unwrap();

        let skills = discover_skills(&root).unwrap();
        let names: Vec<&str> = skills.iter().map(|s| s.name.as_str()).collect();
        assert_eq!(names, vec!["alpha-skill", "beta-skill"], "按 name 排序");

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn discover_skills_skips_invalid_skill_files() {
        let root = make_temp_workspace();
        let skills_dir = root.join(".forgeone").join("skills");

        // 缺 name 的无效 skill 应被跳过，不影响其它 skill
        std::fs::create_dir_all(skills_dir.join("broken")).unwrap();
        std::fs::write(
            skills_dir.join("broken").join("SKILL.md"),
            "---\ndescription: no name\n---\nbody",
        )
        .unwrap();
        std::fs::create_dir_all(skills_dir.join("ok")).unwrap();
        std::fs::write(
            skills_dir.join("ok").join("SKILL.md"),
            "---\nname: ok\ndescription: fine\n---\nbody",
        )
        .unwrap();

        let skills = discover_skills(&root).unwrap();
        let names: Vec<&str> = skills.iter().map(|s| s.name.as_str()).collect();
        assert_eq!(names, vec!["ok"]);

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn load_skill_matches_frontmatter_name() {
        let root = make_temp_workspace();
        std::fs::create_dir_all(root.join(".forgeone").join("skills").join("any-dir")).unwrap();
        std::fs::write(
            root.join(".forgeone").join("skills").join("any-dir").join("SKILL.md"),
            "---\nname: demo\n---\nBody with {{topic}}.",
        )
        .unwrap();

        let skill = load_skill(&root, "demo").unwrap();
        assert_eq!(skill.name, "demo");
        assert!(skill.body.contains("{{topic}}"));
        assert!(load_skill(&root, "no_such_skill").is_err());

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn workspace_root_skill_config_is_discoverable() {
        // 仓库根（CARGO_MANIFEST_DIR 的上级的上级）下的 .forgeone/skills 真实配置
        let workspace_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .parent()
            .unwrap();
        let skills = discover_skills(workspace_root).unwrap();
        let names: Vec<&str> = skills.iter().map(|s| s.name.as_str()).collect();
        assert!(names.contains(&"code-review"), "code-review 应被发现，实际: {names:?}");
        let review = skills.iter().find(|s| s.name == "code-review").unwrap();
        assert!(review.description.contains("结构化审查"));
        assert!(review.body.contains("{{focus}}"), "body 应保留模板占位符");
    }
}
