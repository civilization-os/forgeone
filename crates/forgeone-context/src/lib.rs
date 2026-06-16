use std::fmt;
use std::sync::atomic::{AtomicU64, Ordering};

static SNAPSHOT_COUNTER: AtomicU64 = AtomicU64::new(1);
static SOURCE_COUNTER: AtomicU64 = AtomicU64::new(1);
static SEGMENT_COUNTER: AtomicU64 = AtomicU64::new(1);
static MESSAGE_COUNTER: AtomicU64 = AtomicU64::new(1);
static COMPRESSION_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ContextLayer {
    GoalAnchor,
    WorkingSet,
    EvidenceBuffer,
    ArchiveSummary,
}

impl fmt::Display for ContextLayer {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::GoalAnchor => write!(f, "goal_anchor"),
            Self::WorkingSet => write!(f, "working_set"),
            Self::EvidenceBuffer => write!(f, "evidence_buffer"),
            Self::ArchiveSummary => write!(f, "archive_summary"),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ContextSourceType {
    TaskInput,
    SessionHistory,
    ToolObservation,
    SystemPrompt,
    RuntimeContract,
    PolicyInjection,
    WorkingMemory,
    WorkingSet,
}

impl fmt::Display for ContextSourceType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::TaskInput => write!(f, "task_input"),
            Self::SessionHistory => write!(f, "session_history"),
            Self::ToolObservation => write!(f, "tool_observation"),
            Self::SystemPrompt => write!(f, "system_prompt"),
            Self::RuntimeContract => write!(f, "runtime_contract"),
            Self::PolicyInjection => write!(f, "policy_injection"),
            Self::WorkingMemory => write!(f, "working_memory"),
            Self::WorkingSet => write!(f, "working_set"),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CompressionStrategy {
    Truncate,
    DropLowPriority,
    MergeSummary,
}

impl fmt::Display for CompressionStrategy {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Truncate => write!(f, "truncate"),
            Self::DropLowPriority => write!(f, "drop_low_priority"),
            Self::MergeSummary => write!(f, "merge_summary"),
        }
    }
}

#[derive(Debug, Clone)]
pub struct ContextSource {
    pub source_id: String,
    pub source_type: ContextSourceType,
    pub layer: ContextLayer,
    pub label: String,
    pub content: String,
    pub priority: u8,
}

#[derive(Debug, Clone)]
pub struct SelectedSegment {
    pub segment_id: String,
    pub source_id: String,
    pub layer: ContextLayer,
    pub source_type: ContextSourceType,
    pub content: String,
    pub selection_reason: String,
    pub token_estimate: u32,
    pub priority: u8,
}

#[derive(Debug, Clone)]
pub struct CompressionEvent {
    pub event_id: String,
    pub source_id: String,
    pub layer: ContextLayer,
    pub strategy: CompressionStrategy,
    pub reason: String,
}

#[derive(Debug, Clone)]
pub struct ContextLayerState {
    pub layer: ContextLayer,
    pub segment_refs: Vec<String>,
    pub token_estimate: u32,
}

#[derive(Debug, Clone)]
pub struct PromptMessage {
    pub message_id: String,
    pub role: String,
    pub content: String,
    pub source_segment_refs: Vec<String>,
    /// Tool call correlation ID, set when `role` is "tool".
    pub tool_call_id: Option<String>,
}

#[derive(Debug, Clone)]
pub struct WorkingMemory {
    pub current_goal: String,
    pub completed_items: Vec<String>,
    pub pending_items: Vec<String>,
}

impl WorkingMemory {
    pub fn to_source_content(&self) -> String {
        let completed = if self.completed_items.is_empty() {
            "none".to_string()
        } else {
            self.completed_items.join("; ")
        };
        let pending = if self.pending_items.is_empty() {
            "none".to_string()
        } else {
            self.pending_items.join("; ")
        };

        format!(
            "current_goal: {}\ncompleted: {}\npending: {}",
            self.current_goal, completed, pending
        )
    }
}

#[derive(Debug, Clone)]
pub struct WorkingSet {
    pub active_files: Vec<String>,
    pub focus_notes: Vec<String>,
    pub active_subtasks: Vec<String>,
    pub recent_evidence: Vec<String>,
    pub open_questions: Vec<String>,
}

impl WorkingSet {
    pub fn to_source_content(&self) -> String {
        format!(
            "## Working Set\n{}\n{}\n{}\n{}\n{}",
            render_section("active_files", &self.active_files),
            render_section("focus_notes", &self.focus_notes),
            render_section("active_subtasks", &self.active_subtasks),
            render_section("recent_evidence", &self.recent_evidence),
            render_section("open_questions", &self.open_questions),
        )
    }
}

