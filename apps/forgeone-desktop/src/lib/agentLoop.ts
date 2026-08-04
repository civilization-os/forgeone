/**
 * Agent Loop 客户端：通过 SSE 调用后端 forgeone-runtime 的 /api/agent/run 端点，
 * 将 AgentEvent 流分发到回调。Agent Loop 由后端驱动，携带完整工具定义并执行工具循环。
 */

/// 后端 AgentLoop 的请求体（对应 forgeone-runtime::AgentRunRequest）
export interface AgentRunRequestPayload {
  session_id: string
  prompt: string
  model: string
  protocol: string
  api_key?: string
  base_url: string
  system_prompt: string
  workspace: string
  history: { role: string; content: string }[]
  allow_dangerous_tools: boolean
}

export interface AgentLoopCallbacks {
  onThinking: (delta: string, loopIndex: number) => void
  onText: (delta: string, loopIndex: number) => void
  onToolStart: (call: { toolCallId: string; tool: string; args: any; requiresApproval: boolean }, loopIndex: number) => void
  onToolResult: (call: { toolCallId: string; tool: string; output: string; ok: boolean }, loopIndex: number) => void
  onApproval: (call: { toolCallId: string; tool: string; args: any; reason: string }, loopIndex: number) => void
  onToolRejected: (call: { toolCallId: string; tool: string }, loopIndex: number) => void
  onPlan: (plan: { goal: string; steps: string[] }, loopIndex: number) => void
  onDone: (loops: number, stopReason: string) => void
  onError: (message: string) => void
}

const AGENT_SERVER_URL = 'http://127.0.0.1:9527'

/// 调用后端 Agent Loop（/api/agent/run, SSE）。
/// 返回 true 表示服务可用并已处理完整轮 SSE 流；返回 false 表示服务不可用，调用方应回退到直连模式。
export async function runAgentLoop(
  body: AgentRunRequestPayload,
  cb: AgentLoopCallbacks,
  signal?: AbortSignal
): Promise<boolean> {
  let res: Response
  try {
    res = await fetch(`${AGENT_SERVER_URL}/api/agent/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      return true // 用户主动中断，不算失败
    }
    console.warn('[ChatCanvas] Agent Loop 服务连接失败:', e)
    return false
  }

  if (!res.ok || !res.body) {
    console.warn(`[ChatCanvas] Agent Loop 服务响应异常: HTTP ${res.status}`)
    return false
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const dataStr = trimmed.slice(5).trim()
        if (!dataStr || dataStr === '[DONE]') continue
        try {
          const event = JSON.parse(dataStr)
          dispatchAgentEvent(event, cb)
        } catch (e) {
          // 忽略无法解析的事件行
        }
      }
    }
  } finally {
    reader.releaseLock()
  }

  return true
}

/// 将后端 AgentEvent（serde snake_case tag）分发到回调
function dispatchAgentEvent(event: any, cb: AgentLoopCallbacks) {
  switch (event?.type) {
    case 'thinking':
      cb.onThinking(String(event.delta || ''), Number(event.loop_index ?? 0))
      break
    case 'text':
      cb.onText(String(event.delta || ''), Number(event.loop_index ?? 0))
      break
    case 'tool_start':
      cb.onToolStart({
        toolCallId: String(event.tool_call_id || ''),
        tool: String(event.tool || ''),
        args: event.args ?? {},
        requiresApproval: !!event.requires_approval,
      }, Number(event.loop_index ?? 0))
      break
    case 'tool_result':
      cb.onToolResult({
        toolCallId: String(event.tool_call_id || ''),
        tool: String(event.tool || ''),
        output: String(event.output || ''),
        ok: !!event.ok,
      }, Number(event.loop_index ?? 0))
      break
    case 'approval_required':
      cb.onApproval({
        toolCallId: String(event.tool_call_id || ''),
        tool: String(event.tool || ''),
        args: event.args ?? {},
        reason: String(event.reason || ''),
      }, Number(event.loop_index ?? 0))
      break
    case 'tool_rejected':
      cb.onToolRejected({
        toolCallId: String(event.tool_call_id || ''),
        tool: String(event.tool || ''),
      }, Number(event.loop_index ?? 0))
      break
    case 'plan':
      cb.onPlan({
        goal: String(event.goal || ''),
        steps: Array.isArray(event.steps) ? event.steps.map((s: any) => String(s)) : [],
      }, Number(event.loop_index ?? 0))
      break
    case 'done':
      cb.onDone(Number(event.loops || 0), String(event.stop_reason || 'stop'))
      break
    case 'error':
      cb.onError(String(event.message || 'Agent Loop 执行出错'))
      break
  }
}
