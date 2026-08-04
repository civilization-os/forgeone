use super::tests::format_agent_events;
use super::*;

// ⚠️ 本文件整体不参与默认测试运行：所有测试均标记 #[ignore]，
// 需要手动运行：cargo test -p forgeone-runtime deepseek -- --ignored --nocapture
// 原因：调用真实 DeepSeek API，需要付费密钥与网络访问。

/// 真实 DeepSeek 端到端：复现用户场景「看一个只给文件名的文件」，
/// 验证 Agent Loop 全链路：规划 → 工具调用 → 失败/空结果 → 换方案 → Done。
///
/// 运行：
/// ```bash
/// cargo test -p forgeone-runtime agent_loop_deepseek_real_end_to_end -- --ignored --nocapture
/// ```
#[tokio::test(flavor = "multi_thread")]
#[ignore = "需要真实 DeepSeek API 密钥与网络访问（按需手动运行）"]
async fn agent_loop_deepseek_real_end_to_end() {
    // 从环境变量读取 DeepSeek API Key（https://platform.deepseek.com），勿硬编码密钥入库
    // 运行: set DEEPSEEK_API_KEY=sk-xxx && cargo test ... -- --ignored
    let api_key =
        std::env::var("DEEPSEEK_API_KEY").unwrap_or_else(|_| "sk-<your-deepseek-api-key>".to_string());
    let base_url = "https://api.deepseek.com".to_string();

    let agent = AgentLoop::default();
    let req = AgentRunRequest {
        session_id: "sess_real_deepseek".to_string(),
        prompt: "看看文件 repo-report-9dbfc56d-76c8-4137-a532-097900ab5e56-zh-CN.md".to_string(),
        model: "deepseek-chat".to_string(),
        protocol: "openai".to_string(),
        api_key: Some(api_key),
        base_url,
        system_prompt: "你是 ForgeOne Coding Agent，具备文件工具。用户提到文件时，先调用 search_files 或 glob 定位真实路径，再 read_file 读取；若定位结果为空，尝试换一种查找方式（换 pattern / 列目录），不要只描述意图。".to_string(),
        workspace: "C:\\Users\\14724\\Desktop".to_string(),
        history: vec![],
        allow_dangerous_tools: true,
    };
    let (tx, mut rx) = tokio::sync::mpsc::channel::<AgentEvent>(64);
    let handle = tokio::spawn(async move {
        agent.run(req, tx).await;
    });

    let mut events: Vec<AgentEvent> = vec![];
    while let Some(ev) = rx.recv().await {
        events.push(ev);
    }

    handle.await.expect("AgentLoop 后台任务执行失败");

    let event_log = format_agent_events(&events);
    println!(
        "\n\
         ==================== AGENT EVENT LOG ====================\n\
         {event_log}\n\
         =========================================================\n"
    );

    assert!(
        events
            .iter()
            .any(|e| matches!(e, AgentEvent::ToolStart { .. })),
        "DeepSeek 应触发工具调用（search_files / read_file / glob），实际事件: {events:#?}"
    );
    assert!(
        events.iter().any(|e| matches!(e, AgentEvent::Done { .. })),
        "应以 Done 收尾，实际事件: {events:#?}"
    );
}
