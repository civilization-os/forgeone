use std::collections::HashMap;
use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use forgeone_context::{
    ContextBuildInput, ContextEngine, ContextSnapshot, DefaultContextEngine, ObservationSummary,
    ToolInfo, WorkingMemory,
};
use forgeone_model::{
    MockModelAdapter, ModelAction, ModelAdapter, ModelRequest, ModelResponse, next_model_request_id,
};
use forgeone_policy::{ApprovalRequest, PolicyConfig, PolicyDecision, PolicyEngine};
use forgeone_tools::{
    Observation, ToolCallRequest, ToolCallResult, ToolDescriptor, ToolRegistry, next_tool_call_id,
};
use forgeone_trace::{InMemoryTraceStore, TraceEvent, TraceEventKind};
use serde::{Deserialize, Serialize};

static SESSION_COUNTER: AtomicU64 = AtomicU64::new(1);
static AGENT_COUNTER: AtomicU64 = AtomicU64::new(1);

const SYSTEM_PROMPT: &str = "You are ForgeOne, a terminal-first coding agent runtime.

## Tool Calling Protocol

When you need to gather information, output a JSON object on its own line:

{\"tool\": \"<tool_name>\", \"arguments\": {\"<arg_name>\": \"<arg_value>\"}}

Example:
{\"tool\": \"read_file\", \"arguments\": {\"path\": \"Cargo.toml\"}}

## Rules

1. Call a tool only when you lack information to answer the task.
2. After receiving a tool result, ANALYZE the result immediately. If it contains the answer, produce your final answer in plain text.
3. NEVER call the same tool twice for the same purpose. The result is already in your context.
4. If a tool call is denied, produce the best answer you can with the information you already have.
5. When the task is complete, output your final answer as plain text — do NOT include any JSON.
6. Always respond in the same language as the user's question.";

#[derive(Debug, Clone)]
pub struct RuntimeConfig {
    pub max_loops: u32,
    pub token_budget: u32,
    pub model_name: String,
    pub policy: PolicyConfig,
}

impl Default for RuntimeConfig {
    fn default() -> Self {
        Self {
            max_loops: 8,
            token_budget: 32_000,
            model_name: "mock-model".to_string(),
            policy: PolicyConfig::default(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct RunRequest {
    pub task: String,
    pub config: RuntimeConfig,
}

#[derive(Debug, Clone)]
pub struct Session {
    pub session_id: String,
    pub task: Task,
    pub config: RuntimeConfig,
}

#[derive(Debug, Clone)]
pub struct Task {
    pub task_id: String,
    pub input: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StopReason {
    FinalResponse,
    MaxLoopsReached,
}

impl fmt::Display for StopReason {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::FinalResponse => write!(f, "final_response"),
            Self::MaxLoopsReached => write!(f, "max_loops_reached"),
        }
    }
}

#[derive(Debug, Clone)]
pub enum RuntimeStatus {
    Created,
    Running,
    WaitingApproval,
    Completed,
}

impl fmt::Display for RuntimeStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Created => write!(f, "created"),
            Self::Running => write!(f, "running"),
            Self::WaitingApproval => write!(f, "waiting_approval"),
            Self::Completed => write!(f, "completed"),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RuntimePhase {
    Input,
    ContextBuild,
    ModelRequest,
    ToolDecision,
    StateUpdate,
    Finalize,
}

impl fmt::Display for RuntimePhase {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Input => write!(f, "input"),
            Self::ContextBuild => write!(f, "context_build"),
            Self::ModelRequest => write!(f, "model_request"),
            Self::ToolDecision => write!(f, "tool_decision"),
            Self::StateUpdate => write!(f, "state_update"),
            Self::Finalize => write!(f, "finalize"),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LoopStep {
    ContextBuild,
    ModelRequest,
    ToolDecision,
    ToolExecution,
    StateUpdate,
}

impl LoopStep {
    pub fn phase(self) -> RuntimePhase {
        match self {
            Self::ContextBuild => RuntimePhase::ContextBuild,
            Self::ModelRequest => RuntimePhase::ModelRequest,
            Self::ToolDecision => RuntimePhase::ToolDecision,
            Self::ToolExecution => RuntimePhase::ToolDecision,
            Self::StateUpdate => RuntimePhase::StateUpdate,
        }
    }
}

impl fmt::Display for LoopStep {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ContextBuild => write!(f, "context_build"),
            Self::ModelRequest => write!(f, "model_request"),
            Self::ToolDecision => write!(f, "tool_decision"),
            Self::ToolExecution => write!(f, "tool_execution"),
            Self::StateUpdate => write!(f, "state_update"),
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct BudgetUsage {
    pub tokens_estimate: u32,
    pub tool_call_count: u32,
}

#[derive(Debug, Clone)]
pub struct PolicyRecord {
    pub scope: String,
    pub decision: String,
    pub detail: String,
}

#[derive(Debug, Clone)]
pub struct PendingApproval {
    pub tool_name: String,
    pub reason: String,
    pub argument_summary: String,
}

#[derive(Debug, Clone)]
pub struct RuntimeState {
    pub session_id: String,
    pub task_id: String,
    pub agent_id: String,
    pub parent_agent_id: Option<String>,
    pub loop_index: u32,
    pub status: RuntimeStatus,
    pub current_phase: RuntimePhase,
    pub active_step: Option<LoopStep>,
    pub active_context_snapshot: Option<ContextSnapshot>,
    pub active_model_request: Option<ModelRequest>,
    pub last_model_response: Option<ModelResponse>,
    pub active_tool_call: Option<ToolCallRequest>,
    pub last_tool_result: Option<ToolCallResult>,
    pub observations: Vec<Observation>,
    pub policy_decisions: Vec<PolicyRecord>,
    pub pending_approval: Option<PendingApproval>,
    pub budget_usage: BudgetUsage,
    pub stop_reason: Option<StopReason>,
}

#[derive(Debug, Clone)]
pub struct RunResult {
    pub state: RuntimeState,
    pub final_response: String,
    pub trace: Vec<TraceEvent>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApprovalSessionRecord {
    pub session_id: String,
    pub task_id: String,
    pub task_input: String,
    pub agent_id: String,
    pub loop_index: u32,
    pub max_loops: u32,
    pub token_budget: u32,
    pub model_name: String,
    pub allowed_tools: Vec<String>,
    pub read_roots: Vec<String>,
    pub approval_read_roots: Vec<String>,
    pub max_tool_calls: u32,
    pub tokens_estimate: u32,
    pub tool_call_count: u32,
    pub observations: Vec<ApprovalObservationRecord>,
    pub policy_decisions: Vec<ApprovalPolicyRecord>,
    pub active_tool_call: ApprovalToolCallRecord,
    pub pending_approval: ApprovalPendingRecord,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionTraceRecord {
    pub session_id: String,
    pub task_id: String,
    pub task_input: String,
    pub agent_id: String,
    pub status: String,
    pub current_phase: String,
    pub loop_index: u32,
    pub stop_reason: String,
    pub final_response: String,
    pub approval_required: bool,
    pub pending_approval: Option<ApprovalPendingRecord>,
    pub token_budget: u32,
    pub tokens_estimate: u32,
    pub tool_call_count: u32,
    pub trace: Vec<TraceEvent>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApprovalObservationRecord {
    pub tool_name: String,
    pub summary: String,
    pub content: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApprovalPolicyRecord {
    pub scope: String,
    pub decision: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApprovalToolCallRecord {
    pub call_id: String,
    pub tool_name: String,
    pub requested_by: String,
    pub arguments: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApprovalPendingRecord {
    pub tool_name: String,
    pub reason: String,
    pub argument_summary: String,
}

#[derive(Debug, Default)]
pub struct RuntimeCore;

impl RuntimeCore {
    pub fn run(&self, request: RunRequest) -> RunResult {
        let session = Session::new(request);
        let agent_id = next_agent_id();
        let mut trace = InMemoryTraceStore::default();

        trace.push(TraceEvent::new(
            session.session_id.clone(),
            agent_id.clone(),
            None,
            0,
            TraceEventKind::TaskReceived,
            format!(
                "task_id={} task={}",
                session.task.task_id, session.task.input
            ),
        ));

        let mut state = RuntimeState {
            session_id: session.session_id.clone(),
            task_id: session.task.task_id.clone(),
            agent_id: agent_id.clone(),
            parent_agent_id: None,
            loop_index: 0,
            status: RuntimeStatus::Created,
            current_phase: RuntimePhase::Input,
            active_step: None,
            active_context_snapshot: None,
            active_model_request: None,
            last_model_response: None,
            active_tool_call: None,
            last_tool_result: None,
            observations: Vec::new(),
            policy_decisions: Vec::new(),
            pending_approval: None,
            budget_usage: BudgetUsage::default(),
            stop_reason: None,
        };
        let final_response = self.run_agent_loop(&session, &mut state, &mut trace, 1);

        if state.stop_reason.is_none() && state.pending_approval.is_none() {
            state.stop_reason = Some(StopReason::MaxLoopsReached);
        }

        if state.pending_approval.is_some() {
            state.status = RuntimeStatus::WaitingApproval;
            let record = self.build_approval_session_record(&state, &session);
            self.save_approval_session(&record)
                .expect("failed to save pending approval session");
        } else {
            self.transition(&mut state, RuntimeStatus::Completed, None);
            state.current_phase = RuntimePhase::Finalize;
        }
        let final_response = final_response.unwrap_or_else(|| {
            format!(
                "ForgeOne runtime skeleton completed task: {}",
                session.task.input
            )
        });

        trace.push(TraceEvent::new(
            session.session_id.clone(),
            agent_id,
            state.parent_agent_id.clone(),
            state.loop_index,
            TraceEventKind::SessionStopped,
            format!(
                "task_id={} phase={} status={} stop_reason={}",
                state.task_id,
                state.current_phase,
                state.status,
                state
                    .stop_reason
                    .as_ref()
                    .map(ToString::to_string)
                    .unwrap_or_else(|| "approval_required".to_string())
            ),
        ));

        let trace_events = trace.into_events();
        let result = RunResult {
            state,
            final_response,
            trace: trace_events,
        };
        let trace_record = self.build_session_trace_record(&result, &session.task.input, session.config.token_budget);
        self.save_session_trace(&trace_record)
            .expect("failed to save session trace");
        result
    }

    pub fn approve_session(&self, session_id: &str) -> Result<RunResult, String> {
        let record = self.load_approval_session(session_id)?;
        let mut trace = InMemoryTraceStore::default();

        let mut state = RuntimeState {
            session_id: record.session_id.clone(),
            task_id: record.task_id.clone(),
            agent_id: record.agent_id.clone(),
            parent_agent_id: None,
            loop_index: record.loop_index,
            status: RuntimeStatus::Running,
            current_phase: RuntimePhase::ToolDecision,
            active_step: Some(LoopStep::ToolDecision),
            active_context_snapshot: None,
            active_model_request: None,
            last_model_response: None,
            active_tool_call: Some(ToolCallRequest {
                call_id: record.active_tool_call.call_id.clone(),
                session_id: record.session_id.clone(),
                agent_id: record.agent_id.clone(),
                loop_index: record.loop_index,
                tool_name: record.active_tool_call.tool_name.clone(),
                arguments: record.active_tool_call.arguments.clone(),
                requested_by: record.active_tool_call.requested_by.clone(),
            }),
            last_tool_result: None,
            observations: record
                .observations
                .iter()
                .map(|observation| Observation {
                    tool_name: observation.tool_name.clone(),
                    summary: observation.summary.clone(),
                    content: None,
                })
                .collect(),
            policy_decisions: record
                .policy_decisions
                .iter()
                .map(|decision| PolicyRecord {
                    scope: decision.scope.clone(),
                    decision: decision.decision.clone(),
                    detail: decision.detail.clone(),
                })
                .collect(),
            pending_approval: Some(PendingApproval {
                tool_name: record.pending_approval.tool_name.clone(),
                reason: record.pending_approval.reason.clone(),
                argument_summary: record.pending_approval.argument_summary.clone(),
            }),
            budget_usage: BudgetUsage {
                tokens_estimate: record.tokens_estimate,
                tool_call_count: record.tool_call_count,
            },
            stop_reason: None,
        };

        trace.push(TraceEvent::new(
            state.session_id.clone(),
            state.agent_id.clone(),
            state.parent_agent_id.clone(),
            state.loop_index,
            TraceEventKind::TaskReceived,
            format!("task_id={} approval_resumed=true", state.task_id),
        ));

        state.policy_decisions.push(PolicyRecord {
            scope: "tool_call".to_string(),
            decision: "approved_by_user".to_string(),
            detail: format!(
                "tool={} approved via forgeone approve",
                record.active_tool_call.tool_name
            ),
        });
        state.pending_approval = None;

        self.transition(
            &mut state,
            RuntimeStatus::Running,
            Some(LoopStep::ToolExecution),
        );
        self.emit_policy_checked(&mut trace, &state);
        self.execute_tool_call(&mut state, None);
        self.emit_tool_completed(&mut trace, &state);

        self.complete_state_update(&mut trace, &mut state);

        let config = RuntimeConfig {
            max_loops: record.max_loops,
            token_budget: record.token_budget,
            model_name: record.model_name.clone(),
            policy: PolicyConfig {
                allowed_tools: record.allowed_tools.clone(),
                read_roots: record.read_roots.clone(),
                max_tool_calls: record.max_tool_calls,
                approval_read_roots: record.approval_read_roots.clone(),
            },
        };

        let session = Session {
            session_id: record.session_id.clone(),
            task: Task {
                task_id: record.task_id.clone(),
                input: record.task_input.clone(),
            },
            config,
        };

        let final_response = self.run_agent_loop(&session, &mut state, &mut trace, record.loop_index + 1);

        if state.stop_reason.is_none() {
            state.stop_reason = Some(StopReason::MaxLoopsReached);
        }
        self.transition(&mut state, RuntimeStatus::Completed, None);
        state.current_phase = RuntimePhase::Finalize;

        let final_response = final_response.unwrap_or_else(|| {
            format!(
                "ForgeOne runtime skeleton completed task: {}",
                session.task.input
            )
        });

        trace.push(TraceEvent::new(
            state.session_id.clone(),
            state.agent_id.clone(),
            state.parent_agent_id.clone(),
            state.loop_index,
            TraceEventKind::SessionStopped,
            format!(
                "task_id={} phase={} status={} stop_reason={}",
                state.task_id,
                state.current_phase,
                state.status,
                state
                    .stop_reason
                    .as_ref()
                    .map(ToString::to_string)
                    .unwrap_or_else(|| "unknown".to_string())
            ),
        ));

        self.delete_approval_session(session_id)?;

        let result = RunResult {
            state,
            final_response,
            trace: trace.into_events(),
        };
        let trace_record =
            self.build_session_trace_record(&result, &session.task.input, session.config.token_budget);
        self.save_session_trace(&trace_record)
            .map_err(|error| format!("failed to save session trace: {error}"))?;

        Ok(result)
    }

    pub fn inspect_approval_session(
        &self,
        session_id: &str,
    ) -> Result<ApprovalSessionRecord, String> {
        self.load_approval_session(session_id)
    }

    pub fn inspect_session_trace(&self, session_id: &str) -> Result<SessionTraceRecord, String> {
        self.load_session_trace(session_id)
    }

    pub fn resume_session(&self, session_id: &str) -> Result<RunResult, String> {
        if approval_session_path(session_id).exists() {
            return self.approve_session(session_id);
        }

        let trace = self.load_session_trace(session_id)?;
        Err(format!(
            "session {} is not resumable in the current runtime: status={} stop_reason={}",
            session_id, trace.status, trace.stop_reason
        ))
    }

    pub fn list_session_traces(&self) -> Result<Vec<SessionTraceRecord>, String> {
        let mut records = Vec::new();
        let dir = Path::new(".forgeone").join("traces");
        if !dir.exists() {
            return Ok(records);
        }

        for entry in fs::read_dir(dir).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            let path = entry.path();
            if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
                continue;
            }
            let payload = fs::read_to_string(&path).map_err(|error| error.to_string())?;
            let record =
                serde_json::from_str::<SessionTraceRecord>(&payload).map_err(|error| error.to_string())?;
            records.push(record);
        }

        records.sort_by(|a, b| b.session_id.cmp(&a.session_id));
        Ok(records)
    }

    pub fn list_pending_approvals(&self) -> Result<Vec<ApprovalSessionRecord>, String> {
        let mut records = Vec::new();
        let dir = Path::new(".forgeone").join("sessions");
        if !dir.exists() {
            return Ok(records);
        }

        for entry in fs::read_dir(dir).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            let path = entry.path();
            if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
                continue;
            }
            let payload = fs::read_to_string(&path).map_err(|error| error.to_string())?;
            let record = serde_json::from_str::<ApprovalSessionRecord>(&payload)
                .map_err(|error| error.to_string())?;
            records.push(record);
        }

        records.sort_by(|a, b| b.session_id.cmp(&a.session_id));
        Ok(records)
    }

    pub fn prune_session_traces(&self) -> Result<usize, String> {
        let dir = Path::new(".forgeone").join("traces");
        prune_json_dir(&dir)
    }

    pub fn prune_pending_approvals(&self) -> Result<usize, String> {
        let dir = Path::new(".forgeone").join("sessions");
        prune_json_dir(&dir)
    }

    fn run_agent_loop(
        &self,
        session: &Session,
        state: &mut RuntimeState,
        trace: &mut InMemoryTraceStore,
        start_loop_index: u32,
    ) -> Option<String> {
        let mut final_response = None;

        for loop_index in start_loop_index..=session.config.max_loops {
            state.loop_index = loop_index;
            self.transition(
                state,
                RuntimeStatus::Running,
                Some(LoopStep::ContextBuild),
            );
            self.emit_loop_started(trace, state);
            state.active_context_snapshot = Some(self.build_context_snapshot(state, session));
            self.emit_context_built(trace, state);

            self.transition(
                state,
                RuntimeStatus::Running,
                Some(LoopStep::ModelRequest),
            );
            state.active_model_request = Some(self.build_model_request(state, &session.config));
            state.last_model_response = Some(self.request_model(state));
            self.emit_model_requested(trace, state, &session.config);
            self.emit_model_responded(trace, state);

            self.transition(
                state,
                RuntimeStatus::Running,
                Some(LoopStep::ToolDecision),
            );
            state.active_tool_call = self.decide_tool_call(state);
            if state.active_tool_call.is_none() {
                final_response = self.extract_final_response(state);
                state.stop_reason = Some(StopReason::FinalResponse);
            }
            self.emit_tool_decision(trace, state);

            if state.active_tool_call.is_none() {
                self.complete_state_update(trace, state);
                break;
            }

            self.transition(
                state,
                RuntimeStatus::Running,
                Some(LoopStep::ToolExecution),
            );
            let execution_outcome = self.execute_tool_call(state, Some(&session.config.policy));
            self.emit_policy_checked(trace, state);
            self.emit_tool_completed(trace, state);

            if matches!(execution_outcome, ToolExecutionOutcome::WaitingApproval) {
                break;
            }

            self.complete_state_update(trace, state);
        }

        final_response
    }

    fn complete_state_update(
        &self,
        trace: &mut InMemoryTraceStore,
        state: &mut RuntimeState,
    ) {
        self.transition(
            state,
            RuntimeStatus::Running,
            Some(LoopStep::StateUpdate),
        );
        state.budget_usage.tokens_estimate += 512;
        if let Some(snapshot) = &state.active_context_snapshot {
            state.budget_usage.tokens_estimate += snapshot.budget_estimate;
        }
        self.emit_state_updated(trace, state);
    }

    fn transition(&self, state: &mut RuntimeState, status: RuntimeStatus, step: Option<LoopStep>) {
        state.status = status;
        state.active_step = step;
        state.current_phase = step.map(LoopStep::phase).unwrap_or(RuntimePhase::Input);
    }

    fn emit_loop_started(&self, trace: &mut InMemoryTraceStore, state: &RuntimeState) {
        trace.push(TraceEvent::new(
            state.session_id.clone(),
            state.agent_id.clone(),
            state.parent_agent_id.clone(),
            state.loop_index,
            TraceEventKind::LoopStarted,
            format!(
                "task_id={} phase={} status={} agent loop started",
                state.task_id, state.current_phase, state.status
            ),
        ));
    }

    fn emit_context_built(&self, trace: &mut InMemoryTraceStore, state: &RuntimeState) {
        let snapshot = state
            .active_context_snapshot
            .as_ref()
            .expect("context snapshot should exist during context_build");
        trace.push(TraceEvent::new(
            state.session_id.clone(),
            state.agent_id.clone(),
            state.parent_agent_id.clone(),
            state.loop_index,
            TraceEventKind::ContextBuilt,
            format!(
                "task_id={} phase={} {}",
                state.task_id,
                state.current_phase,
                snapshot.summary()
            ),
        ));
    }

    fn emit_model_requested(
        &self,
        trace: &mut InMemoryTraceStore,
        state: &RuntimeState,
        config: &RuntimeConfig,
    ) {
        let model_request = state
            .active_model_request
            .as_ref()
            .expect("model request should exist during model_request");
        trace.push(TraceEvent::new(
            state.session_id.clone(),
            state.agent_id.clone(),
            state.parent_agent_id.clone(),
            state.loop_index,
            TraceEventKind::ModelRequested,
            format!(
                "task_id={} phase={} model={} token_budget={} {}",
                state.task_id,
                state.current_phase,
                config.model_name,
                config.token_budget,
                model_request.summary()
            ),
        ));
    }

    fn emit_model_responded(&self, trace: &mut InMemoryTraceStore, state: &RuntimeState) {
        let response = state
            .last_model_response
            .as_ref()
            .expect("model response should exist during model_response");
        trace.push(TraceEvent::new(
            state.session_id.clone(),
            state.agent_id.clone(),
            state.parent_agent_id.clone(),
            state.loop_index,
            TraceEventKind::ModelResponded,
            format!(
                "task_id={} phase={} response_id={} summary={}",
                state.task_id, state.current_phase, response.response_id, response.summary
            ),
        ));
    }

    fn emit_tool_decision(&self, trace: &mut InMemoryTraceStore, state: &RuntimeState) {
        if let Some(call) = state.active_tool_call.as_ref() {
            trace.push(TraceEvent::new(
                state.session_id.clone(),
                state.agent_id.clone(),
                state.parent_agent_id.clone(),
                state.loop_index,
                TraceEventKind::ToolRequested,
                format!(
                    "task_id={} phase={} tool_call={} requested_by={}",
                    state.task_id, state.current_phase, call.tool_name, call.requested_by
                ),
            ));
        } else {
            trace.push(TraceEvent::new(
                state.session_id.clone(),
                state.agent_id.clone(),
                state.parent_agent_id.clone(),
                state.loop_index,
                TraceEventKind::StateUpdated,
                format!(
                    "task_id={} phase={} tool_decision=final_response",
                    state.task_id, state.current_phase
                ),
            ));
        }
    }

    fn emit_tool_completed(&self, trace: &mut InMemoryTraceStore, state: &RuntimeState) {
        if let Some(result) = &state.last_tool_result {
            trace.push(TraceEvent::new(
                state.session_id.clone(),
                state.agent_id.clone(),
                state.parent_agent_id.clone(),
                state.loop_index,
                TraceEventKind::ToolCompleted,
                format!(
                    "task_id={} phase={} {}",
                    state.task_id,
                    LoopStep::ToolExecution,
                    result.summary()
                ),
            ));
        }
    }

    fn emit_policy_checked(&self, trace: &mut InMemoryTraceStore, state: &RuntimeState) {
        if let Some(record) = state.policy_decisions.last() {
            trace.push(TraceEvent::new(
                state.session_id.clone(),
                state.agent_id.clone(),
                state.parent_agent_id.clone(),
                state.loop_index,
                TraceEventKind::PolicyChecked,
                format!(
                    "task_id={} scope={} decision={} detail={}",
                    state.task_id, record.scope, record.decision, record.detail
                ),
            ));
        }
    }

    fn emit_state_updated(&self, trace: &mut InMemoryTraceStore, state: &RuntimeState) {
        trace.push(TraceEvent::new(
            state.session_id.clone(),
            state.agent_id.clone(),
            state.parent_agent_id.clone(),
            state.loop_index,
            TraceEventKind::StateUpdated,
            format!(
                "task_id={} phase={} status={} tokens_estimate={} tool_call_count={} policy_decisions={}",
                state.task_id,
                state.current_phase,
                state.status,
                state.budget_usage.tokens_estimate,
                state.budget_usage.tool_call_count,
                state.policy_decisions.len()
            ),
        ));
    }

    fn build_context_snapshot(&self, state: &RuntimeState, session: &Session) -> ContextSnapshot {
        let engine = DefaultContextEngine;
        let registry = ToolRegistry::with_builtin_tools();
        let tool_info: Vec<ToolInfo> = registry
            .descriptors()
            .into_iter()
            .map(|d: ToolDescriptor| ToolInfo {
                name: d.tool_name,
                description: d.description,
            })
            .collect();
        engine.build(ContextBuildInput {
            session_id: state.session_id.clone(),
            agent_id: state.agent_id.clone(),
            loop_index: state.loop_index,
            task_input: session.task.input.clone(),
            session_history: vec![format!(
                "loop={} phase={} status={}",
                state.loop_index, state.current_phase, state.status
            )],
            tool_observations: self.to_observation_summaries(&state.observations),
            system_prompt: SYSTEM_PROMPT.to_string(),
            policy_injections: vec![
                "Keep context transparent and bounded by budget.".to_string(),
                "Do not rely on hidden prompt state.".to_string(),
            ],
            working_memory: WorkingMemory {
                current_goal: session.task.input.clone(),
                completed_items: vec!["task received".to_string()],
                pending_items: vec![
                    "produce model request".to_string(),
                    "decide next action".to_string(),
                ],
            },
            token_budget: session.config.token_budget / 2,
            tool_descriptors: tool_info,
        })
    }

    fn build_model_request(&self, state: &RuntimeState, config: &RuntimeConfig) -> ModelRequest {
        let snapshot = state
            .active_context_snapshot
            .as_ref()
            .expect("context snapshot should exist before model request");

        ModelRequest {
            request_id: next_model_request_id(),
            model_name: config.model_name.clone(),
            messages: snapshot.prompt_messages.clone(),
            prompt_token_estimate: snapshot.budget_estimate,
        }
    }

    fn request_model(&self, state: &RuntimeState) -> ModelResponse {
        let request = state
            .active_model_request
            .as_ref()
            .expect("model request should exist before model adapter call");

        // Dispatch to the appropriate adapter based on model_name prefix.
        // Format: "openai:gpt-4o" or "ollama:qwen2.5-coder:7b" or "mock" (default).
        let model_name = &request.model_name;
        if model_name.starts_with("openai:") {
            #[cfg(feature = "openai")]
            {
                let adapter = forgeone_model_openai::OpenAiModelAdapter::from_env();
                return adapter.respond(request);
            }
            #[cfg(not(feature = "openai"))]
            {
                return ModelResponse {
                    response_id: next_model_request_id(),
                    action: ModelAction::FinalResponse {
                        content: format!(
                            "[runtime] openai feature not enabled for model={model_name}"
                        ),
                    },
                    summary: "openai adapter unavailable".to_string(),
                };
            }
        }

        if model_name.starts_with("ollama:") {
            #[cfg(feature = "ollama")]
            {
                let adapter = forgeone_model_ollama::OllamaModelAdapter::from_env();
                return adapter.respond(request);
            }
            #[cfg(not(feature = "ollama"))]
            {
                return ModelResponse {
                    response_id: next_model_request_id(),
                    action: ModelAction::FinalResponse {
                        content: format!(
                            "[runtime] ollama feature not enabled for model={model_name}"
                        ),
                    },
                    summary: "ollama adapter unavailable".to_string(),
                };
            }
        }

        // Fall back to MockModelAdapter for unknown / test model names
        let adapter = MockModelAdapter;
        adapter.respond(request)
    }

    fn decide_tool_call(&self, state: &RuntimeState) -> Option<ToolCallRequest> {
        let response = state
            .last_model_response
            .as_ref()
            .expect("model response should exist before tool decision");

        match &response.action {
            ModelAction::RequestTool {
                tool_name,
                arguments,
            } => Some(ToolCallRequest {
                call_id: next_tool_call_id(),
                session_id: state.session_id.clone(),
                agent_id: state.agent_id.clone(),
                loop_index: state.loop_index,
                tool_name: tool_name.clone(),
                arguments: arguments.clone(),
                requested_by: "model".to_string(),
            }),
            ModelAction::FinalResponse { .. } => None,
        }
    }

    fn extract_final_response(&self, state: &RuntimeState) -> Option<String> {
        let response = state.last_model_response.as_ref()?;
        match &response.action {
            ModelAction::FinalResponse { content } => Some(content.clone()),
            ModelAction::RequestTool { .. } => None,
        }
    }

    fn execute_tool_call(
        &self,
        state: &mut RuntimeState,
        policy: Option<&PolicyConfig>,
    ) -> ToolExecutionOutcome {
        let Some(request) = state.active_tool_call.clone() else {
            return ToolExecutionOutcome::NoCall;
        };

        if let Some(policy) = policy {
            let policy_engine = PolicyEngine::new(policy.clone());
            match policy_engine.check_tool_call(&request, state.budget_usage.tool_call_count) {
                PolicyDecision::Allowed => {
                    state.policy_decisions.push(PolicyRecord {
                        scope: "tool_call".to_string(),
                        decision: "allowed".to_string(),
                        detail: format!("tool={} passed policy checks", request.tool_name),
                    });
                }
                PolicyDecision::RequireApproval(approval) => {
                    self.record_approval_required(state, approval);
                    return ToolExecutionOutcome::WaitingApproval;
                }
                PolicyDecision::Denied(violation) => {
                    state.policy_decisions.push(PolicyRecord {
                        scope: "tool_call".to_string(),
                        decision: "denied".to_string(),
                        detail: format!("code={} message={}", violation.code, violation.message),
                    });
                    // Push an observation so the model sees why the call was denied
                    state.observations.push(Observation {
                        tool_name: request.tool_name.clone(),
                        summary: format!(
                            "tool={} status=denied reason={}",
                            request.tool_name, violation.message
                        ),
                        content: None,
                    });
                    state.last_tool_result = Some(ToolCallResult {
                        call_id: request.call_id.clone(),
                        status: forgeone_tools::ToolCallStatus::PermissionDenied,
                        structured_output: HashMap::new(),
                        error: Some(violation.message),
                        completed_at_ms: now_ms(),
                    });
                    return ToolExecutionOutcome::Denied;
                }
            }
        }

        let registry = ToolRegistry::with_builtin_tools();
        let result = registry.execute(&request);
        let observation = build_observation(&request, &result);
        state.observations.push(observation);
        state.last_tool_result = Some(result);
        state.budget_usage.tool_call_count = state.budget_usage.tool_call_count.saturating_add(1);
        ToolExecutionOutcome::Executed
    }

    fn to_observation_summaries(&self, observations: &[Observation]) -> Vec<ObservationSummary> {
        observations
            .iter()
            .map(|observation| ObservationSummary {
                tool_name: observation.tool_name.clone(),
                summary: observation.summary.clone(),
                content: observation.content.clone(),
            })
            .collect()
    }

    fn record_approval_required(&self, state: &mut RuntimeState, approval: ApprovalRequest) {
        state.policy_decisions.push(PolicyRecord {
            scope: "tool_call".to_string(),
            decision: "require_approval".to_string(),
            detail: approval.reason.clone(),
        });
        state.pending_approval = Some(PendingApproval {
            tool_name: approval.tool_name,
            reason: approval.reason,
            argument_summary: approval.argument_summary,
        });
        state.last_tool_result = None;
        state.status = RuntimeStatus::WaitingApproval;
    }

    fn build_approval_session_record(
        &self,
        state: &RuntimeState,
        session: &Session,
    ) -> ApprovalSessionRecord {
        let active_tool_call = state
            .active_tool_call
            .as_ref()
            .expect("pending approval requires active tool call");
        let pending_approval = state
            .pending_approval
            .as_ref()
            .expect("pending approval requires approval payload");

        ApprovalSessionRecord {
            session_id: state.session_id.clone(),
            task_id: state.task_id.clone(),
            task_input: session.task.input.clone(),
            agent_id: state.agent_id.clone(),
            loop_index: state.loop_index,
            max_loops: session.config.max_loops,
            token_budget: session.config.token_budget,
            model_name: session.config.model_name.clone(),
            allowed_tools: session.config.policy.allowed_tools.clone(),
            read_roots: session.config.policy.read_roots.clone(),
            approval_read_roots: session.config.policy.approval_read_roots.clone(),
            max_tool_calls: session.config.policy.max_tool_calls,
            tokens_estimate: state.budget_usage.tokens_estimate,
            tool_call_count: state.budget_usage.tool_call_count,
            observations: state
                .observations
                .iter()
                .map(|observation| ApprovalObservationRecord {
                    tool_name: observation.tool_name.clone(),
                    summary: observation.summary.clone(),
                    content: observation.content.clone(),
                })
                .collect(),
            policy_decisions: state
                .policy_decisions
                .iter()
                .map(|decision| ApprovalPolicyRecord {
                    scope: decision.scope.clone(),
                    decision: decision.decision.clone(),
                    detail: decision.detail.clone(),
                })
                .collect(),
            active_tool_call: ApprovalToolCallRecord {
                call_id: active_tool_call.call_id.clone(),
                tool_name: active_tool_call.tool_name.clone(),
                requested_by: active_tool_call.requested_by.clone(),
                arguments: active_tool_call.arguments.clone(),
            },
            pending_approval: ApprovalPendingRecord {
                tool_name: pending_approval.tool_name.clone(),
                reason: pending_approval.reason.clone(),
                argument_summary: pending_approval.argument_summary.clone(),
            },
        }
    }

    fn save_approval_session(&self, record: &ApprovalSessionRecord) -> Result<(), String> {
        let path = approval_session_path(&record.session_id);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let payload = serde_json::to_string_pretty(record).map_err(|error| error.to_string())?;
        fs::write(path, payload).map_err(|error| error.to_string())
    }

    fn load_approval_session(&self, session_id: &str) -> Result<ApprovalSessionRecord, String> {
        let path = approval_session_path(session_id);
        let payload = fs::read_to_string(&path)
            .map_err(|error| format!("failed to read session {}: {}", session_id, error))?;
        serde_json::from_str(&payload)
            .map_err(|error| format!("failed to parse session {}: {}", session_id, error))
    }

    fn delete_approval_session(&self, session_id: &str) -> Result<(), String> {
        let path = approval_session_path(session_id);
        if path.exists() {
            fs::remove_file(path).map_err(|error| error.to_string())?;
        }
        Ok(())
    }

    fn build_session_trace_record(
        &self,
        result: &RunResult,
        task_input: &str,
        token_budget: u32,
    ) -> SessionTraceRecord {
        SessionTraceRecord {
            session_id: result.state.session_id.clone(),
            task_id: result.state.task_id.clone(),
            task_input: task_input.to_string(),
            agent_id: result.state.agent_id.clone(),
            status: result.state.status.to_string(),
            current_phase: result.state.current_phase.to_string(),
            loop_index: result.state.loop_index,
            stop_reason: result
                .state
                .stop_reason
                .as_ref()
                .map(ToString::to_string)
                .unwrap_or_else(|| "unknown".to_string()),
            final_response: result.final_response.clone(),
            approval_required: result.state.pending_approval.is_some(),
            pending_approval: result
                .state
                .pending_approval
                .as_ref()
                .map(|approval| ApprovalPendingRecord {
                    tool_name: approval.tool_name.clone(),
                    reason: approval.reason.clone(),
                    argument_summary: approval.argument_summary.clone(),
                }),
            token_budget,
            tokens_estimate: result.state.budget_usage.tokens_estimate,
            tool_call_count: result.state.budget_usage.tool_call_count,
            trace: result.trace.clone(),
        }
    }

    fn save_session_trace(&self, record: &SessionTraceRecord) -> Result<(), String> {
        let path = session_trace_path(&record.session_id);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let payload = serde_json::to_string_pretty(record).map_err(|error| error.to_string())?;
        fs::write(path, payload).map_err(|error| error.to_string())
    }

    fn load_session_trace(&self, session_id: &str) -> Result<SessionTraceRecord, String> {
        let path = session_trace_path(session_id);
        let payload = fs::read_to_string(&path)
            .map_err(|error| format!("failed to read trace {}: {}", session_id, error))?;
        serde_json::from_str(&payload)
            .map_err(|error| format!("failed to parse trace {}: {}", session_id, error))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ToolExecutionOutcome {
    NoCall,
    Executed,
    WaitingApproval,
    Denied,
}

impl Session {
    fn new(request: RunRequest) -> Self {
        let session_id = next_session_id();
        let task = Task::new(request.task);
        Self {
            session_id,
            task,
            config: request.config,
        }
    }
}

impl Task {
    fn new(input: String) -> Self {
        Self {
            task_id: next_task_id(),
            input,
        }
    }
}

fn next_session_id() -> String {
    let counter = SESSION_COUNTER.fetch_add(1, Ordering::Relaxed);
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time should be after unix epoch")
        .as_millis();
    let pid = std::process::id();
    format!("session-{timestamp}-{pid}-{counter}")
}

fn next_agent_id() -> String {
    let counter = AGENT_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("agent-{counter}")
}

fn next_task_id() -> String {
    let counter = SESSION_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("task-{counter}")
}

/// Extract tool output content for observation, using whatever key is available.
/// Different tools return different keys (preview, files, matches, stdout).
fn extract_observation_content(output: &HashMap<String, String>) -> Option<String> {
    // Priority order: the most useful keys for the model
    for key in &["files", "matches", "preview", "stdout"] {
        if let Some(value) = output.get(*key) {
            let truncated: String = value.lines().take(100).collect::<Vec<_>>().join("\n");
            // Skip if it's just a count line
            if truncated.len() > 10 {
                return Some(truncated);
            }
        }
    }
    None
}

fn build_observation(request: &ToolCallRequest, result: &ToolCallResult) -> Observation {
    let summary = if let Some(error) = &result.error {
        format!(
            "tool={} status={} error={}",
            request.tool_name, result.status, error
        )
    } else {
        let preview = result
            .structured_output
            .get("preview")
            .or_else(|| result.structured_output.get("files"))
            .or_else(|| result.structured_output.get("matches"))
            .or_else(|| result.structured_output.get("stdout"))
            .map(|preview| preview.lines().next().unwrap_or(""))
            .unwrap_or("");
        format!(
            "tool={} status={} preview={}",
            request.tool_name, result.status, preview
        )
    };

    Observation {
        tool_name: request.tool_name.clone(),
        summary,
        content: extract_observation_content(&result.structured_output),
    }
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time should be after unix epoch")
        .as_millis()
}

fn approval_session_path(session_id: &str) -> PathBuf {
    Path::new(".forgeone")
        .join("sessions")
        .join(format!("{session_id}.json"))
}

fn session_trace_path(session_id: &str) -> PathBuf {
    Path::new(".forgeone")
        .join("traces")
        .join(format!("{session_id}.json"))
}

fn prune_json_dir(dir: &Path) -> Result<usize, String> {
    if !dir.exists() {
        return Ok(0);
    }

    let mut deleted = 0usize;
    for entry in fs::read_dir(dir).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) == Some("json") {
            fs::remove_file(path).map_err(|error| error.to_string())?;
            deleted += 1;
        }
    }

    Ok(deleted)
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use forgeone_tools::ToolCallRequest;

    use super::{
        LoopStep, RunRequest, RuntimeConfig, RuntimeCore, RuntimePhase, RuntimeState,
        RuntimeStatus, StopReason,
    };

    #[test]
    fn runtime_emits_final_response_and_trace() {
        let core = RuntimeCore;
        let result = core.run(RunRequest {
            task: "inspect repo".to_string(),
            config: RuntimeConfig::default(),
        });

        assert_eq!(
            result.final_response,
            "Mock model produced final response after observation"
        );
        assert_eq!(result.state.stop_reason, Some(StopReason::FinalResponse));
        assert_eq!(result.state.loop_index, 2);
        assert_eq!(
            result.state.status.to_string(),
            RuntimeStatus::Completed.to_string()
        );
        assert_eq!(
            result.state.current_phase.to_string(),
            RuntimePhase::Finalize.to_string()
        );
        assert!(result.state.agent_id.starts_with("agent-"));
        assert!(result.state.task_id.starts_with("task-"));
        assert!(result.state.active_context_snapshot.is_some());
        assert!(result.state.active_model_request.is_some());
        assert!(result.state.last_model_response.is_some());
        assert!(result.state.active_tool_call.is_none());
        assert!(result.state.pending_approval.is_none());
        assert!(result.state.last_tool_result.is_some());
        assert!(!result.state.observations.is_empty());
        assert!(!result.state.policy_decisions.is_empty());
        assert_eq!(result.state.active_step, None);
        assert!(result.state.budget_usage.tokens_estimate >= 512);
        assert!(result.state.budget_usage.tool_call_count >= 1);
        assert!(result.trace.len() >= 12);
    }

    #[test]
    fn runtime_can_enter_waiting_approval() {
        let core = RuntimeCore;
        let mut config = RuntimeConfig::default();
        config.policy.approval_read_roots = vec!["crates/".to_string()];

        let result = core.run(RunRequest {
            task: "inspect runtime".to_string(),
            config,
        });

        assert_eq!(
            result.state.status.to_string(),
            RuntimeStatus::WaitingApproval.to_string()
        );
        assert!(result.state.pending_approval.is_some());
        assert!(result.state.last_tool_result.is_none());
    }

    #[test]
    fn loop_step_maps_to_runtime_phase() {
        assert_eq!(LoopStep::ContextBuild.phase(), RuntimePhase::ContextBuild);
        assert_eq!(LoopStep::ModelRequest.phase(), RuntimePhase::ModelRequest);
        assert_eq!(LoopStep::ToolDecision.phase(), RuntimePhase::ToolDecision);
        assert_eq!(LoopStep::StateUpdate.phase(), RuntimePhase::StateUpdate);
    }

    #[test]
    fn denied_tool_call_does_not_consume_execution_budget() {
        let core = RuntimeCore;
        let mut config = RuntimeConfig::default();
        config.policy.max_tool_calls = 1;

        let mut state = build_test_state("search_files", [("pattern", "Cargo.toml"), ("path", "/etc")]);
        let outcome = core.execute_tool_call(&mut state, Some(&config.policy));

        assert!(matches!(outcome, super::ToolExecutionOutcome::Denied));
        assert_eq!(state.budget_usage.tool_call_count, 0);
        assert_eq!(state.observations.len(), 1);
        assert!(state
            .last_tool_result
            .as_ref()
            .is_some_and(|result| result.status == forgeone_tools::ToolCallStatus::PermissionDenied));
    }

    #[test]
    fn empty_observations_do_not_inject_placeholder_summary() {
        let core = RuntimeCore;
        let summaries = core.to_observation_summaries(&[]);
        assert!(summaries.is_empty());
    }

    fn build_test_state<const N: usize>(
        tool_name: &str,
        arguments: [(&str, &str); N],
    ) -> RuntimeState {
        let arguments = HashMap::from_iter(
            arguments
                .into_iter()
                .map(|(key, value)| (key.to_string(), value.to_string())),
        );

        RuntimeState {
            session_id: "session-test".to_string(),
            task_id: "task-test".to_string(),
            agent_id: "agent-test".to_string(),
            parent_agent_id: None,
            loop_index: 1,
            status: RuntimeStatus::Running,
            current_phase: RuntimePhase::ToolDecision,
            active_step: Some(LoopStep::ToolDecision),
            active_context_snapshot: None,
            active_model_request: None,
            last_model_response: None,
            active_tool_call: Some(ToolCallRequest {
                call_id: "tool-call-test".to_string(),
                session_id: "session-test".to_string(),
                agent_id: "agent-test".to_string(),
                loop_index: 1,
                tool_name: tool_name.to_string(),
                arguments,
                requested_by: "model".to_string(),
            }),
            last_tool_result: None,
            observations: Vec::new(),
            policy_decisions: Vec::new(),
            pending_approval: None,
            budget_usage: super::BudgetUsage::default(),
            stop_reason: None,
        }
    }
}
