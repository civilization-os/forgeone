//! LLM 客户端：支持 OpenAI / Anthropic / Ollama 协议的异步流式调用
//!
//! 负责将 Agent Loop 的消息列表和工具定义发送给 LLM，
//! 并流式解析返回的 text chunk 和 tool_use 调用。

pub mod types;
pub mod tool_defs;
mod anthropic;
mod openai;
mod ollama;

pub use tool_defs::builtin_tool_defs;
pub use types::*;
#[cfg(test)]
pub(crate) use ollama::extract_text_tool_calls;

/// 异步 LLM 客户端，使用 reqwest
pub struct LlmClient {
    pub(crate) http: reqwest::Client,
}

impl LlmClient {
    pub fn new() -> Self {
        Self {
            http: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(120))
                .build()
                .expect("failed to build HTTP client"),
        }
    }

    /// 调用 LLM，流式接收响应，通过 tx 推送 LlmChunk
    pub async fn call_streaming(
        &self,
        req: &LlmRequest,
        tx: tokio::sync::mpsc::Sender<LlmChunk>,
    ) -> Result<(), String> {
        match req.protocol {
            LlmProtocol::Anthropic => self.call_anthropic(req, tx).await,
            LlmProtocol::OpenAi => self.call_openai(req, tx).await,
            LlmProtocol::Ollama => self.call_ollama(req, tx).await,
        }
    }
}

impl Default for LlmClient {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 文本 JSON 工具调用提取：纯 JSON / 文本混合 / tool 别名 / 无调用
    #[test]
    fn extract_text_tool_calls_recognizes_text_json_calls() {
        // 纯 JSON 工具调用（qwen2.5-coder 经 Ollama 的典型输出）
        let (clean, calls) = extract_text_tool_calls(
            r#"{"name": "search_files", "arguments": {"pattern": "repo-report-9dbfc56d-76c8-4137-a532-097900ab5e56-zh-CN.md"}}"#,
        );
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].name, "search_files");
        assert_eq!(calls[0].input["pattern"], "repo-report-9dbfc56d-76c8-4137-a532-097900ab5e56-zh-CN.md");
        assert!(clean.is_empty(), "纯 JSON 调用应被整体剥离，实际: {clean}");

        // 文本与工具调用混合
        let (clean2, calls2) = extract_text_tool_calls(
            "好的，我先定位文件：\n{\"tool\":\"read_file\",\"arguments\":{\"path\":\"src/main.rs\"}}\n这是结果",
        );
        assert_eq!(calls2.len(), 1);
        assert_eq!(calls2[0].name, "read_file");
        assert_eq!(calls2[0].input["path"], "src/main.rs");
        assert!(clean2.contains("好的，我先定位文件"), "剥离后应保留正文，实际: {clean2}");
        assert!(clean2.contains("这是结果"));

        // 无工具调用
        let (clean3, calls3) = extract_text_tool_calls("抱歉，我无法确认该文件是否存在。");
        assert!(calls3.is_empty());
        assert_eq!(clean3, "抱歉，我无法确认该文件是否存在。");
    }
}
