use std::io::{self, BufRead, Write};
use serde::{Deserialize, Serialize};
use forgeone_runtime::{RuntimeCore, RunRequest, RuntimeConfig};

#[derive(Debug, Deserialize)]
struct JsonRpcRequest {
    jsonrpc: String,
    id: Option<serde_json::Value>,
    method: String,
    params: Option<serde_json::Value>,
}

#[derive(Debug, Serialize)]
struct JsonRpcResponse {
    jsonrpc: String,
    id: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<JsonRpcError>,
}

#[derive(Debug, Serialize)]
struct JsonRpcError {
    code: i32,
    message: String,
}

#[derive(Debug, Deserialize)]
struct RunParams {
    task: String,
    conversation_id: Option<String>,
    conversation_history: Option<Vec<forgeone_runtime::ConversationTurnRecord>>,
    model_name: Option<String>,
    max_loops: Option<u32>,
    token_budget: Option<u32>,
    max_output_tokens: Option<u32>,
    allowed_tools: Option<Vec<String>>,
    read_roots: Option<Vec<String>>,
    approval_read_roots: Option<Vec<String>>,
    api_key: Option<String>,
    base_url: Option<String>,
    mcp_servers: Option<Vec<forgeone_tools::McpServerConfig>>,
}

#[derive(Debug, Deserialize)]
struct SessionIdParams {
    session_id: String,
}

fn main() {
    let runtime = RuntimeCore::default();
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut handle = stdout.lock();

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => break,
        };

        if line.trim().is_empty() {
            continue;
        }

        let request: JsonRpcRequest = match serde_json::from_str(&line) {
            Ok(req) => req,
            Err(e) => {
                let err_resp = JsonRpcResponse {
                    jsonrpc: "2.0".to_string(),
                    id: serde_json::Value::Null,
                    result: None,
                    error: Some(JsonRpcError {
                        code: -32700,
                        message: format!("Parse error: {e}"),
                    }),
                };
                let _ = writeln!(handle, "{}", serde_json::to_string(&err_resp).unwrap());
                let _ = handle.flush();
                continue;
            }
        };

        let response_id = request.id.unwrap_or(serde_json::Value::Null);
        let result = handle_request(&runtime, &request.method, request.params);

        let response = match result {
            Ok(res) => JsonRpcResponse {
                jsonrpc: "2.0".to_string(),
                id: response_id,
                result: Some(res),
                error: None,
            },
            Err(err_msg) => JsonRpcResponse {
                jsonrpc: "2.0".to_string(),
                id: response_id,
                result: None,
                error: Some(JsonRpcError {
                    code: -32603,
                    message: err_msg,
                }),
            },
        };

        let _ = writeln!(handle, "{}", serde_json::to_string(&response).unwrap());
        let _ = handle.flush();
    }
}

