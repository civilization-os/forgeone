use std::env;
use std::process::ExitCode;

use forgeone_runtime::{ApprovalSessionRecord, RunRequest, RuntimeConfig, RuntimeCore, SessionTraceRecord};

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("{message}");
            ExitCode::from(1)
        }
    }
}

fn run() -> Result<(), String> {
    let mut args = env::args().skip(1);
    let Some(command) = args.next() else {
        return Err(usage());
    };

    match command.as_str() {
        "run" => {
            let mut config = RuntimeConfig::default();
            let mut task_parts = Vec::new();

            while let Some(arg) = args.next() {
                match arg.as_str() {
                    "--model" => {
                        let value = args
                            .next()
                            .ok_or_else(|| "missing value for --model".to_string())?;
                        config.model_name = value;
                    }
                    "--max-loops" => {
                        let value = args
                            .next()
                            .ok_or_else(|| "missing value for --max-loops".to_string())?;
                        config.max_loops = parse_u32("--max-loops", &value)?;
                    }
                    "--budget-tokens" => {
                        let value = args
                            .next()
                            .ok_or_else(|| "missing value for --budget-tokens".to_string())?;
                        config.token_budget = parse_u32("--budget-tokens", &value)?;
                    }
                    "--allow-tool" => {
                        let value = args
                            .next()
                            .ok_or_else(|| "missing value for --allow-tool".to_string())?;
                        push_unique(&mut config.policy.allowed_tools, value);
                    }
                    "--allow-tools" => {
                        let value = args
                            .next()
                            .ok_or_else(|| "missing value for --allow-tools".to_string())?;
                        config.policy.allowed_tools.clear();
                        for tool in value.split(',').map(str::trim).filter(|v| !v.is_empty()) {
                            push_unique(&mut config.policy.allowed_tools, tool.to_string());
                        }
                    }
                    "--approval-read-root" => {
                        let value = args
                            .next()
                            .ok_or_else(|| "missing value for --approval-read-root".to_string())?;
                        push_unique(&mut config.policy.approval_read_roots, value);
                    }
                    value if value.starts_with("--") => {
                        return Err(format!("unknown flag: {value}\n\n{}", usage()));
                    }
                    value => task_parts.push(value.to_string()),
                }
            }

            if task_parts.is_empty() {
                return Err("missing task input\n\n".to_string() + &usage());
            }

            let request = RunRequest {
                task: task_parts.join(" "),
                config,
            };

            let result = RuntimeCore.run(request);
            print_result(&result);
            Ok(())
        }
        "approve" => {
            let session_id = args
                .next()
                .ok_or_else(|| "missing session_id for approve".to_string())?;
            if args.next().is_some() {
                return Err(format!("approve only accepts a single session_id\n\n{}", usage()));
            }

            let result = RuntimeCore
                .approve_session(&session_id)
                .map_err(|error| format!("failed to approve session {session_id}: {error}"))?;
            print_result(&result);
            Ok(())
        }
        "resume" => {
            let session_id = args
                .next()
                .ok_or_else(|| "missing session_id for resume".to_string())?;
            if args.next().is_some() {
                return Err(format!("resume only accepts a single session_id\n\n{}", usage()));
            }

            let result = RuntimeCore
                .resume_session(&session_id)
                .map_err(|error| format!("failed to resume session {session_id}: {error}"))?;
            print_result(&result);
            Ok(())
        }
        "trace" => {
            let subcommand = args
                .next()
                .ok_or_else(|| "missing trace subcommand".to_string())?;
            match subcommand.as_str() {
                "list" => {
                    if args.next().is_some() {
                        return Err(format!("trace list does not accept extra args\n\n{}", usage()));
                    }

                    let records = RuntimeCore
                        .list_session_traces()
                        .map_err(|error| format!("failed to list traces: {error}"))?;
                    print_trace_list(&records);
                    Ok(())
                }
                "prune" => {
                    if args.next().is_some() {
                        return Err(format!("trace prune does not accept extra args\n\n{}", usage()));
                    }

                    let deleted = RuntimeCore
                        .prune_session_traces()
                        .map_err(|error| format!("failed to prune traces: {error}"))?;
                    println!("deleted_traces: {deleted}");
                    Ok(())
                }
                "show" => {
                    let session_id = args
                        .next()
                        .ok_or_else(|| "missing session_id for trace show".to_string())?;
                    if args.next().is_some() {
                        return Err(format!(
                            "trace show only accepts a single session_id\n\n{}",
                            usage()
                        ));
                    }

                    match RuntimeCore.inspect_session_trace(&session_id) {
                        Ok(record) => print_session_trace(&record),
                        Err(_) => {
                            let record = RuntimeCore.inspect_approval_session(&session_id).map_err(
                                |error| format!("failed to inspect session {session_id}: {error}"),
                            )?;
                            print_approval_session(&record);
                        }
                    }
                    Ok(())
                }
                value => Err(format!("unknown trace subcommand: {value}\n\n{}", usage())),
            }
        }
        "session" => {
            let subcommand = args
                .next()
                .ok_or_else(|| "missing session subcommand".to_string())?;
            match subcommand.as_str() {
                "list" => {
                    if args.next().is_some() {
                        return Err(format!(
                            "session list does not accept extra args\n\n{}",
                            usage()
                        ));
                    }

                    let records = RuntimeCore
                        .list_pending_approvals()
                        .map_err(|error| format!("failed to list pending sessions: {error}"))?;
                    print_pending_sessions(&records);
                    Ok(())
                }
                "prune" => {
                    if args.next().is_some() {
                        return Err(format!(
                            "session prune does not accept extra args\n\n{}",
                            usage()
                        ));
                    }

                    let deleted = RuntimeCore
                        .prune_pending_approvals()
                        .map_err(|error| format!("failed to prune pending sessions: {error}"))?;
                    println!("deleted_sessions: {deleted}");
                    Ok(())
                }
                value => Err(format!("unknown session subcommand: {value}\n\n{}", usage())),
            }
        }
        _ => Err(usage()),
    }
}

