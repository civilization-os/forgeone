use anyhow::{Context, Result};
use forgeone_runtime::{RunRequest, RunResult, RuntimeConfig, RuntimeCore};
use forgeone_trace::TraceEventKind;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

/// Represents a single evaluation task.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvalTask {
    pub id: String,
    pub input: String,
    /// Tools that the agent is expected to call at least once.
    pub expected_tool_calls: Option<Vec<String>>,
    /// Keywords or phrases expected in the final response.
    pub expected_final_response_contains: Option<Vec<String>>,
}

/// Represents the quantitative report for an evaluated task.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvalReport {
    pub task_id: String,
    pub success: bool,
    pub total_loops: u32,
    pub total_tokens: u32,
    pub missing_tools: Vec<String>,
    pub missing_keywords: Vec<String>,
    pub stop_reason: String,
}

pub trait EvalSuite {
    /// Load a list of evaluation tasks from a JSON file.
    fn load_tasks(path: impl AsRef<Path>) -> Result<Vec<EvalTask>>;
    
    /// Run a single evaluation task using the provided runtime.
    fn run_eval(runtime: &RuntimeCore, task: &EvalTask, config: RuntimeConfig) -> RunResult;
    
    /// Evaluate the results of a run against the expected outcomes.
    fn evaluate(task: &EvalTask, result: &RunResult) -> EvalReport;
}

pub struct DefaultEvalSuite;

impl EvalSuite for DefaultEvalSuite {
    fn load_tasks(path: impl AsRef<Path>) -> Result<Vec<EvalTask>> {
        let content = fs::read_to_string(path).context("Failed to read eval tasks file")?;
        let tasks: Vec<EvalTask> = serde_json::from_str(&content).context("Failed to parse eval tasks")?;
        Ok(tasks)
    }

    fn run_eval(runtime: &RuntimeCore, task: &EvalTask, config: RuntimeConfig) -> RunResult {
        let request = RunRequest {
            task: task.input.clone(),
            conversation_id: None,
            conversation_history: vec![],
            agent_prompt: None,
            config,
        };
        runtime.run(request)
    }

    fn evaluate(task: &EvalTask, result: &RunResult) -> EvalReport {
        let mut missing_tools = Vec::new();
        let mut missing_keywords = Vec::new();

        // Check expected tools
        if let Some(expected_tools) = &task.expected_tool_calls {
            let actual_tools: std::collections::HashSet<String> = result.trace.iter()
                .filter(|e| e.kind == TraceEventKind::ToolRequested)
                // parse "tool_call=<tool>" from message. Super simple matching for now.
                .filter_map(|e| {
                    let parts: Vec<&str> = e.message.split_whitespace().collect();
                    parts.iter().find(|p| p.starts_with("tool_call=")).map(|p| p.replace("tool_call=", ""))
                })
                .collect();

            for expected in expected_tools {
                if !actual_tools.contains(expected) {
                    missing_tools.push(expected.clone());
                }
            }
        }

        // Check expected keywords in final response
        if let Some(expected_keywords) = &task.expected_final_response_contains {
            let final_response = &result.final_response.to_lowercase();
            for expected in expected_keywords {
                if !final_response.contains(&expected.to_lowercase()) {
                    missing_keywords.push(expected.clone());
                }
            }
        }

        let success = missing_tools.is_empty() && missing_keywords.is_empty();

        EvalReport {
            task_id: task.id.clone(),
            success,
            total_loops: result.state.loop_index,
            total_tokens: result.state.budget_usage.tokens_estimate,
            missing_tools,
            missing_keywords,
            stop_reason: result.state.stop_reason.as_ref().map(|s| s.to_string()).unwrap_or_else(|| "unknown".to_string()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use forgeone_runtime::{RuntimeConfig, RuntimeCore};

    fn make_task(
        id: &str,
        input: &str,
        expected_tools: Option<Vec<&str>>,
        expected_keywords: Option<Vec<&str>>,
    ) -> EvalTask {
        EvalTask {
            id: id.to_string(),
            input: input.to_string(),
            expected_tool_calls: expected_tools
                .map(|v| v.into_iter().map(|s| s.to_string()).collect()),
            expected_final_response_contains: expected_keywords
                .map(|v| v.into_iter().map(|s| s.to_string()).collect()),
        }
    }

    #[test]
    fn evaluate_reports_success_when_no_expectations() {
        let task = make_task("t-none", "describe the runtime", None, None);
        let core = RuntimeCore::default();
        let result = DefaultEvalSuite::run_eval(&core, &task, RuntimeConfig::default());
        let report = DefaultEvalSuite::evaluate(&task, &result);

        assert!(report.success);
        assert!(report.missing_tools.is_empty());
        assert!(report.missing_keywords.is_empty());
        assert_eq!(report.task_id, "t-none");
    }

    #[test]
    fn evaluate_reports_missing_keyword_when_not_in_response() {
        let task = make_task(
            "t-kw",
            "describe the runtime",
            None,
            Some(vec!["absolutely-not-in-response-xyzzy"]),
        );
        let core = RuntimeCore::default();
        let result = DefaultEvalSuite::run_eval(&core, &task, RuntimeConfig::default());
        let report = DefaultEvalSuite::evaluate(&task, &result);

        assert!(!report.success);
        assert_eq!(report.missing_keywords.len(), 1);
        assert_eq!(report.missing_keywords[0], "absolutely-not-in-response-xyzzy");
    }

    #[test]
    fn evaluate_reports_missing_tool_when_tool_not_called() {
        let task = make_task(
            "t-tool",
            "describe the runtime",
            Some(vec!["nonexistent_tool_xyz"]),
            None,
        );
        let core = RuntimeCore::default();
        let result = DefaultEvalSuite::run_eval(&core, &task, RuntimeConfig::default());
        let report = DefaultEvalSuite::evaluate(&task, &result);

        assert!(!report.success);
        assert!(report.missing_tools.contains(&"nonexistent_tool_xyz".to_string()));
    }

    #[test]
    fn run_eval_returns_result_with_final_response() {
        let task = make_task("t-run", "inspect the repo", None, None);
        let core = RuntimeCore::default();
        let result = DefaultEvalSuite::run_eval(&core, &task, RuntimeConfig::default());

        assert!(!result.final_response.is_empty());
        assert!(result.state.loop_index > 0);
    }

    #[test]
    fn evaluate_tracks_total_loops_and_tokens() {
        let task = make_task("t-metrics", "inspect the repo", None, None);
        let core = RuntimeCore::default();
        let result = DefaultEvalSuite::run_eval(&core, &task, RuntimeConfig::default());
        let report = DefaultEvalSuite::evaluate(&task, &result);

        assert_eq!(report.total_loops, result.state.loop_index);
        assert_eq!(report.total_tokens, result.state.budget_usage.tokens_estimate);
    }
}
