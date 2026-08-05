use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

use crate::types::{ToolCallRequest, ToolCallResult, ToolCallStatus, ToolDescriptor, ToolKind, ToolExecutor};
use crate::util::{error_result, now_ms};

#[derive(Debug, Clone, Copy)]
pub struct ReadFileTool;

impl ToolExecutor for ReadFileTool {
    fn descriptor(&self) -> ToolDescriptor {
        ToolDescriptor {
            tool_name: "read_file".to_string(),
            description: "Read a file from the local workspace".to_string(),
            kind: ToolKind::Builtin,
            required_permissions: vec!["fs_read".to_string()],
        input_schema: None,
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


#[derive(Debug, Clone, Copy)]
pub struct SearchContentTool;

impl ToolExecutor for SearchContentTool {
    fn descriptor(&self) -> ToolDescriptor {
        ToolDescriptor {
            tool_name: "search_content".to_string(),
            description: "Search file contents by regex pattern across the workspace".to_string(),
            kind: ToolKind::Builtin,
            required_permissions: vec!["fs_read".to_string()],
        input_schema: None,
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
        let max_matches: usize = request.arguments.get("limit").and_then(|v| v.parse().ok()).unwrap_or(200);

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

#[derive(Debug, Clone, Copy)]
pub struct SearchFilesTool;

impl ToolExecutor for SearchFilesTool {
    fn descriptor(&self) -> ToolDescriptor {
        ToolDescriptor {
            tool_name: "search_files".to_string(),
            description: "Find files by name pattern in the workspace".to_string(),
            kind: ToolKind::Builtin,
            required_permissions: vec!["fs_read".to_string()],
        input_schema: None,
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

#[derive(Debug, Clone, Copy)]
pub struct WriteFileTool;

impl ToolExecutor for WriteFileTool {
    fn descriptor(&self) -> ToolDescriptor {
        ToolDescriptor {
            tool_name: "write_file".to_string(),
            description: "Write content to a file, overwriting if it exists".to_string(),
            kind: ToolKind::Builtin,
            required_permissions: vec!["fs_write".to_string()],
        input_schema: None,
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


#[derive(Debug, Clone, Copy)]
pub struct EditFileTool;

impl ToolExecutor for EditFileTool {
    fn descriptor(&self) -> ToolDescriptor {
        ToolDescriptor {
            tool_name: "edit_file".to_string(),
            description: "Edit a file by finding unique text and replacing it".to_string(),
            kind: ToolKind::Builtin,
            required_permissions: vec!["fs_write".to_string()],
        input_schema: None,
        }
    }

    fn execute(&self, request: &ToolCallRequest) -> ToolCallResult {
        let path = match request.arguments.get("path") {
            Some(v) => v,
            None => return error_result(request, "missing_argument=path"),
        };
        let search = match request.arguments.get("search") {
            Some(v) => v,
            None => return error_result(request, "missing_argument=search"),
        };
        let replace = request.arguments.get("replace").map(String::as_str).unwrap_or("");

        let content = match std::fs::read_to_string(path) {
            Ok(c) => c,
            Err(e) => return error_result(request, &format!("read_failed={e}")),
        };

        let count = content.matches(search).count();
        if count == 0 {
            return error_result(request, "search_text_not_found");
        }
        if count > 1 {
            return error_result(request, &format!("search_text_not_unique: found {count} matches"));
        }

        let new_content = content.replace(search, replace);
        let lines_changed = content.lines().zip(new_content.lines()).filter(|(a, b)| a != b).count();

        match std::fs::write(path, &new_content) {
            Ok(()) => {
                let mut structured_output = HashMap::new();
                structured_output.insert("path".to_string(), path.clone());
                structured_output.insert("lines_changed".to_string(), lines_changed.to_string());
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



#[derive(Debug, Clone, Copy)]
pub struct GlobTool;

impl ToolExecutor for GlobTool {
    fn descriptor(&self) -> ToolDescriptor {
        ToolDescriptor {
            tool_name: "glob".to_string(),
            description: "List files matching a glob pattern (e.g. **/*.rs, crates/**/Cargo.toml)".to_string(),
            kind: ToolKind::Builtin,
            required_permissions: vec!["fs_read".to_string()],
        input_schema: None,
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

        let root_path = std::path::PathBuf::from(&root);
        let max_results: usize = request
            .arguments
            .get("limit")
            .and_then(|v| v.parse().ok())
            .unwrap_or(200);

        let mut results = Vec::new();

        // Simple glob matching: split pattern by / and match segments
        let parts: Vec<&str> = pattern.split('/').collect();

        // Build recursive matcher
        collect_glob_matches(&root_path, &parts, 0, &root_path, &mut results, max_results);

        results.sort();
        let file_count = results.len();

        let mut structured_output = std::collections::HashMap::new();
        structured_output.insert(
            "files".to_string(),
            format!("{}
{}", file_count, results.join("
")),
        );
        structured_output.insert("file_count".to_string(), file_count.to_string());

        ToolCallResult {
            call_id: request.call_id.clone(),
            status: ToolCallStatus::Success,
            structured_output,
            error: None,
            completed_at_ms: now_ms(),
        }
    }
}

fn collect_glob_matches(
    dir: &std::path::Path,
    parts: &[&str],
    depth: usize,
    root: &std::path::Path,
    results: &mut Vec<String>,
    max: usize,
) {
    if results.len() >= max {
        return;
    }
    if depth >= parts.len() {
        // All parts matched - record this path
        if dir.exists() && let Ok(rel) = dir.strip_prefix(root) {
            results.push(rel.display().to_string());
        }
        return;
    }

    let part = parts[depth];
    if part == "**" {
        // ** matches zero or more directories
        collect_glob_matches(dir, parts, depth + 1, root, results, max);
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                    collect_glob_matches(&entry.path(), parts, depth, root, results, max);
                }
            }
        }
    } else if part.contains('*') || part.contains('?') {
        // Wildcard matching within a single path segment
        let re_pattern = format!(
            "^{}$",
            part.replace('.', r"\.")
                .replace('*', ".*")
                .replace('?', ".")
        );
        if let Ok(re) = regex_lite::Regex::new(&re_pattern)
            && let Ok(entries) = std::fs::read_dir(dir)
        {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if re.is_match(&name) {
                    collect_glob_matches(&entry.path(), parts, depth + 1, root, results, max);
                }
            }
        }
    } else {
        // Exact segment match
        let next = dir.join(part);
        if next.exists() {
            collect_glob_matches(&next, parts, depth + 1, root, results, max);
        }
    }
}



#[derive(Debug, Clone, Copy)]
pub struct DirectoryTreeTool;

impl ToolExecutor for DirectoryTreeTool {
    fn descriptor(&self) -> ToolDescriptor {
        ToolDescriptor {
            tool_name: "directory_tree".to_string(),
            description: "Show directory tree structure with indentation".to_string(),
            kind: ToolKind::Builtin,
            required_permissions: vec!["fs_read".to_string()],
        input_schema: None,
        }
    }

    fn execute(&self, request: &ToolCallRequest) -> ToolCallResult {
        let root = request
            .arguments
            .get("path")
            .cloned()
            .unwrap_or_else(|| ".".to_string());
        let max_depth: usize = request
            .arguments
            .get("max_depth")
            .and_then(|v| v.parse().ok())
            .unwrap_or(3);
        let include_deps = request
            .arguments
            .get("include_deps")
            .map(|v| v == "true")
            .unwrap_or(false);

        let root_path = std::path::PathBuf::from(&root);
        let mut tree_lines = Vec::new();

        build_tree(&root_path, &root_path, 0, max_depth, include_deps, &mut tree_lines);

        let mut structured_output = std::collections::HashMap::new();
        structured_output.insert(
            "tree".to_string(),
            tree_lines.join("\n"),
        );
        structured_output.insert("entry_count".to_string(), tree_lines.len().to_string());

        ToolCallResult {
            call_id: request.call_id.clone(),
            status: ToolCallStatus::Success,
            structured_output,
            error: None,
            completed_at_ms: now_ms(),
        }
    }
}

#[allow(clippy::only_used_in_recursion)]
fn build_tree(
    dir: &std::path::Path,
    root: &std::path::Path,

    depth: usize,
    max_depth: usize,
    include_deps: bool,
    lines: &mut Vec<String>,
) {
    if depth > max_depth {
        return;
    }

    let indent = if depth == 0 {
        String::new()
    } else {
        "  ".repeat(depth)
    };

    if depth == 0 {
        if let Some(name) = dir.file_name().and_then(|n| n.to_str()) {
            lines.push(format!("{}/", name));
        } else {
            lines.push("./".to_string());
        }
    }

    let mut entries: Vec<_> = match std::fs::read_dir(dir) {
        Ok(entries) => entries.filter_map(|e| e.ok()).collect(),
        Err(_) => return,
    };
    entries.sort_by_key(|e| e.file_name());

    for entry in &entries {
        let name = entry.file_name().to_string_lossy().to_string();
        let path = entry.path();

        // Skip hidden/dep dirs unless include_deps
        if !include_deps {
            let lower = name.to_lowercase();
            if lower == "node_modules" || lower == "target" || lower == ".git"
                || lower == ".venv" || lower == "__pycache__" || lower == "dist"
            {
                continue;
            }
        }

        let line = if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            format!("{}{}/", indent, name)
        } else {
            format!("{}{}", indent, name)
        };
        lines.push(line);

        if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            build_tree(&path, root, depth + 1, max_depth, include_deps, lines);
        }
    }
}



#[derive(Debug, Clone, Copy)]
pub struct DiffTool;

impl ToolExecutor for DiffTool {
    fn descriptor(&self) -> ToolDescriptor {
        ToolDescriptor {
            tool_name: "diff".to_string(),
            description: "Compare two files and return structured differences".to_string(),
            kind: ToolKind::Builtin,
            required_permissions: vec!["fs_read".to_string()],
        input_schema: None,
        }
    }

    fn execute(&self, request: &ToolCallRequest) -> ToolCallResult {
        let path_a = match request.arguments.get("path_a") {
            Some(v) => v,
            None => return error_result(request, "missing_argument=path_a"),
        };
        let path_b = match request.arguments.get("path_b") {
            Some(v) => v,
            None => return error_result(request, "missing_argument=path_b"),
        };

        let content_a = match std::fs::read_to_string(path_a) {
            Ok(c) => c,
            Err(e) => return error_result(request, &format!("read_a_failed={e}")),
        };
        let content_b = match std::fs::read_to_string(path_b) {
            Ok(c) => c,
            Err(e) => return error_result(request, &format!("read_b_failed={e}")),
        };

        let lines_a: Vec<&str> = content_a.lines().collect();
        let lines_b: Vec<&str> = content_b.lines().collect();

        // Simple LCS-based diff
        let mut hunks = Vec::new();
        let mut i = 0;
        let mut j = 0;
        while i < lines_a.len() || j < lines_b.len() {
            if i < lines_a.len() && j < lines_b.len() && lines_a[i] == lines_b[j] {
                i += 1;
                j += 1;
                continue;
            }
            // Found a difference - collect the hunk
            let hunk_start_a = i + 1;
            let hunk_start_b = j + 1;
            let mut hunk_lines_a = Vec::new();
            let mut hunk_lines_b = Vec::new();

            while i < lines_a.len() || j < lines_b.len() {
                if i < lines_a.len() && j < lines_b.len() && lines_a[i] == lines_b[j] {
                    break;
                }
                if i < lines_a.len() {
                    hunk_lines_a.push(lines_a[i]);
                    i += 1;
                }
                if j < lines_b.len() {
                    hunk_lines_b.push(lines_b[j]);
                    j += 1;
                }
            }

            let hunk = if hunk_lines_b.is_empty() {
                format!(
                    "@@ -{},{}+{},{} @@
deleted:
  {}",
                    hunk_start_a, hunk_lines_a.len(), hunk_start_b, 0,
                    hunk_lines_a.join("
  ")
                )
            } else if hunk_lines_a.is_empty() {
                format!(
                    "@@ -{},{}+{},{} @@
added:
  {}",
                    hunk_start_a, 0, hunk_start_b, hunk_lines_b.len(),
                    hunk_lines_b.join("
  ")
                )
            } else {
                let mut sb = format!(
                    "@@ -{},{}+{},{} @@
",
                    hunk_start_a, hunk_lines_a.len(), hunk_start_b, hunk_lines_b.len()
                );
                for (idx, line) in hunk_lines_a.iter().enumerate() {
                    if idx < hunk_lines_b.len() && line == &hunk_lines_b[idx] {
                        sb.push_str(&format!(" {}
", line));
                    } else {
                        sb.push_str(&format!("-{}
", line));
                    }
                }
                for idx in 0..hunk_lines_b.len() {
                    if idx >= hunk_lines_a.len() || hunk_lines_a[idx] != hunk_lines_b[idx] {
                        sb.push_str(&format!("+{}
", hunk_lines_b[idx]));
                    }
                }
                sb
            };
            hunks.push(hunk);
        }

        let output = if hunks.is_empty() {
            "files are identical".to_string()
        } else {
            hunks.join("
")
        };

        let mut structured_output = std::collections::HashMap::new();
        structured_output.insert("hunks".to_string(), output);
        structured_output.insert("hunk_count".to_string(), hunks.len().to_string());
        structured_output.insert("lines_a".to_string(), lines_a.len().to_string());
        structured_output.insert("lines_b".to_string(), lines_b.len().to_string());

        ToolCallResult {
            call_id: request.call_id.clone(),
            status: ToolCallStatus::Success,
            structured_output,
            error: None,
            completed_at_ms: now_ms(),
        }
    }
}

