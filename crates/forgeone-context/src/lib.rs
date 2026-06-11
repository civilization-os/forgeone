use std::fmt;
use std::sync::atomic::{AtomicU64, Ordering};

static SNAPSHOT_COUNTER: AtomicU64 = AtomicU64::new(1);
static SOURCE_COUNTER: AtomicU64 = AtomicU64::new(1);
static SEGMENT_COUNTER: AtomicU64 = AtomicU64::new(1);
static MESSAGE_COUNTER: AtomicU64 = AtomicU64::new(1);
static COMPRESSION_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ContextSourceType {
    TaskInput,
    SessionHistory,
    ToolObservation,
    SystemPrompt,
    PolicyInjection,
    WorkingMemory,
}

impl fmt::Display for ContextSourceType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::TaskInput => write!(f, "task_input"),
            Self::SessionHistory => write!(f, "session_history"),
            Self::ToolObservation => write!(f, "tool_observation"),
            Self::SystemPrompt => write!(f, "system_prompt"),
            Self::PolicyInjection => write!(f, "policy_injection"),
            Self::WorkingMemory => write!(f, "working_memory"),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CompressionStrategy {
    Truncate,
    DropLowPriority,
}

impl fmt::Display for CompressionStrategy {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Truncate => write!(f, "truncate"),
            Self::DropLowPriority => write!(f, "drop_low_priority"),
        }
    }
}

#[derive(Debug, Clone)]
pub struct ContextSource {
    pub source_id: String,
    pub source_type: ContextSourceType,
    pub label: String,
    pub content: String,
    pub priority: u8,
}

#[derive(Debug, Clone)]
pub struct SelectedSegment {
    pub segment_id: String,
    pub source_id: String,
    pub content: String,
    pub selection_reason: String,
    pub token_estimate: u32,
    pub priority: u8,
}

#[derive(Debug, Clone)]
pub struct CompressionEvent {
    pub event_id: String,
    pub source_id: String,
    pub strategy: CompressionStrategy,
    pub reason: String,
}

