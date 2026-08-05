//! 全局级（用户级）MCP 集成测试：
//! 通过 `{user_home}/.forgeone/mcp/*.json` 发现并注册，对所有项目生效。
//!
//! 单独文件的原因：测试通过环境变量模拟用户主目录（`USERPROFILE` / `HOME`），
//! 不同测试二进制是独立进程，不会污染其他测试文件。

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

use forgeone_runtime::mcp::register_workspace_mcp_servers;
use forgeone_tools::{ToolCallRequest, ToolCallStatus, ToolRegistry};

/// 同一进程内 `USERPROFILE`/`HOME` 是进程级共享的，多个测试必须串行执行
static HOME_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn mock_entrypoint() -> String {
    let mock_bin = env!("CARGO_BIN_EXE_mcp_mock_server");
    if mock_bin.contains(' ') {
        format!("\"{mock_bin}\"")
    } else {
        mock_bin.to_string()
    }
}

fn temp_home() -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "forgeone-mcp-global-home-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn manages_global_mcp_servers() {
    let _guard = HOME_LOCK.lock().unwrap();
    // 用临时目录模拟用户主目录（edition 2024 中 set_var 为 unsafe）
    let home = temp_home();
    unsafe {
        #[cfg(windows)]
        std::env::set_var("USERPROFILE", &home);
        #[cfg(not(windows))]
        std::env::set_var("HOME", &home);
    }

    let mut registry = ToolRegistry::with_builtin_tools();

    // 添加全局 server：无需 workspace，写入 {home}/.forgeone/mcp/
    let info = forgeone_runtime::mcp::add_workspace_mcp_server(
        &mut registry,
        "global",
        "",
        "gserver",
        "stdio",
        &mock_entrypoint(),
        "",
    )
    .expect("添加全局 MCP server 应成功");
    assert_eq!(info.name, "gserver");
    assert_eq!(info.scope, "global");
    assert_eq!(info.tool_count, 2);

    // 列表：workspace 为空时仅注册/列出全局
    let servers = forgeone_runtime::mcp::list_workspace_mcp_servers(&registry, "");
    assert_eq!(servers.len(), 1, "应只有全局 server: {servers:?}");
    assert_eq!(servers[0].name, "gserver");
    assert_eq!(servers[0].scope, "global");

    // 工具可调用（跨"项目"可见：空 workspace 注册后同样可执行）
    let result = registry.execute(&ToolCallRequest {
        call_id: "call_g".to_string(),
        session_id: "test".to_string(),
        agent_id: "test".to_string(),
        loop_index: 0,
        tool_name: "gserver__echo".to_string(),
        arguments: HashMap::from([("text".to_string(), "global".to_string())]),
        requested_by: "test".to_string(),
    });
    assert_eq!(result.status, ToolCallStatus::Success, "error: {:?}", result.error);
    assert_eq!(
        result.structured_output.get("content").map(|s| s.as_str()),
        Some("echo: global")
    );

    // 幂等：重复注册跳过
    let (ok, errors) = register_workspace_mcp_servers(&mut registry, "");
    assert!(ok.is_empty(), "重复注册应被跳过: {ok:?}");
    assert!(errors.is_empty(), "{errors:?}");

    // manifest 落在用户主目录
    assert!(
        home.join(".forgeone").join("mcp").join("gserver.json").exists(),
        "全局 manifest 应写入用户主目录"
    );

    // 删除
    forgeone_runtime::mcp::remove_workspace_mcp_server(&mut registry, "global", "", "gserver")
        .expect("删除全局 MCP server 应成功");
    let servers = forgeone_runtime::mcp::list_workspace_mcp_servers(&registry, "");
    assert!(servers.is_empty(), "删除后不应有全局 server: {servers:?}");
    assert!(
        !registry
            .descriptors()
            .iter()
            .any(|d| d.tool_name == "gserver__echo"),
        "注销后工具应不可用"
    );

    let _ = fs::remove_dir_all(&home);
}

#[test]
fn project_overrides_global_same_name() {
    let _guard = HOME_LOCK.lock().unwrap();
    let home = temp_home();
    unsafe {
        #[cfg(windows)]
        std::env::set_var("USERPROFILE", &home);
        #[cfg(not(windows))]
        std::env::set_var("HOME", &home);
    }

    // 全局 + 项目各放一个同名 server manifest（entrypoint 都指向 mock server）
    let global_mcp = home.join(".forgeone").join("mcp");
    fs::create_dir_all(&global_mcp).unwrap();
    let project_root = std::env::temp_dir().join(format!(
        "forgeone-mcp-override-ws-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let project_mcp = project_root.join(".forgeone").join("mcp");
    fs::create_dir_all(&project_mcp).unwrap();

    let manifest = |name: &str| {
        serde_json::json!({
            "api_version": "forgeone/v1",
            "name": name,
            "kind": "mcp",
            "description": "same-name server",
            "entrypoint": mock_entrypoint(),
            "tools": []
        })
    };
    fs::write(
        global_mcp.join("dup.json"),
        serde_json::to_string_pretty(&manifest("dup")).unwrap(),
    )
    .unwrap();
    fs::write(
        project_mcp.join("dup.json"),
        serde_json::to_string_pretty(&manifest("dup")).unwrap(),
    )
    .unwrap();

    let mut registry = ToolRegistry::with_builtin_tools();
    let (ok, errors) = register_workspace_mcp_servers(&mut registry, &project_root);
    assert!(errors.is_empty(), "{errors:?}");
    // 同名只注册一次（项目级生效）
    assert_eq!(ok, vec!["dup".to_string()], "同名 server 应只注册一次: {ok:?}");

    let servers = forgeone_runtime::mcp::list_workspace_mcp_servers(&registry, &project_root.to_string_lossy());
    assert_eq!(servers.len(), 1);
    assert_eq!(servers[0].name, "dup");
    assert_eq!(servers[0].scope, "project", "项目级应覆盖全局级: {servers:?}");

    let _ = fs::remove_dir_all(&home);
    let _ = fs::remove_dir_all(&project_root);
}
