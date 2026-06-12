use std::env;
use std::process::ExitCode;

use forgeone_runtime::{
    ApprovalSessionRecord, RunRequest, RuntimeConfig, RuntimeCore, SessionTraceRecord,
};
use forgeone_tools::{ExtensionSurface, ToolRegistry, discover_workspace_extensions};

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
    let runtime = RuntimeCore::default();
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
                    "--read-root" => {
                        let value = args
                            .next()
                            .ok_or_else(|| "missing value for --read-root".to_string())?;
                        push_unique(&mut config.policy.read_roots, value);
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

            let result = runtime.run(request);
            print_result(&result);
            Ok(())
        }
        "approve" => {
            let session_id = args
                .next()
                .ok_or_else(|| "missing session_id for approve".to_string())?;
            if args.next().is_some() {
                return Err(format!(
                    "approve only accepts a single session_id\n\n{}",
                    usage()
                ));
            }

            let result = runtime
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
                return Err(format!(
                    "resume only accepts a single session_id\n\n{}",
                    usage()
                ));
            }

            let result = runtime
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
                        return Err(format!(
                            "trace list does not accept extra args\n\n{}",
                            usage()
                        ));
                    }

                    let records = runtime
                        .list_session_traces()
                        .map_err(|error| format!("failed to list traces: {error}"))?;
                    print_trace_list(&records);
                    Ok(())
                }
                "prune" => {
                    if args.next().is_some() {
                        return Err(format!(
                            "trace prune does not accept extra args\n\n{}",
                            usage()
                        ));
                    }

                    let deleted = runtime
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

                    match runtime.inspect_session_trace(&session_id) {
                        Ok(record) => print_session_trace(&record),
                        Err(_) => {
                            let record =
                                runtime
                                    .inspect_approval_session(&session_id)
                                    .map_err(|error| {
                                        format!("failed to inspect session {session_id}: {error}")
                                    })?;
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

                    let records = runtime
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

                    let deleted = runtime
                        .prune_pending_approvals()
                        .map_err(|error| format!("failed to prune pending sessions: {error}"))?;
                    println!("deleted_sessions: {deleted}");
                    Ok(())
                }
                value => Err(format!(
                    "unknown session subcommand: {value}\n\n{}",
                    usage()
                )),
            }
        }
        "tool" => {
            let subcommand = args
                .next()
                .ok_or_else(|| "missing tool subcommand".to_string())?;
            match subcommand.as_str() {
                "list" => {
                    if args.next().is_some() {
                        return Err(format!(
                            "tool list does not accept extra args\n\n{}",
                            usage()
                        ));
                    }
                    print_tool_catalog();
                    Ok(())
                }
                value => Err(format!("unknown tool subcommand: {value}\n\n{}", usage())),
            }
        }
        "plugin" => {
            let subcommand = args
                .next()
                .ok_or_else(|| "missing plugin subcommand".to_string())?;
            match subcommand.as_str() {
                "list" => {
                    if args.next().is_some() {
                        return Err(format!(
                            "plugin list does not accept extra args\n\n{}",
                            usage()
                        ));
                    }
                    print_extension_catalog(ExtensionSurface::Plugin)?;
                    Ok(())
                }
                value => Err(format!("unknown plugin subcommand: {value}\n\n{}", usage())),
            }
        }
        "mcp" => {
            let subcommand = args
                .next()
                .ok_or_else(|| "missing mcp subcommand".to_string())?;
            match subcommand.as_str() {
                "list" => {
                    if args.next().is_some() {
                        return Err(format!(
                            "mcp list does not accept extra args\n\n{}",
                            usage()
                        ));
                    }
                    print_extension_catalog(ExtensionSurface::Mcp)?;
                    Ok(())
                }
                value => Err(format!("unknown mcp subcommand: {value}\n\n{}", usage())),
            }
        }
        "skill" => {
            let subcommand = args
                .next()
                .ok_or_else(|| "missing skill subcommand".to_string())?;
            match subcommand.as_str() {
                "list" => {
                    if args.next().is_some() {
                        return Err(format!(
                            "skill list does not accept extra args\n\n{}",
                            usage()
                        ));
                    }
                    print_extension_catalog(ExtensionSurface::Skill)?;
                    Ok(())
                }
                value => Err(format!("unknown skill subcommand: {value}\n\n{}", usage())),
            }
        }
        "tui" => {
            let session_id = args.next();
            if args.next().is_some() {
                return Err(format!(
                    "tui only accepts an optional session_id\n\n{}",
                    usage()
                ));
            }
            forgeone_tui::launch_tui(session_id.as_deref())
                .map_err(|error| format!("failed to launch TUI: {error}"))?;
            Ok(())
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
    println!(
        "approval_read_roots: {}",
        record.approval_read_roots.join(",")
    );
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
    println!(
        "approval_required: {}",
        if record.approval_required {
            "yes"
        } else {
            "no"
        }
    );
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
            if record.approval_required {
                "yes"
            } else {
                "no"
            },
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

fn print_tool_catalog() {
    let registry = ToolRegistry::with_builtin_tools();
    let tools = registry.registered_tools();
    if tools.is_empty() {
        println!("no tools registered");
        return;
    }

    println!("tool_name kind provider permissions description");
    for tool in tools {
        println!(
            "{} {} {} {} {}",
            tool.tool.tool_name,
            tool.tool.kind,
            tool.provider.provider_id,
            format_csv(&tool.tool.required_permissions),
            tool.tool.description
        );
    }
}

fn print_extension_catalog(surface: ExtensionSurface) -> Result<(), String> {
    let workspace_root = env::current_dir()
        .map_err(|error| format!("failed to resolve current directory: {error}"))?;
    let discovered = discover_workspace_extensions(&workspace_root)?;
    let entries: Vec<_> = discovered
        .into_iter()
        .filter(|entry| entry.provider.kind == surface.tool_kind())
        .collect();

    if entries.is_empty() {
        println!(
            "no {} manifests discovered under .forgeone/{}",
            surface,
            surface.directory_name()
        );
        return Ok(());
    }

    println!("provider kind version tools source");
    for entry in &entries {
        let version = entry.provider.version.as_deref().unwrap_or("-");
        let source = entry
            .manifest_path()
            .map(|path| path.display().to_string())
            .unwrap_or_else(|| entry.provider.source.summary());
        println!(
            "{} {} {} {} {}",
            entry.provider.provider_id,
            entry.provider.kind,
            version,
            entry.tools.len(),
            source
        );
    }

    println!();
    println!("details:");
    for entry in &entries {
        let version = entry.provider.version.as_deref().unwrap_or("-");
        println!(
            "{} {} {}",
            entry.provider.provider_id, entry.provider.display_name, version
        );
        println!("  description: {}", entry.provider.description);
        println!("  permissions: {}", format_csv(&entry.required_permissions));
        println!(
            "  entrypoint: {}",
            entry.entrypoint.as_deref().unwrap_or("-")
        );
        println!(
            "  tools: {}",
            entry
                .tools
                .iter()
                .map(|tool| format!(
                    "{}({})",
                    tool.tool_name,
                    format_csv(&tool.required_permissions)
                ))
                .collect::<Vec<_>>()
                .join(", ")
        );
    }

    Ok(())
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

fn format_csv(values: &[String]) -> String {
    if values.is_empty() {
        "-".to_string()
    } else {
        values.join(",")
    }
}

fn usage() -> String {
    "usage:\n  forgeone run [--model <name>] [--max-loops <n>] [--budget-tokens <n>] [--allow-tool <name>] [--allow-tools <a,b>] [--approval-read-root <prefix>] <task>\n  forgeone approve <session_id>\n  forgeone resume <session_id>\n  forgeone trace list\n  forgeone trace show <session_id>\n  forgeone trace prune\n  forgeone session list\n  forgeone session prune\n  forgeone tool list\n  forgeone plugin list\n  forgeone mcp list\n  forgeone skill list\n  forgeone tui [session_id]".to_string()
}
