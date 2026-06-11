use forgeone_tools::ToolCallRequest;

#[derive(Debug, Clone)]
pub struct PolicyConfig {
    pub allowed_tools: Vec<String>,
    pub read_roots: Vec<String>,
    pub max_tool_calls: u32,
    pub approval_read_roots: Vec<String>,
}

impl Default for PolicyConfig {
    fn default() -> Self {
        Self {
            allowed_tools: vec!["read_file".to_string()],
            read_roots: vec![
                "crates/".to_string(),
                "docs/".to_string(),
                "specs/".to_string(),
            ],
            max_tool_calls: 4,
            approval_read_roots: vec!["specs/".to_string()],
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PolicyDecision {
    Allowed,
    RequireApproval(ApprovalRequest),
    Denied(PolicyViolation),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApprovalRequest {
    pub reason: String,
    pub tool_name: String,
    pub argument_summary: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PolicyViolation {
    pub code: String,
    pub message: String,
}

impl PolicyViolation {
    fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct PolicyEngine {
    config: PolicyConfig,
}

impl PolicyEngine {
    pub fn new(config: PolicyConfig) -> Self {
        Self { config }
    }

    pub fn config(&self) -> &PolicyConfig {
        &self.config
    }

    pub fn check_tool_call(
        &self,
        request: &ToolCallRequest,
        tool_call_count: u32,
    ) -> PolicyDecision {
        if !self
            .config
            .allowed_tools
            .iter()
            .any(|tool| tool == &request.tool_name)
        {
            return PolicyDecision::Denied(PolicyViolation::new(
                "tool_not_allowed",
                format!("tool={} is not allowed by policy", request.tool_name),
            ));
        }

        if tool_call_count >= self.config.max_tool_calls {
            return PolicyDecision::Denied(PolicyViolation::new(
                "tool_budget_exceeded",
                format!(
                    "tool_call_count={} exceeds_max_tool_calls={}",
                    tool_call_count, self.config.max_tool_calls
                ),
            ));
        }

        if request.tool_name == "read_file" {
            let Some(path) = request.arguments.get("path") else {
                return PolicyDecision::Denied(PolicyViolation::new(
                    "missing_path",
                    "read_file requires a path argument",
                ));
            };

            let allowed = self
                .config
                .read_roots
                .iter()
                .any(|prefix| path.starts_with(prefix));
            if !allowed {
                return PolicyDecision::Denied(PolicyViolation::new(
                    "path_not_allowed",
                    format!("path={} is outside allowed read roots", path),
                ));
            }

            let requires_approval = self
                .config
                .approval_read_roots
                .iter()
                .any(|prefix| path.starts_with(prefix));
            if requires_approval {
                return PolicyDecision::RequireApproval(ApprovalRequest {
                    reason: format!("path={} matches approval-controlled read root", path),
                    tool_name: request.tool_name.clone(),
                    argument_summary: format!("path={path}"),
                });
            }
        }

        PolicyDecision::Allowed
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use forgeone_tools::ToolCallRequest;

    use super::{PolicyConfig, PolicyDecision, PolicyEngine};

    #[test]
    fn policy_denies_disallowed_path() {
        let engine = PolicyEngine::new(PolicyConfig::default());
        let mut arguments = HashMap::new();
        arguments.insert("path".to_string(), "/etc/passwd".to_string());

        let decision = engine.check_tool_call(
            &ToolCallRequest {
                call_id: "tool-call-1".to_string(),
                session_id: "session-1".to_string(),
                agent_id: "agent-1".to_string(),
                loop_index: 1,
                tool_name: "read_file".to_string(),
                arguments,
                requested_by: "runtime".to_string(),
            },
            0,
        );

        assert!(matches!(decision, PolicyDecision::Denied(_)));
    }

    #[test]
    fn policy_requires_approval_for_sensitive_read_root() {
        let engine = PolicyEngine::new(PolicyConfig::default());
        let mut arguments = HashMap::new();
        arguments.insert("path".to_string(), "specs/runtime-spec.md".to_string());

        let decision = engine.check_tool_call(
            &ToolCallRequest {
                call_id: "tool-call-2".to_string(),
                session_id: "session-1".to_string(),
                agent_id: "agent-1".to_string(),
                loop_index: 1,
                tool_name: "read_file".to_string(),
                arguments,
                requested_by: "runtime".to_string(),
            },
            0,
        );

        assert!(matches!(decision, PolicyDecision::RequireApproval(_)));
    }
}
