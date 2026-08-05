//! MCP 客户端接入主链路集成测试：
//! 通过 `.forgeone/mcp/*.json` manifest 发现并拉起 mock MCP server，
//! 验证工具注册（含 inputSchema）、工具调用与幂等注册。

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

use forgeone_runtime::mcp::register_workspace_mcp_servers;
use forgeone_tools::{ToolCallRequest, ToolCallStatus, ToolRegistry};

/// 同一进程内 USERPROFILE/HOME 是进程级共享的，测试串行隔离
static HOME_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// 用临时目录模拟用户主目录，避免测试被真实全局 MCP 配置干扰
fn isolate_home() -> PathBuf {
    let home = std::env::temp_dir().join(format!(
        "forgeone-mcp-test-home-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::create_dir_all(&home).unwrap();
    unsafe {
        #[cfg(windows)]
        std::env::set_var("USERPROFILE", &home);
        #[cfg(not(windows))]
        std::env::set_var("HOME", &home);
    }
    home
}

/// mock server 可执行文件路径（含空格时加引号，避免 entrypoint split 拆错）
fn mock_entrypoint() -> String {
    let mock_bin = env!("CARGO_BIN_EXE_mcp_mock_server");
    if mock_bin.contains(' ') {
        format!("\"{mock_bin}\"")
    } else {
        mock_bin.to_string()
    }
}

/// 构造一个临时 workspace：写入 `.forgeone/mcp/mock.json`，
/// entrypoint 指向本 crate 编译出的 mock server 可执行文件。
fn make_workspace() -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "forgeone-mcp-test-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let mcp_dir = dir.join(".forgeone").join("mcp");
    fs::create_dir_all(&mcp_dir).unwrap();

    let manifest = serde_json::json!({
        "api_version": "forgeone/v1",
        "name": "mock",
        "kind": "mcp",
        "description": "Mock MCP server for integration test",
        "entrypoint": mock_entrypoint(),
        "tools": []
    });
    fs::write(
        mcp_dir.join("mock.json"),
        serde_json::to_string_pretty(&manifest).unwrap(),
    )
    .unwrap();
    dir
}

#[test]
fn registers_and_invokes_mcp_tools() {
    let _guard = HOME_LOCK.lock().unwrap();
    let test_home = isolate_home();
    let ws = make_workspace();
    let mut registry = ToolRegistry::with_builtin_tools();

    // 1. 注册：发现 manifest → 拉起子进程 → 握手 → 注册工具
    let (ok, errors) = register_workspace_mcp_servers(&mut registry, &ws);
    assert!(errors.is_empty(), "注册不应失败: {errors:?}");
    assert!(ok.contains(&"mock".to_string()), "应注册 mock: {ok:?}");

    // 2. 工具已注册，且 MCP inputSchema 已解析
    let descriptors = registry.descriptors();
    let names: Vec<String> = descriptors.iter().map(|d| d.tool_name.clone()).collect();
    assert!(names.contains(&"mock__echo".to_string()), "缺少 mock__echo: {names:?}");
    assert!(names.contains(&"mock__add".to_string()), "缺少 mock__add: {names:?}");
    let echo = descriptors
        .iter()
        .find(|d| d.tool_name == "mock__echo")
        .expect("mock__echo 已注册");
    assert!(echo.input_schema.is_some(), "echo 应携带 inputSchema");

    // 3. 工具调用：echo
    let result = registry.execute(&ToolCallRequest {
        call_id: "call_1".to_string(),
        session_id: "test".to_string(),
        agent_id: "test".to_string(),
        loop_index: 0,
        tool_name: "mock__echo".to_string(),
        arguments: HashMap::from([("text".to_string(), "hello".to_string())]),
        requested_by: "test".to_string(),
    });
    assert_eq!(result.status, ToolCallStatus::Success, "error: {:?}", result.error);
    assert_eq!(
        result.structured_output.get("content").map(|s| s.as_str()),
        Some("echo: hello")
    );

    // 4. 工具调用：add（数值参数）
    let result = registry.execute(&ToolCallRequest {
        call_id: "call_2".to_string(),
        session_id: "test".to_string(),
        agent_id: "test".to_string(),
        loop_index: 0,
        tool_name: "mock__add".to_string(),
        arguments: HashMap::from([
            ("a".to_string(), "2".to_string()),
            ("b".to_string(), "3".to_string()),
        ]),
        requested_by: "test".to_string(),
    });
    assert_eq!(result.status, ToolCallStatus::Success, "error: {:?}", result.error);
    assert_eq!(
        result.structured_output.get("content").map(|s| s.as_str()),
        Some("sum: 5")
    );

    // 5. 幂等：重复注册同一 workspace 应全部跳过
    let (ok2, errors2) = register_workspace_mcp_servers(&mut registry, &ws);
    assert!(!ok2.contains(&"mock".to_string()), "mock 重复注册应被跳过: {ok2:?}");
    assert!(errors2.is_empty(), "{errors2:?}");

    // 清理（registry drop 时 McpExecutor 持有 Arc<ActiveMcpClient>，
    // 引用计数归零后 Drop 会自动 kill 子进程）
    let _ = fs::remove_dir_all(&test_home);
    let _ = fs::remove_dir_all(&test_home);
    let _ = fs::remove_dir_all(&ws);
}

#[test]
fn manages_mcp_servers_via_registry() {
    let _guard = HOME_LOCK.lock().unwrap();
    let test_home = isolate_home();
    let ws = make_workspace();
    let ws_str = ws.to_str().unwrap();
    let mut registry = ToolRegistry::with_builtin_tools();

    // 初始：磁盘有 fixture mock.json 但未注册 → 以 failed 状态展示（可删可重试）
    let servers = forgeone_runtime::mcp::list_workspace_mcp_servers(&registry, ws_str);
    assert_eq!(servers.len(), 1, "应显示未注册的 mock: {servers:?}");
    assert_eq!(servers[0].name, "mock");
    assert_eq!(servers[0].status, "failed");

    // 添加：写 manifest + 注册（拉起 mock server）
    let info = forgeone_runtime::mcp::add_workspace_mcp_server(
        &mut registry,
        "project",
        ws_str,
        "mock2",
        "stdio",
        &mock_entrypoint(),
        "",
    )
    .expect("添加 MCP server 应成功");
    assert_eq!(info.name, "mock2");
    assert_eq!(info.scope, "project");
    assert_eq!(info.tool_count, 2, "mock server 应暴露 2 个工具");
    assert_eq!(info.entrypoint.as_deref(), Some(mock_entrypoint().as_str()));

    // 列表：能读到新增的 server（含 tool_count / entrypoint）。
    // 注意 add 会重新注册整个 workspace，fixture 中的 mock 也会一并注册
    let servers = forgeone_runtime::mcp::list_workspace_mcp_servers(&registry, ws_str);
    assert!(servers.iter().any(|s| s.name == "mock"), "应包含 fixture mock: {servers:?}");
    let mock2 = servers
        .iter()
        .find(|s| s.name == "mock2")
        .expect("mock2 应在列表中");
    assert_eq!(mock2.tool_count, 2);
    assert!(mock2.entrypoint.is_some());

    // 重复添加：报错（配置已存在）
    let dup = forgeone_runtime::mcp::add_workspace_mcp_server(
        &mut registry,
        "project",
        ws_str,
        "mock2",
        "stdio",
        &mock_entrypoint(),
        "",
    );
    assert!(dup.is_err(), "重复添加应失败: {dup:?}");

    // 非法名称：路径穿越被拒绝
    let evil = forgeone_runtime::mcp::add_workspace_mcp_server(
        &mut registry,
        "project",
        ws_str,
        "../evil",
        "stdio",
        &mock_entrypoint(),
        "",
    );
    assert!(evil.is_err(), "非法名称应被拒绝: {evil:?}");

    // 空 entrypoint：被拒绝
    let empty = forgeone_runtime::mcp::add_workspace_mcp_server(
        &mut registry,
        "project",
        ws_str,
        "bad",
        "stdio",
        "  ",
        "",
    );
    assert!(empty.is_err(), "空 entrypoint 应被拒绝: {empty:?}");

    // 删除：manifest 移除 + 注册表注销（子进程被 kill）
    forgeone_runtime::mcp::remove_workspace_mcp_server(
        &mut registry,
        "project",
        ws_str,
        "mock2",
    )
    .expect("删除 MCP server 应成功");
    let servers = forgeone_runtime::mcp::list_workspace_mcp_servers(&registry, ws_str);
    assert!(
        !servers.iter().any(|s| s.name == "mock2"),
        "删除 mock2 后不应再出现: {servers:?}"
    );
    assert!(
        !registry
            .descriptors()
            .iter()
            .any(|d| d.tool_name == "mock2__echo"),
        "注销后工具应不可用"
    );
    assert!(
        !ws.join(".forgeone").join("mcp").join("mock2.json").exists(),
        "manifest 文件应被删除"
    );

    let _ = fs::remove_dir_all(&ws);
}

#[test]
fn detail_and_reconnect_mcp_server() {
    let _guard = HOME_LOCK.lock().unwrap();
    let test_home = isolate_home();
    let ws = make_workspace();
    let ws_str = ws.to_str().unwrap();
    let mut registry = ToolRegistry::with_builtin_tools();

    // 未注册：detail 显示 failed、工具列表为空、带 manifest 路径
    let detail = forgeone_runtime::mcp::get_mcp_server_detail(&registry, "project", ws_str, "mock")
        .expect("detail 应成功（manifest 存在）");
    assert_eq!(detail.info.status, "failed");
    assert_eq!(detail.info.tool_count, 0);
    assert!(detail.tools.is_empty());
    assert!(detail.manifest_path.is_some(), "应返回 manifest 路径");

    // 重连：触发注册
    let info = forgeone_runtime::mcp::reconnect_mcp_server(&mut registry, "project", ws_str, "mock")
        .expect("重连应成功");
    assert_eq!(info.status, "running");
    assert_eq!(info.tool_count, 2);

    // 已注册：detail 返回工具列表（含 inputSchema）
    let detail = forgeone_runtime::mcp::get_mcp_server_detail(&registry, "project", ws_str, "mock")
        .expect("detail 应成功");
    assert_eq!(detail.info.status, "running");
    let tool_names: Vec<String> = detail.tools.iter().map(|t| t.name.clone()).collect();
    assert!(tool_names.contains(&"mock__echo".to_string()), "{tool_names:?}");
    assert!(tool_names.contains(&"mock__add".to_string()), "{tool_names:?}");
    let echo = detail.tools.iter().find(|t| t.name == "mock__echo").unwrap();
    assert!(echo.input_schema.is_some(), "echo 应携带 inputSchema");

    // 已注册再重连：幂等返回当前状态
    let info2 = forgeone_runtime::mcp::reconnect_mcp_server(&mut registry, "project", ws_str, "mock")
        .expect("已注册重连应直接返回");
    assert_eq!(info2.status, "running");

    // 不存在的 server：detail / reconnect 都报错
    assert!(
        forgeone_runtime::mcp::reconnect_mcp_server(&mut registry, "project", ws_str, "nope").is_err()
    );
    assert!(
        forgeone_runtime::mcp::get_mcp_server_detail(&registry, "project", ws_str, "nope").is_err()
    );

    let _ = fs::remove_dir_all(&test_home);
    let _ = fs::remove_dir_all(&ws);
}

#[test]
fn keepalive_detects_and_rebuilds_dead_server() {
    let _guard = HOME_LOCK.lock().unwrap();
    let test_home = isolate_home();
    let ws = make_workspace();
    let ws_str = ws.to_str().unwrap();
    let mut registry = ToolRegistry::with_builtin_tools();

    // 注册
    let (ok, errors) = register_workspace_mcp_servers(&mut registry, &ws);
    assert!(ok.contains(&"mock".to_string()), "{errors:?}");

    // 通过类型下探拿到 McpExecutor，检查连接存活
    let executors = registry.executors();
    let executor = executors
        .iter()
        .find(|(name, _)| name == "mock__echo")
        .expect("mock__echo 已注册")
        .1
        .clone();
    let mcp = executor
        .as_any()
        .downcast_ref::<forgeone_runtime::mcp::McpExecutor>()
        .expect("应下探到 McpExecutor");
    assert!(mcp.client.is_alive(), "连接应存活");

    // 模拟 server 挂掉：主动 kill 连接
    mcp.client.kill();
    std::thread::sleep(std::time::Duration::from_millis(200));
    assert!(!mcp.client.is_alive(), "kill 后应不存活");

    // 保活重建：按 provider 注销（保留 manifest）→ 重新注册
    let pid = registry.provider_id_of("mock__echo").expect("provider").to_string();
    assert_eq!(pid, "mock");
    registry.remove_provider(&pid).expect("注销");
    let (ok2, errors2) = register_workspace_mcp_servers(&mut registry, &ws);
    assert!(ok2.contains(&"mock".to_string()), "{errors2:?}");

    // 重建后的连接可用
    let result = registry.execute(&ToolCallRequest {
        call_id: "call_ka".to_string(),
        session_id: "test".to_string(),
        agent_id: "test".to_string(),
        loop_index: 0,
        tool_name: "mock__echo".to_string(),
        arguments: HashMap::from([("text".to_string(), "alive".to_string())]),
        requested_by: "test".to_string(),
    });
    assert_eq!(result.status, ToolCallStatus::Success, "error: {:?}", result.error);
    assert_eq!(
        result.structured_output.get("content").map(|s| s.as_str()),
        Some("echo: alive")
    );

    let _ = fs::remove_dir_all(&test_home);
    let _ = fs::remove_dir_all(&ws);
}