#[derive(Debug, Clone)]
pub struct PromptMessage {
    pub message_id: String,
    pub role: String,
    pub content: String,
    pub source_segment_refs: Vec<String>,
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
pub struct ObservationSummary {
    pub tool_name: String,
    pub summary: String,
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
    pub fn from_total(total_tokens: u32) -> Self {
        Self {
            total_tokens,
            reserved_system_tokens: total_tokens * 15 / 100,
            reserved_working_memory_tokens: total_tokens * 15 / 100,
            reserved_recent_tokens: total_tokens * 20 / 100,
            reserved_observation_tokens: total_tokens * 30 / 100,
        }
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
    pub policy_injections: Vec<String>,
    pub working_memory: WorkingMemory,
    pub token_budget: u32,
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
    pub prompt_messages: Vec<PromptMessage>,
    pub budget: ContextBudget,
    pub budget_estimate: u32,
}

impl ContextSnapshot {
    pub fn summary(&self) -> String {
        format!(
            "snapshot_id={} sources={} segments={} messages={} budget_estimate={}",
            self.snapshot_id,
            self.sources.len(),
            self.selected_segments.len(),
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
        let budget = ContextBudget::from_total(input.token_budget);
        let mut compression_events = Vec::new();
        let mut sources = Vec::new();

        sources.push(ContextSource {
            source_id: next_source_id(),
            source_type: ContextSourceType::SystemPrompt,
            label: "system_prompt".to_string(),
            content: truncate_with_budget(
                &input.system_prompt,
                budget.reserved_system_tokens,
                &mut compression_events,
                "system_prompt",
            ),
            priority: 100,
        });

        sources.push(ContextSource {
            source_id: next_source_id(),
            source_type: ContextSourceType::TaskInput,
            label: "task_input".to_string(),
            content: input.task_input,
            priority: 100,
        });

        sources.push(ContextSource {
            source_id: next_source_id(),
            source_type: ContextSourceType::WorkingMemory,
            label: "working_memory".to_string(),
            content: truncate_with_budget(
                &input.working_memory.to_source_content(),
                budget.reserved_working_memory_tokens,
                &mut compression_events,
                "working_memory",
            ),
            priority: 95,
        });

        for (index, injection) in input.policy_injections.iter().enumerate() {
            sources.push(ContextSource {
                source_id: next_source_id(),
                source_type: ContextSourceType::PolicyInjection,
                label: format!("policy_injection_{index}"),
                content: injection.clone(),
                priority: 90,
            });
        }

        for (index, history) in input.session_history.iter().rev().take(2).enumerate() {
            sources.push(ContextSource {
                source_id: next_source_id(),
                source_type: ContextSourceType::SessionHistory,
                label: format!("recent_history_{index}"),
                content: truncate_with_budget(
                    history,
                    budget.reserved_recent_tokens / 2,
                    &mut compression_events,
                    "session_history",
                ),
                priority: 70,
            });
        }

        for (index, observation) in input.tool_observations.iter().take(2).enumerate() {
            sources.push(ContextSource {
                source_id: next_source_id(),
                source_type: ContextSourceType::ToolObservation,
                label: format!("tool_observation_{index}"),
                content: truncate_with_budget(
                    &format!(
                        "tool={} summary={}",
                        observation.tool_name, observation.summary
                    ),
                    budget.reserved_observation_tokens / 2,
                    &mut compression_events,
                    "tool_observation",
                ),
                priority: 75,
            });
        }

        let mut selected_segments = Vec::new();
        for source in &sources {
            selected_segments.push(SelectedSegment {
                segment_id: next_segment_id(),
                source_id: source.source_id.clone(),
                content: source.content.clone(),
                selection_reason: selection_reason(source.source_type).to_string(),
                token_estimate: estimate_tokens(&source.content),
                priority: source.priority,
            });
        }

        let prompt_messages = assemble_messages(&selected_segments);
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
            prompt_messages,
            budget,
            budget_estimate,
        }
    }
}

fn assemble_messages(selected_segments: &[SelectedSegment]) -> Vec<PromptMessage> {
    let mut system_segments = Vec::new();
    let mut user_segments = Vec::new();

    for segment in selected_segments {
        if segment.priority >= 90 {
            system_segments.push(segment);
        } else {
            user_segments.push(segment);
        }
    }

    let mut messages = Vec::new();
    if !system_segments.is_empty() {
        messages.push(PromptMessage {
            message_id: next_message_id(),
            role: "system".to_string(),
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

    if !user_segments.is_empty() {
        messages.push(PromptMessage {
            message_id: next_message_id(),
            role: "user".to_string(),
            content: user_segments
                .iter()
                .map(|segment| segment.content.as_str())
                .collect::<Vec<_>>()
                .join("\n\n"),
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
) -> String {
    let estimated = estimate_tokens(content);
    if estimated <= token_budget {
        return content.to_string();
    }

    let char_budget = (token_budget as usize).saturating_mul(4);
    let truncated = content.chars().take(char_budget).collect::<String>();
    compression_events.push(CompressionEvent {
        event_id: next_compression_id(),
        source_id: label.to_string(),
        strategy: CompressionStrategy::Truncate,
        reason: format!(
            "estimated_tokens={} exceeds_budget={}",
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
        ContextSourceType::PolicyInjection => "policy injection must be explicit",
        ContextSourceType::WorkingMemory => "working memory keeps current progress stable",
    }
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
        ContextBuildInput, ContextEngine, DefaultContextEngine, ObservationSummary, WorkingMemory,
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
            }],
            system_prompt: "you are a coding agent".to_string(),
            policy_injections: vec!["do not exceed token budget".to_string()],
            working_memory: WorkingMemory {
                current_goal: "stabilize runtime".to_string(),
                completed_items: vec!["trace fields added".to_string()],
                pending_items: vec!["build context snapshot".to_string()],
            },
            token_budget: 128,
        });

        assert_eq!(snapshot.loop_index, 1);
        assert!(!snapshot.sources.is_empty());
        assert!(!snapshot.selected_segments.is_empty());
        assert!(!snapshot.prompt_messages.is_empty());
        assert!(
            snapshot
                .sources
                .iter()
                .any(|source| source.label == "working_memory")
        );
    }
}
