use serde::{Deserialize, Serialize};
use std::fmt;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TraceEventKind {
    TaskReceived,
    LoopStarted,
    ContextBuilt,
    ModelRequested,
    ModelResponded,
    PolicyChecked,
    ToolRequested,
    ToolCompleted,
    StateUpdated,
    SessionStopped,
}

impl TraceEventKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::TaskReceived => "task_received",
            Self::LoopStarted => "loop_started",
            Self::ContextBuilt => "context_built",
            Self::ModelRequested => "model_requested",
            Self::ModelResponded => "model_responded",
            Self::PolicyChecked => "policy_checked",
            Self::ToolRequested => "tool_requested",
            Self::ToolCompleted => "tool_completed",
            Self::StateUpdated => "state_updated",
            Self::SessionStopped => "session_stopped",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TraceEvent {
    pub timestamp_ms: u128,
    pub session_id: String,
    pub agent_id: String,
    pub parent_agent_id: Option<String>,
    pub loop_index: u32,
    pub kind: TraceEventKind,
    pub message: String,
}

impl TraceEvent {
    pub fn new(
        session_id: impl Into<String>,
        agent_id: impl Into<String>,
        parent_agent_id: Option<String>,
        loop_index: u32,
        kind: TraceEventKind,
        message: impl Into<String>,
    ) -> Self {
        Self {
            timestamp_ms: now_ms(),
            session_id: session_id.into(),
            agent_id: agent_id.into(),
            parent_agent_id,
            loop_index,
            kind,
            message: message.into(),
        }
    }
}

impl fmt::Display for TraceEvent {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "[{}] {} agent={} parent={} loop={} {}",
            self.timestamp_ms,
            self.kind.as_str(),
            self.agent_id,
            self.parent_agent_id.as_deref().unwrap_or("-"),
            self.loop_index,
            self.message
        )
    }
}

#[derive(Debug, Default, Clone)]
pub struct InMemoryTraceStore {
    events: Vec<TraceEvent>,
}

impl InMemoryTraceStore {
    pub fn push(&mut self, event: TraceEvent) {
        self.events.push(event);
    }

    pub fn events(&self) -> &[TraceEvent] {
        &self.events
    }

    pub fn into_events(self) -> Vec<TraceEvent> {
        self.events
    }

    pub fn render_timeline(&self) -> String {
        self.events
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join("\n")
    }
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time should be after unix epoch")
        .as_millis()
}

#[cfg(test)]
mod tests {
    use super::{InMemoryTraceStore, TraceEvent, TraceEventKind};

    #[test]
    fn timeline_contains_event_kind() {
        let mut store = InMemoryTraceStore::default();
        store.push(TraceEvent::new(
            "session-1",
            "agent-root",
            None,
            0,
            TraceEventKind::TaskReceived,
            "task accepted",
        ));

        let timeline = store.render_timeline();
        assert!(timeline.contains("task_received"));
        assert!(timeline.contains("agent-root"));
        assert!(timeline.contains("task accepted"));
    }
}
