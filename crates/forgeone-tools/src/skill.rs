//! Skill 能力：SKILL.md 的解析、模板渲染与发现。
//!
//! Skill 是面向任务模式的轻量上下文能力：`SKILL.md` 通过 frontmatter
//! 声明元数据（`name` / `description` / `version`），body 为 Markdown 指令。
//! 调用时以 `{{param}}` 模板注入参数，渲染后的内容作为上下文/指令提供给
//! 模型，由 Agent Loop 在允许的边界内自主执行。
//!
//! 发现范围：项目级 `{workspace}/.forgeone/skills/*/SKILL.md` 优先，
//! 全局 `{user_home}/.forgeone/skills/*/SKILL.md` 兜底（同名项目级覆盖全局）。

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use crate::extensions::user_forgeone_dir;

/// 解析后的 Skill 定义
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SkillDefinition {
    pub name: String,
    pub description: String,
    pub version: Option<String>,
    pub body: String,
}

const FRONTMATTER_DELIMITER: &str = "---";

/// 解析 SKILL.md：`---` 分隔的 YAML 风格 frontmatter + Markdown body。
///
/// frontmatter 要求包含 `name`；`description` / `version` 可选。
pub fn parse_skill(content: &str) -> Result<SkillDefinition, String> {
    let trimmed = content.trim_start_matches('\u{feff}'); // 兼容 UTF-8 BOM
    let lines: Vec<&str> = trimmed.lines().collect();

    // 必须以 frontmatter 分隔符开头
    if lines.first().map(|line| line.trim()) != Some(FRONTMATTER_DELIMITER) {
        return Err("missing frontmatter: SKILL.md must start with '---'".to_string());
    }

    // 找第二个分隔符作为 frontmatter 结束
    let end = lines
        .iter()
        .skip(1)
        .position(|line| line.trim() == FRONTMATTER_DELIMITER)
        .map(|idx| idx + 1)
        .ok_or_else(|| "invalid frontmatter: missing closing '---'".to_string())?;

    let mut name: Option<String> = None;
    let mut description = String::new();
    let mut version: Option<String> = None;

    for line in &lines[1..end] {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        let value = value.trim().trim_matches('"').trim_matches('\'');
        match key.trim() {
            "name" => name = Some(value.to_string()),
            "description" => description = value.to_string(),
            "version" => version = Some(value.to_string()),
            _ => {}
        }
    }

    let name = name
        .ok_or_else(|| "invalid frontmatter: missing required field 'name'".to_string())?;
    let body = lines[end + 1..].join("\n").trim().to_string();

    Ok(SkillDefinition {
        name,
        description,
        version,
        body,
    })
}

/// 模板渲染：将 body 中的 `{{param}}` 占位符替换为 `args` 提供的值。
///
/// 未提供的参数保留原占位符，便于调用方/模型识别缺失变量。
pub fn render_skill(definition: &SkillDefinition, args: &HashMap<String, String>) -> String {
    let mut rendered = definition.body.clone();
    for (key, value) in args {
        rendered = rendered.replace(&format!("{{{{{key}}}}}"), value);
    }
    rendered
}

/// 发现可用 Skill：项目级优先，全局兜底；同名时项目级覆盖全局。
///
/// 解析失败的 skill 被跳过（记录警告），不影响整体发现。
pub fn discover_skills(workspace_root: impl AsRef<Path>) -> Result<Vec<SkillDefinition>, String> {
    let mut roots: Vec<PathBuf> = Vec::new();
    let workspace = workspace_root.as_ref();
    if !workspace.as_os_str().is_empty() {
        roots.push(workspace.join(".forgeone").join("skills"));
    }
    if let Some(home) = user_forgeone_dir() {
        roots.push(home.join("skills"));
    }

    let mut found: HashMap<String, SkillDefinition> = HashMap::new();
    for root in roots {
        let Ok(entries) = fs::read_dir(&root) else {
            continue; // 目录不存在则跳过
        };
        for entry in entries.flatten() {
            let skill_dir = entry.path();
            if !skill_dir.is_dir() {
                continue;
            }
            let skill_file = skill_dir.join("SKILL.md");
            let Ok(content) = fs::read_to_string(&skill_file) else {
                continue;
            };
            match parse_skill(&content) {
                Ok(definition) => {
                    // 先插入的（项目级）优先，全局同名不覆盖
                    found.entry(definition.name.clone()).or_insert(definition);
                }
                Err(e) => {
                    eprintln!("[Skill] 跳过无效 SKILL.md {}: {e}", skill_file.display());
                }
            }
        }
    }

    let mut skills: Vec<SkillDefinition> = found.into_values().collect();
    skills.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(skills)
}

/// 按名称加载 Skill（匹配 frontmatter 的 `name`，项目级优先于全局）。
pub fn load_skill(workspace_root: impl AsRef<Path>, name: &str) -> Result<SkillDefinition, String> {
    let skills = discover_skills(workspace_root)?;
    skills
        .into_iter()
        .find(|skill| skill.name == name)
        .ok_or_else(|| format!("skill_not_found={name}"))
}
