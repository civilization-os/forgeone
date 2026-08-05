use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::{
        sse::{Event, Sse},
        IntoResponse, Response,
    },
    routing::{delete, get, post},
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

    // MCP 自动连接 + 保持连接：启动立即连接，之后每 30s 自动拉起 failed 并重建断开的连接
    state.agent_loop.start_mcp_keepalive(std::time::Duration::from_secs(30));

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
        // MCP Server 管理：列表 / 添加 / 删除（.forgeone/mcp/*.json 配置）
        .route("/api/mcp/servers", get(mcp_servers_handler))
        .route("/api/mcp/servers", post(mcp_add_handler))
        .route("/api/mcp/servers", delete(mcp_remove_handler))
        // 详情（配置 + 工具列表）/ 重连（failed → 重新注册）
        .route("/api/mcp/servers/detail", get(mcp_detail_handler))
        .route("/api/mcp/servers/reconnect", post(mcp_reconnect_handler))
        // Skill：清单 / 详情（.forgeone/skills/*/SKILL.md）
        .route("/api/skills", get(skills_list_handler))
        .route("/api/skills/detail", get(skills_detail_handler))
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

// ── MCP Server 管理（.forgeone/mcp/*.json）────────────────────────

#[derive(Debug, Deserialize)]
pub struct McpServersQuery {
    pub workspace: String,
}

#[derive(Debug, Deserialize)]
pub struct McpAddRequest {
    pub workspace: String,
    /// "global"（用户级，对所有项目生效）| "project"（当前项目）
    pub scope: Option<String>,
    pub name: String,
    /// "stdio"（默认，用 entrypoint 启动子进程）| "sse"（用 endpoint 连接 HTTP+SSE 站点）
    pub transport: Option<String>,
    pub entrypoint: Option<String>,
    pub endpoint: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct McpRemoveRequest {
    pub workspace: String,
    /// "global" | "project"
    pub scope: Option<String>,
    pub name: String,
}

type ApiResult = Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)>;

fn api_err(code: StatusCode, message: String) -> (StatusCode, Json<serde_json::Value>) {
    (code, Json(serde_json::json!({ "error": message })))
}

async fn mcp_servers_handler(
    State(state): State<Arc<McpServerState>>,
    Query(params): Query<McpServersQuery>,
) -> ApiResult {
    // 列表会触发幂等注册（拉起 MCP 子进程/连接，可能阻塞数十秒），必须移出 tokio worker
    let agent = state.agent_loop.clone();
    let workspace = params.workspace;
    let servers = tokio::task::spawn_blocking(move || agent.list_mcp_servers(&workspace))
        .await
        .map_err(|e| {
            api_err(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("MCP 列表任务失败: {e}"),
            )
        })?;
    Ok(Json(serde_json::json!({ "servers": servers })))
}

async fn mcp_add_handler(
    State(state): State<Arc<McpServerState>>,
    Json(req): Json<McpAddRequest>,
) -> ApiResult {
    let scope = req.scope.unwrap_or_else(|| "project".to_string());
    let transport = req.transport.unwrap_or_else(|| "stdio".to_string());
    let agent = state.agent_loop.clone();
    let workspace = req.workspace;
    let name = req.name;
    let entrypoint = req.entrypoint.unwrap_or_default();
    let endpoint = req.endpoint.unwrap_or_default();
    // 添加会拉起子进程/建立 SSE 连接并握手（可能阻塞数十秒），移出 tokio worker
    let result = tokio::task::spawn_blocking(move || {
        agent.add_mcp_server(&workspace, &scope, &name, &transport, &entrypoint, &endpoint)
    })
    .await
    .map_err(|e| {
        api_err(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("MCP 添加任务失败: {e}"),
        )
    })?;
    match result {
        Ok(server) => Ok(Json(serde_json::json!({ "server": server }))),
        Err(e) => Err(api_err(StatusCode::BAD_REQUEST, e)),
    }
}

