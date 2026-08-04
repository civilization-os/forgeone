use serde_json::json;

use crate::llm_client::types::LlmToolDef;

// ── 内置工具 Schema 定义 ───────────────────────────────────────────

/// 返回 ForgeOne 内置工具的 JSON Schema 列表
pub fn builtin_tool_defs() -> Vec<LlmToolDef> {
    vec![
        LlmToolDef {
            name: "read_file".to_string(),
            description: "读取工作区内的本地文件内容，返回前200行".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "文件路径：相对路径相对于工作区根目录（如 src/main.rs），或绝对路径" }
                },
                "required": ["path"]
            }),
        },
        LlmToolDef {
            name: "directory_tree".to_string(),
            description: "列出指定目录的文件树结构".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "目录路径" },
                    "depth": { "type": "integer", "description": "最大深度，默认3", "default": 3 }
                },
                "required": ["path"]
            }),
        },
        LlmToolDef {
            name: "search_content".to_string(),
            description: "在工作区文件中搜索匹配正则表达式的内容".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "pattern": { "type": "string", "description": "正则表达式" },
                    "path": { "type": "string", "description": "搜索根目录，默认为工作区根" }
                },
                "required": ["pattern"]
            }),
        },
        LlmToolDef {
            name: "glob".to_string(),
            description: "按 glob 模式匹配文件路径".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "pattern": { "type": "string", "description": "glob 模式，如 src/**/*.ts" },
                    "path": { "type": "string", "description": "搜索根目录" }
                },
                "required": ["pattern"]
            }),
        },
        LlmToolDef {
            name: "write_file".to_string(),
            description: "写入或创建文件（需要用户审批）".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "文件路径" },
                    "content": { "type": "string", "description": "文件完整内容" }
                },
                "required": ["path", "content"]
            }),
        },
        LlmToolDef {
            name: "edit_file".to_string(),
            description: "对文件进行局部 patch 修改（需要用户审批）".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "文件路径" },
                    "old_content": { "type": "string", "description": "要替换的原始内容片段" },
                    "new_content": { "type": "string", "description": "替换后的新内容" }
                },
                "required": ["path", "old_content", "new_content"]
            }),
        },
        LlmToolDef {
            name: "shell".to_string(),
            description: "执行终端命令（需要用户审批，高危操作）".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "command": { "type": "string", "description": "要执行的 shell 命令" },
                    "cwd": { "type": "string", "description": "工作目录，默认为工作区根" }
                },
                "required": ["command"]
            }),
        },
        LlmToolDef {
            name: "diff".to_string(),
            description: "对比两个文件或两段内容的差异".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "path_a": { "type": "string", "description": "原始文件路径" },
                    "path_b": { "type": "string", "description": "对比文件路径" }
                },
                "required": ["path_a", "path_b"]
            }),
        },
        LlmToolDef {
            name: "search_files".to_string(),
            description: "按文件名模式在工作区中查找文件（当用户只提到文件名、不确定完整路径时，先用此工具定位）".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "pattern": { "type": "string", "description": "文件名匹配模式（不区分大小写，如 repo-report 或 *.md）" },
                    "path": { "type": "string", "description": "搜索根目录，默认为工作区根" }
                },
                "required": ["pattern"]
            }),
        },
        LlmToolDef {
            name: "git".to_string(),
            description: "执行 git 命令（status / diff / log / show / branch 等）".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "command": { "type": "string", "description": "git 子命令，如 status、diff、log" },
                    "args": { "type": "string", "description": "附加参数，空格分隔，可选" },
                    "path": { "type": "string", "description": "git 仓库路径，默认为工作区根" }
                },
                "required": ["command"]
            }),
        },
        LlmToolDef {
            name: "diagnostics".to_string(),
            description: "运行 cargo check 并返回结构化编译器诊断信息".to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "cargo 项目路径，默认为工作区根" },
                    "args": { "type": "string", "description": "附加参数，如 --tests 或 --all-targets" }
                }
            }),
        },
    ]
}