fn handle_request(
    runtime: &RuntimeCore,
    method: &str,
    params: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    match method {
        "run" => {
            let params: RunParams = serde_json::from_value(params.unwrap_or(serde_json::Value::Null))
                .map_err(|e| format!("Invalid params for run: {e}"))?;
            
            unsafe {
                if let Some(ref key) = params.api_key {
                    std::env::set_var("OPENAI_API_KEY", key);
                }
                if let Some(ref base) = params.base_url {
                    std::env::set_var("OPENAI_BASE_URL", base);
                }
            }
            
            let mut config = RuntimeConfig::default();
            if let Some(m) = params.model_name {
                config.model_name = m;
            }
            if let Some(l) = params.max_loops {
                config.max_loops = l;
            }
            if let Some(b) = params.token_budget {
                config.token_budget = b;
            }
            if let Some(max_output_tokens) = params.max_output_tokens {
                config.max_output_tokens = Some(max_output_tokens);
            }
            if let Some(tools) = params.allowed_tools {
                config.policy.allowed_tools = tools;
            }
            if let Some(roots) = params.read_roots {
                config.policy.read_roots = roots;
            }
            if let Some(approval_roots) = params.approval_read_roots {
                config.policy.approval_read_roots = approval_roots;
            }
            if let Some(mcp) = params.mcp_servers {
                config.mcp_servers = mcp;
            }

            let req = RunRequest {
                task: params.task,
                conversation_id: params.conversation_id,
                conversation_history: params.conversation_history.unwrap_or_default(),
                config,
            };

            let res = runtime.run(req);
            
            // Serialize RunResult using custom JSON mapping
            // since RunResult does not implement Serialize/Deserialize directly,
            // we map it to serde_json::Value manually.
            let serialized = serde_json::json!({
                "state": {
                    "session_id": res.state.session_id,
                    "task_id": res.state.task_id,
                    "agent_id": res.state.agent_id,
                    "parent_agent_id": res.state.parent_agent_id,
                    "loop_index": res.state.loop_index,
                    "status": res.state.status.to_string(),
                    "current_phase": res.state.current_phase.to_string(),
                    "observations": res.state.observations.iter().map(|o| {
                        serde_json::json!({
                            "tool_name": o.tool_name,
                            "summary": o.summary,
                            "content": o.content,
                        })
                    }).collect::<Vec<_>>(),
                    "policy_decisions": res.state.policy_decisions.iter().map(|p| {
                        serde_json::json!({
                            "scope": p.scope,
                            "decision": p.decision,
                            "detail": p.detail,
                        })
                    }).collect::<Vec<_>>(),
                    "pending_approval": res.state.pending_approval.as_ref().map(|p| {
                        serde_json::json!({
                            "tool_name": p.tool_name,
                            "reason": p.reason,
                            "argument_summary": p.argument_summary,
                        })
                    }),
                    "budget_usage": {
                        "tokens_estimate": res.state.budget_usage.tokens_estimate,
                        "tool_call_count": res.state.budget_usage.tool_call_count,
                    },
                    "stop_reason": res.state.stop_reason.as_ref().map(|s| s.to_string()),
                },
                "final_response": res.final_response,
                "trace": res.trace,
            });

            Ok(serialized)
        }
        "approve" => {
            let params: SessionIdParams = serde_json::from_value(params.unwrap_or(serde_json::Value::Null))
                .map_err(|e| format!("Invalid params for approve: {e}"))?;
            
            let res = runtime.approve_session(&params.session_id)?;
            let serialized = serde_json::json!({
                "state": {
                    "session_id": res.state.session_id,
                    "task_id": res.state.task_id,
                    "agent_id": res.state.agent_id,
                    "parent_agent_id": res.state.parent_agent_id,
                    "loop_index": res.state.loop_index,
                    "status": res.state.status.to_string(),
                    "current_phase": res.state.current_phase.to_string(),
                    "observations": res.state.observations.iter().map(|o| {
                        serde_json::json!({
                            "tool_name": o.tool_name,
                            "summary": o.summary,
                            "content": o.content,
                        })
                    }).collect::<Vec<_>>(),
                    "policy_decisions": res.state.policy_decisions.iter().map(|p| {
                        serde_json::json!({
                            "scope": p.scope,
                            "decision": p.decision,
                            "detail": p.detail,
                        })
                    }).collect::<Vec<_>>(),
                    "pending_approval": res.state.pending_approval.as_ref().map(|p| {
                        serde_json::json!({
                            "tool_name": p.tool_name,
                            "reason": p.reason,
                            "argument_summary": p.argument_summary,
                        })
                    }),
                    "budget_usage": {
                        "tokens_estimate": res.state.budget_usage.tokens_estimate,
                        "tool_call_count": res.state.budget_usage.tool_call_count,
                    },
                    "stop_reason": res.state.stop_reason.as_ref().map(|s| s.to_string()),
                },
                "final_response": res.final_response,
                "trace": res.trace,
            });

            Ok(serialized)
        }
        "resume" => {
            let params: SessionIdParams = serde_json::from_value(params.unwrap_or(serde_json::Value::Null))
                .map_err(|e| format!("Invalid params for resume: {e}"))?;
            
            let res = runtime.resume_session(&params.session_id)?;
            let serialized = serde_json::json!({
                "state": {
                    "session_id": res.state.session_id,
                    "task_id": res.state.task_id,
                    "agent_id": res.state.agent_id,
                    "parent_agent_id": res.state.parent_agent_id,
                    "loop_index": res.state.loop_index,
                    "status": res.state.status.to_string(),
                    "current_phase": res.state.current_phase.to_string(),
                    "observations": res.state.observations.iter().map(|o| {
                        serde_json::json!({
                            "tool_name": o.tool_name,
                            "summary": o.summary,
                            "content": o.content,
                        })
                    }).collect::<Vec<_>>(),
                    "policy_decisions": res.state.policy_decisions.iter().map(|p| {
                        serde_json::json!({
                            "scope": p.scope,
                            "decision": p.decision,
                            "detail": p.detail,
                        })
                    }).collect::<Vec<_>>(),
                    "pending_approval": res.state.pending_approval.as_ref().map(|p| {
                        serde_json::json!({
                            "tool_name": p.tool_name,
                            "reason": p.reason,
                            "argument_summary": p.argument_summary,
                        })
                    }),
                    "budget_usage": {
                        "tokens_estimate": res.state.budget_usage.tokens_estimate,
                        "tool_call_count": res.state.budget_usage.tool_call_count,
                    },
                    "stop_reason": res.state.stop_reason.as_ref().map(|s| s.to_string()),
                },
                "final_response": res.final_response,
                "trace": res.trace,
            });

            Ok(serialized)
        }
        "list_pending" => {
            let list = runtime.list_pending_approvals()?;
            Ok(serde_json::to_value(list).unwrap())
        }
        "list_traces" => {
            let list = runtime.list_session_traces()?;
            Ok(serde_json::to_value(list).unwrap())
        }
        "inspect_trace" => {
            let params: SessionIdParams = serde_json::from_value(params.unwrap_or(serde_json::Value::Null))
                .map_err(|e| format!("Invalid params for inspect_trace: {e}"))?;
            let trace = runtime.inspect_session_trace(&params.session_id)?;
            Ok(serde_json::to_value(trace).unwrap())
        }
        "delete_trace" => {
            let params: SessionIdParams = serde_json::from_value(params.unwrap_or(serde_json::Value::Null))
                .map_err(|e| format!("Invalid params for delete_trace: {e}"))?;
            runtime.delete_session_trace(&params.session_id)?;
            Ok(serde_json::json!({ "deleted": true, "session_id": params.session_id }))
        }
        "inspect_approval" => {
            let params: SessionIdParams = serde_json::from_value(params.unwrap_or(serde_json::Value::Null))
                .map_err(|e| format!("Invalid params for inspect_approval: {e}"))?;
            let approval = runtime.inspect_approval_session(&params.session_id)?;
            Ok(serde_json::to_value(approval).unwrap())
        }
        "prune_traces" => {
            let count = runtime.prune_session_traces()?;
            Ok(serde_json::json!({ "deleted": count }))
        }
        "prune_pending" => {
            let count = runtime.prune_pending_approvals()?;
            Ok(serde_json::json!({ "deleted": count }))
        }
        _ => Err(format!("Unknown method: {method}")),
    }
}
