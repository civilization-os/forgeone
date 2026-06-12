use forgeone_runtime::{ApprovalSessionRecord, SessionTraceRecord};
use std::collections::HashMap;

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
    pub fn marker(self) -> &'static str {
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
pub struct PendingApprovalView {
    pub tool_name: String,
    pub reason: String,
    pub argument_summary: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActiveModal {
    None,
    Help,
    ModelSelector,
    SessionSwitcher,
    StepInspector,
}

#[derive(Debug, Clone)]
pub struct SessionSummary {
    pub session_id: String,
    pub status: String,
    pub loop_index: u32,
    pub stop_reason: String,
    pub task_input: String,
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
    pub active_model: String,
    pub chat_scroll: usize,
    pub pending_approval: Option<PendingApprovalView>,

    // New fields for Modal & Navigation Support
    pub active_modal: ActiveModal,
    pub modal_selected_index: usize,
    pub modal_models: Vec<String>,
    pub modal_sessions: Vec<SessionSummary>,
    pub inspector_content: Vec<String>,
    pub monitor_selected_index: usize,
}

pub(crate) fn format_timestamp(ms: u128) -> String {
    let secs = ms / 1000;
    let mins = secs / 60;
    let hours = mins / 60;
    format!("{:02}:{:02}:{:02}", hours % 24, mins % 60, secs % 60)
}

pub(crate) fn now_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn parse_field(message: &str, field: &str) -> Option<String> {
    let pattern = format!("{field}=");
    if let Some(pos) = message.find(&pattern) {
        let start = pos + pattern.len();
        let rest = &message[start..];
        let end = rest.find(' ').unwrap_or(rest.len());
        Some(rest[..end].to_string())
    } else {
        None
    }
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

impl DashboardState {
    pub fn empty(hint: String) -> Self {
        Self {
            version: "v0.1.0".to_string(),
            session_id: "-".to_string(),
            focus: FocusPane::Input,
            agent_name: "-".to_string(),
            loop_progress: "0/0".to_string(),
            runtime_status: "idle".to_string(),
            steps: Vec::new(),
            last_tool: "-".to_string(),
            budget_text: "0/0".to_string(),
            agents: Vec::new(),
            tool_stats: Vec::new(),
            chat_blocks: Vec::new(),
            input: String::new(),
            input_cursor: 0,
            paste_badges: Vec::new(),
            hint,
            exit_pending: false,
            active_model: "mock-model".to_string(),
            chat_scroll: 9999,
            pending_approval: None,
            active_modal: ActiveModal::None,
            modal_selected_index: 0,
            modal_models: Vec::new(),
            modal_sessions: Vec::new(),
            inspector_content: Vec::new(),
            monitor_selected_index: 0,
        }
    }

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
            active_model: "mock-model".to_string(),
            chat_scroll: 9999,
            pending_approval: None,
            active_modal: ActiveModal::None,
            modal_selected_index: 0,
            modal_models: Vec::new(),
            modal_sessions: Vec::new(),
            inspector_content: Vec::new(),
            monitor_selected_index: 0,
        }
    }

