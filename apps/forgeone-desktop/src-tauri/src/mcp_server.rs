use axum::{
    extract::{Query, State},
    response::{
        sse::{Event, Sse},
        IntoResponse, Response,
    },
    routing::{get, post},
    Json, Router,
};
use forgeone_runtime::{AgentEvent, AgentLoop, AgentRunRequest, RuntimeCore};
use futures::stream::{self, Stream};
use serde::{Deserialize, Serialize};
use std::{convert::Infallible, net::SocketAddr, sync::Arc, time::Duration};
use tokio_stream::StreamExt;

pub struct McpServerState {
    pub runtime: Arc<RuntimeCore>,
    pub agent_loop: Arc<AgentLoop>,
}

// ── 遗留的 /api/chat 类型（向后兼容）────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct ChatApiRequest {
    pub prompt: String,
    pub model: Option<String>,
    pub mode: Option<String>,
    pub workspace: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct PendingApprovalDto {
    pub tool_name: String,
    pub args: String,
    pub reason: String,
}

#[derive(Debug, Serialize)]
pub struct ChatApiResponse {
    pub id: String,
    pub role: String,
    pub content: String,
    pub trace_log: String,
    pub pending_approval: Option<PendingApprovalDto>,
}

// ── 服务启动 ──────────────────────────────────────────────────────

pub async fn start_mcp_server(runtime: Arc<RuntimeCore>) {
    let state = Arc::new(McpServerState {
        runtime,
        agent_loop: Arc::new(AgentLoop::default()),
    });

    let app = Router::new()
        .route("/sse", get(sse_handler))
        .route("/api/health", get(health_handler))
        .route("/api/chat", post(chat_handler))
        // 新：后端驱动的 Agent Loop SSE 端点
        .route("/api/agent/run", post(agent_run_handler))
        // 项目 git 状态（StatusBar 展示分支与本地改动数）
        .route("/api/project/git_status", get(git_status_handler))
        // 工具审批：批准/拒绝待审批的工具调用
        .route("/api/agent/approve", post(approve_handler))
        .layer(
            tower_http::cors::CorsLayer::new()
                .allow_origin(tower_http::cors::Any)
                .allow_methods(tower_http::cors::Any)
                .allow_headers(tower_http::cors::Any),
        )
        .with_state(state);

    let addr = SocketAddr::from(([127, 0, 0, 1], 9527));
    println!("ForgeOne MCP & REST Server listening on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("failed to bind MCP server port");
    axum::serve(listener, app)
        .await
        .expect("MCP server crashed");
}

// ── /api/health ───────────────────────────────────────────────────

async fn health_handler() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "status": "ok",
        "service": "ForgeOne Harness Runtime",
        "version": "0.1.0",
        "mcp_port": 9527
    }))
}

// ── /api/project/git_status ───────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct GitStatusParams {
    pub path: String,
}

