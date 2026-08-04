import type { ExecutionBlock, ToolExecution } from '../types'

/**
 * 聊天流式解析工具：把模型输出（<think>/<tool> 标签、SSE/NDJSON 流）解析为
 * 界面可渲染的 ExecutionBlock 与消息分段。
 */

export function parseTimelineBlocks(raw: string, isStreaming?: boolean): ExecutionBlock[] {
  const blocks: ExecutionBlock[] = []
  if (!raw) return blocks

  // 匹配 <think>...</think>, <thought>...</thought>, <reasoning>...</reasoning>, 或尾部未闭合的 <think>...
  // 以及 <tool name="...">...</tool>
  const tagRegex = /(?:<(think|thought|reasoning)>([\s\S]*?)<\/\1>|<(think|thought|reasoning)>([\s\S]*)$|<tool(?: name="([^"]+)")?>([\s\S]*?)<\/tool>)/gi

  let lastIndex = 0
  let match: RegExpExecArray | null
  let blockIdx = 0

  while ((match = tagRegex.exec(raw)) !== null) {
    const preText = raw.substring(lastIndex, match.index).trim()
    if (preText) {
      blocks.push({
        id: `blk-text-${blockIdx++}`,
        type: 'text',
        content: preText,
        isStreaming: false,
      })
    }

    if (match[1]) {
      // 闭合的 <think>...</think>
      const thinkContent = match[2].trim()
      if (thinkContent) {
        blocks.push({
          id: `blk-think-${blockIdx++}`,
          type: 'think',
          content: thinkContent,
          isStreaming: false,
        })
      }
    } else if (match[3]) {
      // 未闭合的 <think>...（流式进行中）
      const thinkContent = match[4]
      blocks.push({
        id: `blk-think-${blockIdx++}`,
        type: 'think',
        content: thinkContent,
        isStreaming: isStreaming,
      })
    } else if (match[5] || match[6]) {
      // <tool name="...">...</tool>
      const toolName = match[5] || 'tool_call'
      const toolArgs = match[6]?.trim() || ''
      blocks.push({
        id: `blk-tool-${blockIdx++}`,
        type: 'tool',
        tool: {
          id: `t-${blockIdx}`,
          name: toolName,
          args: toolArgs,
          status: 'success',
        },
      })
    }

    lastIndex = tagRegex.lastIndex
  }

  // 剩余的后置文本
  const postText = raw.substring(lastIndex).trim()
  if (postText) {
    blocks.push({
      id: `blk-text-${blockIdx++}`,
      type: 'text',
      content: postText,
      isStreaming: isStreaming,
    })
  }

  return blocks
}

export function parseResponseSections(raw: string, _mode?: string): { thinking?: string; tools?: ToolExecution[]; content: string } {
  let thinking: string | undefined = undefined
  let content = raw

  // 1. 已闭合的完整标签匹配: <think>...</think> 或 <thought>...</thought> 或 <reasoning>...</reasoning>
  const thinkMatch = raw.match(/<(?:think|thought|reasoning)>([\s\S]*?)<\/(?:think|thought|reasoning)>/i)
  if (thinkMatch) {
    thinking = thinkMatch[1].trim()
    content = raw.replace(/<(?:think|thought|reasoning)>[\s\S]*?<\/(?:think|thought|reasoning)>/i, '').trim()
  } else {
    // 2. 流式进行中（未闭合）: 以 <think> / <thought> 开头
    const openTagMatch = raw.match(/<(?:think|thought|reasoning)>([\s\S]*)$/i)
    if (openTagMatch) {
      thinking = openTagMatch[1]
      content = ''
    }
  }

  return { thinking, content }
}