#[derive(Debug, Clone)]
pub struct ObservationSummary {
    pub tool_name: String,
    pub summary: String,
    /// Full tool output content, if available.
    pub content: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ModelCapabilities {
    pub context_window: u32,
    pub reserved_output_tokens: u32,
    pub supports_vision: bool,
    pub supports_tool_role: bool,
}

impl ModelCapabilities {
    pub fn input_budget(self) -> u32 {
        self.context_window
            .saturating_sub(self.reserved_output_tokens)
    }
}

#[derive(Debug, Clone)]
pub struct ContextBudget {
    pub total_tokens: u32,
    pub reserved_system_tokens: u32,
    pub reserved_working_memory_tokens: u32,
    pub reserved_recent_tokens: u32,
    pub reserved_observation_tokens: u32,
}

impl ContextBudget {
    pub fn from_capabilities(caps: &ModelCapabilities) -> Self {
        let total_tokens = caps.input_budget();
        // Here we could dynamically adapt based on caps, but for now we retain the percentages
        Self {
            total_tokens,
            reserved_system_tokens: total_tokens * 15 / 100,
            reserved_working_memory_tokens: total_tokens * 15 / 100,
            reserved_recent_tokens: total_tokens * 20 / 100,
            reserved_observation_tokens: total_tokens * 30 / 100,
        }
    }
}

/// Minimal tool description for context injection.
/// Carries only what the model needs to know about available tools.
#[derive(Debug, Clone)]
pub struct ToolInfo {
    pub name: String,
    pub description: String,
}

impl ToolInfo {
    pub fn to_prompt_block(&self) -> String {
        format!("- `{}`: {}", self.name, self.description)
    }
}

#[derive(Debug, Clone)]
pub struct ContextBuildInput {
    pub session_id: String,
    pub agent_id: String,
    pub loop_index: u32,
    pub task_input: String,
    pub session_history: Vec<String>,
    pub tool_observations: Vec<ObservationSummary>,
    pub system_prompt: String,
    pub runtime_contract: Vec<String>,
    pub policy_injections: Vec<String>,
    pub working_memory: WorkingMemory,
    pub working_set: WorkingSet,
    pub model_capabilities: ModelCapabilities,
    pub tool_descriptors: Vec<ToolInfo>,
}

#[derive(Debug, Clone)]
pub struct ContextSnapshot {
    pub snapshot_id: String,
    pub session_id: String,
    pub agent_id: String,
    pub loop_index: u32,
    pub sources: Vec<ContextSource>,
    pub selected_segments: Vec<SelectedSegment>,
    pub compression_events: Vec<CompressionEvent>,
    pub layers: Vec<ContextLayerState>,
    pub prompt_messages: Vec<PromptMessage>,
    pub budget: ContextBudget,
    pub budget_estimate: u32,
}

impl ContextSnapshot {
    pub fn summary(&self) -> String {
        let layer_summary = self
            .layers
            .iter()
            .map(|layer| format!("{}={}", layer.layer, layer.segment_refs.len()))
            .collect::<Vec<_>>()
            .join(",");
        format!(
            "snapshot_id={} sources={} segments={} layers=[{}] messages={} budget_estimate={}",
            self.snapshot_id,
            self.sources.len(),
            self.selected_segments.len(),
            layer_summary,
            self.prompt_messages.len(),
            self.budget_estimate
        )
    }
}

pub trait ContextEngine {
    fn build(&self, input: ContextBuildInput) -> ContextSnapshot;
}

#[derive(Debug, Default, Clone)]
pub struct DefaultContextEngine;

impl ContextEngine for DefaultContextEngine {
    fn build(&self, input: ContextBuildInput) -> ContextSnapshot {
        let budget = ContextBudget::from_capabilities(&input.model_capabilities);
        let mut compression_events = Vec::new();
        let mut sources = Vec::new();

        // Append tool descriptors as structured instructions
        let tool_block = if input.tool_descriptors.is_empty() {
            String::new()
        } else {
            let mut block = "\n\n## Available Tools\n\n".to_string();
            for tool in &input.tool_descriptors {
                block.push_str(&tool.to_prompt_block());
                block.push('\n');
            }
            block
        };
        let system_content = format!("{}{}", input.system_prompt, tool_block);

        sources.push(ContextSource {
            source_id: next_source_id(),
            source_type: ContextSourceType::SystemPrompt,
            layer: ContextLayer::GoalAnchor,
            label: "system_prompt".to_string(),
            content: truncate_with_budget(
                &system_content,
                budget.reserved_system_tokens,
                &mut compression_events,
                "system_prompt",
                ContextLayer::GoalAnchor,
            ),
            priority: 100,
        });

        sources.push(ContextSource {
            source_id: next_source_id(),
            source_type: ContextSourceType::TaskInput,
            layer: ContextLayer::GoalAnchor,
            label: "task_input".to_string(),
            content: input.task_input,
            priority: 100,
        });

        for (index, contract_line) in input.runtime_contract.iter().enumerate() {
            sources.push(ContextSource {
                source_id: next_source_id(),
                source_type: ContextSourceType::RuntimeContract,
                layer: ContextLayer::GoalAnchor,
                label: format!("runtime_contract_{index}"),
                content: contract_line.clone(),
                priority: 98,
            });
        }

        sources.push(ContextSource {
            source_id: next_source_id(),
            source_type: ContextSourceType::WorkingMemory,
            layer: ContextLayer::WorkingSet,
            label: "working_memory".to_string(),
            content: truncate_with_budget(
                &input.working_memory.to_source_content(),
                budget.reserved_working_memory_tokens,
                &mut compression_events,
                "working_memory",
                ContextLayer::WorkingSet,
            ),
            priority: 95,
        });

        sources.push(ContextSource {
            source_id: next_source_id(),
            source_type: ContextSourceType::WorkingSet,
            layer: ContextLayer::WorkingSet,
            label: "working_set".to_string(),
            content: truncate_with_budget(
                &input.working_set.to_source_content(),
                budget.reserved_working_memory_tokens,
                &mut compression_events,
                "working_set",
                ContextLayer::WorkingSet,
            ),
            priority: 92,
        });

        for (index, injection) in input.policy_injections.iter().enumerate() {
            sources.push(ContextSource {
                source_id: next_source_id(),
                source_type: ContextSourceType::PolicyInjection,
                layer: ContextLayer::GoalAnchor,
                label: format!("policy_injection_{index}"),
                content: injection.clone(),
                priority: 90,
            });
        }

        let recent_history: Vec<&String> = input.session_history.iter().rev().take(2).collect();
        for (index, history) in recent_history.iter().enumerate() {
            sources.push(ContextSource {
                source_id: next_source_id(),
                source_type: ContextSourceType::SessionHistory,
                layer: ContextLayer::ArchiveSummary,
                label: format!("recent_history_{index}"),
                content: truncate_with_budget(
                    history,
                    budget.reserved_recent_tokens / 2,
                    &mut compression_events,
                    "session_history",
                    ContextLayer::ArchiveSummary,
                ),
                priority: 60,
            });
        }

        if input.session_history.len() > recent_history.len() {
            let merged_history = input
                .session_history
                .iter()
                .take(input.session_history.len() - recent_history.len())
                .rev()
                .take(4)
                .map(String::as_str)
                .collect::<Vec<_>>()
                .join(" | ");
            let content = format!(
                "older_history_summary: {} previous entries compressed; recent topics: {}",
                input.session_history.len() - recent_history.len(),
                merged_history
            );
            sources.push(ContextSource {
                source_id: next_source_id(),
                source_type: ContextSourceType::SessionHistory,
                layer: ContextLayer::ArchiveSummary,
                label: "older_history_summary".to_string(),
                content,
                priority: 45,
            });
            compression_events.push(CompressionEvent {
                event_id: next_compression_id(),
                source_id: "older_history_summary".to_string(),
                layer: ContextLayer::ArchiveSummary,
                strategy: CompressionStrategy::MergeSummary,
                reason: format!(
                    "compressed_history_entries={}",
                    input.session_history.len() - recent_history.len()
                ),
            });
        }

        let recent_observations: Vec<&ObservationSummary> =
            input.tool_observations.iter().rev().take(2).collect();
        for (index, observation) in recent_observations.iter().enumerate() {
            let content = if let Some(output) = &observation.content {
                format!(
                    "## Tool Result: {}\n\n{}\n\n```\n{}\n```",
                    observation.tool_name, observation.summary, output
                )
            } else {
                format!(
                    "tool={} summary={}",
                    observation.tool_name, observation.summary
                )
            };
            sources.push(ContextSource {
                source_id: next_source_id(),
                source_type: ContextSourceType::ToolObservation,
                layer: ContextLayer::EvidenceBuffer,
                label: format!("tool_observation_{}", index),
                content: truncate_with_budget(
                    &content,
                    budget.reserved_observation_tokens / 2,
                    &mut compression_events,
                    "tool_observation",
                    ContextLayer::EvidenceBuffer,
                ),
                priority: 75,
            });
        }

        if input.tool_observations.len() > recent_observations.len() {
            let merged_observations = input
                .tool_observations
                .iter()
                .take(input.tool_observations.len() - recent_observations.len())
                .rev()
                .take(4)
                .map(|observation| format!("{}: {}", observation.tool_name, observation.summary))
                .collect::<Vec<_>>()
                .join(" | ");
            sources.push(ContextSource {
                source_id: next_source_id(),
                source_type: ContextSourceType::ToolObservation,
                layer: ContextLayer::ArchiveSummary,
                label: "older_observation_summary".to_string(),
                content: format!(
                    "older_observation_summary: {} prior observations compressed; highlights: {}",
                    input.tool_observations.len() - recent_observations.len(),
                    merged_observations
                ),
                priority: 50,
            });
            compression_events.push(CompressionEvent {
                event_id: next_compression_id(),
                source_id: "older_observation_summary".to_string(),
                layer: ContextLayer::ArchiveSummary,
                strategy: CompressionStrategy::MergeSummary,
                reason: format!(
                    "compressed_observations={}",
                    input.tool_observations.len() - recent_observations.len()
                ),
            });
        }

        let mut selected_segments = Vec::new();
        for source in &sources {
            selected_segments.push(SelectedSegment {
                segment_id: next_segment_id(),
                source_id: source.source_id.clone(),
                layer: source.layer,
                source_type: source.source_type,
                content: source.content.clone(),
                selection_reason: selection_reason(source.source_type).to_string(),
                token_estimate: estimate_tokens(&source.content),
                priority: source.priority,
            });
        }

        let layers = build_layer_states(&selected_segments);
        let prompt_messages = assemble_messages(&selected_segments, &layers, &compression_events);
        let budget_estimate = prompt_messages
            .iter()
            .map(|message| estimate_tokens(&message.content))
            .sum();

        ContextSnapshot {
            snapshot_id: next_snapshot_id(),
            session_id: input.session_id,
            agent_id: input.agent_id,
            loop_index: input.loop_index,
            sources,
            selected_segments,
            compression_events,
            layers,
            prompt_messages,
            budget,
            budget_estimate,
        }
    }
}

fn build_layer_states(selected_segments: &[SelectedSegment]) -> Vec<ContextLayerState> {
    let ordered_layers = [
        ContextLayer::GoalAnchor,
        ContextLayer::WorkingSet,
        ContextLayer::EvidenceBuffer,
        ContextLayer::ArchiveSummary,
    ];
    ordered_layers
        .into_iter()
        .map(|layer| {
            let layer_segments = selected_segments
                .iter()
                .filter(|segment| segment.layer == layer)
                .collect::<Vec<_>>();
            ContextLayerState {
                layer,
                segment_refs: layer_segments
                    .iter()
                    .map(|segment| segment.segment_id.clone())
                    .collect(),
                token_estimate: layer_segments
                    .iter()
                    .map(|segment| segment.token_estimate)
                    .sum(),
            }
        })
        .collect()
}

fn assemble_messages(
    selected_segments: &[SelectedSegment],
    layers: &[ContextLayerState],
    compression_events: &[CompressionEvent],
) -> Vec<PromptMessage> {
    let mut system_segments = Vec::new();
    let mut user_segments = Vec::new();
    let mut tool_segments = Vec::new();

    for segment in selected_segments {
        match segment.layer {
            ContextLayer::GoalAnchor => system_segments.push(segment),
            ContextLayer::EvidenceBuffer if segment.source_type == ContextSourceType::ToolObservation => {
                tool_segments.push(segment);
            }
            ContextLayer::WorkingSet
            | ContextLayer::EvidenceBuffer
            | ContextLayer::ArchiveSummary => user_segments.push(segment),
        }
    }

    let mut messages = Vec::new();
    if !system_segments.is_empty() {
        messages.push(PromptMessage {
            message_id: next_message_id(),
            role: "system".to_string(),
            tool_call_id: None,
            content: system_segments
                .iter()
                .map(|segment| segment.content.as_str())
                .collect::<Vec<_>>()
                .join("\n\n"),
            source_segment_refs: system_segments
                .iter()
                .map(|segment| segment.segment_id.clone())
                .collect(),
        });
    }

    // Tool-role messages: recent observation content as structured tool results
    for segment in &tool_segments {
        messages.push(PromptMessage {
            message_id: next_message_id(),
            role: "tool".to_string(),
            tool_call_id: Some(format!("tool-call-{}", segment.segment_id)),
            content: segment.content.clone(),
            source_segment_refs: vec![segment.segment_id.clone()],
        });
    }

    if !user_segments.is_empty() {
        let layer_header = layers
            .iter()
            .filter(|layer| {
                layer.layer != ContextLayer::GoalAnchor && !layer.segment_refs.is_empty()
            })
            .map(|layer| format!("- {} tokens={}", layer.layer, layer.token_estimate))
            .collect::<Vec<_>>()
            .join("\n");
        let compression_header = render_compression_events(compression_events);
        let grouped_segments = render_grouped_segments(&user_segments);
        messages.push(PromptMessage {
            message_id: next_message_id(),
            role: "user".to_string(),
            tool_call_id: None,
            content: format!(
                "## Prompt-Loaded Context\nThese sections are the only non-system context currently loaded into the prompt.\n\n### Layer Balance\n{}\n\n### Compression Events\n{}\n\n{}",
                layer_header,
                compression_header,
                grouped_segments
            ),
            source_segment_refs: user_segments
                .iter()
                .map(|segment| segment.segment_id.clone())
                .collect(),
        });
    }

    messages
}

fn truncate_with_budget(
    content: &str,
    token_budget: u32,
    compression_events: &mut Vec<CompressionEvent>,
    label: &str,
    layer: ContextLayer,
) -> String {
    let estimated = estimate_tokens(content);
    if estimated <= token_budget {
        return content.to_string();
    }

    // Phase 1: paragraph boundary first (split by double newline)
    let mut para_acc = String::new();
    let mut para_tokens = 0u32;
    for para in content.split("\n\n") {
        let para_est = estimate_tokens(para);
        let with_sep = if para_acc.is_empty() { para_est } else { para_est + 1 };
        if para_tokens + with_sep > token_budget && !para_acc.is_empty() {
            break;
        }
        if !para_acc.is_empty() {
            para_acc.push_str("\n\n");
        }
        para_acc.push_str(para);
        para_tokens += with_sep;
    }
    if !para_acc.is_empty() && para_acc.len() < content.len() {
        let saved = content.len() - para_acc.len();
        compression_events.push(CompressionEvent {
            event_id: next_compression_id(),
            source_id: label.to_string(),
            layer,
            strategy: CompressionStrategy::Truncate,
            reason: format!(
                "estimated_tokens={} exceeds_budget={} truncated_at_paragraph saved={}",
                estimated, token_budget, saved
            ),
        });
        return para_acc;
    }

    // Phase 1 fallback: line boundary (split by single newline)
    let mut line_acc = String::new();
    let mut line_tokens = 0u32;
    for line in content.split('\n') {
        let line_est = estimate_tokens(line);
        let with_sep = if line_acc.is_empty() { line_est } else { line_est + 1 };
        if line_tokens + with_sep > token_budget && !line_acc.is_empty() {
            break;
        }
        if !line_acc.is_empty() {
            line_acc.push('\n');
        }
        line_acc.push_str(line);
        line_tokens += with_sep;
    }
    if !line_acc.is_empty() && line_acc.len() < content.len() {
        compression_events.push(CompressionEvent {
            event_id: next_compression_id(),
            source_id: label.to_string(),
            layer,
            strategy: CompressionStrategy::Truncate,
            reason: format!(
                "estimated_tokens={} exceeds_budget={} truncated_at_line",
                estimated, token_budget
            ),
        });
        return line_acc;
    }

    // Last resort: character boundary (should rarely happen)
    let char_budget = (token_budget as usize).saturating_mul(4);
    let truncated = content.chars().take(char_budget).collect::<String>();
    compression_events.push(CompressionEvent {
        event_id: next_compression_id(),
        source_id: label.to_string(),
        layer,
        strategy: CompressionStrategy::Truncate,
        reason: format!(
            "estimated_tokens={} exceeds_budget={} truncated_at_char",
            estimated, token_budget
        ),
    });
    truncated
}

fn selection_reason(source_type: ContextSourceType) -> &'static str {
    match source_type {
        ContextSourceType::TaskInput => "task anchor is always included",
        ContextSourceType::SessionHistory => "recent history retained for continuity",
        ContextSourceType::ToolObservation => "recent observation retained as working evidence",
        ContextSourceType::SystemPrompt => "system prompt anchors runtime policy",
        ContextSourceType::RuntimeContract => {
            "runtime contract declares visible capabilities and limits"
        }
        ContextSourceType::PolicyInjection => "policy injection must be explicit",
        ContextSourceType::WorkingMemory => "working memory keeps current progress stable",
        ContextSourceType::WorkingSet => "working set keeps active files and subtasks in focus",
    }
}

