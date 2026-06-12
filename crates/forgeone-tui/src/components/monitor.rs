use ratatui::Frame;
use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, BorderType, Borders, Paragraph};

use crate::state::{DashboardState, FocusPane, LoopStepState};
use crate::theme::*;

pub fn render_monitor(frame: &mut Frame<'_>, area: Rect, state: &DashboardState) {
    let is_focused = state.focus == FocusPane::Monitor;

    // Main outer block for the panel
    let outer_block = Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .border_style(if is_focused {
            Style::default().fg(COLOR_BORDER_FOCUS)
        } else {
            Style::default().fg(COLOR_BORDER)
        })
        .title(Span::styled(
            " 📊 MONITOR PANEL ",
            Style::default()
                .fg(if is_focused { COLOR_BLUE } else { COLOR_TITLE })
                .add_modifier(Modifier::BOLD),
        ));

    let inner = outer_block.inner(area);
    frame.render_widget(outer_block, area);

    // Layout inside the panel (4 sections)
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Percentage(25), // Active Agents
            Constraint::Percentage(35), // Loop Steps
            Constraint::Percentage(18), // Runtime summary
            Constraint::Percentage(22), // Tool Stats
        ])
        .split(inner);

    // 1. Render Active Agents Tree
    let mut agent_lines = vec![Line::from(Span::styled(
        "👤 ACTIVE AGENTS",
        Style::default().fg(COLOR_PINK).add_modifier(Modifier::BOLD),
    ))];
    for (i, agent) in state.agents.iter().enumerate() {
        let is_selected = is_focused && (i == state.monitor_selected_index);
        let patch_style = if is_selected {
            Style::default().bg(COLOR_SELECTED_BG)
        } else {
            Style::default()
        };

        let prefix = match agent.depth {
            0 => " ",
            1 => "  ├─ ",
            _ => "    └─ ",
        };
        let mut spans = vec![Span::styled(prefix, Style::default().fg(COLOR_MUTED))];
        if agent.is_selected {
            spans.push(Span::styled(
                "▶ ",
                Style::default()
                    .fg(COLOR_GREEN)
                    .add_modifier(Modifier::BOLD),
            ));
            spans.push(Span::styled(
                &agent.label,
                Style::default()
                    .fg(COLOR_TITLE)
                    .add_modifier(Modifier::BOLD),
            ));
        } else {
            spans.push(Span::styled("  ", Style::default().fg(COLOR_MUTED)));
            spans.push(Span::styled(
                &agent.label,
                Style::default().fg(COLOR_SUBTEXT0),
            ));
        }

        if is_selected {
            for span in &mut spans {
                span.style = span.style.patch(patch_style);
            }
        }
        agent_lines.push(Line::from(spans));
    }
    frame.render_widget(Paragraph::new(agent_lines), chunks[0]);

    // 2. Render Loop Progress & Steps
    let (current, total) = if let Some((c_str, t_str)) = state.loop_progress.split_once('/') {
        let c = c_str.trim().parse::<usize>().unwrap_or(0);
        let t = t_str.trim().parse::<usize>().unwrap_or(1);
        (c, t)
    } else {
        (0, 1)
    };
    let bar_width = 10;
    let filled = if total > 0 {
        (current * bar_width) / total
    } else {
        0
    };
    let filled = filled.min(bar_width);
    let empty = bar_width.saturating_sub(filled);
    let bar_str = format!("[{}{}]", "█".repeat(filled), "░".repeat(empty));

    let mut loop_lines = vec![
        Line::from(Span::styled(
            "🔄 LOOP PROGRESS",
            Style::default().fg(COLOR_PINK).add_modifier(Modifier::BOLD),
        )),
        Line::from(vec![
            Span::styled(format!("  {}  ", bar_str), Style::default().fg(COLOR_GREEN)),
            Span::styled(
                format!("{}/{}  ", current, total),
                Style::default().fg(COLOR_SUBTEXT1),
            ),
            Span::styled(
                state.runtime_status.to_uppercase(),
                Style::default()
                    .fg(if state.runtime_status == "running" {
                        COLOR_GREEN
                    } else {
                        COLOR_YELLOW
                    })
                    .add_modifier(Modifier::BOLD),
            ),
        ]),
    ];
    for (i, step) in state.steps.iter().enumerate() {
        let is_selected = is_focused && (state.agents.len() + i == state.monitor_selected_index);
        let patch_style = if is_selected {
            Style::default().bg(COLOR_SELECTED_BG)
        } else {
            Style::default()
        };

        let (marker, step_style) = match step.state {
            LoopStepState::Completed => ("✓", Style::default().fg(COLOR_SUCCESS)),
            LoopStepState::Active => (
                "▶",
                Style::default()
                    .fg(COLOR_ACTIVE)
                    .add_modifier(Modifier::BOLD),
            ),
            LoopStepState::Pending => ("○", Style::default().fg(COLOR_MUTED)),
        };
        let mut spans = vec![
            Span::raw("  "),
            Span::styled(marker, step_style),
            Span::raw(" "),
            Span::styled(step.label.as_str(), step_style),
        ];

        if is_selected {
            for span in &mut spans {
                span.style = span.style.patch(patch_style);
            }
        }
        loop_lines.push(Line::from(spans));
    }
    frame.render_widget(Paragraph::new(loop_lines), chunks[1]);

    // 3. Render Runtime Summary
    let runtime_selected =
        is_focused && (state.agents.len() + state.steps.len() == state.monitor_selected_index);
    let patch_style = if runtime_selected {
        Style::default().bg(COLOR_SELECTED_BG)
    } else {
        Style::default()
    };

    let mut last_tool_spans = vec![
        Span::styled("  Last Tool: ", Style::default().fg(COLOR_MUTED)),
        Span::styled(
            state.last_tool.as_str(),
            Style::default()
                .fg(COLOR_TITLE)
                .add_modifier(Modifier::BOLD),
        ),
    ];
    let mut budget_spans = vec![
        Span::styled("  Budget:    ", Style::default().fg(COLOR_MUTED)),
        Span::styled(
            state.budget_text.as_str(),
            Style::default().fg(COLOR_TEAL).add_modifier(Modifier::BOLD),
        ),
    ];

    if runtime_selected {
        for span in &mut last_tool_spans {
            span.style = span.style.patch(patch_style);
        }
        for span in &mut budget_spans {
            span.style = span.style.patch(patch_style);
        }
    }

    let runtime_lines = vec![
        Line::from(Span::styled(
            "💻 RUNTIME INFO",
            Style::default().fg(COLOR_PINK).add_modifier(Modifier::BOLD),
        )),
        Line::from(last_tool_spans),
        Line::from(budget_spans),
    ];
    frame.render_widget(Paragraph::new(runtime_lines), chunks[2]);

    // 4. Render Tool Statistics
    let mut tool_lines = vec![Line::from(Span::styled(
        "🛠️  TOOL STATISTICS",
        Style::default().fg(COLOR_PINK).add_modifier(Modifier::BOLD),
    ))];
    if state.tool_stats.is_empty() {
        tool_lines.push(Line::from(Span::styled(
            "  No tools used yet.",
            Style::default()
                .fg(COLOR_MUTED)
                .add_modifier(Modifier::ITALIC),
        )));
    } else {
        for (i, tool) in state.tool_stats.iter().enumerate() {
            let is_selected = is_focused
                && (state.agents.len() + state.steps.len() + 1 + i == state.monitor_selected_index);
            let patch_style = if is_selected {
                Style::default().bg(COLOR_SELECTED_BG)
            } else {
                Style::default()
            };

            let mut parts = vec![Span::styled(
                format!("  {:<12} ", tool.tool_name),
                Style::default().fg(COLOR_TITLE),
            )];
            if tool.success_count > 0 {
                parts.push(Span::styled(
                    format!("✓ {} ", tool.success_count),
                    Style::default()
                        .fg(COLOR_SUCCESS)
                        .add_modifier(Modifier::BOLD),
                ));
            }
            if tool.failure_count > 0 {
                parts.push(Span::styled(
                    format!("✗ {} ", tool.failure_count),
                    Style::default()
                        .fg(COLOR_ERROR)
                        .add_modifier(Modifier::BOLD),
                ));
            }
            if tool.success_count == 0 && tool.failure_count == 0 {
                parts.push(Span::styled("- 0 ", Style::default().fg(COLOR_MUTED)));
            }

            if is_selected {
                for span in &mut parts {
                    span.style = span.style.patch(patch_style);
                }
            }
            tool_lines.push(Line::from(parts));
        }
    }
    frame.render_widget(Paragraph::new(tool_lines), chunks[3]);
}
