use ratatui::Frame;
use ratatui::layout::{Constraint, Direction, Layout, Margin, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Paragraph, Wrap};
use unicode_width::{UnicodeWidthChar, UnicodeWidthStr};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FocusPane {
    Chat,
    Monitor,
    Input,
}

impl FocusPane {
    pub fn next(self) -> Self {
        match self {
            Self::Chat => Self::Monitor,
            Self::Monitor => Self::Input,
            Self::Input => Self::Chat,
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Chat => "chat",
            Self::Monitor => "monitor",
            Self::Input => "input",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LoopStepState {
    Completed,
    Active,
    Pending,
}

impl LoopStepState {
    fn marker(self) -> &'static str {
        match self {
            Self::Completed => "[x]",
            Self::Active => "[>]",
            Self::Pending => "[ ]",
        }
    }
}

#[derive(Debug, Clone)]
pub struct LoopStepView {
    pub label: String,
    pub state: LoopStepState,
}

#[derive(Debug, Clone)]
pub struct AgentTreeItem {
    pub label: String,
    pub depth: u16,
    pub is_selected: bool,
}

#[derive(Debug, Clone)]
pub struct ToolStatView {
    pub tool_name: String,
    pub success_count: u32,
    pub failure_count: u32,
}

#[derive(Debug, Clone)]
pub struct ChatBlockView {
    pub timestamp: String,
    pub user_text: String,
    pub tool_name: String,
    pub tool_summary: String,
    pub assistant_lines: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct PasteBadge {
    pub chars: usize,
    pub lines: usize,
}

impl PasteBadge {
    pub fn from_content(content: &str) -> Self {
        Self {
            chars: content.chars().count(),
            lines: content.lines().count().max(1),
        }
    }

    pub fn label(&self) -> String {
        format!("[TEXT {} chars {} lines ⧉]", self.chars, self.lines)
    }
}

#[derive(Debug, Clone)]
pub struct DashboardState {
    pub version: String,
    pub session_id: String,
    pub focus: FocusPane,
    pub agent_name: String,
    pub loop_progress: String,
    pub runtime_status: String,
    pub steps: Vec<LoopStepView>,
    pub last_tool: String,
    pub budget_text: String,
    pub agents: Vec<AgentTreeItem>,
    pub tool_stats: Vec<ToolStatView>,
    pub chat_blocks: Vec<ChatBlockView>,
    pub input: String,
    pub input_cursor: usize,
    pub paste_badges: Vec<PasteBadge>,
    pub hint: String,
    pub exit_pending: bool,
}

const COLOR_BORDER: Color = Color::Rgb(92, 102, 128);
const COLOR_BORDER_FOCUS: Color = Color::Rgb(110, 168, 255);
const COLOR_TITLE: Color = Color::Rgb(198, 208, 230);
const COLOR_HEADER_ACCENT: Color = Color::Rgb(135, 206, 250);
const COLOR_SELECTED_BG: Color = Color::Rgb(38, 53, 82);
const COLOR_SELECTED_FG: Color = Color::Rgb(240, 244, 255);
const COLOR_SUCCESS: Color = Color::Rgb(120, 196, 140);
const COLOR_ACTIVE: Color = Color::Rgb(255, 196, 107);
const COLOR_MUTED: Color = Color::Rgb(140, 150, 170);
const COLOR_HINT: Color = Color::Rgb(168, 178, 198);
const COLOR_TOOL: Color = Color::Rgb(198, 160, 255);

impl DashboardState {
    pub fn mock() -> Self {
        Self {
            version: "v0.1.0".to_string(),
            session_id: "s-xxx".to_string(),
            focus: FocusPane::Input,
            agent_name: "root".to_string(),
            loop_progress: "2/10".to_string(),
            runtime_status: "running".to_string(),
            steps: vec![
                LoopStepView {
                    label: "ContextBuild".to_string(),
                    state: LoopStepState::Completed,
                },
                LoopStepView {
                    label: "ModelRequest".to_string(),
                    state: LoopStepState::Active,
                },
                LoopStepView {
                    label: "ToolExecution".to_string(),
                    state: LoopStepState::Completed,
                },
                LoopStepView {
                    label: "StateUpdate".to_string(),
                    state: LoopStepState::Pending,
                },
            ],
            last_tool: "search_files".to_string(),
            budget_text: "1.6k/32k".to_string(),
            agents: vec![
                AgentTreeItem {
                    label: "root [active]".to_string(),
                    depth: 0,
                    is_selected: true,
                },
                AgentTreeItem {
                    label: "a1".to_string(),
                    depth: 1,
                    is_selected: false,
                },
                AgentTreeItem {
                    label: "a2".to_string(),
                    depth: 2,
                    is_selected: false,
                },
            ],
            tool_stats: vec![
                ToolStatView {
                    tool_name: "read_file".to_string(),
                    success_count: 1,
                    failure_count: 0,
                },
                ToolStatView {
                    tool_name: "search_files".to_string(),
                    success_count: 1,
                    failure_count: 0,
                },
                ToolStatView {
                    tool_name: "write_file".to_string(),
                    success_count: 0,
                    failure_count: 0,
                },
                ToolStatView {
                    tool_name: "shell".to_string(),
                    success_count: 0,
                    failure_count: 0,
                },
            ],
            chat_blocks: vec![
                ChatBlockView {
                    timestamp: "2025-03-20 14:23:01".to_string(),
                    user_text: "查找所有 Cargo.toml 文件".to_string(),
                    tool_name: "search_files".to_string(),
                    tool_summary: "10 files found".to_string(),
                    assistant_lines: vec![
                        "这个仓库有 **10** 个 crate:".to_string(),
                        "1. forgeone-cli".to_string(),
                        "2. forgeone-context".to_string(),
                        "...".to_string(),
                    ],
                },
                ChatBlockView {
                    timestamp: "2025-03-20 14:23:45".to_string(),
                    user_text: "有哪些外部依赖？".to_string(),
                    tool_name: "read_file".to_string(),
                    tool_summary: "crates/.../Cargo..".to_string(),
                    assistant_lines: vec!["外部依赖: serde, serde_json".to_string()],
                },
            ],
            input: String::new(),
            input_cursor: 0,
            paste_badges: Vec::new(),
            hint: "输入任务、追问或 /command ...".to_string(),
            exit_pending: false,
        }
    }

    pub fn append_char(&mut self, ch: char) {
        let byte_index = char_to_byte_index(self.input.as_str(), self.input_cursor);
        self.input.insert(byte_index, ch);
        self.input_cursor += 1;
    }

    pub fn backspace(&mut self) {
        if self.input_cursor == 0 {
            return;
        }
        let end = char_to_byte_index(self.input.as_str(), self.input_cursor);
        let start = char_to_byte_index(self.input.as_str(), self.input_cursor - 1);
        self.input.replace_range(start..end, "");
        self.input_cursor -= 1;
    }

    pub fn delete_forward(&mut self) {
        let len = self.input.chars().count();
        if self.input_cursor >= len {
            return;
        }
        let start = char_to_byte_index(self.input.as_str(), self.input_cursor);
        let end = char_to_byte_index(self.input.as_str(), self.input_cursor + 1);
        self.input.replace_range(start..end, "");
    }

    pub fn clear_input(&mut self) {
        self.input.clear();
        self.input_cursor = 0;
        self.paste_badges.clear();
    }

    pub fn move_cursor_left(&mut self) {
        self.input_cursor = self.input_cursor.saturating_sub(1);
    }

    pub fn move_cursor_right(&mut self) {
        self.input_cursor = (self.input_cursor + 1).min(self.input.chars().count());
    }

    pub fn move_cursor_home(&mut self) {
        self.input_cursor = 0;
    }

    pub fn move_cursor_end(&mut self) {
        self.input_cursor = self.input.chars().count();
    }

    pub fn record_paste(&mut self, content: &str) {
        self.paste_badges.push(PasteBadge::from_content(content));
    }

    pub fn arm_exit(&mut self) {
        self.exit_pending = true;
    }

    pub fn cancel_exit(&mut self) {
        self.exit_pending = false;
    }

    pub fn cycle_focus(&mut self) {
        self.focus = self.focus.next();
    }
}

pub fn render_dashboard(frame: &mut Frame<'_>, state: &DashboardState) {
    let inner = frame.area().inner(Margin {
        vertical: 0,
        horizontal: 1,
    });
    let rows = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(2),
            Constraint::Min(16),
            Constraint::Length(3),
        ])
        .split(inner);

    render_header(frame, rows[0], state);

    let body = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(70), Constraint::Percentage(30)])
        .split(rows[1]);

    render_conversation(frame, body[0], state);
    render_monitor(frame, body[1], state);
    render_input(frame, rows[2], state);

    if state.focus == FocusPane::Input && !state.exit_pending {
        let input_inner = rows[2].inner(Margin {
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

fn render_header(frame: &mut Frame<'_>, area: Rect, state: &DashboardState) {
    let header = Block::default()
        .borders(Borders::BOTTOM)
        .border_style(Style::default().fg(COLOR_BORDER));
    let inner = header.inner(area);
    frame.render_widget(header, area);

    let line = Line::from(vec![
        Span::styled(
            format!("ForgeOne  {} ", state.version),
            Style::default()
                .fg(COLOR_TITLE)
                .add_modifier(Modifier::BOLD),
        ),
        Span::styled("— ", Style::default().fg(COLOR_BORDER)),
        Span::styled("Session: ", Style::default().fg(COLOR_MUTED)),
        Span::styled(
            state.session_id.as_str(),
            Style::default()
                .fg(COLOR_HEADER_ACCENT)
                .add_modifier(Modifier::BOLD),
        ),
        Span::styled("  —  ", Style::default().fg(COLOR_BORDER)),
        Span::styled("Focus: ", Style::default().fg(COLOR_MUTED)),
        Span::styled(
            state.focus.label(),
            Style::default()
                .fg(COLOR_SUCCESS)
                .add_modifier(Modifier::BOLD),
        ),
        Span::styled("  —  ", Style::default().fg(COLOR_BORDER)),
        Span::styled("Exit: ", Style::default().fg(COLOR_MUTED)),
        Span::styled(
            if state.exit_pending {
                "confirm"
            } else {
                "idle"
            },
            Style::default()
                .fg(if state.exit_pending {
                    Color::LightRed
                } else {
                    COLOR_MUTED
                })
                .add_modifier(if state.exit_pending {
                    Modifier::BOLD
                } else {
                    Modifier::empty()
                }),
        ),
    ]);

    frame.render_widget(Paragraph::new(line), inner);
}

fn render_conversation(frame: &mut Frame<'_>, area: Rect, state: &DashboardState) {
    let border_style = pane_border_style(state.focus == FocusPane::Chat);
    let mut lines = Vec::new();

    for (index, block) in state.chat_blocks.iter().enumerate() {
        if index > 0 {
            lines.push(Line::from(""));
        }
        lines.push(Line::from(vec![
            Span::styled(
                block.timestamp.as_str(),
                Style::default().fg(COLOR_HEADER_ACCENT),
            ),
            Span::styled(" ───────────────", Style::default().fg(COLOR_BORDER)),
        ]));
        lines.push(Line::from(""));
        lines.push(Line::from(vec![
            Span::styled("你: ", Style::default().fg(COLOR_MUTED)),
            Span::styled(block.user_text.as_str(), Style::default().fg(COLOR_TITLE)),
        ]));
        lines.push(Line::from(""));
        lines.push(Line::from(vec![
            Span::styled(
                "ForgeOne ",
                Style::default()
                    .fg(COLOR_TITLE)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::styled("───────────────", Style::default().fg(COLOR_BORDER)),
        ]));
        lines.push(Line::from(vec![
            Span::styled(
                "✓",
                Style::default().fg(COLOR_TOOL).add_modifier(Modifier::BOLD),
            ),
            Span::styled(
                block.tool_name.as_str(),
                Style::default()
                    .fg(COLOR_TITLE)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::styled(" → ", Style::default().fg(COLOR_MUTED)),
            Span::styled(
                block.tool_summary.as_str(),
                Style::default().fg(COLOR_TITLE),
            ),
        ]));
        for entry in &block.assistant_lines {
            lines.push(Line::from(Span::styled(
                entry.as_str(),
                Style::default().fg(COLOR_TITLE),
            )));
        }
    }

    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(border_style);
    let paragraph = Paragraph::new(lines)
        .block(block)
        .wrap(Wrap { trim: false });
    frame.render_widget(paragraph, area);
}

fn render_monitor(frame: &mut Frame<'_>, area: Rect, state: &DashboardState) {
    let border_style = pane_border_style(state.focus == FocusPane::Monitor);
    let block = Block::default()
        .borders(Borders::ALL)
        .border_style(border_style);
    frame.render_widget(block, area);

    let inner = area.inner(Margin {
        vertical: 1,
        horizontal: 1,
    });

    let mut agent_lines = Vec::new();
    for agent in &state.agents {
        let prefix = match agent.depth {
            0 => "• ",
            1 => "   ├ ",
            _ => "     └ ",
        };
        let style = if agent.is_selected {
            Style::default()
                .fg(COLOR_SELECTED_FG)
                .bg(COLOR_SELECTED_BG)
                .add_modifier(Modifier::BOLD)
        } else {
            Style::default().fg(COLOR_TITLE)
        };
        agent_lines.push(Line::from(Span::styled(
            format!("{prefix}{}", agent.label),
            style,
        )));
    }

    let mut loop_lines = Vec::new();
    loop_lines.push(Line::from(vec![
        Span::styled("Loop ", Style::default().fg(COLOR_MUTED)),
        Span::styled(
            state.loop_progress.as_str(),
            Style::default()
                .fg(COLOR_HEADER_ACCENT)
                .add_modifier(Modifier::BOLD),
        ),
        Span::raw("  "),
        Span::styled(
            state.runtime_status.as_str(),
            Style::default()
                .fg(COLOR_ACTIVE)
                .add_modifier(Modifier::BOLD),
        ),
    ]));
    for step in &state.steps {
        let step_style = match step.state {
            LoopStepState::Completed => Style::default().fg(COLOR_SUCCESS),
            LoopStepState::Active => Style::default()
                .fg(COLOR_TITLE)
                .add_modifier(Modifier::BOLD),
            LoopStepState::Pending => Style::default().fg(COLOR_MUTED),
        };
        loop_lines.push(Line::from(vec![
            Span::styled(step.state.marker(), step_style),
            Span::raw(" "),
            Span::styled(step.label.as_str(), step_style),
        ]));
    }

    let runtime_lines = vec![
        Line::from(vec![
            Span::styled("last: ", Style::default().fg(COLOR_MUTED)),
            Span::styled(state.last_tool.as_str(), Style::default().fg(COLOR_TITLE)),
        ]),
        Line::from(vec![
            Span::styled("budget: ", Style::default().fg(COLOR_MUTED)),
            Span::styled(state.budget_text.as_str(), Style::default().fg(COLOR_TITLE)),
        ]),
    ];

    let mut tool_lines = Vec::new();
    for tool in &state.tool_stats {
        let count_style = if tool.success_count > 0 {
            Style::default().fg(COLOR_TOOL).add_modifier(Modifier::BOLD)
        } else {
            Style::default().fg(COLOR_MUTED)
        };
        let mark = if tool.success_count > 0 { "✓" } else { "-" };
        let value = if tool.success_count > 0 {
            tool.success_count.to_string()
        } else {
            tool.failure_count.to_string()
        };
        tool_lines.push(Line::from(vec![
            Span::styled(
                format!("{:<13}", tool.tool_name),
                Style::default().fg(COLOR_TITLE),
            ),
            Span::styled(mark, count_style),
            Span::raw(" "),
            Span::styled(value, count_style),
        ]));
    }

    let sections = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(2),
            Constraint::Length(section_height(agent_lines.len(), true)),
            Constraint::Length(section_height(loop_lines.len(), true)),
            Constraint::Length(section_height(runtime_lines.len(), true)),
            Constraint::Min(section_height(tool_lines.len(), false)),
        ])
        .split(inner);

    render_monitor_header(frame, sections[0]);
    render_monitor_section(frame, sections[1], "Agent", &agent_lines, true);
    render_monitor_section(frame, sections[2], "Loop", &loop_lines, true);
    render_monitor_section(frame, sections[3], "Runtime", &runtime_lines, true);
    render_monitor_section(frame, sections[4], "Tools", &tool_lines, false);
}

fn render_input(frame: &mut Frame<'_>, area: Rect, state: &DashboardState) {
    let border_style = pane_border_style(state.focus == FocusPane::Input);
    let inner = area.inner(Margin {
        vertical: 1,
        horizontal: 1,
    });
    let visible_input_width = inner.width.saturating_sub(2);
    let content = if state.exit_pending {
        Line::from(vec![
            Span::styled("> ", Style::default().fg(Color::LightRed)),
            Span::styled(
                "Press Ctrl+C again to exit, or Esc to cancel",
                Style::default()
                    .fg(Color::LightRed)
                    .add_modifier(Modifier::BOLD),
            ),
        ])
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

    let input = Paragraph::new(content).block(
        Block::default()
            .borders(Borders::ALL)
            .border_style(border_style),
    );
    frame.render_widget(input, area);
}

fn render_monitor_header(frame: &mut Frame<'_>, area: Rect) {
    let header = Paragraph::new(Line::from(Span::styled(
        "Monitor",
        Style::default()
            .fg(COLOR_TITLE)
            .add_modifier(Modifier::BOLD),
    )))
    .block(
        Block::default()
            .borders(Borders::BOTTOM)
            .border_style(Style::default().fg(COLOR_BORDER)),
    );
    frame.render_widget(header, area);
}

fn render_monitor_section(
    frame: &mut Frame<'_>,
    area: Rect,
    title: &str,
    content_lines: &[Line<'_>],
    show_bottom_border: bool,
) {
    let mut lines = Vec::with_capacity(content_lines.len() + 1);
    lines.push(Line::from(Span::styled(
        title.to_string(),
        Style::default()
            .fg(COLOR_TITLE)
            .add_modifier(Modifier::BOLD),
    )));
    lines.extend(content_lines.iter().cloned());

    let block = Block::default()
        .borders(if show_bottom_border {
            Borders::BOTTOM
        } else {
            Borders::NONE
        })
        .border_style(Style::default().fg(COLOR_BORDER));
    frame.render_widget(
        Paragraph::new(lines)
            .block(block)
            .wrap(Wrap { trim: false }),
        area,
    );
}

fn section_height(content_lines: usize, show_bottom_border: bool) -> u16 {
    let base_height = (content_lines + 1) as u16;
    if show_bottom_border {
        base_height + 1
    } else {
        base_height
    }
}

fn pane_border_style(is_focused: bool) -> Style {
    if is_focused {
        Style::default().fg(COLOR_BORDER_FOCUS)
    } else {
        Style::default().fg(COLOR_BORDER)
    }
}

fn render_input_line(
    visible_input: &str,
    paste_badges: &[PasteBadge],
    max_width: u16,
    is_hint: bool,
    hint: &str,
) -> Line<'static> {
    let mut spans = vec![Span::styled("> ", Style::default().fg(COLOR_HEADER_ACCENT))];

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
        let label = badge.label();
        let label_width = UnicodeWidthStr::width(label.as_str()).min(usize::from(u16::MAX)) as u16;
        let required = label_width + 1;
        if used_width + required > max_width {
            break;
        }

        spans.push(Span::raw(" "));
        spans.push(Span::styled(
            label,
            Style::default()
                .fg(COLOR_HEADER_ACCENT)
                .bg(COLOR_SELECTED_BG)
                .add_modifier(Modifier::BOLD),
        ));
        used_width += required;
    }

    spans
}

struct VisibleInputWindow {
    text: String,
    cursor_width: u16,
}

fn visible_input_window(
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

fn char_to_byte_index(input: &str, char_index: usize) -> usize {
    if char_index == 0 {
        return 0;
    }
    input
        .char_indices()
        .nth(char_index)
        .map(|(byte_index, _)| byte_index)
        .unwrap_or(input.len())
}

#[cfg(test)]
mod tests {
    use ratatui::Terminal;
    use ratatui::backend::TestBackend;

    use super::{DashboardState, PasteBadge, render_dashboard, visible_input_window};

    #[test]
    fn dashboard_renders_chat_and_monitor() {
        let backend = TestBackend::new(120, 36);
        let mut terminal = Terminal::new(backend).expect("test terminal should initialize");
        let mut state = DashboardState::mock();
        let pasted = "Cargo.toml\nserde = \"1\"\nserde_json = \"1\"";
        state.record_paste(pasted);

        terminal
            .draw(|frame| render_dashboard(frame, &state))
            .expect("dashboard should render");

        let output = terminal.backend().buffer().content.clone();
        let text = output
            .iter()
            .map(|cell| cell.symbol())
            .collect::<Vec<_>>()
            .join("");

        assert!(text.contains("Session:"));
        assert!(text.contains("Monitor"));
        assert!(text.contains("Agent"));
        assert!(text.contains("Runtime"));
        assert!(text.contains("Cargo.toml"));
        assert!(text.contains("serde_json"));
        assert!(text.contains("ForgeOne"));
        assert!(text.contains("search_files"));
        assert!(text.contains("read_file"));
        assert!(text.contains(PasteBadge::from_content(pasted).label().as_str()));
    }

    #[test]
    fn dashboard_renders_exit_confirmation() {
        let backend = TestBackend::new(120, 36);
        let mut terminal = Terminal::new(backend).expect("test terminal should initialize");
        let mut state = DashboardState::mock();
        state.arm_exit();

        terminal
            .draw(|frame| render_dashboard(frame, &state))
            .expect("dashboard should render");

        let output = terminal.backend().buffer().content.clone();
        let text = output
            .iter()
            .map(|cell| cell.symbol())
            .collect::<Vec<_>>()
            .join("");

        assert!(text.contains("Press Ctrl+C again to exit"));
        assert!(text.contains("confirm"));
    }

    #[test]
    fn visible_input_window_tracks_wide_characters() {
        let visible = visible_input_window("abc你好", 5, 6);
        assert_eq!(visible.text, "bc你好");
        assert_eq!(visible.cursor_width, 6);

        let visible = visible_input_window("修复TUI光标", 7, 8);
        assert_eq!(visible.text, "TUI光标");
        assert_eq!(visible.cursor_width, 7);
    }

    #[test]
    fn editor_supports_cursor_movement_and_delete() {
        let mut state = DashboardState::mock();
        for ch in "ab你好".chars() {
            state.append_char(ch);
        }
        state.move_cursor_left();
        state.move_cursor_left();
        state.append_char('X');
        assert_eq!(state.input, "abX你好");

        state.delete_forward();
        assert_eq!(state.input, "abX好");

        state.backspace();
        assert_eq!(state.input, "ab好");

        state.move_cursor_home();
        assert_eq!(state.input_cursor, 0);
        state.move_cursor_end();
        assert_eq!(state.input_cursor, state.input.chars().count());
    }

    #[test]
    fn paste_badge_reports_chars_and_lines() {
        let badge = PasteBadge::from_content("hello\nworld");
        assert_eq!(badge.chars, 11);
        assert_eq!(badge.lines, 2);
        assert_eq!(badge.label(), "[TEXT 11 chars 2 lines ⧉]");
    }
}
