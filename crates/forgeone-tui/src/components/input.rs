use ratatui::Frame;
use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, BorderType, Borders, Paragraph};
use unicode_width::{UnicodeWidthChar, UnicodeWidthStr};

use crate::state::{DashboardState, FocusPane, PasteBadge};
use crate::theme::*;

pub fn render_input(frame: &mut Frame<'_>, area: Rect, state: &DashboardState) {
    let is_focused = state.focus == FocusPane::Input;
    let border_style = if is_focused {
        Style::default().fg(COLOR_BORDER_FOCUS)
    } else {
        Style::default().fg(COLOR_BORDER)
    };

    let block = Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .border_style(border_style)
        .title(Span::styled(
            " 💬 PROMPT INPUT ",
            Style::default()
                .fg(if is_focused { COLOR_BLUE } else { COLOR_TITLE })
                .add_modifier(Modifier::BOLD),
        ));

    let inner = block.inner(area);
    let visible_input_width = inner.width.saturating_sub(2);

    let content = if state.exit_pending {
        Line::from(vec![Span::styled(
            " Press Ctrl+C again to exit, or Esc to cancel ",
            Style::default()
                .bg(COLOR_RED)
                .fg(COLOR_CRUST)
                .add_modifier(Modifier::BOLD),
        )])
    } else if state.input.is_empty() && !state.paste_badges.is_empty() {
        render_input_line(
            "",
            &state.paste_badges,
            visible_input_width,
            false,
            state.hint.as_str(),
        )
    } else if state.input.is_empty() {
        render_input_line(
            "",
            &state.paste_badges,
            visible_input_width,
            true,
            state.hint.as_str(),
        )
    } else {
        let visible = visible_input_window(
            state.input.as_str(),
            state.input_cursor,
            visible_input_width,
        );
        render_input_line(
            visible.text.as_str(),
            &state.paste_badges,
            visible_input_width,
            false,
            state.hint.as_str(),
        )
    };

    let paragraph = Paragraph::new(content).block(block);
    frame.render_widget(paragraph, area);
}

pub fn render_suggestions(frame: &mut Frame<'_>, area: Rect, matched: &[&str], input: &str) {
    let block = Block::default()
        .borders(Borders::ALL)
        .border_type(BorderType::Rounded)
        .border_style(Style::default().fg(COLOR_BORDER_FOCUS))
        .title(Span::styled(
            " 💡 COMMAND SUGGESTIONS ",
            Style::default()
                .fg(COLOR_ACTIVE)
                .add_modifier(Modifier::BOLD),
        ));

    let mut lines = Vec::new();
    for cmd in matched {
        let (matched_part, remaining_part) = if cmd.starts_with(input) {
            (&cmd[..input.len()], &cmd[input.len()..])
        } else {
            ("", *cmd)
        };

        lines.push(Line::from(vec![
            Span::styled("  • ", Style::default().fg(COLOR_MUTED)),
            Span::styled(
                matched_part,
                Style::default()
                    .fg(COLOR_ACTIVE)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::styled(remaining_part, Style::default().fg(COLOR_TITLE)),
        ]));
    }

    let paragraph = Paragraph::new(lines).block(block);
    frame.render_widget(paragraph, area);
}

fn render_input_line(
    visible_input: &str,
    paste_badges: &[PasteBadge],
    max_width: u16,
    is_hint: bool,
    hint: &str,
) -> Line<'static> {
    let mut spans = vec![Span::styled(
        "> ",
        Style::default()
            .fg(COLOR_HEADER_ACCENT)
            .add_modifier(Modifier::BOLD),
    )];

    if is_hint {
        spans.push(Span::styled(
            hint.to_string(),
            Style::default()
                .fg(COLOR_HINT)
                .add_modifier(Modifier::ITALIC),
        ));
        return Line::from(spans);
    }

    spans.push(Span::styled(
        visible_input.to_string(),
        Style::default().fg(COLOR_TITLE),
    ));

    let used_width =
        2_u16 + UnicodeWidthStr::width(visible_input).min(usize::from(u16::MAX)) as u16;
    let badge_budget = max_width.saturating_sub(used_width);
    let badge_spans = render_paste_badges(paste_badges, badge_budget);
    spans.extend(badge_spans);
    Line::from(spans)
}

fn render_paste_badges(paste_badges: &[PasteBadge], max_width: u16) -> Vec<Span<'static>> {
    if paste_badges.is_empty() || max_width < 4 {
        return Vec::new();
    }

    let mut spans = Vec::new();
    let mut used_width = 0_u16;

    for badge in paste_badges {
        let label = format!(" 📋 {} ch, {} ln ", badge.chars, badge.lines);
        let label_width = UnicodeWidthStr::width(label.as_str()).min(usize::from(u16::MAX)) as u16;
        let required = label_width + 1;
        if used_width + required > max_width {
            break;
        }

        spans.push(Span::raw(" "));
        spans.push(Span::styled(
            label,
            Style::default()
                .fg(COLOR_CRUST)
                .bg(COLOR_PINK)
                .add_modifier(Modifier::BOLD),
        ));
        used_width += required;
    }

    spans
}

pub struct VisibleInputWindow {
    pub text: String,
    pub cursor_width: u16,
}

pub fn visible_input_window(
    input: &str,
    cursor_char_index: usize,
    max_width: u16,
) -> VisibleInputWindow {
    if max_width == 0 {
        return VisibleInputWindow {
            text: String::new(),
            cursor_width: 0,
        };
    }

    let chars = input.chars().collect::<Vec<_>>();
    let len = chars.len();
    let cursor = cursor_char_index.min(len);

    let total_width = chars
        .iter()
        .map(|ch| UnicodeWidthChar::width(*ch).unwrap_or(0).min(2) as u16)
        .sum::<u16>();
    if total_width <= max_width {
        return VisibleInputWindow {
            text: input.to_string(),
            cursor_width: chars[..cursor]
                .iter()
                .map(|ch| UnicodeWidthChar::width(*ch).unwrap_or(0).min(2) as u16)
                .sum(),
        };
    }

    let mut start = cursor;
    let mut used_width = 0_u16;
    while start > 0 {
        let width = UnicodeWidthChar::width(chars[start - 1])
            .unwrap_or(0)
            .min(2) as u16;
        if used_width + width > max_width {
            break;
        }
        start -= 1;
        used_width += width;
    }

    let mut end = cursor;
    while end < len {
        let width = UnicodeWidthChar::width(chars[end]).unwrap_or(0).min(2) as u16;
        if used_width + width > max_width {
            break;
        }
        used_width += width;
        end += 1;
    }

    let text = chars[start..end].iter().collect::<String>();
    let cursor_width = chars[start..cursor]
        .iter()
        .map(|ch| UnicodeWidthChar::width(*ch).unwrap_or(0).min(2) as u16)
        .sum::<u16>();

    VisibleInputWindow { text, cursor_width }
}
