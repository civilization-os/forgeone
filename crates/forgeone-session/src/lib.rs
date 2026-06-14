use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use forgeone_trace::TraceEvent;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationTurnRecord {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApprovalSessionRecord {
    pub session_id: String,
    #[serde(default)]
    pub conversation_id: String,
    #[serde(default)]
    pub turn_index: u32,
    pub task_id: String,
    pub task_input: String,
    #[serde(default)]
    pub conversation_history: Vec<ConversationTurnRecord>,
    pub agent_id: String,
    pub loop_index: u32,
    pub max_loops: u32,
    pub token_budget: u32,
    #[serde(default)]
    pub max_output_tokens: Option<u32>,
    pub model_name: String,
    pub allowed_tools: Vec<String>,
    pub read_roots: Vec<String>,
    pub approval_read_roots: Vec<String>,
    pub max_tool_calls: u32,
    pub tokens_estimate: u32,
    pub tool_call_count: u32,
    pub last_executed_tool_signature: Option<String>,
    pub observations: Vec<ApprovalObservationRecord>,
    pub policy_decisions: Vec<ApprovalPolicyRecord>,
    pub active_tool_call: ApprovalToolCallRecord,
    pub pending_approval: ApprovalPendingRecord,
    #[serde(default)]
    pub mcp_servers: Vec<forgeone_tools::McpServerConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionTraceRecord {
    pub session_id: String,
    #[serde(default)]
    pub conversation_id: String,
    #[serde(default)]
    pub turn_index: u32,
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
    #[serde(default)]
    pub updated_at_ms: u64,
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

pub trait SessionStore {
    fn save_approval_session(&self, record: &ApprovalSessionRecord) -> Result<(), String>;
    fn load_approval_session(&self, session_id: &str) -> Result<ApprovalSessionRecord, String>;
    fn delete_approval_session(&self, session_id: &str) -> Result<(), String>;
    fn inspect_approval_session(&self, session_id: &str) -> Result<ApprovalSessionRecord, String>;
    fn list_pending_approvals(&self) -> Result<Vec<ApprovalSessionRecord>, String>;
    fn prune_pending_approvals(&self) -> Result<usize, String>;
    fn pending_approval_exists(&self, session_id: &str) -> bool;
    fn save_session_trace(&self, record: &SessionTraceRecord) -> Result<(), String>;
    fn load_session_trace(&self, session_id: &str) -> Result<SessionTraceRecord, String>;
    fn inspect_session_trace(&self, session_id: &str) -> Result<SessionTraceRecord, String>;
    fn delete_session_trace(&self, session_id: &str) -> Result<(), String>;
    fn list_session_traces(&self) -> Result<Vec<SessionTraceRecord>, String>;
    fn prune_session_traces(&self) -> Result<usize, String>;
}

#[derive(Debug, Clone, Default)]
pub struct FileSessionStore;

impl SessionStore for FileSessionStore {
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

    fn inspect_approval_session(&self, session_id: &str) -> Result<ApprovalSessionRecord, String> {
        self.load_approval_session(session_id)
    }

    fn list_pending_approvals(&self) -> Result<Vec<ApprovalSessionRecord>, String> {
        let mut records = self.load_record_dir(pending_approvals_dir())?;
        records.sort_by(|a: &ApprovalSessionRecord, b: &ApprovalSessionRecord| {
            b.session_id.cmp(&a.session_id)
        });
        Ok(records)
    }

    fn prune_pending_approvals(&self) -> Result<usize, String> {
        prune_json_dir(&pending_approvals_dir())
    }

    fn pending_approval_exists(&self, session_id: &str) -> bool {
        approval_session_path(session_id).exists()
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

    fn inspect_session_trace(&self, session_id: &str) -> Result<SessionTraceRecord, String> {
        self.load_session_trace(session_id)
    }

    fn delete_session_trace(&self, session_id: &str) -> Result<(), String> {
        let path = session_trace_path(session_id);
        if path.exists() {
            fs::remove_file(path).map_err(|error| error.to_string())?;
        }
        Ok(())
    }

    fn list_session_traces(&self) -> Result<Vec<SessionTraceRecord>, String> {
        let mut records = self.load_record_dir(session_traces_dir())?;
        records.sort_by(|a: &SessionTraceRecord, b: &SessionTraceRecord| {
            b.session_id.cmp(&a.session_id)
        });
        Ok(records)
    }

    fn prune_session_traces(&self) -> Result<usize, String> {
        prune_json_dir(&session_traces_dir())
    }
}

impl FileSessionStore {
    fn load_record_dir<T>(&self, dir: PathBuf) -> Result<Vec<T>, String>
    where
        T: for<'de> Deserialize<'de>,
    {
        let mut records = Vec::new();
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
            let record = serde_json::from_str::<T>(&payload).map_err(|error| error.to_string())?;
            records.push(record);
        }

        Ok(records)
    }
}

fn pending_approvals_dir() -> PathBuf {
    Path::new(".forgeone").join("sessions")
}

fn session_traces_dir() -> PathBuf {
    Path::new(".forgeone").join("traces")
}

fn approval_session_path(session_id: &str) -> PathBuf {
    pending_approvals_dir().join(format!("{session_id}.json"))
}

fn session_trace_path(session_id: &str) -> PathBuf {
    session_traces_dir().join(format!("{session_id}.json"))
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
    use std::env;
    use std::sync::{Mutex, OnceLock};
    use std::time::{SystemTime, UNIX_EPOCH};

    use forgeone_trace::{TraceEvent, TraceEventKind};

    use super::{
        ApprovalObservationRecord, ApprovalPendingRecord, ApprovalPolicyRecord,
        ApprovalSessionRecord, ApprovalToolCallRecord, ConversationTurnRecord,
        FileSessionStore, SessionStore, SessionTraceRecord,
    };

    static CWD_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

    #[test]
    fn file_session_store_persists_lists_and_prunes_records() {
        let _guard = CWD_LOCK
            .get_or_init(|| Mutex::new(()))
            .lock()
            .expect("cwd lock should not be poisoned");
        let workspace = TestWorkspace::enter();
        let store = FileSessionStore;

        let approval_one = sample_approval_record("session-100");
        let approval_two = sample_approval_record("session-200");
        store
            .save_approval_session(&approval_one)
            .expect("approval session should save");
        store
            .save_approval_session(&approval_two)
            .expect("approval session should save");

        let trace_one = sample_trace_record("session-100");
        let trace_two = sample_trace_record("session-300");
        store
            .save_session_trace(&trace_one)
            .expect("session trace should save");
        store
            .save_session_trace(&trace_two)
            .expect("session trace should save");

        let loaded_approval = store
            .load_approval_session("session-100")
            .expect("approval session should load");
        assert_eq!(loaded_approval.task_id, approval_one.task_id);
        assert!(store.pending_approval_exists("session-100"));

        let pending = store
            .list_pending_approvals()
            .expect("pending approvals should list");
        assert_eq!(pending.len(), 2);
        assert_eq!(pending[0].session_id, "session-200");
        assert_eq!(pending[1].session_id, "session-100");

        let traces = store
            .list_session_traces()
            .expect("session traces should list");
        assert_eq!(traces.len(), 2);
        assert_eq!(traces[0].session_id, "session-300");
        assert_eq!(traces[1].session_id, "session-100");

        store
            .delete_approval_session("session-100")
            .expect("approval session should delete");
        assert!(!store.pending_approval_exists("session-100"));

        store
            .delete_session_trace("session-300")
            .expect("session trace should delete");
        let traces = store
            .list_session_traces()
            .expect("session traces should list");
        assert_eq!(traces.len(), 1);
        assert_eq!(traces[0].session_id, "session-100");

        let deleted_approvals = store
            .prune_pending_approvals()
            .expect("pending approvals should prune");
        let deleted_traces = store
            .prune_session_traces()
            .expect("session traces should prune");
        assert_eq!(deleted_approvals, 1);
        assert_eq!(deleted_traces, 1);

        drop(workspace);
    }

    fn sample_approval_record(session_id: &str) -> ApprovalSessionRecord {
        ApprovalSessionRecord {
            session_id: session_id.to_string(),
            conversation_id: "conversation-1".to_string(),
            turn_index: 1,
            task_id: format!("task-{session_id}"),
            task_input: "inspect repository".to_string(),
            conversation_history: vec![ConversationTurnRecord {
                role: "user".to_string(),
                content: "previous question".to_string(),
            }],
            agent_id: "agent-1".to_string(),
            loop_index: 2,
            max_loops: 8,
            token_budget: 32_000,
            max_output_tokens: Some(4096),
            model_name: "mock-model".to_string(),
            allowed_tools: vec!["read_file".to_string()],
            read_roots: vec!["src".to_string()],
            approval_read_roots: vec!["secrets".to_string()],
            max_tool_calls: 4,
            tokens_estimate: 512,
            tool_call_count: 1,
            last_executed_tool_signature: Some("read_file:path=src/lib.rs".to_string()),
            observations: vec![ApprovalObservationRecord {
                tool_name: "read_file".to_string(),
                summary: "preview captured".to_string(),
                content: Some("fn main() {}".to_string()),
            }],
            policy_decisions: vec![ApprovalPolicyRecord {
                scope: "tool_call".to_string(),
                decision: "require_approval".to_string(),
                detail: "sensitive root".to_string(),
            }],
            active_tool_call: ApprovalToolCallRecord {
                call_id: "tool-1".to_string(),
                tool_name: "read_file".to_string(),
                requested_by: "agent-1".to_string(),
                arguments: [("path".to_string(), "secrets/prod.env".to_string())].into(),
            },
            pending_approval: ApprovalPendingRecord {
                tool_name: "read_file".to_string(),
                reason: "sensitive root".to_string(),
                argument_summary: "path=secrets/prod.env".to_string(),
            },
        }
    }

    fn sample_trace_record(session_id: &str) -> SessionTraceRecord {
        SessionTraceRecord {
            session_id: session_id.to_string(),
            conversation_id: "conversation-1".to_string(),
            turn_index: 1,
            task_id: format!("task-{session_id}"),
            task_input: "inspect repository".to_string(),
            agent_id: "agent-1".to_string(),
            status: "completed".to_string(),
            current_phase: "response".to_string(),
            loop_index: 3,
            stop_reason: "response_ready".to_string(),
            final_response: "done".to_string(),
            approval_required: false,
            pending_approval: None,
            token_budget: 32_000,
            tokens_estimate: 1024,
            tool_call_count: 2,
            updated_at_ms: 1_717_171_717_000,
            trace: vec![TraceEvent::new(
                session_id,
                "agent-1",
                None,
                3,
                TraceEventKind::SessionStopped,
                "done",
            )],
        }
    }

    struct TestWorkspace {
        original_dir: std::path::PathBuf,
        temp_dir: std::path::PathBuf,
    }

    impl TestWorkspace {
        fn enter() -> Self {
            let original_dir = env::current_dir().expect("current dir should resolve");
            let temp_dir =
                env::temp_dir().join(format!("forgeone-session-test-{}", unique_suffix()));
            std::fs::create_dir_all(&temp_dir).expect("temp dir should create");
            env::set_current_dir(&temp_dir).expect("current dir should switch");
            Self {
                original_dir,
                temp_dir,
            }
        }
    }

    impl Drop for TestWorkspace {
        fn drop(&mut self) {
            let _ = env::set_current_dir(&self.original_dir);
            let _ = std::fs::remove_dir_all(&self.temp_dir);
        }
    }

    fn unique_suffix() -> u128 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after unix epoch")
            .as_nanos()
    }
}