fn run_git(dir: &str, args: &[&str]) -> Option<String> {
    let out = std::process::Command::new("git")
        .args(args)
        .current_dir(dir)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

async fn git_status_handler(Query(params): Query<GitStatusParams>) -> Json<serde_json::Value> {
    let dir = &params.path;
    let branch = run_git(dir, &["branch", "--show-current"]);
    let status_out = run_git(dir, &["status", "--porcelain"]);
    let changes = status_out
        .as_ref()
        .map(|s| s.lines().filter(|l| !l.trim().is_empty()).count())
        .unwrap_or(0);
    let is_git_repo = branch.is_some() || status_out.is_some();
    Json(serde_json::json!({
        "branch": branch.unwrap_or_default(),
        "changes_count": changes,
        "is_git_repo": is_git_repo,
    }))
}

// ── /api/chat (遗留) ──────────────────────────────────────────────

async fn chat_handler(
    State(state): State<Arc<McpServerState>>,
    Json(payload): Json<ChatApiRequest>,
) -> Json<ChatApiResponse> {
    println!("[Agent Runtime] Received user prompt: {}", payload.prompt);

    let mode = payload.mode.unwrap_or_else(|| "loop".to_string());
    let model = payload.model.unwrap_or_else(|| "claude-3-5-sonnet".to_string());
    let workspace = payload
        .workspace
        .unwrap_or_else(|| "d:\\project\\forgeone".to_string());

    let execution_result =
        state
            .runtime
            .execute_tool(forgeone_runtime::ToolExecuteRequest {
                session_id: format!(
                    "session_{}",
                    tokio::time::Instant::now().elapsed().as_millis()
                ),
                tool_name: "context_scan".to_string(),
                arguments: serde_json::json!({
                    "prompt": payload.prompt,
                    "workspace": workspace,
                    "mode": mode,
                }),
                config: forgeone_runtime::RuntimeConfig::default(),
            });

    let (content, pending_approval) = if payload.prompt.contains("test")
        || payload.prompt.contains("测试")
        || payload.prompt.contains("cargo")
    {
        (
            format!(
                "ForgeOne Agent Loop [模式: {}] 已触发上下文扫描。检测到高危工具调用（执行 shell 命令），需要确认：",
                mode
            ),
            Some(PendingApprovalDto {
                tool_name: "execute_command".to_string(),
                args: "cargo test --workspace".to_string(),
                reason: "在本地开发终端中运行单元测试与构建流程".to_string(),
            }),
        )
    } else {
        (
            format!(
                "ForgeOne Agent Loop [{}] 已完成分析。针对指令 \"{}\"，成功加载工作区 [{}] 上下文树，完成代码与策略检查。",
                mode, payload.prompt, workspace
            ),
            None,
        )
    };

    let trace_log = format!(
        "[Trace #{}] Model: {} | Tokens: 620/128k | Session: {}",
        execution_result.trace.len(),
        model,
        execution_result.session_id
    );

    Json(ChatApiResponse {
        id: format!(
            "msg_{}",
            tokio::time::Instant::now().elapsed().as_nanos()
        ),
        role: "assistant".to_string(),
        content,
        trace_log,
        pending_approval,
    })
}

// ── /api/agent/approve（工具审批）──────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct ApproveRequest {
    pub tool_call_id: String,
    pub approved: bool,
}

async fn approve_handler(
    State(state): State<Arc<McpServerState>>,
    Json(req): Json<ApproveRequest>,
) -> Json<serde_json::Value> {
    let resolved = state
        .agent_loop
        .resolve_approval(&req.tool_call_id, req.approved)
        .await;
    Json(serde_json::json!({
        "resolved": resolved,
        "approved": req.approved,
    }))
}

// ── /api/agent/run（核心：后端驱动 Agent Loop）───────────────────

async fn agent_run_handler(
    State(state): State<Arc<McpServerState>>,
    Json(req): Json<AgentRunRequest>,
) -> Response {
    let (tx, mut rx) = tokio::sync::mpsc::channel::<AgentEvent>(256);
    let agent = state.agent_loop.clone();

    // 在后台 task 中运行 AgentLoop
    tokio::spawn(async move {
        agent.run(req, tx).await;
    });

    // 把 AgentEvent 通道转换为 SSE 流
    let stream = async_stream::stream! {
        while let Some(event) = rx.recv().await {
            let json = serde_json::to_string(&event).unwrap_or_default();
            yield Ok::<Event, Infallible>(Event::default().data(json));

            // done/error 后结束流
            match &event {
                AgentEvent::Done { .. } | AgentEvent::Error { .. } => break,
                _ => {}
            }
        }
    };

    Sse::new(stream)
        .keep_alive(
            axum::response::sse::KeepAlive::new()
                .interval(Duration::from_secs(15))
                .text("ping"),
        )
        .into_response()
}

// ── /sse（心跳保活）──────────────────────────────────────────────

async fn sse_handler() -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let stream = stream::repeat_with(|| Event::default().data("Runtime Active"))
        .map(Ok)
        .throttle(Duration::from_secs(1));

    Sse::new(stream)
        .keep_alive(axum::response::sse::KeepAlive::new().interval(Duration::from_secs(15)))
}
