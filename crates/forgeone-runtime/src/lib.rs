pub mod mcp;
pub mod llm_client;
pub mod agent_loop;

pub use agent_loop::{AgentLoop, AgentRunRequest, AgentEvent, HistoryMessage};

use forgeone_policy::PolicyConfig;
pub use forgeone_session::{
    ApprovalObservationRecord, ApprovalPendingRecord, ApprovalPolicyRecord, ApprovalSessionRecord,
    ApprovalToolCallRecord, ConversationTurnRecord, FileSessionStore, SessionStore,
    SessionTraceRecord,
};
use forgeone_trace::{InMemoryTraceStore, TraceEvent, TraceEventKind};

#[derive(Debug, Clone)]
pub struct RuntimeConfig {
    pub policy: PolicyConfig,
    pub mcp_servers: Vec<forgeone_tools::McpServerConfig>,
}

impl Default for RuntimeConfig {
    fn default() -> Self {
        Self {
            policy: PolicyConfig::default(),
            mcp_servers: Vec::new(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct ToolExecuteRequest {
    pub session_id: String,
    pub tool_name: String,
    pub arguments: serde_json::Value,
    pub config: RuntimeConfig,
}

#[derive(Debug, Clone)]
pub struct ToolExecuteResult {
    pub session_id: String,
    pub tool_name: String,
    pub result: Result<serde_json::Value, String>,
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

    pub fn session_store(&self) -> &S {
        &self.session_store
    }
}

impl<S: SessionStore> RuntimeCore<S> {
    pub fn execute_tool(&self, req: ToolExecuteRequest) -> ToolExecuteResult {
        let mut trace = InMemoryTraceStore::default();
        trace.push(TraceEvent::new(
            req.session_id.clone(),
            "mcp-client".to_string(),
            None,
            0,
            TraceEventKind::TaskReceived,
            format!("Execute tool: {}", req.tool_name),
        ));

        // Simplified execution logic
        // In a real implementation, we would check PolicyEngine here and potentially return a pending approval state.
        
        let result = ToolExecuteResult {
            session_id: req.session_id,
            tool_name: req.tool_name,
            result: Ok(serde_json::json!({"status": "mock_executed"})),
            trace: trace.into_events(),
        };

        result
    }
    
    // Stub methods to satisfy server compilation temporarily, will be refactored or deleted later
    pub fn run(&self, _req: forgeone_runtime_stubs::RunRequest) -> forgeone_runtime_stubs::RunResult {
        unimplemented!()
    }
    pub fn approve_session(&self, _session_id: &str) -> Result<forgeone_runtime_stubs::RunResult, String> {
        unimplemented!()
    }
    pub fn reject_session(&self, _session_id: &str) -> Result<forgeone_runtime_stubs::RunResult, String> {
        unimplemented!()
    }
    pub fn resume_session(&self, _session_id: &str) -> Result<forgeone_runtime_stubs::RunResult, String> {
        unimplemented!()
    }
    pub fn list_pending_approvals(&self) -> Result<Vec<ApprovalSessionRecord>, String> {
        Ok(vec![])
    }
    pub fn list_session_traces(&self) -> Result<Vec<SessionTraceRecord>, String> {
        Ok(vec![])
    }
    pub fn inspect_session_trace(&self, _session_id: &str) -> Result<SessionTraceRecord, String> {
        unimplemented!()
    }
    pub fn delete_session_trace(&self, _session_id: &str) -> Result<(), String> {
        Ok(())
    }
    pub fn inspect_approval_session(&self, _session_id: &str) -> Result<ApprovalSessionRecord, String> {
        unimplemented!()
    }
    pub fn prune_session_traces(&self) -> Result<usize, String> {
        Ok(0)
    }
    pub fn prune_pending_approvals(&self) -> Result<usize, String> {
        Ok(0)
    }
}

pub mod forgeone_runtime_stubs {
    #[derive(Debug, Clone)]
    pub struct RunRequest {}
    #[derive(Debug, Clone)]
    pub struct RunResult {}
}
