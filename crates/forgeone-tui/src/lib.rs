use std::io;
use std::time::Duration;

use crossterm::cursor::SetCursorStyle;
use crossterm::event::{
    self, DisableBracketedPaste, EnableBracketedPaste, Event, KeyCode, KeyEventKind, KeyModifiers,
};
use crossterm::execute;
use crossterm::terminal::{
    EnterAlternateScreen, LeaveAlternateScreen, disable_raw_mode, enable_raw_mode,
};
use ratatui::Frame;
use ratatui::Terminal;
use ratatui::backend::CrosstermBackend;
use ratatui::layout::{Constraint, Direction, Layout, Margin, Rect};

pub mod commands;
pub mod components;
pub mod state;
pub mod theme;

use commands::*;
use components::*;
pub use state::*;

use forgeone_model_ollama::OllamaModelAdapter;
use forgeone_runtime::{RunRequest, RuntimeConfig, RuntimeCore, RuntimeStatus};

pub fn load_dashboard(
    session_id: Option<&str>,
) -> Result<DashboardState, Box<dyn std::error::Error>> {
    let core = RuntimeCore::default();

    if let Some(id) = session_id {
        if let Ok(record) = core.inspect_approval_session(id) {
            return Ok(DashboardState::from_approval_session(record));
        }
        if let Ok(record) = core.inspect_session_trace(id) {
            return Ok(DashboardState::from_session_trace(record));
        }
        return Err(format!("Session not found: {id}").into());
    }

    if let Ok(approvals) = core.list_pending_approvals() {
        if let Some(latest) = approvals.first() {
            return Ok(DashboardState::from_approval_session(latest.clone()));
        }
    }

    if let Ok(traces) = core.list_session_traces() {
        if let Some(latest) = traces.first() {
            return Ok(DashboardState::from_session_trace(latest.clone()));
        }
    }

    Ok(DashboardState::empty(
        "No active session or trace found. Enter a task to start.".to_string(),
    ))
}