fn print_result(result: &forgeone_runtime::RunResult) {
    println!("session_id: {}", result.state.session_id);
    println!("agent_id: {}", result.state.agent_id);
    println!(
        "parent_agent_id: {}",
        result.state.parent_agent_id.as_deref().unwrap_or("-")
    );
    println!("status: {}", result.state.status);
    println!("current_phase: {}", result.state.current_phase);
    println!("loop_index: {}", result.state.loop_index);
    println!(
        "stop_reason: {}",
        result
            .state
            .stop_reason
            .as_ref()
            .map(|v| v.to_string())
            .unwrap_or_else(|| "unknown".to_string())
    );
    if let Some(approval) = &result.state.pending_approval {
        println!("approval_required: yes");
        println!("approval_tool: {}", approval.tool_name);
        println!("approval_reason: {}", approval.reason);
        println!("approval_args: {}", approval.argument_summary);
        println!(
            "approval_session_file: .forgeone/sessions/{}.json",
            result.state.session_id
        );
    } else {
        println!("approval_required: no");
    }
    println!("final_response: {}", result.final_response);
    println!("trace:");
    for event in &result.trace {
        println!("  {event}");
    }
}

fn print_approval_session(record: &ApprovalSessionRecord) {
    println!("session_id: {}", record.session_id);
    println!("task_id: {}", record.task_id);
    println!("task_input: {}", record.task_input);
    println!("status: waiting_approval");
    println!("loop_index: {}", record.loop_index);
    println!("model: {}", record.model_name);
    println!("token_budget: {}", record.token_budget);
    println!("tool_call_count: {}", record.tool_call_count);
    println!("tokens_estimate: {}", record.tokens_estimate);
    println!("pending_tool: {}", record.pending_approval.tool_name);
    println!("pending_reason: {}", record.pending_approval.reason);
    println!("pending_args: {}", record.pending_approval.argument_summary);
    println!("allowed_tools: {}", record.allowed_tools.join(","));
    println!("read_roots: {}", record.read_roots.join(","));
    println!("approval_read_roots: {}", record.approval_read_roots.join(","));
    if record.observations.is_empty() {
        println!("observations: none");
    } else {
        println!("observations:");
        for observation in &record.observations {
            println!("  {} => {}", observation.tool_name, observation.summary);
        }
    }
    if record.policy_decisions.is_empty() {
        println!("policy_decisions: none");
    } else {
        println!("policy_decisions:");
        for decision in &record.policy_decisions {
            println!(
                "  {} {} {}",
                decision.scope, decision.decision, decision.detail
            );
        }
    }
}

fn print_session_trace(record: &SessionTraceRecord) {
    println!("session_id: {}", record.session_id);
    println!("task_id: {}", record.task_id);
    println!("task_input: {}", record.task_input);
    println!("agent_id: {}", record.agent_id);
    println!("status: {}", record.status);
    println!("current_phase: {}", record.current_phase);
    println!("loop_index: {}", record.loop_index);
    println!("stop_reason: {}", record.stop_reason);
    println!("approval_required: {}", if record.approval_required { "yes" } else { "no" });
    println!("token_budget: {}", record.token_budget);
    println!("tokens_estimate: {}", record.tokens_estimate);
    println!("tool_call_count: {}", record.tool_call_count);
    if let Some(approval) = &record.pending_approval {
        println!("pending_tool: {}", approval.tool_name);
        println!("pending_reason: {}", approval.reason);
        println!("pending_args: {}", approval.argument_summary);
    }
    println!("final_response: {}", record.final_response);
    println!("trace:");
    for event in &record.trace {
        println!("  {event}");
    }
}

fn print_trace_list(records: &[SessionTraceRecord]) {
    if records.is_empty() {
        println!("no traces");
        return;
    }

    println!("session_id status loop stop_reason approval task");
    for record in records {
        println!(
            "{} {} {} {} {} {}",
            record.session_id,
            record.status,
            record.loop_index,
            record.stop_reason,
            if record.approval_required { "yes" } else { "no" },
            record.task_input
        );
    }
}

fn print_pending_sessions(records: &[ApprovalSessionRecord]) {
    if records.is_empty() {
        println!("no pending sessions");
        return;
    }

    println!("session_id loop tool reason");
    for record in records {
        println!(
            "{} {} {} {}",
            record.session_id,
            record.loop_index,
            record.pending_approval.tool_name,
            record.pending_approval.reason
        );
    }
}

fn parse_u32(flag: &str, value: &str) -> Result<u32, String> {
    value
        .parse::<u32>()
        .map_err(|_| format!("invalid value for {flag}: {value}"))
}

fn push_unique(values: &mut Vec<String>, value: String) {
    if !values.iter().any(|existing| existing == &value) {
        values.push(value);
    }
}

fn usage() -> String {
    "usage:\n  forgeone run [--model <name>] [--max-loops <n>] [--budget-tokens <n>] [--allow-tool <name>] [--allow-tools <a,b>] [--approval-read-root <prefix>] <task>\n  forgeone approve <session_id>\n  forgeone resume <session_id>\n  forgeone trace list\n  forgeone trace show <session_id>\n  forgeone trace prune\n  forgeone session list\n  forgeone session prune".to_string()
}
