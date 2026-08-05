use std::collections::HashMap;

use crate::skill::{parse_skill, render_skill};
use crate::types::*;
use crate::util::{error_result, now_ms};

#[derive(Debug, Clone, Copy)]
pub struct SkillTool;

impl ToolExecutor for SkillTool {
    fn descriptor(&self) -> ToolDescriptor {
        ToolDescriptor {
            tool_name: "invoke_skill".to_string(),
            description: "加载并执行一个 Skill（可复用的任务模板）。提供 skill 的 'name' 作为参数；skill 内 {{param}} 占位符通过同名参数传入。可用 skill 清单由运行时注入上下文。".to_string(),
            kind: ToolKind::Skill,
            required_permissions: vec!["fs_read".to_string()],
            input_schema: Some(serde_json::json!({
                "type": "object",
                "properties": {
                    "name": { "type": "string", "description": "skill 名称（frontmatter name）" }
                },
                "required": ["name"],
                "additionalProperties": { "type": "string", "description": "skill 模板参数" }
            })),
        }
    }

    fn execute(&self, request: &ToolCallRequest) -> ToolCallResult {
        let name = match request.arguments.get("name") {
            Some(v) => v,
            None => return error_result(request, "missing_argument=name"),
        };

        // 默认相对当前工作目录解析；Agent Loop 拦截时以 workspace 根解析
        let skill_path = std::path::PathBuf::from(".forgeone/skills").join(name).join("SKILL.md");
        if !skill_path.exists() {
            return error_result(request, &format!("skill_not_found: {name} (looked at .forgeone/skills/{name}/SKILL.md)"));
        }

        let content = match std::fs::read_to_string(&skill_path) {
            Ok(c) => c,
            Err(e) => return error_result(request, &format!("read_failed={e}")),
        };
        let definition = match parse_skill(&content) {
            Ok(d) => d,
            Err(e) => return error_result(request, &format!("invalid_skill={name}: {e}")),
        };
        let rendered = render_skill(&definition, &request.arguments);

        let mut structured_output = HashMap::new();
        structured_output.insert("skill".to_string(), name.clone());
        structured_output.insert("description".to_string(), definition.description);
        structured_output.insert("content".to_string(), rendered);

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
pub struct InvokeSubAgentTool;

impl ToolExecutor for InvokeSubAgentTool {
    fn descriptor(&self) -> ToolDescriptor {
        ToolDescriptor {
            tool_name: "invoke_subagent".to_string(),
            description: "Spawn a sub-agent to handle a specific sub-task. Provide a detailed prompt in 'task' argument. You can optionally provide 'budget' (e.g. 5000). The runtime intercepts this tool and runs a sub-agent, returning the final result.".to_string(),
            kind: ToolKind::Builtin,
            required_permissions: vec![],
        input_schema: None,
        }
    }

    fn execute(&self, request: &ToolCallRequest) -> ToolCallResult {
        // This tool should be intercepted by the runtime. If it reaches here, it means the runtime didn't intercept it.
        ToolCallResult {
            call_id: request.call_id.clone(),
            status: ToolCallStatus::Failed,
            structured_output: HashMap::new(),
            error: Some("invoke_subagent must be intercepted by the runtime".to_string()),
            completed_at_ms: now_ms(),
        }
    }
}