async fn mcp_remove_handler(
    State(state): State<Arc<McpServerState>>,
    Json(req): Json<McpRemoveRequest>,
) -> ApiResult {
    let scope = req.scope.unwrap_or_else(|| "project".to_string());
    let agent = state.agent_loop.clone();
    let workspace = req.workspace;
    let name = req.name;
    let result = tokio::task::spawn_blocking(move || {
        agent.remove_mcp_server(&workspace, &scope, &name)
    })
    .await
    .map_err(|e| {
        api_err(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("MCP 删除任务失败: {e}"),
        )
    })?;
    match result {
        Ok(()) => Ok(Json(serde_json::json!({ "ok": true }))),
        Err(e) => Err(api_err(StatusCode::BAD_REQUEST, e)),
    }
}

#[derive(Debug, Deserialize)]
pub struct McpReconnectRequest {
    pub workspace: String,
    /// "global" | "project"
    pub scope: Option<String>,
    pub name: String,
}

#[derive(Debug, Deserialize)]
pub struct McpDetailQuery {
    pub workspace: String,
    /// "global" | "project"
    pub scope: String,
    pub name: String,
}

async fn mcp_reconnect_handler(
    State(state): State<Arc<McpServerState>>,
    Json(req): Json<McpReconnectRequest>,
) -> ApiResult {
    let scope = req.scope.unwrap_or_else(|| "project".to_string());
    let agent = state.agent_loop.clone();
    let workspace = req.workspace;
    let name = req.name;
    // 重连会拉起 MCP 连接并握手（可能阻塞数十秒），移出 tokio worker
    let result = tokio::task::spawn_blocking(move || {
        agent.reconnect_mcp_server(&workspace, &scope, &name)
    })
    .await
    .map_err(|e| {
        api_err(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("MCP 重连任务失败: {e}"),
        )
    })?;
    match result {
        Ok(server) => Ok(Json(serde_json::json!({ "server": server }))),
        Err(e) => Err(api_err(StatusCode::BAD_REQUEST, e)),
    }
}

async fn mcp_detail_handler(
    State(state): State<Arc<McpServerState>>,
    Query(params): Query<McpDetailQuery>,
) -> ApiResult {
    let agent = state.agent_loop.clone();
    let workspace = params.workspace;
    let scope = params.scope;
    let name = params.name;
    let result = tokio::task::spawn_blocking(move || {
        agent.get_mcp_server_detail(&workspace, &scope, &name)
    })
    .await
    .map_err(|e| {
        api_err(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("MCP 详情任务失败: {e}"),
        )
    })?;
    match result {
        Ok(server) => Ok(Json(serde_json::json!({ "server": server }))),
        Err(e) => Err(api_err(StatusCode::BAD_REQUEST, e)),
    }
}

// ── /api/skills ───────────────────────────────────────────────────
// Skill：`.forgeone/skills/*/SKILL.md` 的清单与详情。
// 清单 = frontmatter 元数据（name/description/version）；详情 = 元数据 + 指令正文。
// 发现范围：项目级 `{workspace}/.forgeone/skills` 优先，全局 `{user_home}/.forgeone/skills` 兜底。

#[derive(Debug, Deserialize)]
pub struct SkillsListParams {
    pub workspace: String,
}

async fn skills_list_handler(
    Query(params): Query<SkillsListParams>,
) -> Json<serde_json::Value> {
    match forgeone_tools::discover_skills(&params.workspace) {
        Ok(skills) => Json(serde_json::json!({
            "ok": true,
            "skills": skills.iter().map(|s| serde_json::json!({
                "name": s.name,
                "description": s.description,
                "version": s.version,
            })).collect::<Vec<_>>(),
        })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e })),
    }
}

#[derive(Debug, Deserialize)]
pub struct SkillsDetailParams {
    pub workspace: String,
    pub name: String,
}

async fn skills_detail_handler(
    Query(params): Query<SkillsDetailParams>,
) -> Json<serde_json::Value> {
    match forgeone_tools::load_skill(&params.workspace, &params.name) {
        Ok(skill) => Json(serde_json::json!({
            "ok": true,
            "skill": {
                "name": skill.name,
                "description": skill.description,
                "version": skill.version,
                "body": skill.body,
            }
        })),
        Err(e) => Json(serde_json::json!({ "ok": false, "error": e })),
    }
}
