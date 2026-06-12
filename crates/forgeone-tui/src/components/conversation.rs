use ratatui::Frame;
use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, BorderType, Borders, Paragraph, Wrap};

use crate::state::{DashboardState, FocusPane};
use crate::theme::*;

pub fn render_conversation(frame: &mut Frame<'_>, area: Rect, state: &DashboardState) {
    let is_focused = state.focus == FocusPane::Chat;

    let mut lines = Vec::new();
    // Add initial spacing
    lines.push(Line::from(""));

    for block in &state.chat_blocks {
        // Render User Header
        lines.push(Line::from(vec![
            Span::styled(
                " 👤 USER ",
                Style::default()
                    .bg(COLOR_BLUE)
                    .fg(COLOR_CRUST)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::styled(
                format!(" [{}] ", block.timestamp),
                Style::default().fg(COLOR_MUTED),
            ),
            Span::styled("─".repeat(40), Style::default().fg(COLOR_SURFACE1)),
        ]));
        // Render User Text
        lines.push(Line::from(Span::styled(
            format!("  {}", block.user_text),
            Style::default().fg(COLOR_TITLE),
        )));
        lines.push(Line::from(""));

        // Render Agent Header
        lines.push(Line::from(vec![
            Span::styled(
                " 🤖 AGENT ",
                Style::default()
                    .bg(COLOR_MAUVE)
                    .fg(COLOR_CRUST)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::styled("─".repeat(47), Style::default().fg(COLOR_SURFACE1)),
        ]));

        // Render Tool Call if active
        if !block.tool_name.is_empty() && block.tool_name != "none" {
            lines.push(Line::from(vec![
                Span::styled(
                    "  🛠️  [",
                    Style::default().fg(COLOR_TOOL).add_modifier(Modifier::BOLD),
                ),
                Span::styled(
                    &block.tool_name,
                    Style::default().fg(COLOR_TOOL).add_modifier(Modifier::BOLD),
                ),
                Span::styled("] → ", Style::default().fg(COLOR_MUTED)),
                Span::styled(&block.tool_summary, Style::default().fg(COLOR_TEXT)),
            ]));
            lines.push(Line::from(""));
        }

        // Render Assistant text
        let mut in_code_block = false;
        for entry in &block.assistant_lines {
            let trimmed = entry.trim();
            if trimmed.starts_with("```") {
                in_code_block = !in_code_block;
                let lang = trimmed.strip_prefix("```").unwrap_or("").trim();
                let display_lang = if lang.is_empty() { "CODE" } else { lang };
                if in_code_block {
                    lines.push(Line::from(vec![
                        Span::raw("  "),
                        Span::styled(format!("╭── {} ──────────────────────────────────────────", display_lang.to_uppercase()), Style::default().fg(COLOR_MUTED)),
                    ]));
                } else {
                    lines.push(Line::from(vec![
                        Span::raw("  "),
                        Span::styled("╰────────────────────────────────────────────────", Style::default().fg(COLOR_MUTED)),
                    ]));
                }
            } else {
                if in_code_block {
                    lines.push(Line::from(vec![
                        Span::raw("  "),
                        Span::styled("│ ", Style::default().fg(COLOR_MUTED)),
                        Span::styled(entry.as_str(), Style::default().fg(COLOR_TEAL).bg(COLOR_SURFACE0)),
                    ]));
                } else {
                    lines.push(Line::from(vec![
                        Span::raw("  "),
                        Span::styled(entry.as_str(), Style::default().fg(COLOR_TEXT)),
                    ]));
                }
            }
        }
        lines.push(Line::from(""));
    }

    // Render Pending Approval warning box
    if let Some(approval) = &state.pending_approval {
        lines.push(Line::from(""));
        lines.push(Line::from(vec![
            Span::styled(
                " ⚠️  PENDING APPROVAL ",
                Style::default()
                    .bg(COLOR_YELLOW)
                    .fg(COLOR_CRUST)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::styled("─".repeat(36), Style::default().fg(COLOR_YELLOW)),
        ]));
        lines.push(Line::from(Span::styled(
            "  The agent requested authorization to run a tool:",
            Style::default().fg(COLOR_TEXT),
        )));
        lines.push(Line::from(""));
        lines.push(Line::from(vec![
            Span::styled(
                "    Tool:   ",
                Style::default()
                    .fg(COLOR_YELLOW)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::styled(
                &approval.tool_name,
                Style::default()
                    .fg(COLOR_TITLE)
                    .add_modifier(Modifier::BOLD),
            ),
        ]));
        lines.push(Line::from(vec![
            Span::styled(
                "    Args:   ",
                Style::default()
                    .fg(COLOR_YELLOW)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::styled(&approval.argument_summary, Style::default().fg(COLOR_TEXT)),
        ]));
        lines.push(Line::from(vec![
            Span::styled(
                "    Reason: ",
                Style::default()
                    .fg(COLOR_YELLOW)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::styled(&approval.reason, Style::default().fg(COLOR_TEXT)),
        ]));
        lines.push(Line::from(""));
        lines.push(Line::from(vec![
            Span::styled("  👉 Enter ", Style::default().fg(COLOR_GREEN)),
            Span::styled(
                "/approve",
                Style::default()
                    .fg(COLOR_GREEN)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::styled(
                " to authorize execution, or ",
                Style::default().fg(COLOR_TEXT),
            ),
            Span::styled(
                "/deny",
                Style::default().fg(COLOR_RED).add_modifier(Modifier::BOLD),
            ),
            Span::styled(" to cancel.", Style::default().fg(COLOR_TEXT)),
        ]));
        lines.push(Line::from(Span::styled(
            "─".repeat(58),
            Style::default().fg(COLOR_YELLOW),
        )));
    }

    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Min(0)])
        .split(area);

    let content_len = lines.len();
    let display_height = chunks[0].height.saturating_sub(2) as usize; // Account for block borders
    let max_scroll = content_len.saturating_sub(display_height);
    let scroll = state.chat_scroll.min(max_scroll);

    // Setup border details
    let mut title_spans = vec![
        Span::styled(
            " 💬 CONVERSATION LOG ",
            Style::default()
                .fg(if is_focused { COLOR_BLUE } else { COLOR_TITLE })
                .add_modifier(Modifier::BOLD),
        ),
        Span::styled(
            format!("(Model: {})", state.active_model),
            Style::default().fg(COLOR_MUTED),
        ),
    ];
    if scroll > 0 {
        title_spans.push(Span::styled(
            format!(" [Scroll: {}]", scroll),
            Style::default().fg(COLOR_ACTIVE),
        ));
    }

    let block = Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .border_style(if is_focused {
            Style::default().fg(COLOR_BORDER_FOCUS)
        } else {
            Style::default().fg(COLOR_BORDER)
        })
        .title(Line::from(title_spans));

    let paragraph = Paragraph::new(lines)
        .block(block)
        .scroll((scroll as u16, 0))
        .wrap(Wrap { trim: false });

    frame.render_widget(paragraph, chunks[0]);
}
