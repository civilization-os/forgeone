use serde_json::Value;

// ── 规划阶段 ───────────────────────────────────────────────────────

pub(crate) const PLAN_SYSTEM_PROMPT: &str = "你是 ForgeOne Agent 的规划器（Planner）。\
你负责把用户的请求提炼为一个清晰目标，并分解为 2~5 个可执行步骤。\
严格只输出 JSON，不要任何解释、前后缀或 markdown 代码块。\
JSON 格式：{\"goal\": \"一句话目标\", \"steps\": [\"步骤1\", \"步骤2\"]}";

/// 将目标与执行计划注入 system 上下文（目标锚定）
pub(crate) fn build_goal_system(base_system: &str, goal: &str, steps: &[String]) -> String {
    let mut plan_text = String::new();
    for (i, s) in steps.iter().enumerate() {
        plan_text.push_str(&format!("{}. {}\n", i + 1, s));
    }
    format!(
        "{}\n\n【当前目标】{}\n【执行计划】\n{}【推进要求】围绕目标有序执行；每一步基于已获取的上下文推进；目标达成后请立即停止调用工具并输出最终总结，不要多余动作。",
        base_system, goal, plan_text
    )
}

/// 从模型输出中解析规划 JSON（容忍 ```json 代码块包裹等噪音）
pub(crate) fn parse_plan_json(raw: &str) -> Result<(String, Vec<String>), String> {
    let trimmed = raw.trim();
    let start = trimmed.find('{').ok_or("模型输出中未找到 JSON 对象")?;
    let end = trimmed
        .rfind('}')
        .ok_or("模型输出中未找到闭合的 JSON 对象")?;
    let json_str = &trimmed[start..=end];

    let v: Value =
        serde_json::from_str(json_str).map_err(|e| format!("规划 JSON 解析失败: {e}"))?;
    let goal = v
        .get("goal")
        .and_then(|g| g.as_str())
        .map(str::to_string)
        .ok_or("规划缺少 goal 字段")?;
    let steps = v
        .get("steps")
        .and_then(|s| s.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|s| s.as_str().map(str::to_string))
                .collect::<Vec<String>>()
        })
        .unwrap_or_default();
    if steps.is_empty() {
        return Err("规划 steps 为空".to_string());
    }
    Ok((goal, steps))
}
// ── 目标完成度自评 ─────────────────────────────────────────────────

pub(crate) const COMPLETION_CHECK_PROMPT: &str = "你是 ForgeOne Agent 的目标完成度评估器。\
基于【目标】【执行计划】和【已执行情况】，判断目标是否真正完成。\
注意：仅当证据充分（已读取/修改了目标文件、已获取所需信息）才算完成；\
如果只是口头承诺「我来看看」但没有实际执行，判定为未完成。\
严格只输出 JSON，不要任何解释、前后缀或 markdown 代码块。\
JSON 格式：{\"completed\": true/false, \"reason\": \"一句话依据\", \"next_action\": \"未完成时的下一步动作，已完成则留空\"}";

/// 从模型输出中提取第一个 JSON 对象（容忍代码块/前后缀噪音）
fn extract_json_value(raw: &str) -> Result<Value, String> {
    let trimmed = raw.trim();
    let start = trimmed.find('{').ok_or("模型输出中未找到 JSON 对象")?;
    let end = trimmed
        .rfind('}')
        .ok_or("模型输出中未找到闭合的 JSON 对象")?;
    serde_json::from_str(&trimmed[start..=end]).map_err(|e| format!("JSON 解析失败: {e}"))
}

/// 解析目标完成度评估结果 → (completed, reason, next_action)
pub(crate) fn parse_completion_check(raw: &str) -> Result<(bool, String, String), String> {
    let v = extract_json_value(raw)?;
    let completed = v
        .get("completed")
        .and_then(|c| c.as_bool())
        .ok_or("评估缺少 completed 字段")?;
    let reason = v
        .get("reason")
        .and_then(|r| r.as_str())
        .unwrap_or("")
        .to_string();
    let next_action = v
        .get("next_action")
        .and_then(|n| n.as_str())
        .unwrap_or("")
        .to_string();
    Ok((completed, reason, next_action))
}
