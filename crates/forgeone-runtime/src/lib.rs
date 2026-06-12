use std::collections::HashMap;
use std::fmt;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use forgeone_context::{
    ContextBuildInput, ContextEngine, ContextLayer, ContextSnapshot, DefaultContextEngine,
    ObservationSummary, ToolInfo, WorkingMemory, WorkingSet,
};
use forgeone_model::{
    MockModelAdapter, ModelAction, ModelAdapter, ModelCapabilities, ModelRequest,
    ModelRequestEstimate, ModelResponse, next_model_request_id,
};
use forgeone_policy::{ApprovalRequest, PolicyConfig, PolicyDecision, PolicyEngine};
pub use forgeone_session::{
    ApprovalObservationRecord, ApprovalPendingRecord, ApprovalPolicyRecord, ApprovalSessionRecord,
    ApprovalToolCallRecord, FileSessionStore, SessionStore, SessionTraceRecord,
};
use forgeone_tools::{
    Observation, ToolCallRequest, ToolCallResult, ToolDescriptor, ToolRegistry, next_tool_call_id,
};
use forgeone_trace::{InMemoryTraceStore, TraceEvent, TraceEventKind};

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
    pub last_executed_tool_signature: Option<String>,
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

#[derive(Debug, Clone)]
pub struct RuntimeCore<S = FileSessionStore> {
    session_store: S,
}

impl Default for RuntimeCore<FileSessionStore> {
    fn default() -> Self {
        Self {
            session_store: FileSessionStore,
        }
    }
}

impl<S> RuntimeCore<S> {
    pub fn with_session_store(session_store: S) -> Self {
        Self { session_store }
    }
}

impl<S: SessionStore> RuntimeCore<S> {
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
            last_executed_tool_signature: None,
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
        let trace_record = self.build_session_trace_record(
            &result,
            &session.task.input,
            session.config.token_budget,
        );
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
            last_executed_tool_signature: record.last_executed_tool_signature.clone(),
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

        let final_response =
            self.run_agent_loop(&session, &mut state, &mut trace, record.loop_index + 1);

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
        let trace_record = self.build_session_trace_record(
            &result,
            &session.task.input,
            session.config.token_budget,
        );
        self.save_session_trace(&trace_record)
            .map_err(|error| format!("failed to save session trace: {error}"))?;