pub fn launch_tui(session_id: Option<&str>) -> Result<(), Box<dyn std::error::Error>> {
    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(
        stdout,
        EnterAlternateScreen,
        EnableBracketedPaste,
        SetCursorStyle::SteadyBar
    )?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    let mut state = load_dashboard(session_id).unwrap_or_else(|_| {
        DashboardState::empty("TUI Initialized. Enter a task to run.".to_string())
    });

    let core = RuntimeCore::default();

    loop {
        terminal.draw(|frame| render_dashboard(frame, &state))?;

        if !event::poll(Duration::from_millis(100))? {
            continue;
        }

        match event::read()? {
            Event::Paste(text) => {
                if state.active_modal == ActiveModal::None && state.focus == FocusPane::Input {
                    state.cancel_exit();
                    state.record_paste(text.as_str());
                }
            }
            Event::Key(key) => {
                if key.kind != KeyEventKind::Press {
                    continue;
                }

                // 1. If a modal is active, handle modal keys exclusively
                if state.active_modal != ActiveModal::None {
                    match key.code {
                        KeyCode::Esc => {
                            state.active_modal = ActiveModal::None;
                        }
                        KeyCode::Up => match state.active_modal {
                            ActiveModal::ModelSelector => {
                                if !state.modal_models.is_empty() {
                                    state.modal_selected_index = state
                                        .modal_selected_index
                                        .checked_sub(1)
                                        .unwrap_or(state.modal_models.len() - 1);
                                }
                            }
                            ActiveModal::SessionSwitcher => {
                                if !state.modal_sessions.is_empty() {
                                    state.modal_selected_index = state
                                        .modal_selected_index
                                        .checked_sub(1)
                                        .unwrap_or(state.modal_sessions.len() - 1);
                                }
                            }
                            _ => {}
                        },
                        KeyCode::Down => match state.active_modal {
                            ActiveModal::ModelSelector => {
                                if !state.modal_models.is_empty() {
                                    state.modal_selected_index =
                                        (state.modal_selected_index + 1) % state.modal_models.len();
                                }
                            }
                            ActiveModal::SessionSwitcher => {
                                if !state.modal_sessions.is_empty() {
                                    state.modal_selected_index = (state.modal_selected_index + 1)
                                        % state.modal_sessions.len();
                                }
                            }
                            _ => {}
                        },
                        KeyCode::Enter | KeyCode::Char(' ') => {
                            match state.active_modal {
                                ActiveModal::ModelSelector => {
                                    if !state.modal_models.is_empty() {
                                        let selected =
                                            state.modal_models[state.modal_selected_index].clone();
                                        state.active_model = selected.clone();
                                        state.hint = format!("Active model: {}", selected);
                                    }
                                }
                                ActiveModal::SessionSwitcher => {
                                    if !state.modal_sessions.is_empty() {
                                        let selected_id = state.modal_sessions
                                            [state.modal_selected_index]
                                            .session_id
                                            .clone();
                                        if let Ok(rec) = core.inspect_session_trace(&selected_id) {
                                            state = DashboardState::from_session_trace(rec);
                                            state.hint = format!("Loaded session: {selected_id}");
                                        } else if let Ok(rec) =
                                            core.inspect_approval_session(&selected_id)
                                        {
                                            state = DashboardState::from_approval_session(rec);
                                            state.hint = format!(
                                                "Loaded session: {selected_id} (pending approval)"
                                            );
                                        }
                                    }
                                }
                                _ => {}
                            }
                            state.active_modal = ActiveModal::None;
                        }
                        _ => {}
                    }
                    continue;
                }

                // 2. Control Modifiers (Global Shortcuts)
                if key.modifiers.contains(KeyModifiers::CONTROL) {
                    match key.code {
                        KeyCode::Char('c') | KeyCode::Char('C') => {
                            if state.exit_pending {
                                disable_raw_mode()?;
                                execute!(
                                    terminal.backend_mut(),
                                    DisableBracketedPaste,
                                    SetCursorStyle::DefaultUserShape,
                                    LeaveAlternateScreen
                                )?;
                                terminal.show_cursor()?;
                                return Ok(());
                            }
                            state.arm_exit();
                            continue;
                        }
                        KeyCode::Char('m')
                        | KeyCode::Char('M')
                        | KeyCode::Char('g')
                        | KeyCode::Char('G') => {
                            // Populate models
                            let adapter = OllamaModelAdapter::from_env();
                            let client = adapter.client();
                            let mut list = vec![
                                "mock-model".to_string(),
                                "openai:gpt-4o".to_string(),
                                "openai:gpt-4o-mini".to_string(),
                            ];
                            if let Ok(ollama_models) = client.list_models() {
                                for m in ollama_models {
                                    list.push(format!("ollama:{}", m));
                                }
                            }
                            state.modal_models = list;
                            state.modal_selected_index = state
                                .modal_models
                                .iter()
                                .position(|m| m == &state.active_model)
                                .unwrap_or(0);
                            state.active_modal = ActiveModal::ModelSelector;
                            continue;
                        }
                        KeyCode::Char('s')
                        | KeyCode::Char('S')
                        | KeyCode::Char('o')
                        | KeyCode::Char('O') => {
                            // Populate sessions
                            let mut list = Vec::new();
                            if let Ok(traces) = core.list_session_traces() {
                                for t in traces {
                                    list.push(SessionSummary {
                                        session_id: t.session_id,
                                        status: t.status,
                                        loop_index: t.loop_index,
                                        stop_reason: t.stop_reason,
                                        task_input: t.task_input,
                                    });
                                }
                            }
                            if let Ok(approvals) = core.list_pending_approvals() {
                                for a in approvals {
                                    list.push(SessionSummary {
                                        session_id: a.session_id,
                                        status: "waiting_approval".to_string(),
                                        loop_index: a.loop_index,
                                        stop_reason: "-".to_string(),
                                        task_input: a.task_input,
                                    });
                                }
                            }
                            state.modal_sessions = list;
                            state.modal_selected_index = state
                                .modal_sessions
                                .iter()
                                .position(|s| s.session_id == state.session_id)
                                .unwrap_or(0);
                            state.active_modal = ActiveModal::SessionSwitcher;
                            continue;
                        }
                        KeyCode::Char('h') | KeyCode::Char('H') => {
                            state.active_modal = ActiveModal::Help;
                            continue;
                        }
                        _ => {}
                    }
                }

                // 3. F-keys and global shortcuts
                if key.code == KeyCode::F(1) {
                    state.active_modal = ActiveModal::Help;
                    continue;
                }

                // 4. Standard Focused Navigation
                match key.code {
                    KeyCode::Tab => {
                        state.cancel_exit();
                        let input_trimmed = state.input.trim();
                        let show_suggestions = state.focus == FocusPane::Input && input_trimmed.starts_with('/');
                        let mut matched_suggestions = Vec::new();
                        if show_suggestions {
                            for cmd in SLASH_COMMANDS {
                                if cmd.starts_with(input_trimmed) {
                                    matched_suggestions.push(*cmd);
                                }
                            }
                        }
                        if !matched_suggestions.is_empty() {
                            state.input = matched_suggestions[0].to_string();
                            state.input_cursor = state.input.chars().count();
                        } else {
                            state.cycle_focus();
                        }
                    }
                    KeyCode::Up => {
                        state.cancel_exit();
                        if state.focus == FocusPane::Chat {
                            state.chat_scroll = state.chat_scroll.saturating_sub(1);
                        } else if state.focus == FocusPane::Monitor {
                            let total_items =
                                state.agents.len() + state.steps.len() + state.tool_stats.len() + 1; // plus 1 runtime info
                            if total_items > 0 {
                                state.monitor_selected_index = state
                                    .monitor_selected_index
                                    .checked_sub(1)
                                    .unwrap_or(total_items - 1);
                            }
                        }
                    }
                    KeyCode::Down => {
                        state.cancel_exit();
                        if state.focus == FocusPane::Chat {
                            state.chat_scroll = state.chat_scroll.saturating_add(1);
                        } else if state.focus == FocusPane::Monitor {
                            let total_items =
                                state.agents.len() + state.steps.len() + state.tool_stats.len() + 1;
                            if total_items > 0 {
                                state.monitor_selected_index =
                                    (state.monitor_selected_index + 1) % total_items;
                            }
                        }
                    }
                    KeyCode::Left => {
                        state.cancel_exit();
                        if state.focus == FocusPane::Input {
                            state.move_cursor_left();
                        }
                    }
                    KeyCode::Right => {
                        state.cancel_exit();
                        if state.focus == FocusPane::Input {
                            let input_trimmed = state.input.trim();
                            let cursor_at_end = state.input_cursor == state.input.chars().count();
                            let show_suggestions = input_trimmed.starts_with('/');
                            let mut matched_suggestions = Vec::new();
                            if show_suggestions {
                                for cmd in SLASH_COMMANDS {
                                    if cmd.starts_with(input_trimmed) {
                                        matched_suggestions.push(*cmd);
                                    }
                                }
                            }
                            if cursor_at_end && !matched_suggestions.is_empty() {
                                state.input = matched_suggestions[0].to_string();
                                state.input_cursor = state.input.chars().count();
                            } else {
                                state.move_cursor_right();
                            }
                        }
                    }
                    KeyCode::Home => {
                        state.cancel_exit();
                        if state.focus == FocusPane::Input {
                            state.move_cursor_home();
                        }
                    }
                    KeyCode::End => {
                        state.cancel_exit();
                        if state.focus == FocusPane::Input {
                            state.move_cursor_end();
                        }
                    }
                    KeyCode::Backspace => {
                        state.cancel_exit();
                        if state.focus == FocusPane::Input {
                            state.backspace();
                        }
                    }
                    KeyCode::Delete => {
                        state.cancel_exit();
                        if state.focus == FocusPane::Input {
                            state.delete_forward();
                        }
                    }
                    KeyCode::Esc => {
                        if state.exit_pending {
                            state.cancel_exit();
                        } else if state.focus == FocusPane::Input {
                            state.clear_input();
                        }
                    }
                    KeyCode::Enter => {
                        state.cancel_exit();
                        if state.focus == FocusPane::Monitor {
                            // Inspect selected node
                            let mut details = Vec::new();
                            details
                                .push("╭──────────────────────────────────────────╮".to_string());
                            details
                                .push("│       MONITOR NODE INSPECTOR             │".to_string());
                            details
                                .push("╰──────────────────────────────────────────╯".to_string());
                            details.push("".to_string());

                            let mut idx = state.monitor_selected_index;
                            if idx < state.agents.len() {
                                let agent = &state.agents[idx];
                                details.push(format!("  • Type:   Agent Tree Node"));
                                details.push(format!("  • Label:  {}", agent.label));
                                details.push(format!("  • Depth:  {}", agent.depth));
                                details.push(format!(
                                    "  • Status: {}",
                                    if agent.is_selected {
                                        "Active (Selected)"
                                    } else {
                                        "Idle"
                                    }
                                ));
                            } else {
                                idx -= state.agents.len();
                                if idx < state.steps.len() {
                                    let step = &state.steps[idx];
                                    details.push(format!("  • Type:   Agent Loop Phase"));
                                    details.push(format!("  • Step:   {}", step.label));
                                    details.push(format!("  • State:  {:?}", step.state));
                                } else {
                                    idx -= state.steps.len();
                                    if idx == 0 {
                                        details.push(format!("  • Type:     Runtime Statistics"));
                                        details.push(format!("  • Session:  {}", state.session_id));
                                        details
                                            .push(format!("  • Model:    {}", state.active_model));
                                        details
                                            .push(format!("  • Budget:   {}", state.budget_text));
                                        details.push(format!("  • Last Run: {}", state.last_tool));
                                    } else {
                                        idx -= 1;
                                        if idx < state.tool_stats.len() {
                                            let tool = &state.tool_stats[idx];
                                            details.push(format!("  • Type:     Tool Statistics"));
                                            details
                                                .push(format!("  • Tool:     {}", tool.tool_name));
                                            details.push(format!(
                                                "  • Success:  {} calls",
                                                tool.success_count
                                            ));
                                            details.push(format!(
                                                "  • Failure:  {} calls",
                                                tool.failure_count
                                            ));
                                        } else {
                                            details
                                                .push(format!("  • Selected index out of range"));
                                        }
                                    }
                                }
                            }
                            details.push("".to_string());
                            details.push("  👉 Press Esc or Enter to close.".to_string());
                            state.inspector_content = details;
                            state.active_modal = ActiveModal::StepInspector;
                        } else if state.focus == FocusPane::Input && !state.input.is_empty() {
                            let input_str = state.input.clone();
                            state.clear_input();

                            let trimmed = input_str.trim();
                            if trimmed == "/models" || trimmed.starts_with("/models ") {
                                let adapter = OllamaModelAdapter::from_env();
                                let client = adapter.client();
                                let mut list = vec![
                                    "mock-model".to_string(),
                                    "openai:gpt-4o".to_string(),
                                    "openai:gpt-4o-mini".to_string(),
                                ];
                                if let Ok(ollama_models) = client.list_models() {
                                    for m in ollama_models {
                                        list.push(format!("ollama:{}", m));
                                    }
                                }
                                let mut assistant_lines = vec!["Available models:".to_string()];
                                for m in list {
                                    assistant_lines.push(format!("- {}", m));
                                }
                                assistant_lines.push("".to_string());
                                assistant_lines
                                    .push("Use `/model <name>` to select one.".to_string());

                                let block = ChatBlockView {
                                    timestamp: format_timestamp(now_ms()),
                                    user_text: input_str,
                                    tool_name: "system".to_string(),
                                    tool_summary: "Query Ollama/OpenAI".to_string(),
                                    assistant_lines,
                                };
                                state.chat_blocks.push(block);
                                state.chat_scroll = 9999;
                            } else if trimmed == "/model" {
                                state.chat_blocks.push(ChatBlockView {
                                    timestamp: format_timestamp(now_ms()),
                                    user_text: input_str,
                                    tool_name: "system".to_string(),
                                    tool_summary: "Error".to_string(),
                                    assistant_lines: vec![
                                        "Error: Model name cannot be empty. Usage: /model <name>"
                                            .to_string(),
                                    ],
                                });
                                state.chat_scroll = 9999;
                            } else if trimmed.starts_with("/model ") {
                                let model_name =
                                    trimmed.trim_start_matches("/model ").trim().to_string();
                                if model_name.is_empty() {
                                    state.chat_blocks.push(ChatBlockView {
                                        timestamp: format_timestamp(now_ms()),
                                        user_text: input_str,
                                        tool_name: "system".to_string(),
                                        tool_summary: "Error".to_string(),
                                        assistant_lines: vec!["Error: Model name cannot be empty. Usage: /model <name>".to_string()],
                                    });
                                } else {
                                    state.active_model = model_name.clone();
                                    state.chat_blocks.push(ChatBlockView {
                                        timestamp: format_timestamp(now_ms()),
                                        user_text: input_str,
                                        tool_name: "system".to_string(),
                                        tool_summary: "Model changed".to_string(),
                                        assistant_lines: vec![format!(
                                            "Selected active model: {}",
                                            model_name
                                        )],
                                    });
                                    state.hint = format!("Active model: {}", model_name);
                                }
                                state.chat_scroll = 9999;
                            } else if input_str.starts_with("/approve") {
                                if state.pending_approval.is_some() {
                                    state.hint = "Approving session execution...".to_string();
                                    terminal.draw(|frame| render_dashboard(frame, &state))?;
                                    let prev_active_model = state.active_model.clone();
                                    match core.approve_session(&state.session_id) {
                                        Ok(result) => {
                                            if matches!(
                                                result.state.status,
                                                RuntimeStatus::WaitingApproval
                                            ) {
                                                if let Ok(rec) = core.inspect_approval_session(
                                                    &result.state.session_id,
                                                ) {
                                                    state =
                                                        DashboardState::from_approval_session(rec);
                                                }
                                            } else {
                                                if let Ok(rec) = core
                                                    .inspect_session_trace(&result.state.session_id)
                                                {
                                                    state = DashboardState::from_session_trace(rec);
                                                }
                                            }
                                        }
                                        Err(e) => {
                                            state.hint = format!("Approval failed: {e}");
                                        }
                                    }
                                    state.active_model = prev_active_model;
                                } else {
                                    state.hint = "No pending approval session.".to_string();
                                }
                            } else if input_str.starts_with("/deny") {
                                if state.pending_approval.is_some() {
                                    let session_path = std::path::Path::new(".forgeone")
                                        .join("sessions")
                                        .join(format!("{}.json", state.session_id));
                                    if session_path.exists() {
                                        let _ = std::fs::remove_file(session_path);
                                    }
                                    state.hint = "Session execution denied.".to_string();
                                    state.pending_approval = None;
                                    state.runtime_status = "denied".to_string();
                                } else {
                                    state.hint = "No pending approval session.".to_string();
                                }
                            } else {
                                state.hint = format!("Running task: {} ...", input_str);
                                terminal.draw(|frame| render_dashboard(frame, &state))?;
                                let prev_active_model = state.active_model.clone();

                                let result = core.run(RunRequest {
                                    task: input_str,
                                    config: RuntimeConfig {
                                        model_name: state.active_model.clone(),
                                        ..Default::default()
                                    },
                                });

                                if matches!(result.state.status, RuntimeStatus::WaitingApproval) {
                                    if let Ok(rec) =
                                        core.inspect_approval_session(&result.state.session_id)
                                    {
                                        state = DashboardState::from_approval_session(rec);
                                    }
                                } else {
                                    if let Ok(rec) =
                                        core.inspect_session_trace(&result.state.session_id)
                                    {
                                        state = DashboardState::from_session_trace(rec);
                                    }
                                }
                                state.active_model = prev_active_model;
                                state.chat_scroll = 9999;
                            }
                        }
                    }
                    KeyCode::Char(ch) => {
                        state.cancel_exit();
                        if state.focus == FocusPane::Input {
                            state.append_char(ch);
                        }
                    }
                    _ => {}
                }
            }
            _ => {}
        }
    }
}