    pub fn from_session_trace(record: SessionTraceRecord) -> Self {
        let mut chat_blocks = Vec::new();
        let mut current_block: Option<ChatBlockView> = None;
        let mut user_text = record.task_input.clone();

        for event in &record.trace {
            let ts = format_timestamp(event.timestamp_ms);
            match event.kind {
                forgeone_trace::TraceEventKind::TaskReceived => {}
                forgeone_trace::TraceEventKind::ToolRequested => {
                    if let Some(block) = current_block.take() {
                        chat_blocks.push(block);
                    }
                    let tool_name = parse_field(&event.message, "tool_call")
                        .unwrap_or_else(|| "unknown".to_string());
                    current_block = Some(ChatBlockView {
                        timestamp: ts,
                        user_text: std::mem::take(&mut user_text),
                        tool_name,
                        tool_summary: String::new(),
                        assistant_lines: Vec::new(),
                    });
                }
                forgeone_trace::TraceEventKind::ToolCompleted => {
                    if let Some(block) = &mut current_block {
                        block.tool_summary = event.message.clone();
                    }
                }
                forgeone_trace::TraceEventKind::ModelResponded => {
                    if let Some(block) = &mut current_block {
                        let summary = parse_field(&event.message, "summary")
                            .unwrap_or_else(|| event.message.clone());
                        block.assistant_lines.push(summary);
                    }
                }
                _ => {}
            }
        }

        if let Some(block) = current_block {
            chat_blocks.push(block);
        }

        if chat_blocks.is_empty() {
            chat_blocks.push(ChatBlockView {
                timestamp: format_timestamp(now_ms()),
                user_text: record.task_input.clone(),
                tool_name: "none".to_string(),
                tool_summary: "no tools executed".to_string(),
                assistant_lines: vec![record.final_response.clone()],
            });
        } else if !record.final_response.is_empty() {
            if let Some(last) = chat_blocks.last_mut() {
                last.assistant_lines
                    .push(format!("Final Response: {}", record.final_response));
            }
        }

        let pending_approval = record
            .pending_approval
            .as_ref()
            .map(|p| PendingApprovalView {
                tool_name: p.tool_name.clone(),
                reason: p.reason.clone(),
                argument_summary: p.argument_summary.clone(),
            });

        let mut tool_stats = Vec::new();
        let mut counts: HashMap<String, (u32, u32)> = HashMap::new();
        for event in &record.trace {
            if event.kind == forgeone_trace::TraceEventKind::ToolRequested {
                let name = parse_field(&event.message, "tool_call").unwrap_or_default();
                if !name.is_empty() {
                    counts.entry(name).or_insert((0, 0)).0 += 1;
                }
            }
        }
        for (tool_name, (success, failure)) in counts {
            tool_stats.push(ToolStatView {
                tool_name,
                success_count: success,
                failure_count: failure,
            });
        }

        Self {
            version: "v0.1.0".to_string(),
            session_id: record.session_id,
            focus: FocusPane::Input,
            agent_name: record.agent_id,
            loop_progress: format!("{}/{}", record.loop_index, 8),
            runtime_status: record.status.clone(),
            steps: vec![LoopStepView {
                label: "Completed".to_string(),
                state: LoopStepState::Completed,
            }],
            last_tool: record
                .pending_approval
                .as_ref()
                .map(|p| p.tool_name.clone())
                .unwrap_or_else(|| "-".to_string()),
            budget_text: format!("{}/{}", record.tokens_estimate, record.token_budget),
            agents: vec![AgentTreeItem {
                label: "root".to_string(),
                depth: 0,
                is_selected: true,
            }],
            tool_stats,
            chat_blocks,
            input: String::new(),
            input_cursor: 0,
            paste_badges: Vec::new(),
            hint: if record.status == "waiting_approval" {
                "Waiting approval... Enter /approve to authorize, /deny to abort."
            } else {
                "Enter task to start new session."
            }
            .to_string(),
            exit_pending: false,
            active_model: "mock-model".to_string(),
            chat_scroll: 9999,
            pending_approval,
            active_modal: ActiveModal::None,
            modal_selected_index: 0,
            modal_models: Vec::new(),
            modal_sessions: Vec::new(),
            inspector_content: Vec::new(),
            monitor_selected_index: 0,
        }
    }

    pub fn from_approval_session(record: ApprovalSessionRecord) -> Self {
        let chat_blocks = vec![ChatBlockView {
            timestamp: format_timestamp(now_ms()),
            user_text: record.task_input.clone(),
            tool_name: record.pending_approval.tool_name.clone(),
            tool_summary: format!("Waiting approval: {}", record.pending_approval.reason),
            assistant_lines: vec![format!(
                "Arguments: {}",
                record.pending_approval.argument_summary
            )],
        }];

        let pending_approval = Some(PendingApprovalView {
            tool_name: record.pending_approval.tool_name.clone(),
            reason: record.pending_approval.reason.clone(),
            argument_summary: record.pending_approval.argument_summary.clone(),
        });

        Self {
            version: "v0.1.0".to_string(),
            session_id: record.session_id,
            focus: FocusPane::Input,
            agent_name: record.agent_id,
            loop_progress: format!("{}/{}", record.loop_index, record.max_loops),
            runtime_status: "waiting_approval".to_string(),
            steps: vec![LoopStepView {
                label: "ToolDecision".to_string(),
                state: LoopStepState::Active,
            }],
            last_tool: record.pending_approval.tool_name.clone(),
            budget_text: format!("{}/{}", record.tokens_estimate, record.token_budget),
            agents: vec![AgentTreeItem {
                label: "root".to_string(),
                depth: 0,
                is_selected: true,
            }],
            tool_stats: vec![ToolStatView {
                tool_name: record.pending_approval.tool_name.clone(),
                success_count: 0,
                failure_count: 0,
            }],
            chat_blocks,
            input: String::new(),
            input_cursor: 0,
            paste_badges: Vec::new(),
            hint: "Authorization required. Enter /approve or /deny.".to_string(),
            exit_pending: false,
            active_model: record.model_name.clone(),
            chat_scroll: 9999,
            pending_approval,
            active_modal: ActiveModal::None,
            modal_selected_index: 0,
            modal_models: Vec::new(),
            modal_sessions: Vec::new(),
            inspector_content: Vec::new(),
            monitor_selected_index: 0,
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