fn render_section(label: &str, items: &[String]) -> String {
    if items.is_empty() {
        return format!("{label}: none");
    }

    format!(
        "{label}:\n{}",
        items
            .iter()
            .map(|item| format!("- {item}"))
            .collect::<Vec<_>>()
            .join("\n")
    )
}

fn render_grouped_segments(user_segments: &[&SelectedSegment]) -> String {
    let ordered_layers = [
        ContextLayer::WorkingSet,
        ContextLayer::EvidenceBuffer,
        ContextLayer::ArchiveSummary,
    ];

    ordered_layers
        .into_iter()
        .filter_map(|layer| {
            let content = user_segments
                .iter()
                .filter(|segment| segment.layer == layer)
                .map(|segment| segment.content.as_str())
                .collect::<Vec<_>>();
            if content.is_empty() {
                None
            } else {
                Some(format!("### {}\n{}", layer, content.join("\n\n")))
            }
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

fn render_compression_events(compression_events: &[CompressionEvent]) -> String {
    if compression_events.is_empty() {
        return "none".to_string();
    }

    compression_events
        .iter()
        .rev()
        .take(3)
        .map(|event| format!("- {} via {} ({})", event.layer, event.strategy, event.reason))
        .collect::<Vec<_>>()
        .join("\n")
}

fn estimate_tokens(content: &str) -> u32 {
    content
        .split_whitespace()
        .count()
        .try_into()
        .unwrap_or(u32::MAX)
}

fn next_snapshot_id() -> String {
    let counter = SNAPSHOT_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("context-{counter}")
}

fn next_source_id() -> String {
    let counter = SOURCE_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("source-{counter}")
}

fn next_segment_id() -> String {
    let counter = SEGMENT_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("segment-{counter}")
}

fn next_message_id() -> String {
    let counter = MESSAGE_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("message-{counter}")
}

fn next_compression_id() -> String {
    let counter = COMPRESSION_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("compression-{counter}")
}

#[cfg(test)]
mod tests {
    use super::{
        ContextBuildInput, ContextEngine, ContextLayer, DefaultContextEngine, ModelCapabilities, ObservationSummary,
        WorkingMemory, WorkingSet,
    };

    #[test]
    fn context_snapshot_retains_working_memory_and_messages() {
        let engine = DefaultContextEngine;
        let snapshot = engine.build(ContextBuildInput {
            session_id: "session-1".to_string(),
            agent_id: "agent-1".to_string(),
            loop_index: 1,
            task_input: "fix runtime".to_string(),
            session_history: vec!["looked at runtime state".to_string()],
            tool_observations: vec![ObservationSummary {
                tool_name: "read_file".to_string(),
                summary: "read runtime source".to_string(),
                content: None,
            }],
            system_prompt: "you are a coding agent".to_string(),
            runtime_contract: vec!["tool_call_protocol: json".to_string()],
            policy_injections: vec!["do not exceed token budget".to_string()],
            working_memory: WorkingMemory {
                current_goal: "stabilize runtime".to_string(),
                completed_items: vec!["trace fields added".to_string()],
                pending_items: vec!["build context snapshot".to_string()],
            },
            working_set: WorkingSet {
                active_files: vec!["crates/forgeone-runtime/src/lib.rs".to_string()],
                focus_notes: vec!["runtime file is under active review".to_string()],
                active_subtasks: vec!["build context snapshot".to_string()],
                recent_evidence: vec!["read_file => runtime source".to_string()],
                open_questions: vec!["which tool to call next".to_string()],
            },
            model_capabilities: crate::ModelCapabilities {
                context_window: 128,
                reserved_output_tokens: 0,
                supports_vision: false,
                supports_tool_role: false,
            },
            tool_descriptors: vec![],
        });

        assert_eq!(snapshot.loop_index, 1);
        assert!(!snapshot.sources.is_empty());
        assert!(!snapshot.selected_segments.is_empty());
        assert!(!snapshot.layers.is_empty());
        assert!(!snapshot.prompt_messages.is_empty());
        assert!(
            snapshot
                .sources
                .iter()
                .any(|source| source.label == "working_memory")
        );
        assert!(
            snapshot
                .sources
                .iter()
                .any(|source| source.label == "working_set")
        );
    }

    #[test]
    fn context_injects_tool_descriptors_into_system_prompt() {
        let engine = DefaultContextEngine;
        let snapshot = engine.build(ContextBuildInput {
            session_id: "session-1".to_string(),
            agent_id: "agent-1".to_string(),
            loop_index: 1,
            task_input: "list files".to_string(),
            session_history: vec![],
            tool_observations: vec![],
            system_prompt: "you are a coding agent".to_string(),
            runtime_contract: vec!["visible_prompt_layers: working_set".to_string()],
            policy_injections: vec![],
            working_memory: WorkingMemory {
                current_goal: "list files".to_string(),
                completed_items: vec![],
                pending_items: vec![],
            },
            working_set: WorkingSet {
                active_files: vec![],
                focus_notes: vec![],
                active_subtasks: vec!["inspect workspace".to_string()],
                recent_evidence: vec![],
                open_questions: vec![],
            },
            model_capabilities: ModelCapabilities { context_window: 1024, reserved_output_tokens: 256, supports_vision: false, supports_tool_role: false },
            tool_descriptors: vec![
                super::ToolInfo {
                    name: "read_file".to_string(),
                    description: "Read a file from workspace".to_string(),
                },
                super::ToolInfo {
                    name: "search_content".to_string(),
                    description: "Grep file contents".to_string(),
                },
            ],
        });

        let system_msg = snapshot
            .prompt_messages
            .iter()
            .find(|m| m.role == "system")
            .expect("should have a system message");

        assert!(system_msg.content.contains("read_file"));
        assert!(system_msg.content.contains("search_content"));
        assert!(system_msg.content.contains("Available Tools"));
    }

    #[test]
    fn context_exposes_runtime_contract_and_prompt_loaded_context() {
        let engine = DefaultContextEngine;
        let snapshot = engine.build(ContextBuildInput {
            session_id: "session-1".to_string(),
            agent_id: "agent-1".to_string(),
            loop_index: 2,
            task_input: "inspect prompt".to_string(),
            session_history: vec!["history-1".to_string(), "history-2".to_string()],
            tool_observations: vec![],
            system_prompt: "you are a coding agent".to_string(),
            runtime_contract: vec![
                "## Runtime Contract".to_string(),
                "visible_prompt_layers: working_set, archive_summary".to_string(),
            ],
            policy_injections: vec![],
            working_memory: WorkingMemory {
                current_goal: "inspect prompt".to_string(),
                completed_items: vec![],
                pending_items: vec!["render context".to_string()],
            },
            working_set: WorkingSet {
                active_files: vec!["src/lib.rs".to_string()],
                focus_notes: vec!["src/lib.rs is active".to_string()],
                active_subtasks: vec!["render context".to_string()],
                recent_evidence: vec!["pending_tool_call: none".to_string()],
                open_questions: vec!["what is loaded".to_string()],
            },
            model_capabilities: ModelCapabilities { context_window: 512, reserved_output_tokens: 128, supports_vision: false, supports_tool_role: false },
            tool_descriptors: vec![],
        });

        let system_msg = snapshot
            .prompt_messages
            .iter()
            .find(|m| m.role == "system")
            .expect("should have a system message");
        let user_msg = snapshot
            .prompt_messages
            .iter()
            .find(|m| m.role == "user")
            .expect("should have a user message");

        assert!(system_msg.content.contains("Runtime Contract"));
        assert!(user_msg.content.contains("Prompt-Loaded Context"));
        assert!(user_msg.content.contains("Compression Events"));
    }

    #[test]
    fn context_builds_layered_summary_for_older_history_and_observations() {
        let engine = DefaultContextEngine;
        let snapshot = engine.build(ContextBuildInput {
            session_id: "session-1".to_string(),
            agent_id: "agent-1".to_string(),
            loop_index: 3,
            task_input: "continue task".to_string(),
            session_history: vec![
                "history-1".to_string(),
                "history-2".to_string(),
                "history-3".to_string(),
                "history-4".to_string(),
            ],
            tool_observations: vec![
                ObservationSummary {
                    tool_name: "read_file".to_string(),
                    summary: "obs-1".to_string(),
                    content: None,
                },
                ObservationSummary {
                    tool_name: "search_content".to_string(),
                    summary: "obs-2".to_string(),
                    content: None,
                },
                ObservationSummary {
                    tool_name: "shell".to_string(),
                    summary: "obs-3".to_string(),
                    content: None,
                },
            ],
            system_prompt: "you are a coding agent".to_string(),
            runtime_contract: vec!["context_management: compression enabled".to_string()],
            policy_injections: vec![],
            working_memory: WorkingMemory {
                current_goal: "continue task".to_string(),
                completed_items: vec![],
                pending_items: vec!["decide next step".to_string()],
            },
            working_set: WorkingSet {
                active_files: vec!["src/lib.rs".to_string()],
                focus_notes: vec!["src/lib.rs is part of the active patch".to_string()],
                active_subtasks: vec!["continue task".to_string()],
                recent_evidence: vec!["search_content => obs-2".to_string()],
                open_questions: vec!["what changed last round".to_string()],
            },
            model_capabilities: ModelCapabilities { context_window: 512, reserved_output_tokens: 128, supports_vision: false, supports_tool_role: false },
            tool_descriptors: vec![],
        });

        assert!(snapshot.sources.iter().any(|source| {
            source.label == "older_history_summary" && source.layer == ContextLayer::ArchiveSummary
        }));
        assert!(snapshot.sources.iter().any(|source| {
            source.label == "older_observation_summary"
                && source.layer == ContextLayer::ArchiveSummary
        }));
        assert!(
            snapshot
                .compression_events
                .iter()
                .any(|event| event.strategy == super::CompressionStrategy::MergeSummary)
        );
    }


    #[test]
    fn truncation_respects_paragraph_boundary() {
        // Content with 3 paragraphs, budget only fits 2
        let text = "first paragraph\n\nsecond paragraph\n\nthird paragraph with more content\n";
        let mut events = Vec::new();
        let result = super::truncate_with_budget(
            text, 8, &mut events, "test", super::ContextLayer::EvidenceBuffer
        );
        // Should not cut mid-paragraph
assert!(!result.contains("third paragraph"), "should drop last paragraph entirely");
        assert!(result.contains("first paragraph"), "should keep first paragraph");
        assert!(result.contains("second paragraph"), "should keep second paragraph");
    }

    #[test]
    fn truncation_falls_back_to_line_boundary() {
        // Single long paragraph with lines, budget too small
        let text = "short line\nanother line\nmore\nfinal\n";
        let mut events = Vec::new();
        let result = super::truncate_with_budget(
            text, 2, &mut events, "test", super::ContextLayer::EvidenceBuffer
        );
        // Should drop last lines, not cut mid-line
        assert!(!result.contains("final"), "should drop last line");
    }

    #[test]
    fn old_observations_drop_content_keep_only_summary() {
        // Verify that the archive summary for old observations
        // only contains tool_name: summary, not full content
        let snapshot = super::DefaultContextEngine.build(super::ContextBuildInput {
            session_id: "session-1".to_string(),
            agent_id: "agent-1".to_string(),
            loop_index: 5,
            task_input: "test".to_string(),
            session_history: vec![],
            tool_observations: vec![
                super::ObservationSummary {
                    tool_name: "read_file".to_string(),
                    summary: "read Cargo.toml".to_string(),
                    content: Some("very long file content that should not appear in summary...".to_string()),
                },
                super::ObservationSummary {
                    tool_name: "read_file".to_string(),
                    summary: "read lib.rs".to_string(),
                    content: Some("another long file content...".to_string()),
                },
                super::ObservationSummary {
                    tool_name: "search_files".to_string(),
                    summary: "found 5 files".to_string(),
                    content: Some("file1\nfile2\nfile3\nfile4\nfile5".to_string()),
                },
            ],
            system_prompt: "agent".to_string(),
            runtime_contract: vec![],
            policy_injections: vec![],
            working_memory: super::WorkingMemory {
                current_goal: "test".to_string(),
                completed_items: vec![],
                pending_items: vec![],
            },
            working_set: super::WorkingSet {
                active_files: vec![],
                focus_notes: vec![],
                active_subtasks: vec![],
                recent_evidence: vec![],
                open_questions: vec![],
            },
            model_capabilities: super::ModelCapabilities {
                context_window: 32000,
                reserved_output_tokens: 4000,
                supports_vision: false,
                supports_tool_role: true,
            },
            tool_descriptors: vec![],
        });

        // Recent 2 observations should have full content
        for msg in &snapshot.prompt_messages {
            if msg.role == "tool" {
                // Recent tools have full content
                assert!(msg.content.contains("very long") || msg.content.contains("another long")
                    || msg.content.contains("file5"), "recent tool should include content");
            }
        }

        // Archive summary should NOT contain full content
        let archive = snapshot.sources.iter()
            .find(|s| s.label == "older_observation_summary");
        if let Some(archive) = archive {
            assert!(!archive.content.contains("very long file content"),
                "archive should not contain full observation content");
            // But it should contain the summary
            assert!(archive.content.contains("read_file: read Cargo.toml"),
                "archive should contain summary");
        }
    }

}