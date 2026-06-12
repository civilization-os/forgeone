use ratatui::Frame;
use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::Paragraph;

use crate::state::DashboardState;
use crate::theme::*;

pub fn render_status_bar(frame: &mut Frame<'_>, area: Rect, _state: &DashboardState) {
    let style = Style::default().bg(COLOR_MANTLE).fg(COLOR_TEXT);

    let parts = vec![
        Span::raw(" "),
        Span::styled(
            " ⇥ Tab ",
            Style::default()
                .bg(COLOR_BLUE)
                .fg(COLOR_CRUST)
                .add_modifier(Modifier::BOLD),
        ),
        Span::styled(" Focus Pane  ", Style::default().fg(COLOR_TEXT)),
        Span::styled(
            " ⇅ Up/Down ",
            Style::default()
                .bg(COLOR_MAUVE)
                .fg(COLOR_CRUST)
                .add_modifier(Modifier::BOLD),
        ),
        Span::styled(" Scroll Chat  ", Style::default().fg(COLOR_TEXT)),
        Span::styled(
            " ⎋ Esc ",
            Style::default()
                .bg(COLOR_YELLOW)
                .fg(COLOR_CRUST)
                .add_modifier(Modifier::BOLD),
        ),
        Span::styled(" Clear Input  ", Style::default().fg(COLOR_TEXT)),
        Span::styled(
            " ⌃C Ctrl+C ",
            Style::default()
                .bg(COLOR_RED)
                .fg(COLOR_CRUST)
                .add_modifier(Modifier::BOLD),
        ),
        Span::styled(" Exit  ", Style::default().fg(COLOR_TEXT)),
        Span::styled(
            " / ",
            Style::default()
                .bg(COLOR_PINK)
                .fg(COLOR_CRUST)
                .add_modifier(Modifier::BOLD),
        ),
        Span::styled(" Slash Commands ", Style::default().fg(COLOR_TEXT)),
    ];

    let line = Line::from(parts).alignment(ratatui::layout::Alignment::Left);
    let paragraph = Paragraph::new(line).style(style);
    frame.render_widget(paragraph, area);
}