pub fn render_dashboard(frame: &mut Frame<'_>, state: &DashboardState) {
    let inner = frame.area().inner(Margin {
        vertical: 0,
        horizontal: 1,
    });

    let input_trimmed = state.input.trim();
    let show_suggestions = state.focus == FocusPane::Input && input_trimmed.starts_with('/');
    let mut matched_suggestions = Vec::new();
    if show_suggestions {
        for cmd in SLASH_COMMANDS {
            if cmd.starts_with(input_trimmed) {
                matched_suggestions.push(*cmd);
            }
        }
    }
    let has_matched = !matched_suggestions.is_empty();

    let constraints = if has_matched {
        let suggestions_height = (matched_suggestions.len() as u16 + 2).min(8);
        vec![
            Constraint::Length(2),                  // Header
            Constraint::Min(10),                    // Body
            Constraint::Length(suggestions_height), // Suggestions
            Constraint::Length(3),                  // Input
            Constraint::Length(1),                  // Status Bar
        ]
    } else {
        vec![
            Constraint::Length(2), // Header
            Constraint::Min(10),   // Body
            Constraint::Length(3), // Input
            Constraint::Length(1), // Status Bar
        ]
    };

    let rows = Layout::default()
        .direction(Direction::Vertical)
        .constraints(constraints)
        .split(inner);

    render_header(frame, rows[0], state);

    let body = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(70), Constraint::Percentage(30)])
        .split(rows[1]);

    render_conversation(frame, body[0], state);
    render_monitor(frame, body[1], state);

    let input_area = if has_matched {
        render_suggestions(frame, rows[2], &matched_suggestions, input_trimmed);
        render_input(frame, rows[3], state);
        rows[3]
    } else {
        render_input(frame, rows[2], state);
        rows[2]
    };

    render_status_bar(frame, *rows.last().unwrap(), state);

    // Render popups over the dashboard if active
    render_popups(frame, inner, state);

    if state.focus == FocusPane::Input
        && !state.exit_pending
        && state.active_modal == ActiveModal::None
    {
        let input_inner = input_area.inner(Margin {
            vertical: 1,
            horizontal: 1,
        });
        let prompt_width = 2_u16;
        let visible_width = input_inner.width.saturating_sub(prompt_width);
        let visible = visible_input_window(state.input.as_str(), state.input_cursor, visible_width);
        frame.set_cursor_position((
            input_inner.x + prompt_width + visible.cursor_width,
            input_inner.y,
        ));
    }
}

