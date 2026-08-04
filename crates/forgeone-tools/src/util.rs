use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
#[cfg(windows)]
use encoding_rs::GBK;

use crate::types::{ToolCallRequest, ToolCallResult, ToolCallStatus};

static TOOL_CALL_COUNTER: AtomicU64 = AtomicU64::new(1);
// ── helpers ───────────────────────────────────────────────────────

pub(crate) fn error_result(request: &ToolCallRequest, msg: &str) -> ToolCallResult {
    ToolCallResult {
        call_id: request.call_id.clone(),
        status: ToolCallStatus::ValidationError,
        structured_output: HashMap::new(),
        error: Some(msg.to_string()),
        completed_at_ms: now_ms(),
    }
}

#[cfg(windows)]
pub(crate) fn decode_windows_console_output(bytes: &[u8]) -> String {
    if bytes.is_empty() {
        return String::new();
    }

    if looks_like_utf16le(bytes) {
        let utf16 = bytes
            .chunks_exact(2)
            .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
            .collect::<Vec<_>>();
        return String::from_utf16_lossy(&utf16);
    }

    if let Ok(text) = String::from_utf8(bytes.to_vec()) {
        return text;
    }

    let (decoded, _, _) = GBK.decode(bytes);
    decoded.into_owned()
}

#[cfg(windows)]
pub(crate) fn looks_like_utf16le(bytes: &[u8]) -> bool {
    if bytes.len() < 4 || !bytes.len().is_multiple_of(2) {
        return false;
    }

    let zero_high_bytes = bytes
        .iter()
        .skip(1)
        .step_by(2)
        .filter(|&&byte| byte == 0)
        .count();

    zero_high_bytes * 2 >= bytes.len() / 2
}

pub(crate) fn truncate_output(text: &str, max_len: usize) -> String {
    if text.len() > max_len {
        let mut end = max_len;
        while !text.is_char_boundary(end) {
            end += 1;
        }
        format!("{}...\n[output truncated at {max_len} bytes]", &text[..end])
    } else {
        text.to_string()
    }
}

pub fn next_tool_call_id() -> String {
    let counter = TOOL_CALL_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("tool-call-{counter}")
}

pub(crate) fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time should be after unix epoch")
        .as_millis()
}

