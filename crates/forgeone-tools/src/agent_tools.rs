use std::collections::HashMap;

use crate::types::*;
use crate::util::{error_result, now_ms};

#[derive(Debug, Clone, Copy)]
pub struct SkillTool;

impl ToolExecutor for SkillTool {
    fn descriptor(&self) -> ToolDescriptor {
        ToolDescriptor {
            tool_name: "invoke_skill".to_string(),
            description: "Load and execute a skill (a reusable task template). Provide the skill 'name' as argument. Available skills can be discovered with glob or directory_tree.".to_string(),
            kind: ToolKind::Skill,
            required_permissions: vec!["fs_read".to_string()],
        }
    }

    fn execute(&self, request: &ToolCallRequest) -> ToolCallResult {
        let name = match request.arguments.get("name") {
            Some(v) => v,
            None => return error_result(request, "missing_argument=name"),
        };

        // Look for .forgeone/skills/<name>/SKILL.md
        let skill_path = std::path::PathBuf::from(".forgeone/skills").join(name).join("SKILL.md");
        if !skill_path.exists() {
            return error_result(request, &format!("skill_not_found: {name} (looked at .forgeone/skills/{name}/SKILL.md)"));
        }

        match std::fs::read_to_string(&skill_path) {
            Ok(content) => {
                let mut structured_output = std::collections::HashMap::new();
                structured_output.insert("skill".to_string(), name.clone());
                structured_output.insert("content".to_string(), content);

                ToolCallResult {
                    call_id: request.call_id.clone(),
                    status: ToolCallStatus::Success,
                    structured_output,
                    error: None,
                    completed_at_ms: now_ms(),
                }
            }
            Err(e) => error_result(request, &format!("read_failed={e}")),
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

