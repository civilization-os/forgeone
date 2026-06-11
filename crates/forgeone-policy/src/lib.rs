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
            allowed_tools: vec![
                "read_file".to_string(),
                "search_content".to_string(),
                "search_files".to_string(),
                "write_file".to_string(),
            ],
            read_roots: vec![
                ".".to_string(),
                "crates/".to_string(),
                "docs/".to_string(),
                "specs/".to_string(),
            ],
            max_tool_calls: 10,
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

        if tool_uses_read_roots(&request.tool_name) {
            let raw_path = request.arguments.get("path").map(|s| s.as_str()).unwrap_or(".");
            let path = normalize_path_for_policy(raw_path);

            let allowed = self
                .config
                .read_roots
                .iter()
                .map(|prefix| normalize_path_for_policy(prefix))
                .any(|prefix| path_matches_policy_prefix(&path, &prefix));
            if !allowed {
                return PolicyDecision::Denied(PolicyViolation::new(
                    "path_not_allowed",
                    format!("path={raw_path} is outside allowed read roots"),
                ));
            }

            let requires_approval = self
                .config
                .approval_read_roots
                .iter()
                .map(|prefix| normalize_path_for_policy(prefix))
                .any(|prefix| path_matches_policy_prefix(&path, &prefix));
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

fn tool_uses_read_roots(tool_name: &str) -> bool {
    matches!(tool_name, "read_file" | "search_content" | "search_files")
}

fn normalize_path_for_policy(path: &str) -> String {
    let stripped = path
        .strip_prefix("./")
        .or_else(|| path.strip_prefix(".\\"))
        .unwrap_or(path);
    stripped.replace('\\', "/")
}

fn path_matches_policy_prefix(path: &str, prefix: &str) -> bool {
    let normalized_prefix = prefix.trim_end_matches('/');
    path == normalized_prefix || path.starts_with(&format!("{normalized_prefix}/"))
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

    #[test]
    fn policy_applies_read_roots_to_search_files() {
        let engine = PolicyEngine::new(PolicyConfig::default());
        let mut arguments = HashMap::new();
        arguments.insert("pattern".to_string(), "Cargo.toml".to_string());
        arguments.insert("path".to_string(), "/etc".to_string());

        let decision = engine.check_tool_call(
            &ToolCallRequest {
                call_id: "tool-call-3".to_string(),
                session_id: "session-1".to_string(),
                agent_id: "agent-1".to_string(),
                loop_index: 1,
                tool_name: "search_files".to_string(),
                arguments,
                requested_by: "runtime".to_string(),
            },
            0,
        );

        assert!(matches!(decision, PolicyDecision::Denied(_)));
    }

    #[test]
    fn policy_requires_approval_for_search_content_in_sensitive_root() {
        let engine = PolicyEngine::new(PolicyConfig::default());
        let mut arguments = HashMap::new();
        arguments.insert("pattern".to_string(), "Runtime".to_string());
        arguments.insert("path".to_string(), "./specs".to_string());

        let decision = engine.check_tool_call(
            &ToolCallRequest {
                call_id: "tool-call-4".to_string(),
                session_id: "session-1".to_string(),
                agent_id: "agent-1".to_string(),
                loop_index: 1,
                tool_name: "search_content".to_string(),
                arguments,
                requested_by: "runtime".to_string(),
            },
            0,
        );

        assert!(matches!(decision, PolicyDecision::RequireApproval(_)));
    }
}