        Ok(result)
    }

    pub fn inspect_approval_session(
        &self,
        session_id: &str,
    ) -> Result<ApprovalSessionRecord, String> {
        self.session_store.inspect_approval_session(session_id)
    }

    pub fn inspect_session_trace(&self, session_id: &str) -> Result<SessionTraceRecord, String> {
        self.session_store.inspect_session_trace(session_id)
    }

    pub fn resume_session(&self, session_id: &str) -> Result<RunResult, String> {
        if self.session_store.pending_approval_exists(session_id) {
            return self.approve_session(session_id);
        }

        let trace = self.session_store.load_session_trace(session_id)?;
        Err(format!(
            "session {} is not resumable in the current runtime: status={} stop_reason={}",
            session_id, trace.status, trace.stop_reason
        ))
    }

    pub fn list_session_traces(&self) -> Result<Vec<SessionTraceRecord>, String> {
        self.session_store.list_session_traces()
    }

    pub fn list_pending_approvals(&self) -> Result<Vec<ApprovalSessionRecord>, String> {
        self.session_store.list_pending_approvals()
    }

    pub fn prune_session_traces(&self) -> Result<usize, String> {
        self.session_store.prune_session_traces()
    }

    pub fn prune_pending_approvals(&self) -> Result<usize, String> {
        self.session_store.prune_pending_approvals()
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
            self.transition(state, RuntimeStatus::Running, Some(LoopStep::ContextBuild));
            self.emit_loop_started(trace, state);
            state.active_context_snapshot = Some(self.build_context_snapshot(state, session));
            self.emit_context_built(trace, state);

            self.transition(state, RuntimeStatus::Running, Some(LoopStep::ModelRequest));
            state.active_model_request = Some(self.build_model_request(state, &session.config));
            state.last_model_response = Some(self.request_model(state));
            self.emit_model_requested(trace, state, &session.config);
            self.emit_model_responded(trace, state);

            self.transition(state, RuntimeStatus::Running, Some(LoopStep::ToolDecision));
            state.active_tool_call = self.decide_tool_call(state);
            if let Some(request) = state.active_tool_call.clone() {
                if self.is_repeated_tool_call(state, &request) {
                    let detail = format!(
                        "tool={} arguments={} repeats the most recent successful tool call",
                        request.tool_name,
                        summarize_tool_arguments(&request.arguments)
                    );
                    state.policy_decisions.push(PolicyRecord {
                        scope: "tool_call".to_string(),
                        decision: "duplicate_blocked".to_string(),
                        detail: detail.clone(),
                    });
                    state.observations.push(Observation {
                        tool_name: request.tool_name.clone(),
                        summary: format!(
                            "tool={} status=blocked reason=repeated_tool_call",
                            request.tool_name
                        ),
                        content: Some(detail.clone()),
                    });
                    state.last_tool_result = Some(ToolCallResult {
                        call_id: request.call_id.clone(),
                        status: forgeone_tools::ToolCallStatus::PermissionDenied,
                        structured_output: HashMap::from([
                            ("reason".to_string(), "repeated_tool_call".to_string()),
                            (
                                "detail".to_string(),
                                "Reuse the prior observation or choose another tool before retrying."
                                    .to_string(),
                            ),
                        ]),
                        error: Some(detail.clone()),
                        completed_at_ms: now_ms(),
                    });
                    state.active_tool_call = None;
                    final_response = Some(format!(
                        "[runtime] stopped repeated tool call {} with identical arguments; reuse the prior observation or choose a different action.",
                        request.tool_name
                    ));
                    state.stop_reason = Some(StopReason::FinalResponse);
                }
            }
            if state.active_tool_call.is_none() {
                if final_response.is_none() {
                    final_response = self.extract_final_response(state);
                }
                state.stop_reason = Some(StopReason::FinalResponse);
            }
            self.emit_tool_decision(trace, state);

            if state.active_tool_call.is_none() {
                self.emit_policy_checked(trace, state);
                self.complete_state_update(trace, state);
                break;
            }

            self.transition(state, RuntimeStatus::Running, Some(LoopStep::ToolExecution));
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

    fn complete_state_update(&self, trace: &mut InMemoryTraceStore, state: &mut RuntimeState) {
        self.transition(state, RuntimeStatus::Running, Some(LoopStep::StateUpdate));
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
        let working_set = self.build_working_set(state);
        let model_capabilities = self.model_capabilities_for(&session.config.model_name);
        let context_token_budget = std::cmp::min(
            session.config.token_budget / 2,
            model_capabilities.input_budget() / 2,
        )
        .max(512);
        engine.build(ContextBuildInput {
            session_id: state.session_id.clone(),
            agent_id: state.agent_id.clone(),
            loop_index: state.loop_index,
            task_input: session.task.input.clone(),
            session_history: self.build_session_history(state),
            tool_observations: self.to_observation_summaries(&state.observations),
            system_prompt: SYSTEM_PROMPT.to_string(),
            policy_injections: self.build_policy_injections(state),
            working_memory: self.build_working_memory(state, session),
            working_set: working_set.clone(),
            token_budget: context_token_budget,
            tool_descriptors: self.select_tool_descriptors(state, &working_set, tool_info),
        })
    }

    fn build_session_history(&self, state: &RuntimeState) -> Vec<String> {
        let mut history = Vec::new();
        history.push(format!(
            "loop={} phase={} status={}",
            state.loop_index, state.current_phase, state.status
        ));

        if let Some(response) = &state.last_model_response {
            history.push(format!("last_model_response={}", response.summary));
        }

        if let Some(result) = &state.last_tool_result {
            history.push(format!("last_tool_result={}", result.summary()));
        }

        if let Some(policy) = state.policy_decisions.last() {
            history.push(format!(
                "last_policy_decision scope={} decision={} detail={}",
                policy.scope, policy.decision, policy.detail
            ));
        }

        if let Some(snapshot) = &state.active_context_snapshot {
            let archive_segments = snapshot
                .selected_segments
                .iter()
                .filter(|segment| segment.layer == ContextLayer::ArchiveSummary)
                .map(|segment| segment.content.as_str())
                .take(2)
                .collect::<Vec<_>>();
            if !archive_segments.is_empty() {
                history.push(format!(
                    "archive_summary_reused={}",
                    archive_segments.join(" | ")
                ));
            }
        }

        history
    }

    fn build_policy_injections(&self, state: &RuntimeState) -> Vec<String> {
        let mut injections = vec![
            "Keep context transparent and bounded by budget.".to_string(),
            "Do not rely on hidden prompt state.".to_string(),
            "Prefer goal anchor and working set over archive summary when reasoning.".to_string(),
            "If context grows, compress old history and stale observations before expanding active context.".to_string(),
        ];

        if let Some(snapshot) = &state.active_context_snapshot {
            let archive_tokens = snapshot
                .layers
                .iter()
                .find(|layer| layer.layer == ContextLayer::ArchiveSummary)
                .map(|layer| layer.token_estimate)
                .unwrap_or(0);
            let working_tokens = snapshot
                .layers
                .iter()
                .find(|layer| layer.layer == ContextLayer::WorkingSet)
                .map(|layer| layer.token_estimate)
                .unwrap_or(0);
            injections.push(format!(
                "Previous context balance: working_set_tokens={} archive_summary_tokens={}.",
                working_tokens, archive_tokens
            ));
        }

        injections
    }

    fn build_working_memory(&self, state: &RuntimeState, session: &Session) -> WorkingMemory {
        let mut completed_items = vec!["task received".to_string()];
        if !state.observations.is_empty() {
            completed_items.extend(
                state
                    .observations
                    .iter()
                    .rev()
                    .take(2)
                    .map(|observation| format!("observed {}", observation.tool_name)),
            );
        }
        if let Some(result) = &state.last_tool_result {
            completed_items.push(format!("latest tool result {}", result.status));
        }

        let mut pending_items = Vec::new();
        if let Some(call) = &state.active_tool_call {
            pending_items.push(format!("resolve tool call {}", call.tool_name));
        } else {
            pending_items.push("produce model request".to_string());
            pending_items.push("decide next action".to_string());
        }
        if state.pending_approval.is_some() {
            pending_items.push("await approval before continuing".to_string());
        }
        if let Some(snapshot) = &state.active_context_snapshot {
            let archive_tokens = snapshot
                .layers
                .iter()
                .find(|layer| layer.layer == ContextLayer::ArchiveSummary)
                .map(|layer| layer.token_estimate)
                .unwrap_or(0);
            let working_tokens = snapshot
                .layers
                .iter()
                .find(|layer| layer.layer == ContextLayer::WorkingSet)
                .map(|layer| layer.token_estimate)
                .unwrap_or(0);
            if archive_tokens > working_tokens {
                pending_items.push("recenter context toward active working set".to_string());
            }
        }

        WorkingMemory {
            current_goal: session.task.input.clone(),
            completed_items,
            pending_items,
        }
    }

    fn build_working_set(&self, state: &RuntimeState) -> WorkingSet {
        let mut active_files = Vec::new();
        let mut active_subtasks = Vec::new();
        let mut open_questions = Vec::new();

        if let Some(call) = &state.active_tool_call {
            active_subtasks.push(format!("resolve tool call {}", call.tool_name));
            if let Some(path) = call.arguments.get("path") {
                active_files.push(path.clone());
            }
        }

        if let Some(result) = &state.last_tool_result
            && let Some(path) = result.structured_output.get("path")
            && !active_files.iter().any(|file| file == path)
        {
            active_files.push(path.clone());
        }

        for observation in state.observations.iter().rev().take(2) {
            if observation.tool_name == "read_file" || observation.tool_name == "write_file" {
                if let Some(content) = &observation.content {
                    if content.contains('/') {
                        let candidate = content.lines().next().unwrap_or("").trim().to_string();
                        if !candidate.is_empty()
                            && !active_files.iter().any(|file| file == &candidate)
                        {
                            active_files.push(candidate);
                        }
                    }
                }
            }
            active_subtasks.push(format!("analyze {}", observation.tool_name));
        }

        if let Some(response) = &state.last_model_response {
            open_questions.push(format!("model intent: {}", response.summary));
        } else {
            open_questions.push("determine next high-value action".to_string());
        }

        if let Some(policy) = state.policy_decisions.last()
            && policy.decision == "denied"
        {
            open_questions.push(format!("work around denied action: {}", policy.detail));
        }

        if state.pending_approval.is_some() {
            open_questions.push("approval boundary is blocking active work".to_string());
        }

        dedupe_keep_order(&mut active_files);
        dedupe_keep_order(&mut active_subtasks);
        dedupe_keep_order(&mut open_questions);

        WorkingSet {
            active_files,
            active_subtasks,
            open_questions,
        }
    }

    fn select_tool_descriptors(
        &self,
        state: &RuntimeState,
        working_set: &WorkingSet,
        tool_info: Vec<ToolInfo>,
    ) -> Vec<ToolInfo> {
        let mut selected = Vec::new();
        let mut desired_names = Vec::new();

        if let Some(active_tool_call) = &state.active_tool_call {
            desired_names.push(active_tool_call.tool_name.clone());
        }

        if !working_set.active_files.is_empty() {
            desired_names.push("read_file".to_string());
        }

        for subtask in &working_set.active_subtasks {
            let normalized = subtask.to_ascii_lowercase();
            if normalized.contains("file") || normalized.contains("read") {
                desired_names.push("read_file".to_string());
            }
            if normalized.contains("search") || normalized.contains("find") {
                desired_names.push("search_files".to_string());
                desired_names.push("search_content".to_string());
            }
            if normalized.contains("write")
                || normalized.contains("edit")
                || normalized.contains("patch")
            {
                desired_names.push("write_file".to_string());
            }
            if normalized.contains("run")
                || normalized.contains("test")
                || normalized.contains("command")
            {
                desired_names.push("shell".to_string());
            }
        }

        for question in &working_set.open_questions {
            let normalized = question.to_ascii_lowercase();
            if normalized.contains("intent") || normalized.contains("next high-value action") {
                desired_names.push("read_file".to_string());
                desired_names.push("search_content".to_string());
            }
            if normalized.contains("denied action") || normalized.contains("work around") {
                desired_names.push("search_files".to_string());
                desired_names.push("shell".to_string());
            }
            if normalized.contains("approval") {
                desired_names.push("read_file".to_string());
            }
        }

        dedupe_keep_order(&mut desired_names);

        for desired_name in desired_names {
            if let Some(matched) = tool_info.iter().find(|tool| tool.name == desired_name) {
                selected.push(matched.clone());
            }
            if selected.len() >= 4 {
                break;
            }
        }

        for tool in tool_info {
            if selected.len() >= 4 {
                break;
            }
            if selected
                .iter()
                .any(|selected_tool| selected_tool.name == tool.name)
            {
                continue;
            }
            selected.push(tool);
        }

        selected
    }

    fn build_model_request(&self, state: &RuntimeState, config: &RuntimeConfig) -> ModelRequest {
        let snapshot = state
            .active_context_snapshot
            .as_ref()
            .expect("context snapshot should exist before model request");
        let model_capabilities = self.model_capabilities_for(&config.model_name);

        ModelRequest {
            request_id: next_model_request_id(),
            model_name: config.model_name.clone(),
            messages: snapshot.prompt_messages.clone(),
            prompt_token_estimate: snapshot.budget_estimate,
            context_window: model_capabilities.context_window,
        }
    }

    fn model_capabilities_for(&self, model_name: &str) -> ModelCapabilities {
        if model_name.starts_with("openai:") {
            #[cfg(feature = "openai")]
            {
                let adapter = forgeone_model_openai::OpenAiModelAdapter::new("", "", "");
                return adapter.capabilities(model_name);
            }
            #[cfg(not(feature = "openai"))]
            {
                return MockModelAdapter.capabilities(model_name);
            }
        }

        if model_name.starts_with("ollama:") {
            #[cfg(feature = "ollama")]
            {
                let adapter = forgeone_model_ollama::OllamaModelAdapter::new("");
                return adapter.capabilities(model_name);
            }
            #[cfg(not(feature = "ollama"))]
            {
                return MockModelAdapter.capabilities(model_name);
            }
        }

        MockModelAdapter.capabilities(model_name)
    }

    fn estimate_model_request(&self, request: &ModelRequest) -> ModelRequestEstimate {
        if request.model_name.starts_with("openai:") {
            #[cfg(feature = "openai")]
            {
                let adapter = forgeone_model_openai::OpenAiModelAdapter::new("", "", "");
                return adapter.estimate(request);
            }
            #[cfg(not(feature = "openai"))]
            {
                return MockModelAdapter.estimate(request);
            }
        }

        if request.model_name.starts_with("ollama:") {
            #[cfg(feature = "ollama")]
            {
                let adapter = forgeone_model_ollama::OllamaModelAdapter::new("");
                return adapter.estimate(request);
            }
            #[cfg(not(feature = "ollama"))]
            {
                return MockModelAdapter.estimate(request);
            }
        }

        MockModelAdapter.estimate(request)
    }

    fn request_model(&self, state: &RuntimeState) -> ModelResponse {
        let request = state
            .active_model_request
            .as_ref()
            .expect("model request should exist before model adapter call");
        let _estimate = self.estimate_model_request(request);

        // Dispatch to the appropriate adapter based on model_name prefix.
        // Format: "openai:gpt-4o" or "ollama:qwen2.5-coder:7b" or "mock" (default).
        let model_name = &request.model_name;
        if model_name.starts_with("openai:") {
            #[cfg(feature = "openai")]
            {
                match forgeone_model_openai::OpenAiModelAdapter::from_env() {
                    Ok(adapter) => return adapter.respond(request),
                    Err(error) => {
                        return ModelResponse {
                            response_id: next_model_request_id(),
                            action: ModelAction::FinalResponse {
                                content: format!(
                                    "[runtime] openai adapter unavailable for model={model_name}: {error}"
                                ),
                            },
                            summary: format!("openai adapter unavailable: {error}"),
                        };
                    }
                }
            }
            #[cfg(not(feature = "openai"))]
            {
                return ModelResponse {
                    response_id: next_model_request_id(),
                    action: ModelAction::FinalResponse {
                        content: format!(
                            "[runtime] openai feature not enabled for model={model_name} estimate_total_tokens={}",
                            _estimate.total_expected_tokens
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
                            "[runtime] ollama feature not enabled for model={model_name} estimate_total_tokens={}",
                            _estimate.total_expected_tokens
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
        state.last_executed_tool_signature = Some(tool_call_signature(&request));
        state.budget_usage.tool_call_count = state.budget_usage.tool_call_count.saturating_add(1);
        ToolExecutionOutcome::Executed
    }

    fn is_repeated_tool_call(&self, state: &RuntimeState, request: &ToolCallRequest) -> bool {
        let Some(last_signature) = state.last_executed_tool_signature.as_ref() else {
            return false;
        };
        tool_call_signature(request) == *last_signature
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
            last_executed_tool_signature: state.last_executed_tool_signature.clone(),
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
        self.session_store.save_approval_session(record)
    }

    fn load_approval_session(&self, session_id: &str) -> Result<ApprovalSessionRecord, String> {
        self.session_store.load_approval_session(session_id)
    }

    fn delete_approval_session(&self, session_id: &str) -> Result<(), String> {
        self.session_store.delete_approval_session(session_id)
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
            pending_approval: result.state.pending_approval.as_ref().map(|approval| {
                ApprovalPendingRecord {
                    tool_name: approval.tool_name.clone(),
                    reason: approval.reason.clone(),
                    argument_summary: approval.argument_summary.clone(),
                }
            }),
            token_budget,
            tokens_estimate: result.state.budget_usage.tokens_estimate,
            tool_call_count: result.state.budget_usage.tool_call_count,
            trace: result.trace.clone(),
        }
    }

    fn save_session_trace(&self, record: &SessionTraceRecord) -> Result<(), String> {
        self.session_store.save_session_trace(record)
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

fn tool_call_signature(request: &ToolCallRequest) -> String {
    let mut arguments = request
        .arguments
        .iter()
        .map(|(key, value)| (key.as_str(), value.as_str()))
        .collect::<Vec<_>>();
    arguments.sort_by(|a, b| a.0.cmp(b.0).then_with(|| a.1.cmp(b.1)));
    let rendered_args = arguments
        .into_iter()
        .map(|(key, value)| format!("{key}={value}"))
        .collect::<Vec<_>>()
        .join(",");
    format!("{}|{}", request.tool_name, rendered_args)
}

fn summarize_tool_arguments(arguments: &HashMap<String, String>) -> String {
    let mut pairs = arguments.iter().collect::<Vec<_>>();
    pairs.sort_by(|a, b| a.0.cmp(b.0));
    pairs
        .into_iter()
        .map(|(key, value)| format!("{key}={value}"))
        .collect::<Vec<_>>()
        .join(", ")
}

fn dedupe_keep_order(items: &mut Vec<String>) {
    let mut seen = std::collections::HashSet::new();
    items.retain(|item| seen.insert(item.clone()));
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time should be after unix epoch")
        .as_millis()
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};

    use forgeone_session::{ApprovalSessionRecord, SessionStore, SessionTraceRecord};
    use forgeone_tools::ToolCallRequest;

    use super::{
        LoopStep, RunRequest, RuntimeConfig, RuntimeCore, RuntimePhase, RuntimeState,
        RuntimeStatus, StopReason,
    };
    use forgeone_context::WorkingSet;

    #[test]
    fn runtime_emits_final_response_and_trace() {
        let core = RuntimeCore::default();
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
        assert!(result.state.last_executed_tool_signature.is_some());
        assert!(result.trace.len() >= 12);
    }

    #[test]
    fn runtime_can_enter_waiting_approval() {
        let store = RecordingSessionStore::default();
        let core = RuntimeCore::with_session_store(store.clone());
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
        assert_eq!(store.saved_approvals(), 1);
        assert_eq!(store.saved_traces(), 1);
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
        let core = RuntimeCore::default();
        let mut config = RuntimeConfig::default();
        config.policy.max_tool_calls = 1;

        let mut state = build_test_state(
            "search_files",
            [("pattern", "Cargo.toml"), ("path", "/etc")],
        );
        let outcome = core.execute_tool_call(&mut state, Some(&config.policy));

        assert!(matches!(outcome, super::ToolExecutionOutcome::Denied));
        assert_eq!(state.budget_usage.tool_call_count, 0);
        assert_eq!(state.observations.len(), 1);
        assert!(state.last_tool_result.as_ref().is_some_and(
            |result| result.status == forgeone_tools::ToolCallStatus::PermissionDenied
        ));
    }

    #[test]
    fn empty_observations_do_not_inject_placeholder_summary() {
        let core = RuntimeCore::default();
        let summaries = core.to_observation_summaries(&[]);
        assert!(summaries.is_empty());
    }

    #[test]
    fn runtime_builds_explicit_working_set() {
        let core = RuntimeCore::default();
        let mut state = build_test_state(
            "read_file",
            [("path", "crates/forgeone-runtime/src/lib.rs")],
        );
        state.last_tool_result = Some(forgeone_tools::ToolCallResult {
            call_id: "tool-call-previous".to_string(),
            status: forgeone_tools::ToolCallStatus::Success,
            structured_output: HashMap::from([(
                "path".to_string(),
                "crates/forgeone-context/src/lib.rs".to_string(),
            )]),
            error: None,
            completed_at_ms: 0,
        });

        let working_set = core.build_working_set(&state);
        assert!(
            working_set
                .active_files
                .iter()
                .any(|file| file == "crates/forgeone-runtime/src/lib.rs")
        );
        assert!(
            working_set
                .active_files
                .iter()
                .any(|file| file == "crates/forgeone-context/src/lib.rs")
        );
        assert!(
            working_set
                .active_subtasks
                .iter()
                .any(|task| task.contains("resolve tool call read_file"))
        );
        assert!(!working_set.open_questions.is_empty());
    }

    #[test]
    fn runtime_selects_tool_descriptors_from_working_set() {
        let core = RuntimeCore::default();
        let state = build_test_state(
            "search_content",
            [("pattern", "RuntimeState"), ("path", "crates/")],
        );
        let working_set = WorkingSet {
            active_files: vec!["crates/forgeone-runtime/src/lib.rs".to_string()],
            active_subtasks: vec![
                "search runtime state transitions".to_string(),
                "run targeted command".to_string(),
            ],
            open_questions: vec!["work around denied action".to_string()],
        };
        let descriptors = core.select_tool_descriptors(
            &state,
            &working_set,
            vec![
                forgeone_context::ToolInfo {
                    name: "read_file".to_string(),
                    description: "Read a file".to_string(),
                },
                forgeone_context::ToolInfo {
                    name: "search_content".to_string(),
                    description: "Search content".to_string(),
                },
                forgeone_context::ToolInfo {
                    name: "search_files".to_string(),
                    description: "Search files".to_string(),
                },
                forgeone_context::ToolInfo {
                    name: "shell".to_string(),
                    description: "Run shell".to_string(),
                },
                forgeone_context::ToolInfo {
                    name: "write_file".to_string(),
                    description: "Write file".to_string(),
                },
            ],
        );

        let names = descriptors
            .iter()
            .map(|tool| tool.name.as_str())
            .collect::<Vec<_>>();
        assert_eq!(names.first().copied(), Some("search_content"));
        assert!(names.contains(&"read_file"));
        assert!(names.contains(&"search_files"));
        assert!(names.contains(&"shell"));
        assert!(descriptors.len() <= 4);
    }

    #[test]
    fn runtime_builds_model_request_with_provider_context_window() {
        let core = RuntimeCore::default();
        let mut state = build_test_state(
            "read_file",
            [("path", "crates/forgeone-runtime/src/lib.rs")],
        );
        let session = super::Session {
            session_id: "session-test".to_string(),
            task: super::Task {
                task_id: "task-test".to_string(),
                input: "inspect runtime".to_string(),
            },
            config: RuntimeConfig {
                model_name: "openai:gpt-4o".to_string(),
                ..RuntimeConfig::default()
            },
        };

        state.active_context_snapshot = Some(core.build_context_snapshot(&state, &session));
        let request = core.build_model_request(&state, &session.config);

        assert_eq!(request.context_window, 128_000);
        assert!(request.prompt_token_estimate > 0);
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
            last_executed_tool_signature: None,
            observations: Vec::new(),
            policy_decisions: Vec::new(),
            pending_approval: None,
            budget_usage: super::BudgetUsage::default(),
            stop_reason: None,
        }
    }

    #[test]
    fn runtime_blocks_repeated_tool_call_with_same_arguments() {
        let core = RuntimeCore::default();
        let mut state = build_test_state(
            "read_file",
            [("path", "crates/forgeone-runtime/src/lib.rs")],
        );
        state.last_executed_tool_signature = Some(super::tool_call_signature(
            state
                .active_tool_call
                .as_ref()
                .expect("tool call should exist"),
        ));

        assert!(
            core.is_repeated_tool_call(
                &state,
                state
                    .active_tool_call
                    .as_ref()
                    .expect("tool call should exist"),
            )
        );
    }

    #[derive(Debug, Clone, Default)]
    struct RecordingSessionStore {
        approvals: Arc<Mutex<Vec<ApprovalSessionRecord>>>,
        traces: Arc<Mutex<Vec<SessionTraceRecord>>>,
    }

    impl RecordingSessionStore {
        fn saved_approvals(&self) -> usize {
            self.approvals.lock().expect("approvals should lock").len()
        }

        fn saved_traces(&self) -> usize {
            self.traces.lock().expect("traces should lock").len()
        }
    }

    impl SessionStore for RecordingSessionStore {
        fn save_approval_session(&self, record: &ApprovalSessionRecord) -> Result<(), String> {
            self.approvals
                .lock()
                .expect("approvals should lock")
                .push(record.clone());
            Ok(())
        }

        fn load_approval_session(&self, session_id: &str) -> Result<ApprovalSessionRecord, String> {
            self.inspect_approval_session(session_id)
        }

        fn delete_approval_session(&self, session_id: &str) -> Result<(), String> {
            let mut approvals = self.approvals.lock().expect("approvals should lock");
            approvals.retain(|record| record.session_id != session_id);
            Ok(())
        }

        fn inspect_approval_session(
            &self,
            session_id: &str,
        ) -> Result<ApprovalSessionRecord, String> {
            self.approvals
                .lock()
                .expect("approvals should lock")
                .iter()
                .find(|record| record.session_id == session_id)
                .cloned()
                .ok_or_else(|| format!("missing approval session {session_id}"))
        }

        fn list_pending_approvals(&self) -> Result<Vec<ApprovalSessionRecord>, String> {
            Ok(self
                .approvals
                .lock()
                .expect("approvals should lock")
                .clone())
        }

        fn prune_pending_approvals(&self) -> Result<usize, String> {
            let mut approvals = self.approvals.lock().expect("approvals should lock");
            let deleted = approvals.len();
            approvals.clear();
            Ok(deleted)
        }

        fn pending_approval_exists(&self, session_id: &str) -> bool {
            self.approvals
                .lock()
                .expect("approvals should lock")
                .iter()
                .any(|record| record.session_id == session_id)
        }

        fn save_session_trace(&self, record: &SessionTraceRecord) -> Result<(), String> {
            self.traces
                .lock()
                .expect("traces should lock")
                .push(record.clone());
            Ok(())
        }

        fn load_session_trace(&self, session_id: &str) -> Result<SessionTraceRecord, String> {
            self.inspect_session_trace(session_id)
        }

        fn inspect_session_trace(&self, session_id: &str) -> Result<SessionTraceRecord, String> {
            self.traces
                .lock()
                .expect("traces should lock")
                .iter()
                .find(|record| record.session_id == session_id)
                .cloned()
                .ok_or_else(|| format!("missing session trace {session_id}"))
        }

        fn list_session_traces(&self) -> Result<Vec<SessionTraceRecord>, String> {
            Ok(self.traces.lock().expect("traces should lock").clone())
        }

        fn prune_session_traces(&self) -> Result<usize, String> {
            let mut traces = self.traces.lock().expect("traces should lock");
            let deleted = traces.len();
            traces.clear();
            Ok(deleted)
        }
    }
}