export function estimateTokenCount(text: string): number {
  if (!text) return 0
  const cjkMatches = text.match(/[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/g)
  const cjkCount = cjkMatches ? cjkMatches.length : 0
  const nonCjkText = text.replace(/[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/g, ' ')
  const nonCjkWords = nonCjkText.trim().split(/\s+/).filter(Boolean).length
  const punctuationCount = (nonCjkText.match(/[^a-zA-Z0-9\s]/g) || []).length
  return Math.max(1, Math.round(cjkCount * 1.3 + nonCjkWords * 1.3 + punctuationCount * 0.5))
}

export interface StreamChunkMeta {
  evalCount?: number
  evalDurationNs?: number
  promptEvalCount?: number
  promptEvalDurationNs?: number
  promptTokens?: number
  completionTokens?: number
  cachedTokens?: number
  isDone?: boolean
}

/**
 * 读取直连模型（OpenAI / Anthropic / Ollama）的流式响应：
 * 兼容标准 SSE（data: ...）与 Ollama NDJSON 两种格式。
 */
export async function readSSEStream(
  response: Response,
  onChunk: (chunkText: string, chunkReasoning?: string, meta?: StreamChunkMeta) => void,
  signal?: AbortSignal
) {
  if (!response.body) return
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  // 用户主动中断：中止读取并正常结束
  if (signal) {
    signal.addEventListener('abort', () => {
      reader.cancel().catch(() => {})
    }, { once: true })
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue

        // 1. 标准 SSE 格式: data: ...
        if (trimmed.startsWith('data:')) {
          const dataStr = trimmed.slice(5).trim()
          if (dataStr === '[DONE]') continue
          try {
            const json = JSON.parse(dataStr)
            // OpenAI / DeepSeek delta
            const delta = json.choices?.[0]?.delta
            const text = delta?.content || ''
            const reasoning = delta?.reasoning_content || ''
            const usage = json.usage
            const meta: StreamChunkMeta | undefined = usage
              ? {
                  promptTokens: usage.prompt_tokens,
                  completionTokens: usage.completion_tokens,
                  cachedTokens: usage.prompt_tokens_details?.cached_tokens || usage.prompt_cache_hit_tokens,
                  isDone: true,
                }
              : undefined

            if (text || reasoning || meta) {
              onChunk(text, reasoning, meta)
            }

            // Anthropic delta
            if (json.type === 'content_block_delta') {
              if (json.delta?.type === 'thinking_delta') {
                onChunk('', json.delta.thinking || '')
              } else if (json.delta?.type === 'text_delta') {
                onChunk(json.delta.text || '', '')
              }
            } else if (json.type === 'message_delta' && json.usage) {
              onChunk('', '', {
                completionTokens: json.usage.output_tokens,
                isDone: true,
              })
            }
          } catch (e) {
            // partial JSON parse ignore
          }
        } else {
          // 2. Ollama 流式 NDJSON 格式
          try {
            const json = JSON.parse(trimmed)
            const text = json.message?.content || json.response || ''
            const isDone = json.done === true
            const meta: StreamChunkMeta = {
              evalCount: json.eval_count,
              evalDurationNs: json.eval_duration,
              promptEvalCount: json.prompt_eval_count,
              promptEvalDurationNs: json.prompt_eval_duration,
              isDone,
            }
            if (text || isDone) {
              onChunk(text, '', meta)
            }
          } catch (e) {
            // ignore non-json line
          }
        }
      }
    }

    // 刷新末尾残余 buffer
    if (buffer.trim()) {
      const trimmed = buffer.trim()
      if (trimmed.startsWith('data:')) {
        const dataStr = trimmed.slice(5).trim()
        if (dataStr !== '[DONE]') {
          try {
            const json = JSON.parse(dataStr)
            const delta = json.choices?.[0]?.delta
            const text = delta?.content || ''
            const reasoning = delta?.reasoning_content || ''
            if (text || reasoning) onChunk(text, reasoning)
          } catch (e) {}
        }
      } else {
        try {
          const json = JSON.parse(trimmed)
          const text = json.message?.content || json.response || ''
          const isDone = json.done === true
          const meta: StreamChunkMeta = {
            evalCount: json.eval_count,
            evalDurationNs: json.eval_duration,
            promptEvalCount: json.prompt_eval_count,
            promptEvalDurationNs: json.prompt_eval_duration,
            isDone,
          }
          if (text || isDone) onChunk(text, '', meta)
        } catch (e) {}
      }
    }
  } finally {
    reader.releaseLock()
  }
}