fn centered_rect(percent_x: u16, percent_y: u16, r: Rect) -> Rect {
    let popup_layout = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Percentage((100 - percent_y) / 2),
            Constraint::Percentage(percent_y),
            Constraint::Percentage((100 - percent_y) / 2),
        ])
        .split(r);

    Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Percentage((100 - percent_x) / 2),
            Constraint::Percentage(percent_x),
            Constraint::Percentage((100 - percent_x) / 2),
        ])
        .split(popup_layout[1])[1]
}

fn render_popups(frame: &mut Frame<'_>, area: Rect, state: &DashboardState) {
    use crate::theme::*;
    use ratatui::style::{Modifier, Style};
    use ratatui::text::{Line, Span};
    use ratatui::widgets::{Block, BorderType, Borders, Clear, List, ListItem, Paragraph, Wrap};

    if state.active_modal == ActiveModal::None {
        return;
    }

    let popup_area = centered_rect(70, 70, area);
    frame.render_widget(Clear, popup_area);

    let modal_title = match state.active_modal {
        ActiveModal::Help => " ❓ HELP & KEYBINDINGS ",
        ActiveModal::ModelSelector => " 🤖 SELECT ACTIVE MODEL ",
        ActiveModal::SessionSwitcher => " 📂 SWITCH SESSION / TRACE ",
        ActiveModal::StepInspector => " 🔍 STEP DETAIL INSPECTOR ",
        ActiveModal::None => "",
    };

    let block = Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Double)
        .border_style(Style::default().fg(COLOR_BORDER_FOCUS))
        .title(Span::styled(
            modal_title,
            Style::default()
                .fg(COLOR_ACTIVE)
                .add_modifier(Modifier::BOLD),
        ));

    let inner_area = block.inner(popup_area);
    frame.render_widget(block, popup_area);

    match state.active_modal {
        ActiveModal::Help => {
            let help_text = vec![
                Line::from(vec![Span::styled(
                    "ForgeOne TUI Controller Help",
                    Style::default().add_modifier(Modifier::BOLD).fg(COLOR_PINK),
                )]),
                Line::from(""),
                Line::from(vec![
                    Span::styled(
                        " ⇥ Tab ",
                        Style::default()
                            .bg(COLOR_SURFACE0)
                            .fg(COLOR_BLUE)
                            .add_modifier(Modifier::BOLD),
                    ),
                    Span::raw(" Cycle focus between Chat Panel, Monitor Panel, and Input Box."),
                ]),
                Line::from(vec![
                    Span::styled(
                        " ⇅ Up/Down ",
                        Style::default()
                            .bg(COLOR_SURFACE0)
                            .fg(COLOR_BLUE)
                            .add_modifier(Modifier::BOLD),
                    ),
                    Span::raw(" Scroll Chat logs or navigate Monitor steps."),
                ]),
                Line::from(vec![
                    Span::styled(
                        " ⎋ Esc ",
                        Style::default()
                            .bg(COLOR_SURFACE0)
                            .fg(COLOR_BLUE)
                            .add_modifier(Modifier::BOLD),
                    ),
                    Span::raw(" Clear current prompt input / Close any popup modal."),
                ]),
                Line::from(vec![
                    Span::styled(
                        " ⌃C Ctrl+C ",
                        Style::default()
                            .bg(COLOR_SURFACE0)
                            .fg(COLOR_RED)
                            .add_modifier(Modifier::BOLD),
                    ),
                    Span::raw(" Confirm exit (press twice to terminate)."),
                ]),
                Line::from(""),
                Line::from(vec![Span::styled(
                    "Global Popup Modals:",
                    Style::default()
                        .add_modifier(Modifier::BOLD)
                        .fg(COLOR_GREEN),
                )]),
                Line::from(vec![
                    Span::styled(
                        " ⌃H Ctrl+H ",
                        Style::default()
                            .bg(COLOR_SURFACE0)
                            .fg(COLOR_YELLOW)
                            .add_modifier(Modifier::BOLD),
                    ),
                    Span::raw(" Open this Help menu."),
                ]),
                Line::from(vec![
                    Span::styled(
                        " ⌃M Ctrl+M / ⌃G Ctrl+G ",
                        Style::default()
                            .bg(COLOR_SURFACE0)
                            .fg(COLOR_YELLOW)
                            .add_modifier(Modifier::BOLD),
                    ),
                    Span::raw(" Open Model Selector (switch active LLM)."),
                ]),
                Line::from(vec![
                    Span::styled(
                        " ⌃S Ctrl+S / ⌃O Ctrl+O ",
                        Style::default()
                            .bg(COLOR_SURFACE0)
                            .fg(COLOR_YELLOW)
                            .add_modifier(Modifier::BOLD),
                    ),
                    Span::raw(" Open Session Switcher (browse & load history traces)."),
                ]),
                Line::from(""),
                Line::from(vec![Span::styled(
                    "Monitor Panel Inspector:",
                    Style::default().add_modifier(Modifier::BOLD).fg(COLOR_TEAL),
                )]),
                Line::from(" When focused on the Monitor Panel, use Up/Down to navigate items."),
                Line::from(" Press Enter on a Step, Agent, or Tool node to view full details."),
            ];
            let paragraph = Paragraph::new(help_text).wrap(Wrap { trim: false });
            frame.render_widget(paragraph, inner_area);
        }
        ActiveModal::ModelSelector => {
            let mut items = Vec::new();
            for (i, m) in state.modal_models.iter().enumerate() {
                let style = if i == state.modal_selected_index {
                    Style::default()
                        .bg(COLOR_SELECTED_BG)
                        .fg(COLOR_GREEN)
                        .add_modifier(Modifier::BOLD)
                } else {
                    Style::default().fg(COLOR_TITLE)
                };
                let prefix = if i == state.modal_selected_index {
                    "▶ "
                } else {
                    "  "
                };
                items.push(ListItem::new(Span::styled(
                    format!("{}{}", prefix, m),
                    style,
                )));
            }
            let list = List::new(items);
            frame.render_widget(list, inner_area);
        }
        ActiveModal::SessionSwitcher => {
            let mut items = Vec::new();
            if state.modal_sessions.is_empty() {
                items.push(ListItem::new(Span::styled(
                    "  No session history files found.",
                    Style::default()
                        .fg(COLOR_MUTED)
                        .add_modifier(Modifier::ITALIC),
                )));
            } else {
                for (i, s) in state.modal_sessions.iter().enumerate() {
                    let style = if i == state.modal_selected_index {
                        Style::default()
                            .bg(COLOR_SELECTED_BG)
                            .fg(COLOR_GREEN)
                            .add_modifier(Modifier::BOLD)
                    } else {
                        Style::default().fg(COLOR_TITLE)
                    };
                    let prefix = if i == state.modal_selected_index {
                        "▶ "
                    } else {
                        "  "
                    };
                    let task_preview = if s.task_input.len() > 30 {
                        format!("{}...", &s.task_input[..30])
                    } else {
                        s.task_input.clone()
                    };
                    items.push(ListItem::new(Span::styled(
                        format!(
                            "{}{} [{}] loops={} task=\"{}\"",
                            prefix, s.session_id, s.status, s.loop_index, task_preview
                        ),
                        style,
                    )));
                }
            }
            let list = List::new(items);
            frame.render_widget(list, inner_area);
        }
        ActiveModal::StepInspector => {
            let mut inspector_lines = Vec::new();
            for line in &state.inspector_content {
                inspector_lines.push(Line::from(Span::styled(
                    line.as_str(),
                    Style::default().fg(COLOR_TITLE),
                )));
            }
            let paragraph = Paragraph::new(inspector_lines).wrap(Wrap { trim: false });
            frame.render_widget(paragraph, inner_area);
        }
        _ => {}
    }
}
