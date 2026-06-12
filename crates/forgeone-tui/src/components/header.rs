use ratatui::Frame;
use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Paragraph};

use crate::state::DashboardState;
use crate::theme::*;

pub fn render_header(frame: &mut Frame<'_>, area: Rect, state: &DashboardState) {
    let header_block = Block::default()
        .borders(Borders::BOTTOM)
        .border_style(Style::default().fg(COLOR_BORDER));

    let inner = header_block.inner(area);
    frame.render_widget(header_block, area);

    let line = Line::from(vec![
        Span::styled(
            " ForgeOne ",
            Style::default()
                .bg(COLOR_PINK)
                .fg(COLOR_CRUST)
                .add_modifier(Modifier::BOLD),
        ),
        Span::styled(
            format!(" {} ", state.version),
            Style::default().bg(COLOR_SURFACE0).fg(COLOR_TEXT),
        ),
        Span::raw("  "),
        Span::styled(
            " 🆔 SESSION ",
            Style::default()
                .bg(COLOR_BLUE)
                .fg(COLOR_CRUST)
                .add_modifier(Modifier::BOLD),
        ),
        Span::styled(
            format!(" {} ", state.session_id),
            Style::default().bg(COLOR_SURFACE0).fg(COLOR_TEXT),
        ),
        Span::raw("  "),
        Span::styled(
            " 🎯 FOCUS ",
            Style::default()
                .bg(COLOR_GREEN)
                .fg(COLOR_CRUST)
                .add_modifier(Modifier::BOLD),
        ),
        Span::styled(
            format!(" {} ", state.focus.label().to_uppercase()),
            Style::default().bg(COLOR_SURFACE0).fg(COLOR_TEXT),
        ),
        Span::raw("  "),
        Span::styled(
            " 🚪 EXIT ",
            Style::default()
                .bg(if state.exit_pending {
                    COLOR_RED
                } else {
                    COLOR_SURFACE1
                })
                .fg(COLOR_CRUST)
                .add_modifier(Modifier::BOLD),
        ),
        Span::styled(
            if state.exit_pending {
                " CONFIRM "
            } else {
                " IDLE "
            },
            Style::default()
                .bg(COLOR_SURFACE0)
                .fg(if state.exit_pending {
                    COLOR_RED
                } else {
                    COLOR_TEXT
                }),
        ),
    ]);

    frame.render_widget(Paragraph::new(line), inner);
}
