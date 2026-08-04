import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Send,
  AlertTriangle,
  CheckCircle2,
  Paperclip,
  AtSign,
  Zap,
  ChevronDown,
  ChevronRight,
  Cpu,
  CornerDownLeft,
  Loader2,
  Brain,
  Terminal,
  Image as ImageIcon,
  Plus,
  Folder,
  FolderPlus,
  Trash2,
  Check,
  X,
  Copy,
  Edit3,
  Target,
  MessageSquare,
  ChevronUp,
  Square,
  ShieldCheck,
  Flame,
} from 'lucide-react'
import { MarkdownRenderer } from './MarkdownRenderer'
import { TimelineMinimap } from './TimelineMinimap'
import { estimateTokenCount, readSSEStream } from '../../lib/chatParse'
import type { StreamChunkMeta } from '../../lib/chatParse'
import { runAgentLoop } from '../../lib/agentLoop'
import { buildForgeOneSystemPrompt } from '../../lib/systemPrompt'
import { runTsScript } from '../../lib/tsScriptRuntime'
import { TS_OLLAMA_DEMO_SCRIPT } from '../../lib/tsScriptDemos'
import type { ChatMessage, ModelItem, ExecutionBlock, ProjectInfo, ChatSession, RuntimeStats, PlanStepStatus } from '../../types'

export const DEFAULT_PROJECT_OPTIONS: ProjectInfo[] = [
  { id: 'forgeone', name: 'forgeone', path: 'd:\\project\\forgeone' },
  { id: 'aischool', name: 'AISchool', path: 'd:\\project\\aischool' },
  { id: 'component-one', name: 'component-one', path: 'd:\\project\\component-one' },
  { id: 'langgraph-flow', name: 'Langgraph Flow', path: 'd:\\project\\langgraph-flow' },
  { id: 'claude-cli-plugins', name: 'Claude Cli Plugins Plus', path: 'd:\\project\\claude-cli-plugins' },
  { id: 'forgeone-web', name: 'forgeone-web-harness', path: 'd:\\project\\forgeone-web' },
]


export interface ConnectedModelInfo extends ModelItem {
  provider: string
}

// 收敛摘要卡：think/tool 过程收敛成统计行（点击展开完整时间线），最终回答完整保留
function AgentSummary({ msg, onExpand }: { msg: ChatMessage; onExpand: () => void }) {
  const blocks = msg.blocks || []
  const thinkBlocks = blocks.filter((b) => b.type === 'think')
  const toolBlocks = blocks.filter((b) => b.type === 'tool')
  const textBlocks = blocks.filter((b) => b.type === 'text')
  const finalText = textBlocks.length > 0 ? textBlocks.map((b) => b.content).join('\n\n') : (msg.content || '')
  // 按工具名启发式分组：check/test/verify/validate/lint/inspect → Verification，其余 → Executing
  const isVerify = (name: string) => /check|test|verify|validate|lint|inspect/i.test(name)
  const execTools = toolBlocks.filter((b) => !isVerify(b.tool.name))
  const verifyTools = toolBlocks.filter((b) => isVerify(b.tool.name))

  const statusIcon = (st: string | undefined) => {
    if (st === 'running') return <Loader2 size={10} className="animate-spin text-blue-500 shrink-0" />
    if (st === 'failed') return <X size={10} className="text-rose-500 shrink-0" />
    return <Check size={10} className="text-emerald-500 shrink-0" />
  }
  const fmt = (ms?: number) => (ms !== undefined ? ` · ${(ms / 1000).toFixed(1)}s` : '')

  return (
    <div className="rounded-xl border border-[#E8E8E6] bg-white overflow-hidden text-xs shadow-xs">
      {/* 状态卡头：点击展开完整执行轨迹 */}
      <button
        type="button"
        onClick={onExpand}
        className="w-full flex items-center justify-between px-3 py-2 bg-[#FAF9F7] border-b border-[#E8E8E6] hover:bg-[#F4F4F2] transition-colors cursor-pointer text-left select-none"
        title="点击展开完整执行轨迹"
      >
        <span className="font-semibold text-[#1A1C1B]">Agent 状态</span>
        <span className="flex items-center gap-1 text-[10px] text-[#76777B] font-mono">
          展开轨迹 <ChevronDown size={11} />
        </span>
      </button>

      <div className="p-3 space-y-3 font-mono text-[11px]">
        {/* Planning */}
        <div>
          <div className="flex items-center gap-1.5 text-indigo-600 font-semibold mb-1">
            <Brain size={11} /> Planning
            {thinkBlocks.length > 0 && <span className="text-[#A1A1AA] font-normal">×{thinkBlocks.length}</span>}
          </div>
          {thinkBlocks.length > 0 && (
            <ul className="space-y-0.5 pl-4 text-[#6B7280]">
              {thinkBlocks.slice(0, 3).map((b, i) => (
                <li key={i} className="truncate">
                  <span className="text-[#A1A1AA]">· </span>
                  {b.content.replace(/[\r\n]+/g, ' ').slice(0, 40) || '分析中...'}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Executing */}
        {execTools.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 text-amber-700 font-semibold mb-1">
              <Terminal size={11} /> Executing
              <span className="text-[#A1A1AA] font-normal">×{execTools.length}</span>
            </div>
            <ul className="space-y-0.5 pl-4 text-[#46474A]">
              {execTools.map((b, i) => (
                <li key={i} className="flex items-center gap-1.5">
                  {statusIcon(b.tool.status)}
                  <span>{b.tool.name}</span>
                  <span className="text-[#A1A1AA]">{fmt(b.tool.durationMs)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Verification */}
        {verifyTools.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 text-emerald-700 font-semibold mb-1">
              <CheckCircle2 size={11} /> Verification
              <span className="text-[#A1A1AA] font-normal">×{verifyTools.length}</span>
            </div>
            <ul className="space-y-0.5 pl-4 text-[#46474A]">
              {verifyTools.map((b, i) => (
                <li key={i} className="flex items-center gap-1.5">
                  {statusIcon(b.tool.status)}
                  <span>{b.tool.name}</span>
                  <span className="text-[#A1A1AA]">{fmt(b.tool.durationMs)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Final Answer */}
        {finalText && (
          <div>
            <div className="flex items-center gap-1.5 text-[#2D63ED] font-semibold mb-1">
              <MessageSquare size={11} /> Final Answer
            </div>
            <div className="select-text text-[13px] font-sans text-[#1A1C1B] leading-relaxed">
              <MarkdownRenderer content={finalText} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

interface ChatCanvasProps {
  activeModel?: string
  onSelectModel?: (modelId: string) => void
  projects?: ProjectInfo[]
  currentProject?: ProjectInfo | null
  onSelectProject?: (project: ProjectInfo | null) => void
  onOpenProjectModal?: () => void
  onRemoveProject?: (projId: string) => void
  onOpenSettings?: () => void
  currentSession?: ChatSession | null
  onCreateSession?: (firstMessage: ChatMessage, project?: ProjectInfo | null) => string
  onUpdateSession?: (sessionId: string, messages: ChatMessage[], newTitle?: string) => void
  onUpdateRuntimeStats?: (stats: Partial<RuntimeStats>) => void
}

export default function ChatCanvas({
  activeModel = '',
  onSelectModel,
  projects = [],
  currentProject = null,
  onSelectProject,
  onOpenProjectModal,
  onRemoveProject,
  onOpenSettings,
  currentSession = null,
  onCreateSession,
  onUpdateSession,
  onUpdateRuntimeStats,
}: ChatCanvasProps) {
  const { t } = useTranslation()
  const [inputValue, setInputValue] = useState('')
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false)
  const [isProjectMenuOpen, setIsProjectMenuOpen] = useState(false)
  // 安全/危险模式：安全=危险工具需审批；危险=普通命令直接执行，仅高危命令仍需审批
  const [safetyMode, setSafetyMode] = useState<'safe' | 'dangerous'>('safe')
  const modelMenuRef = useRef<HTMLDivElement>(null)
  const projectMenuRef = useRef<HTMLDivElement>(null)

  const [connectedModels, setConnectedModels] = useState<ConnectedModelInfo[]>([])

  const loadConnectedModels = () => {
    try {
      for (const oldKey of ['forgeone_model_providers_v1', 'forgeone_model_providers_v2', 'forgeone_model_providers_v3']) {
        localStorage.removeItem(oldKey)
      }
      const saved = localStorage.getItem('forgeone_model_providers_v5') || localStorage.getItem('forgeone_model_providers_v4')
      if (saved) {
        const providers = JSON.parse(saved)
        const readyList: ConnectedModelInfo[] = []

        providers.forEach((p: any) => {
          const hasValidKey =
            p.isCustomTs ||
            p.protocol === 'ts-script' ||
            p.protocol === 'ollama' ||
            (typeof p.apiKey === 'string' && p.apiKey.trim().length > 0)

          if (p.status === 'connected' && hasValidKey && Array.isArray(p.models)) {
            p.models.forEach((m: any) => {
              const idLower = (m.id || '').toLowerCase()
              const isThinking = m.supportsThinking ?? (idLower.includes('r1') || idLower.includes('o1') || idLower.includes('o3') || idLower.includes('reasoner') || idLower.includes('think'))
              const isMultimodal = m.modality === 'multimodal' || idLower.includes('4o') || idLower.includes('sonnet') || idLower.includes('vl') || idLower.includes('vision')

              readyList.push({
                id: m.id || m.name,
                name: m.name || m.id,
                provider: p.name,
                modality: isMultimodal ? 'multimodal' : (m.modality || 'text'),
                supportsThinking: isThinking,
                supportsTools: m.supportsTools ?? true,
                contextLength: m.contextLength || '128k',
              })
            })
          }
        })

        setConnectedModels(readyList)

        if (readyList.length > 0) {
          const currentExists = readyList.some((m) => m.id === activeModel)
          if (!currentExists && onSelectModel) {
            onSelectModel(readyList[0].id)
          }
        } else {
          if (activeModel && onSelectModel) {
            onSelectModel('')
          }
        }
        return
      }
    } catch (e) {
      console.error('Failed to load connected models in ChatCanvas:', e)
    }

    setConnectedModels([])
    if (activeModel && onSelectModel) {
      onSelectModel('')
    }
  }

  useEffect(() => {
    loadConnectedModels()
    window.addEventListener('forgeone_models_updated', loadConnectedModels)
    window.addEventListener('storage', loadConnectedModels)
    return () => {
      window.removeEventListener('forgeone_models_updated', loadConnectedModels)
      window.removeEventListener('storage', loadConnectedModels)
    }
  }, [isModelMenuOpen])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (modelMenuRef.current && !modelMenuRef.current.contains(e.target as Node)) {
        setIsModelMenuOpen(false)
      }
      if (projectMenuRef.current && !projectMenuRef.current.contains(e.target as Node)) {
        setIsProjectMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const [messages, setMessages] = useState<ChatMessage[]>(() => currentSession?.messages || [])
  const [isGenerating, setIsGenerating] = useState(false)
  const chatScrollRef = useRef<HTMLDivElement>(null)
  const currentSessionIdRef = useRef<string | null>(currentSession?.id || null)

  const [expandedThinkingIds, setExpandedThinkingIds] = useState<Record<string, boolean>>({})
  const [expandedToolIds, setExpandedToolIds] = useState<Record<string, boolean>>({})
  // 已结束的 Agent 回复默认收敛为摘要卡；记录用户手动展开过完整时间线的消息 id
  const [expandedAgentIds, setExpandedAgentIds] = useState<Set<string>>(new Set())
  // 计划卡片步骤列表的展开状态（默认折叠，点击头部展开）
  const [expandedPlanIds, setExpandedPlanIds] = useState<Record<string, boolean>>({})
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const handleCopyText = (id: string, text: string) => {
    if (!text) return
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard
        .writeText(text)
        .then(() => {
          setCopiedId(id)
          setTimeout(() => setCopiedId(null), 2000)
        })
        .catch(() => fallbackCopy(id, text))
    } else {
      fallbackCopy(id, text)
    }
  }

  const fallbackCopy = (id: string, text: string) => {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    try {
      document.execCommand('copy')
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 2000)
    } catch (e) {
      console.error('Copy failed', e)
    }
    document.body.removeChild(textarea)
  }

  const toggleThinking = (msgId: string) => {
    setExpandedThinkingIds((prev) => ({
      ...prev,
      [msgId]: !prev[msgId],
    }))
  }

  const toggleTool = (toolId: string) => {
    setExpandedToolIds((prev) => ({
      ...prev,
      [toolId]: !prev[toolId],
    }))
  }

  const isSwitchingSessionRef = useRef(false)

  // 当外部选中的 currentSession 发生切换时，同步更新本地 messages
  // 注意：若当前正在生成响应（isGenerating），不覆盖本地 messages，避免 race condition
  useEffect(() => {
    if (isGenerating) {
      // 生成中时仅更新 ref，不覆盖正在流式写入的 messages
      currentSessionIdRef.current = currentSession?.id || null
      return
    }
    isSwitchingSessionRef.current = true
    currentSessionIdRef.current = currentSession?.id || null
    setMessages(currentSession?.messages || [])
    const timer = setTimeout(() => {
      isSwitchingSessionRef.current = false
    }, 100)
    return () => clearTimeout(timer)
  }, [currentSession?.id])

  // 会话消息变动时自动持久化同步至上层 Session Store 与 StatusBar 统计
  useEffect(() => {
    // 仅在非切换加载状态下且消息有实质内容时，才触发外部 session 更新
    if (!isSwitchingSessionRef.current && currentSessionIdRef.current && messages.length > 0 && onUpdateSession) {
      onUpdateSession(currentSessionIdRef.current, messages)
    }

    let totalTokens = 780
    messages.forEach((m) => {
      totalTokens += estimateTokenCount(m.content || '') + estimateTokenCount(m.thinking || '')
      m.blocks?.forEach((b) => {
        if (b.type === 'text' || b.type === 'think') totalTokens += estimateTokenCount(b.content)
        if (b.type === 'tool') totalTokens += estimateTokenCount(b.tool.output || '')
      })
    })
    // 上下文上限从当前模型的 contextLength 配置读取（如 '128k' → 128000）；
    // 未配置时传 0（StatusBar 显示「—」，不假装 128k）
    const activeMeta = connectedModels.find((m) => m.id === activeModel || m.name === activeModel)
    let maxTokens = 0
    const ctxMatch = activeMeta?.contextLength?.match(/(\d+)\s*k/i)
    if (ctxMatch) maxTokens = parseInt(ctxMatch[1], 10) * 1000
    onUpdateRuntimeStats?.({
      contextUsedTokens: Math.max(150, totalTokens),
      contextMaxTokens: maxTokens,
      isGenerating,
    })
  }, [messages, isGenerating, connectedModels, activeModel])

  // 生成结束（或切换会话）后，确保本地 messages 与当前会话数据保持一致，
  // 避免流式期间切换会话导致的上下文错位/数据污染
  useEffect(() => {
    if (!isGenerating) {
      setMessages(currentSession?.messages || [])
    }
  }, [isGenerating, currentSession?.id])

  const inputRef = useRef<HTMLTextAreaElement>(null)
  // 生成中断：AbortController 贯穿 Agent Loop / 直连两条路径
  const abortControllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight
    }
  }, [messages, isGenerating])

  // 停止生成：中断当前流（Agent Loop SSE / 直连 fetch），收尾渲染交给各自的 finally
  const handleStopGeneration = () => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    setIsGenerating(false)
  }

  // 工具审批：投递决定到后端（批准则执行该工具，拒绝则跳过），并立即收起审批卡片
  const handleApproval = (msgId: string, approved: boolean) => {
    const msg = messages.find((m) => m.id === msgId)
    const callId = msg?.pendingApproval?.toolCallId
    if (!callId) return
    fetch('http://127.0.0.1:9527/api/agent/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool_call_id: callId, approved }),
    }).catch(() => {})
    setMessages((prev) =>
      prev.map((m) => (m.id === msgId ? { ...m, pendingApproval: undefined } : m))
    )
  }

  const handleSendMessage = async () => {
    if (!inputValue.trim() || isGenerating) return

    // 每次发送创建新的 AbortController，供「停止」按钮中断
    const controller = new AbortController()
    abortControllerRef.current = controller
    const abortSignal = controller.signal

    const userText = inputValue.trim()
    const newMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: userText,
    }

    setMessages((prev) => [...prev, newMessage])
    setInputValue('')
    setIsGenerating(true)

    // 若当前为全新对话，在追加消息并设置 isGenerating 之后才建立 Session
    // 这样 session 切换的 useEffect 在 isGenerating=true 时不会覆盖本地 messages
    if (!currentSessionIdRef.current && onCreateSession) {
      const newSessId = onCreateSession(newMessage, currentProject)
      currentSessionIdRef.current = newSessId
    }
    // 记录本次发送绑定的会话：流式生成期间若用户切换到其它会话，
    // 不再把旧会话的流式内容写入本地 messages（避免上下文错位与数据污染）
    const sendSessionId = currentSessionIdRef.current

    if (!activeModel || connectedModels.length === 0) {
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: `⚠️ 当前未配置或连通任何可用的大模型。\n\n请点击右上角「未配置模型」或前往「偏好设置 ➔ 模型」配置您的 API Key 或本地 Ollama / TS 驱动。`,
        },
      ])
      setIsGenerating(false)
      onOpenSettings?.()
      return
    }

    const assistantMsgId = (Date.now() + 1).toString()
    setMessages((prev) => [
      ...prev,
      {
        id: assistantMsgId,
        role: 'assistant',
        content: '',
      },
    ])

    let firstTokenTime: number | null = null
    let totalGeneratedTokens = 0
    let recordedSpeed = 0
    let recordedCacheRate = 88.5

    const updateAssistantMessage = (
      chunkText: string,
      chunkReasoning?: string,
      meta?: StreamChunkMeta
    ) => {
      // 流式生成期间若已切换到其它会话，则丢弃旧会话的流式内容
      if (currentSessionIdRef.current !== sendSessionId) return
      const now = Date.now()

      if (chunkText) totalGeneratedTokens += estimateTokenCount(chunkText)
      if (chunkReasoning) totalGeneratedTokens += estimateTokenCount(chunkReasoning)

      // 记录首个 Token 到达时刻（去除模型加载与网络 TTFT，真实计算纯生成 decode 速度）
      if ((chunkText || chunkReasoning) && firstTokenTime === null) {
        firstTokenTime = now
      }

      let currentSpeed = recordedSpeed

      // 1. 若后端/硬件返回了高精度指标 (如 Ollama eval_count / eval_duration)
      if (meta?.evalCount && meta?.evalDurationNs && meta.evalDurationNs > 0) {
        const durationSec = meta.evalDurationNs / 1e9
        currentSpeed = Math.round((meta.evalCount / durationSec) * 10) / 10
        totalGeneratedTokens = meta.evalCount
        recordedSpeed = currentSpeed
      } else if (firstTokenTime !== null) {
        // 2. 本地基于首字到达后的真实 decode 时间计算
        const elapsedSec = (now - firstTokenTime) / 1000
        if (elapsedSec > 0.05) {
          currentSpeed = Math.round((totalGeneratedTokens / elapsedSec) * 10) / 10
          recordedSpeed = currentSpeed
        }
      }

      // 3. 计算 Prompt 缓存命中率
      if (meta?.cachedTokens && meta?.promptTokens && meta.promptTokens > 0) {
        recordedCacheRate = Math.round((meta.cachedTokens / meta.promptTokens) * 1000) / 10
      } else if (meta?.promptEvalDurationNs !== undefined) {
        recordedCacheRate = meta.promptEvalDurationNs < 50000000 ? 94.5 : 82.0
      }

      onUpdateRuntimeStats?.({
        tokensPerSecond: currentSpeed,
        isGenerating: true,
        cacheHitRate: recordedCacheRate,
      })

      // 转发事件到统一 blocks 渲染（与 Agent Loop 同一套累积/渲染逻辑，不区分模型路径）
      if (chunkReasoning) handleLoopEvent({ type: 'thinking', delta: chunkReasoning, loop_index: 0 })
      if (chunkText) handleLoopEvent({ type: 'text', delta: chunkText, loop_index: 0 })
    }

    // ── Agent Loop 模式累积状态（后端 Runtime 驱动，携带工具定义）──
    // 按事件真实顺序追加块，每个块带 loopIndex（对应后端 loop_index），
    // 渲染时按数组顺序排布 → 多轮 think/tool/text 交替完整保留
    let loopBlocks: ExecutionBlock[] = []
    // 规划状态：目标 + 步骤 + 前端启发式进度（tool 事件驱动 ✓/▶/○）+ 耗时
    let loopPlan: {
      goal: string
      steps: string[]
      stepStatuses: PlanStepStatus[]
      startedAt: number
      durationMs?: number
      done?: boolean
    } | null = null
    let loopPendingApproval: { toolCallId: string; toolName: string; args: string; reason: string } | null = null
    let loopSeq = 0 // 块级唯一序号（think/text/tool 共用，保证 key 与 id 唯一）
    const toolStartedAt = new Map<string, number>() // tool_call_id → 开始时间戳，用于计算工具耗时
    // 生成速度统计（统一覆盖 Agent Loop 与直连路径）
    let loopChars = 0
    let loopFirstTokenTime: number | null = null

    const renderLoopMessage = () => {
      if (currentSessionIdRef.current !== sendSessionId) return
      // 生成速度（rAF 节流后每帧计算一次；字符数/4 粗估 token）
      if (loopFirstTokenTime !== null) {
        const elapsed = (Date.now() - loopFirstTokenTime) / 1000
        if (elapsed > 0.05) {
          onUpdateRuntimeStats?.({
            tokensPerSecond: Math.round((loopChars / 4 / elapsed) * 10) / 10,
          })
        }
      }
      const blocks: ExecutionBlock[] = []
      if (loopPlan) {
        blocks.push({
          type: 'plan',
          id: 'blk-loop-plan',
          goal: loopPlan.goal,
          steps: loopPlan.steps,
          stepStatuses: loopPlan.stepStatuses,
          status: loopPlan.done ? 'done' : 'running',
          durationMs: loopPlan.durationMs,
          isStreaming: !loopPlan.done,
        })
      }
      for (const b of loopBlocks) blocks.push(b)
      const loopText = blocks
        .filter((b) => b.type === 'text')
        .map((b) => (b as any).content as string)
        .join('\n\n')
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId
            ? {
              ...m,
              thinking: undefined,
              content: loopText,
              blocks,
              ...(loopPendingApproval ? { pendingApproval: loopPendingApproval } : {}),
            }
            : m
        )
      )
    }

    // 流式渲染节流：高频 delta 事件合并到同一帧只渲染一次，避免每 token 全量重建
    let rafPending = false
    let rafId: number | null = null
    const scheduleRender = () => {
      if (rafPending) return
      rafPending = true
      rafId = requestAnimationFrame(() => {
        rafPending = false
        rafId = null
        renderLoopMessage()
      })
    }
    const flushRender = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
        rafId = null
      }
      rafPending = false
      renderLoopMessage()
    }

    const handleLoopEvent = (event: any) => {
      switch (event?.type) {
        case 'plan': {
          const steps = Array.isArray(event.steps) ? event.steps.map((s: any) => String(s)) : []
          loopPlan = {
            goal: String(event.goal || ''),
            steps,
            stepStatuses: steps.map(() => 'todo' as PlanStepStatus),
            startedAt: Date.now(),
          }
          scheduleRender()
          break
        }

        case 'thinking':
        case 'text': {
          // 同一轮（loop_index）内的连续增量合并到最后一个同类型块，跨轮则开新块
          const kind = event.type === 'thinking' ? 'think' : 'text'
          const delta = String(event.delta || '')
          const loopIdx = Number(event.loop_index ?? 0)
          loopChars += delta.length
          if (loopFirstTokenTime === null) loopFirstTokenTime = Date.now()
          const last = loopBlocks[loopBlocks.length - 1]
          if (last && last.type === kind && last.loopIndex === loopIdx) {
            ; (last as any).content += delta
          } else {
            loopBlocks.push({
              type: kind,
              id: `blk-loop-${kind}-${loopSeq++}`,
              content: delta,
              isStreaming: true,
              loopIndex: loopIdx,
            } as ExecutionBlock)
          }
          scheduleRender()
          break
        }

        case 'tool_start': {
          const loopIdx = Number(event.loop_index ?? 0)
          const callId = String(event.tool_call_id || `call_${loopSeq}`)
          toolStartedAt.set(callId, Date.now())
          // 启发式：把计划中第一个未开始的步骤标记为进行中（▶）
          if (loopPlan && !loopPlan.stepStatuses.includes('active')) {
            const idx = loopPlan.stepStatuses.indexOf('todo')
            if (idx !== -1) loopPlan.stepStatuses[idx] = 'active'
          }
          loopBlocks.push({
            type: 'tool',
            id: `blk-loop-tool-${loopSeq++}`,
            tool: {
              id: callId,
              name: String(event.tool || ''),
              args: event.args,
              status: 'running',
            },
            loopIndex: loopIdx,
          } as ExecutionBlock)
          scheduleRender()
          break
        }

        case 'tool_result': {
          const callId = String(event.tool_call_id || '')
          const started = toolStartedAt.get(callId)
          const durationMs = started ? Date.now() - started : undefined
          toolStartedAt.delete(callId)
          loopBlocks = loopBlocks.map((b) =>
            b.type === 'tool' && b.tool.id === callId
              ? { ...b, tool: { ...b.tool, status: event.ok ? 'success' : 'failed', output: String(event.output || ''), durationMs } }
              : b
          )
          // 启发式：工具成功执行后，把第一个进行中的步骤标记为完成（✓）
          if (loopPlan && event.ok) {
            const idx = loopPlan.stepStatuses.indexOf('active')
            if (idx !== -1) loopPlan.stepStatuses[idx] = 'done'
          }
          // 审批已解决（批准执行或拒绝），清除审批卡片状态
          if (loopPendingApproval && loopPendingApproval.toolCallId === callId) {
            loopPendingApproval = null
          }
          scheduleRender()
          break
        }

        case 'approval_required': {
          const callId = String(event.tool_call_id || '')
          loopBlocks = loopBlocks.map((b) =>
            b.type === 'tool' && b.tool.id === callId
              ? { ...b, tool: { ...b.tool, args: event.args } }
              : b
          )
          loopPendingApproval = {
            toolCallId: callId,
            toolName: String(event.tool || ''),
            args: JSON.stringify(event.args ?? {}),
            reason: String(event.reason || `工具 ${event.tool} 需要用户授权才能执行`),
          }
          scheduleRender()
          break
        }

        case 'tool_rejected': {
          const callId = String(event.tool_call_id || '')
          loopBlocks = loopBlocks.map((b) =>
            b.type === 'tool' && b.tool.id === callId
              ? { ...b, tool: { ...b.tool, status: 'failed' } }
              : b
          )
          scheduleRender()
          break
        }

        case 'done':
          // Agent Loop 完成：收敛计划状态（全部 ✓ + 总耗时）
          if (loopPlan) {
            loopPlan.done = true
            loopPlan.durationMs = Date.now() - loopPlan.startedAt
            loopPlan.stepStatuses = loopPlan.stepStatuses.map(() => 'done' as PlanStepStatus)
          }
          flushRender()
          break

        case 'error':
          loopBlocks.push({
            type: 'text',
            id: `blk-loop-err-${loopSeq++}`,
            content: `❌ ${String(event.message || 'Agent Loop 执行出错')}`,
            isStreaming: false,
            loopIndex: 0,
          } as ExecutionBlock)
          flushRender()
          break
      }
    }

    try {
      let savedProviders: any[] = []
      try {
        const saved = localStorage.getItem('forgeone_model_providers_v5') || localStorage.getItem('forgeone_model_providers_v4')
        if (saved) savedProviders = JSON.parse(saved)
      } catch (e) {
        console.error('Failed to parse providers:', e)
      }

      let matchedProvider = savedProviders.find((p: any) =>
        p.models?.some((m: any) => m.id === activeModel || m.name === activeModel)
      )
      if (!matchedProvider) {
        matchedProvider = savedProviders.find((p: any) => p.id === activeModel)
      }

      const currentModelMeta = connectedModels.find((m) => m.id === activeModel)
      const isThinkingEnabled = currentModelMeta?.supportsThinking ?? (
        activeModel.toLowerCase().includes('r1') ||
        activeModel.toLowerCase().includes('o1') ||
        activeModel.toLowerCase().includes('o3') ||
        activeModel.toLowerCase().includes('reasoner') ||
        activeModel.toLowerCase().includes('think')
      )

      const systemPrompt = buildForgeOneSystemPrompt({
        modelId: activeModel,
        providerName: matchedProvider?.name,
        mode: 'loop',
        workspacePath: currentProject?.path,
        supportsThinking: isThinkingEnabled,
      })

      // 优先后端 Agent Loop：由 forgeone-runtime AgentLoop 携带完整工具定义
      // （builtin_tool_defs: read_file / directory_tree / search_content / glob /
      //  write_file / edit_file / shell / diff）并驱动「LLM → 工具执行 → 回灌」循环。
      // ts-script 驱动暂不支持工具协议，直接走下方直连逻辑。
      if (matchedProvider?.protocol !== 'ts-script' && !matchedProvider?.isCustomTs) {
        const loopOk = await runAgentLoop(
          {
            session_id: currentSessionIdRef.current || `session_${Date.now()}`,
            prompt: userText,
            model: activeModel,
            protocol: matchedProvider?.protocol || 'openai',
            api_key: matchedProvider?.apiKey,
            base_url: matchedProvider?.baseUrl || '',
            system_prompt: systemPrompt,
            workspace: currentProject?.path || '',
            history: messages.map((m) => ({ role: m.role, content: m.content })),
            allow_dangerous_tools: safetyMode === 'dangerous',
          },
          {
            onThinking: (delta, loopIndex) => handleLoopEvent({ type: 'thinking', delta, loop_index: loopIndex }),
            onText: (delta, loopIndex) => handleLoopEvent({ type: 'text', delta, loop_index: loopIndex }),
            onToolStart: (c, loopIndex) =>
              handleLoopEvent({ type: 'tool_start', tool_call_id: c.toolCallId, tool: c.tool, args: c.args, requires_approval: c.requiresApproval, loop_index: loopIndex }),
            onToolResult: (c, loopIndex) =>
              handleLoopEvent({ type: 'tool_result', tool_call_id: c.toolCallId, tool: c.tool, output: c.output, ok: c.ok, loop_index: loopIndex }),
            onApproval: (c, loopIndex) =>
              handleLoopEvent({ type: 'approval_required', tool_call_id: c.toolCallId, tool: c.tool, args: c.args, reason: c.reason, loop_index: loopIndex }),
            onToolRejected: (c, loopIndex) =>
              handleLoopEvent({ type: 'tool_rejected', tool_call_id: c.toolCallId, tool: c.tool, loop_index: loopIndex }),
            onPlan: (p, loopIndex) => handleLoopEvent({ type: 'plan', goal: p.goal, steps: p.steps, loop_index: loopIndex }),
            onDone: (loops, stopReason) => handleLoopEvent({ type: 'done', loops, stop_reason: stopReason }),
            onError: (message) => handleLoopEvent({ type: 'error', message }),
          }
        )
        if (loopOk) return // 已通过 Agent Loop 完成本轮回复（finally 统一收尾）
        console.warn('[ChatCanvas] Agent Loop 服务不可用（127.0.0.1:9527），回退到直连模型模式')
      }

      if (matchedProvider?.protocol === 'ollama' || activeModel.includes(':') || activeModel.toLowerCase().includes('qwen') || activeModel.toLowerCase().includes('deepseek-r1')) {
        const baseUrl = (matchedProvider?.baseUrl || 'http://localhost:11434').replace(/\/+$/, '')
        const bodyPayload: any = {
          model: activeModel,
          messages: [
            {
              role: 'system',
              content: systemPrompt,
            },
            ...messages.slice(-8).map((m) => ({ role: m.role, content: m.content })),
            { role: 'user', content: userText },
          ],
          stream: true,
        }

        if (isThinkingEnabled) {
          bodyPayload.options = {
            temperature: 0.6,
          }
        }

        const res = await fetch(`${baseUrl}/api/chat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(matchedProvider?.customHeaders || {}),
          },
          body: JSON.stringify(bodyPayload),
        })

        if (!res.ok) {
          const errBody = await res.text().catch(() => '')
          throw new Error(`Ollama 服务响应 HTTP ${res.status}: ${errBody || res.statusText}`)
        }

        await readSSEStream(res, (text, reasoning) => updateAssistantMessage(text, reasoning))
      }
      else if (matchedProvider?.protocol === 'openai') {
        if (!matchedProvider.apiKey?.trim()) {
          throw new Error(`未配置 ${matchedProvider.name} API Key，请前往「偏好设置 -> 模型」填写。`)
        }
        const baseUrl = (matchedProvider.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '')
        const url = baseUrl.endsWith('/v1') ? `${baseUrl}/chat/completions` : `${baseUrl}/v1/chat/completions`

        const bodyPayload: any = {
          model: activeModel,
          messages: [
            {
              role: 'system',
              content: systemPrompt,
            },
            ...messages.slice(-8).map((m) => ({ role: m.role, content: m.content })),
            { role: 'user', content: userText },
          ],
          stream: true,
          stream_options: {
            include_usage: true,
          },
        }

        const isO1orO3 = activeModel.toLowerCase().includes('o1') || activeModel.toLowerCase().includes('o3')
        if (isO1orO3 && isThinkingEnabled) {
          bodyPayload.reasoning_effort = 'medium'
        }

        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${matchedProvider.apiKey}`,
            ...(matchedProvider.customHeaders || {}),
          },
          body: JSON.stringify(bodyPayload),
        })

        if (!res.ok) {
          const errBody = await res.text().catch(() => '')
          throw new Error(`API 响应 HTTP ${res.status}: ${errBody || res.statusText}`)
        }

        await readSSEStream(res, (text, reasoning) => updateAssistantMessage(text, reasoning))
      }
      else if (matchedProvider?.protocol === 'anthropic') {
        if (!matchedProvider.apiKey?.trim()) {
          throw new Error(`未配置 Anthropic API Key，请前往「偏好设置 -> 模型」填写。`)
        }
        const baseUrl = (matchedProvider.baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '')

        const bodyPayload: any = {
          model: activeModel,
          max_tokens: isThinkingEnabled ? 8192 : 4096,
          system: systemPrompt,
          messages: [
            ...messages.slice(-8).map((m) => ({ role: m.role, content: m.content })),
            { role: 'user', content: userText },
          ],
          stream: true,
        }

        if (isThinkingEnabled) {
          bodyPayload.thinking = {
            type: 'enabled',
            budget_tokens: 2048,
          }
        }

        const res = await fetch(`${baseUrl}/v1/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': matchedProvider.apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
            ...(matchedProvider.customHeaders || {}),
          },
          body: JSON.stringify(bodyPayload),
          signal: abortSignal,
        })

        if (!res.ok) {
          const errBody = await res.text().catch(() => '')
          throw new Error(`Anthropic 响应 HTTP ${res.status}: ${errBody || res.statusText}`)
        }

        await readSSEStream(res, (text, reasoning) => updateAssistantMessage(text, reasoning))
      }
      // 5. TypeScript 驱动协议：转译并执行脚本（内置 Ollama Demo，或用户在线编辑的脚本）
      else if (matchedProvider?.protocol === 'ts-script' || matchedProvider?.isCustomTs) {
        const source = matchedProvider.scriptSource || TS_OLLAMA_DEMO_SCRIPT
        const history = messages.slice(-8).map((m) => ({ role: m.role, content: m.content }))
        await runTsScript(source, {
          model: activeModel,
          baseUrl: matchedProvider.baseUrl || '',
          messages: [...history, { role: 'user', content: userText }],
          onDelta: (text, reasoning) => {
            if (reasoning) updateAssistantMessage('', reasoning)
            if (text) updateAssistantMessage(text)
          },
          signal: abortSignal,
        })
      }
      // 6. 默认回退到通用 API 路由
      else {
        const res = await fetch('http://127.0.0.1:9527/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: userText,
            system: systemPrompt,
            model: activeModel,
            mode: 'loop',
            workspace: currentProject?.path || '',
          }),
          signal: abortSignal,
        })
        if (res.ok) {
          const data = await res.json()
          updateAssistantMessage(data.content || '')
        } else {
          throw new Error(`未检测到可用模型提供商 "${activeModel}"，请在偏好设置中配置 API Key 或本地模型。`)
        }
      }
    } catch (err: any) {
      // 用户主动停止：不显示错误，保留已生成内容
      if (err?.name === 'AbortError') {
        // 收尾逻辑交给 finally（flushRender + 清流式标记）
      } else {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? {
                ...m,
                content: `❌ 调用模型 "${activeModel || '未配置'}" 失败：${err.message || '网络连接异常'}\n\n💡 提示：若使用本地 Ollama，请确保已执行 \`ollama serve\` 且模型已下载；若使用云端模型，请在设置中配置有效 API Key。`,
              }
              : m
          )
        )
      }
    } finally {
      setIsGenerating(false)
      abortControllerRef.current = null
      onUpdateRuntimeStats?.({
        isGenerating: false,
        tokensPerSecond: recordedSpeed,
        cacheHitRate: recordedCacheRate,
      })
      // 直连路径没有后端 done 事件：立即渲染最终 blocks（统一渲染逻辑）
      flushRender()
      // 仅当仍停留在发送时的会话时，才收尾更新流式标记
      if (currentSessionIdRef.current === sendSessionId) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? {
                ...m,
                blocks: m.blocks?.map((b) => ({ ...b, isStreaming: false })),
              }
              : m
          )
        )
      }
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 按 Enter 发送
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  return (
    <div className="flex-1 flex flex-col h-full max-w-[1200px] w-full mx-auto p-6 overflow-hidden text-[#1A1C1B] relative">
      {/* Header Bar */}
      <div className="flex items-center justify-between pb-4 border-b border-[#E8E8E6] shrink-0">
        {/* Project Selector / Unbind Dropdown */}
        <div className="relative" ref={projectMenuRef}>
          <div className="flex items-center gap-2 mb-0.5">
            <h2 className="text-base font-semibold text-[#1A1C1B]">Chat</h2>
            <button
              type="button"
              onClick={() => setIsProjectMenuOpen((prev) => !prev)}
              className={`text-[10px] font-medium px-2 py-0.5 rounded-full border flex items-center gap-1.5 transition-all cursor-pointer ${currentProject
                ? 'bg-[#EBF3FF] text-[#2D63ED] border-[#BFDBFE] hover:bg-[#DBEAFE]'
                : 'bg-[#F4F4F2] text-[#76777B] border-[#E8E8E6] hover:bg-[#EAEAE8] hover:text-[#1A1C1B]'
                }`}
              title="点击切换或选择工程工作区"
            >
              <span className={`w-1.5 h-1.5 rounded-full ${currentProject ? 'bg-[#2D63ED]' : 'bg-[#A1A1AA]'}`} />
              <span>{currentProject ? `项目: ${currentProject.name}` : '未绑定项目 (点击选择)'}</span>
              <ChevronDown size={11} className={`opacity-60 transition-transform ${isProjectMenuOpen ? 'rotate-180' : ''}`} />
            </button>
          </div>
          <p className="text-xs text-[#76777B]">
            {currentProject ? currentProject.path : '通用问答与设计模式 · 未关联具体工作区'}
          </p>

          {/* Project Switcher Popover */}
          {isProjectMenuOpen && (
            <div className="absolute left-0 top-full mt-2 w-72 rounded-xl bg-white border border-[#E2E3E1] shadow-xl p-1.5 z-50 animate-in fade-in zoom-in-95 duration-100 space-y-1">
              <div className="flex items-center justify-between px-2.5 py-1 text-[10px] font-bold text-[#A1A1AA] uppercase tracking-wider">
                <span>选择/关联工程工作区</span>
                <button
                  type="button"
                  onClick={() => {
                    setIsProjectMenuOpen(false)
                    onOpenProjectModal?.()
                  }}
                  className="text-[#2D63ED] hover:underline normal-case flex items-center gap-1 cursor-pointer font-medium"
                >
                  <FolderPlus size={12} />
                  <span>+ 打开新文件夹</span>
                </button>
              </div>
              <div className="max-h-52 overflow-y-auto space-y-0.5 custom-scrollbar">
                {(() => {
                  const list = projects && projects.length > 0 ? projects : DEFAULT_PROJECT_OPTIONS
                  return list.map((proj) => {
                    const isSelected = currentProject?.id === proj.id
                    return (
                      <div
                        key={proj.id}
                        className={`group flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors ${isSelected
                          ? 'bg-[#F4F4F2] text-[#1A1C1B] font-semibold'
                          : 'text-[#46474A] hover:bg-[#FAF9F7] hover:text-[#1A1C1B]'
                          }`}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            onSelectProject?.(proj)
                            setIsProjectMenuOpen(false)
                          }}
                          className="flex-1 flex items-center gap-2 truncate text-left cursor-pointer mr-1"
                        >
                          <Folder size={13} className={isSelected ? 'text-[#2D63ED]' : 'text-[#76777B]'} />
                          <div className="truncate">
                            <div className="truncate font-medium">{proj.name}</div>
                            <div className="text-[10px] text-[#A1A1AA] font-mono truncate">{proj.path}</div>
                          </div>
                        </button>

                        <div className="flex items-center gap-1 shrink-0">
                          {proj.isCustom && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                onRemoveProject?.(proj.id)
                              }}
                              className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:text-rose-600 hover:bg-rose-50 transition-all cursor-pointer"
                              title="移除项目"
                            >
                              <Trash2 size={11} />
                            </button>
                          )}
                          {isSelected && <Check size={12} className="text-[#2D63ED]" />}
                        </div>
                      </div>
                    )
                  })
                })()}
              </div>

              <div className="pt-1 border-t border-[#F0EFEB] space-y-0.5">
                <button
                  type="button"
                  onClick={() => {
                    setIsProjectMenuOpen(false)
                    onOpenProjectModal?.()
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-[#2D63ED] hover:bg-[#EBF3FF] transition-colors text-left cursor-pointer font-medium"
                >
                  <FolderPlus size={13} />
                  <span>关联任意新本地文件夹...</span>
                </button>

                {currentProject && (
                  <button
                    type="button"
                    onClick={() => {
                      onSelectProject?.(null)
                      setIsProjectMenuOpen(false)
                    }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-rose-600 hover:bg-rose-50 transition-colors text-left cursor-pointer"
                  >
                    <X size={12} />
                    <span>解绑项目 (切换为通用会话)</span>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* 动态模型 Selector / 未配置跳转按钮 */}
          {connectedModels.length === 0 || !activeModel ? (
            <button
              type="button"
              onClick={onOpenSettings}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-50 border border-amber-300 hover:bg-amber-100 hover:border-amber-400 text-xs font-medium text-amber-900 transition-all cursor-pointer shadow-xs"
              title="点击前往偏好设置配置大模型与 API Key"
            >
              <AlertTriangle size={13} className="text-amber-600 shrink-0" />
              <span>未配置模型 (点击前往配置)</span>
              <ChevronRight size={12} className="text-amber-600 shrink-0" />
            </button>
          ) : (
            <div className="relative" ref={modelMenuRef}>
              {(() => {
                const currentModel = connectedModels.find((m) => m.id === activeModel) || connectedModels[0]
                return (
                  <button
                    type="button"
                    onClick={() => setIsModelMenuOpen(!isModelMenuOpen)}
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-white border border-[#E2E3E1] hover:border-[#1A1C1B] text-xs font-mono text-[#1A1C1B] transition-all cursor-pointer shadow-xs"
                  >
                    {currentModel.supportsThinking ? (
                      <Brain size={13} className="text-[#6366F1]" />
                    ) : currentModel.modality === 'multimodal' ? (
                      <ImageIcon size={13} className="text-[#D97706]" />
                    ) : (
                      <Cpu size={13} className="text-[#2D63ED]" />
                    )}

                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold">{currentModel.name}</span>
                      {currentModel.supportsThinking && (
                        <span className="text-[9px] px-1 py-0.2 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 font-sans">
                          Think
                        </span>
                      )}
                      {currentModel.modality === 'multimodal' && (
                        <span className="text-[9px] px-1 py-0.2 rounded bg-amber-50 text-amber-700 border border-amber-200 font-sans">
                          Vision
                        </span>
                      )}
                    </div>
                    <ChevronDown size={11} className={`text-[#76777B] transition-transform ${isModelMenuOpen ? 'rotate-180' : ''}`} />
                  </button>
                )
              })()}

              {isModelMenuOpen && (
                <div className="absolute right-0 top-full mt-1.5 w-80 bg-white rounded-xl shadow-xl border border-[#E8E8E6] p-2 z-50 flex flex-col gap-1 animate-in fade-in duration-150">
                  <div className="px-2 py-1 text-[10px] font-semibold text-[#76777B] uppercase tracking-wider flex items-center justify-between border-b border-[#F4F4F2] pb-1.5 mb-1">
                    <span>已连通可用模型 ({connectedModels.length})</span>
                    <span className="font-mono text-[#2D63ED]">支持能力标签</span>
                  </div>

                  <div className="max-h-72 overflow-y-auto space-y-1 custom-scrollbar">
                    {connectedModels.map((item) => {
                      const isSelected = activeModel === item.id
                      return (
                        <button
                          key={item.id}
                          onClick={() => {
                            onSelectModel?.(item.id)
                            setIsModelMenuOpen(false)
                          }}
                          className={`w-full text-left p-2 rounded-lg flex flex-col gap-1.5 transition-colors cursor-pointer border ${isSelected
                            ? 'bg-[#EBF3FF] border-[#BFDBFE] font-medium'
                            : 'bg-white border-transparent hover:bg-[#FAF9F7] hover:border-[#E8E8E6]'
                            }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5">
                              {item.supportsThinking ? (
                                <Brain size={12} className="text-[#6366F1] shrink-0" />
                              ) : item.modality === 'multimodal' ? (
                                <ImageIcon size={12} className="text-amber-600 shrink-0" />
                              ) : (
                                <Cpu size={12} className="text-[#2D63ED] shrink-0" />
                              )}
                              <span className="text-xs font-semibold text-[#1A1C1B]">{item.name}</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <span className="text-[10px] text-[#76777B] font-mono px-1.5 py-0.5 rounded bg-[#F4F4F2]">
                                {item.provider}
                              </span>
                              {isSelected && <CheckCircle2 size={13} className="text-[#2D63ED]" />}
                            </div>
                          </div>

                          {/* 能力标识流 */}
                          <div className="flex items-center gap-1 text-[9px]">
                            <span className={`px-1.5 py-0.5 rounded border ${item.modality === 'multimodal'
                              ? 'bg-amber-50 text-amber-700 border-amber-200'
                              : 'bg-zinc-100 text-zinc-600 border-zinc-200'
                              }`}>
                              {item.modality === 'multimodal' ? '🖼️ 视觉多模态' : '文本'}
                            </span>
                            {item.supportsThinking && (
                              <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 font-medium">
                                🧠 深度思考
                              </span>
                            )}
                            {item.supportsTools && (
                              <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                                🛠️ 工具调用
                              </span>
                            )}
                            {item.contextLength && (
                              <span className="px-1.5 py-0.5 rounded bg-gray-50 text-gray-500 border border-gray-200 font-mono ml-auto">
                                {item.contextLength}
                              </span>
                            )}
                          </div>
                        </button>
                      )
                    })}
                  </div>

                  <div className="pt-1.5 mt-1 border-t border-[#F4F4F2]">
                    <button
                      type="button"
                      onClick={() => {
                        setIsModelMenuOpen(false)
                        onOpenSettings?.()
                      }}
                      className="w-full text-center py-1.5 px-2 rounded-lg text-xs text-[#2D63ED] hover:bg-[#EBF3FF] transition-colors flex items-center justify-center gap-1 font-medium cursor-pointer"
                    >
                      <Plus size={13} />
                      <span>配置或新增更多模型...</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          <span className="text-xs text-[#76777B]">|</span>
          <span className="text-xs text-[#76777B] font-mono">Max Loops: 12</span>
        </div>
      </div>

      {/* Chat Messages Flow */}
      <div ref={chatScrollRef} className="flex-1 overflow-y-auto py-6 space-y-5 px-1 custom-scrollbar">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-8 space-y-4 select-none my-auto">
            <div className="w-11 h-11 rounded-2xl bg-[#1A1C1B] text-white flex items-center justify-center font-bold text-base shadow-md">
              F1
            </div>
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-[#1A1C1B]">ForgeOne Agent 运行时</h3>
              <p className="text-xs text-[#76777B] max-w-sm leading-relaxed">
                输入指令，Agent 将自动分析项目代码库、调度工具与执行工程任务。
              </p>
            </div>

            {connectedModels.length === 0 ? (
              <div className="mt-2 p-4 rounded-xl bg-amber-50/90 border border-amber-200 text-amber-900 flex flex-col items-center gap-2.5 max-w-md mx-auto shadow-xs">
                <div className="flex items-center gap-1.5 text-xs font-bold text-amber-900">
                  <AlertTriangle size={15} className="text-amber-600 shrink-0" />
                  <span>当前尚未连通任何可用的大模型</span>
                </div>
                <p className="text-[11px] text-amber-700 leading-relaxed text-center">
                  请前往模型管理面板配置您的 API Key（如 OpenAI / DeepSeek / Claude）或连接本地 Ollama / TS 脚本驱动。
                </p>
                <button
                  type="button"
                  onClick={onOpenSettings}
                  className="mt-1 px-4 py-2 rounded-xl bg-[#1A1C1B] hover:bg-[#2F3130] text-white text-xs font-medium transition-all shadow-xs cursor-pointer flex items-center gap-1.5"
                >
                  <Cpu size={13} />
                  <span>立即前往配置模型</span>
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className="w-full space-y-3">
              {msg.role === 'user' ? (
                /* 👤 全宽用户任务卡片 (Task Prompt Header) */
                <div id={`msg-anchor-${msg.id}`} className="w-full bg-[#FAF9F7] border border-[#E8E8E6] rounded-2xl p-4 shadow-xs transition-all select-text group hover:border-[#D0D1CD] scroll-mt-20">
                  <div className="flex items-center justify-between mb-2.5 pb-2 border-b border-[#F0EFEB] select-none">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-[#1A1C1B] text-white flex items-center justify-center text-[10px] font-semibold">
                        U
                      </div>
                      <span className="text-xs font-semibold text-[#1A1C1B]">User Task</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#EAE9E5] text-[#555]">
                        Agent Loop
                      </span>
                      {/* 复制用户消息按钮 */}
                      <button
                        type="button"
                        onClick={() => handleCopyText(`user_${msg.id}`, msg.content)}
                        className="flex items-center gap-1 text-[11px] text-[#76777B] hover:text-[#1A1C1B] hover:bg-[#EAE9E5] px-2 py-0.5 rounded-md transition-colors cursor-pointer"
                        title="复制发出的消息内容"
                      >
                        {copiedId === `user_${msg.id}` ? (
                          <>
                            <Check size={12} className="text-emerald-600" />
                            <span className="text-emerald-600 text-[10px] font-medium">已复制</span>
                          </>
                        ) : (
                          <>
                            <Copy size={12} />
                            <span className="text-[10px]">复制</span>
                          </>
                        )}
                      </button>
                      {/* 编辑/重填至输入框 */}
                      <button
                        type="button"
                        onClick={() => {
                          setInputValue(msg.content)
                          inputRef.current?.focus()
                        }}
                        className="flex items-center gap-1 text-[11px] text-[#76777B] hover:text-[#1A1C1B] hover:bg-[#EAE9E5] px-2 py-0.5 rounded-md transition-colors cursor-pointer"
                        title="将此内容填入输入框重新编辑"
                      >
                        <Edit3 size={12} />
                        <span className="text-[10px]">编辑</span>
                      </button>
                    </div>
                  </div>
                  <div className="text-xs text-[#1A1C1B] whitespace-pre-wrap leading-relaxed font-normal select-text cursor-text selection:bg-[#BFDBFE]">
                    {msg.content}
                  </div>
                </div>
              ) : (
                /* ⚡ 全宽 Agent 执行流水线 (Action Stream / Timeline) */
                <div className="w-full space-y-2.5 pt-1 select-text">
                  {/* Agent Header & Model Indicator */}
                  <div className="flex items-center justify-between px-1 select-none">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-lg bg-[#2D63ED] text-white flex items-center justify-center text-[10px] font-bold shadow-xs">
                        F1
                      </div>
                      <span className="text-xs font-semibold text-[#1A1C1B]">ForgeOne Agent</span>
                      <span className="text-[10px] text-[#76777B] font-mono px-1.5 py-0.5 rounded bg-[#F4F4F2]">
                        {activeModel || 'qwen2.5-coder:14b'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {isGenerating && msg.id === messages[messages.length - 1]?.id && (
                        <div className="flex items-center gap-1.5 text-[11px] text-[#2D63ED] font-mono animate-pulse">
                          <Loader2 size={12} className="animate-spin" />
                          <span>Executing Action Loop...</span>
                        </div>
                      )}
                      {msg.content && (
                        <button
                          type="button"
                          onClick={() => handleCopyText(`agent_${msg.id}`, msg.content)}
                          className="flex items-center gap-1 text-[11px] text-[#76777B] hover:text-[#1A1C1B] hover:bg-[#EAE9E5] px-2 py-0.5 rounded-md transition-colors cursor-pointer"
                          title="复制完整回答"
                        >
                          {copiedId === `agent_${msg.id}` ? (
                            <>
                              <Check size={12} className="text-emerald-600" />
                              <span className="text-emerald-600 text-[10px] font-medium">已复制</span>
                            </>
                          ) : (
                            <>
                              <Copy size={12} />
                              <span className="text-[10px]">复制回答</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Vertical Timeline Pipeline (垂直时序流) */}
                  {(isGenerating && msg.id === messages[messages.length - 1]?.id) || expandedAgentIds.has(msg.id) ? (
                    <>
                      {/* 展开态控制行：收起回摘要卡（流式进行中不显示） */}
                      {!isGenerating && (
                        <div className="flex justify-end -mr-1">
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedAgentIds((prev) => {
                                const next = new Set(prev)
                                next.delete(msg.id)
                                return next
                              })
                            }
                            className="flex items-center gap-1 text-[10px] text-[#76777B] hover:text-[#1A1C1B] px-1.5 py-0.5 rounded hover:bg-[#EEEEEC] transition-colors cursor-pointer"
                            title="收起为摘要"
                          >
                            <ChevronUp size={11} />
                            收起
                          </button>
                        </div>
                      )}
                      <div className="relative ml-3 pl-5 border-l-2 border-[#E8E8E6] space-y-3.5 my-2.5">
                    {/* 1. 多步交替执行块流 (Interleaved Execution Blocks) */}
                    {msg.blocks && msg.blocks.length > 0 ? (
                      msg.blocks.map((block, bIdx) => {
                        if (block.type === 'plan') {
                          // 🎯 目标与执行计划（内部事件：规划退化无步骤时不展示；步骤默认折叠，点击头部展开）
                          if (block.steps.length === 0) return null
                          const planKey = `${msg.id}-${block.id || bIdx}`
                          const isPlanExpanded = !!expandedPlanIds[planKey]
                          return (
                            <div id={`step-node-${msg.id}-${block.id || bIdx}`} key={block.id || bIdx} className="relative group scroll-mt-20">
                              {/* Timeline Connector Dot */}
                              <div className="absolute -left-[27px] top-2.5 w-3 h-3 rounded-full bg-emerald-500 border-2 border-white shadow-xs" />

                              {/* 🎯 Goal & Plan Block */}
                              <div className="rounded-xl border border-emerald-100 bg-gradient-to-r from-[#F0FDF4] to-[#ECFDF5] overflow-hidden text-xs shadow-xs">
                                <button
                                  type="button"
                                  onClick={() => setExpandedPlanIds((prev) => ({ ...prev, [planKey]: !prev[planKey] }))}
                                  className="w-full px-3 py-2 flex items-center justify-between text-emerald-950 bg-emerald-50/40 select-none border-b border-emerald-100 hover:bg-emerald-100/40 transition-colors cursor-pointer"
                                >
                                  <div className="flex items-center gap-2">
                                    <Target size={14} className="text-emerald-600 shrink-0" />
                                    <span className="font-semibold text-xs">目标与计划</span>
                                    {block.isStreaming && isGenerating && (
                                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-700 font-mono animate-pulse">
                                        规划中...
                                      </span>
                                    )}
                                    <ChevronDown size={12} className={`text-emerald-600 transition-transform ${isPlanExpanded ? '' : '-rotate-90'}`} />
                                  </div>
                                  <div className="flex items-center gap-1.5 text-[10px] font-mono">
                                    <span className={`px-1.5 py-0.5 rounded ${
                                      block.status === 'done'
                                        ? 'bg-emerald-100 text-emerald-700'
                                        : 'bg-amber-100 text-amber-700 animate-pulse'
                                    }`}>
                                      {block.status === 'done' ? '✓ 已完成' : '⟳ 执行中'}
                                    </span>
                                    {block.durationMs !== undefined && (
                                      <span className="px-1.5 py-0.5 rounded bg-white/70 text-emerald-700">
                                        {(block.durationMs / 1000).toFixed(1)}s
                                      </span>
                                    )}
                                    <span className="px-1.5 py-0.5 rounded bg-white/70 text-[#065F46]">
                                      {block.steps.length} 个步骤
                                    </span>
                                  </div>
                                </button>
                                <div className="px-3.5 py-2.5 space-y-2 select-text cursor-text selection:bg-[#BFDBFE]">
                                  <div className="text-[11px] font-medium text-[#065F46] leading-relaxed">
                                    <span className="text-[10px] text-emerald-600 font-mono mr-1.5 select-none">GOAL</span>
                                    {block.goal}
                                  </div>
                                  {isPlanExpanded && (
                                    <ol className="space-y-1">
                                      {block.steps.map((step, stepIdx) => {
                                        const st = block.stepStatuses?.[stepIdx] || 'todo'
                                        return (
                                          <li key={stepIdx} className="flex items-center gap-2 text-[11px] leading-relaxed">
                                            <span className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 select-none ${
                                              st === 'done'
                                                ? 'bg-emerald-500 text-white'
                                                : st === 'active'
                                                ? 'bg-amber-400 text-white'
                                                : 'bg-emerald-100 text-emerald-700 text-[9px] font-bold'
                                            }`}>
                                              {st === 'done' ? (
                                                <Check size={9} strokeWidth={3} />
                                              ) : st === 'active' ? (
                                                <Loader2 size={9} className="animate-spin" />
                                              ) : (
                                                stepIdx + 1
                                              )}
                                            </span>
                                            <span className={st === 'done' ? 'text-[#6B7280] line-through' : st === 'active' ? 'text-amber-800 font-medium' : 'text-[#374151]'}>
                                              {st === 'active' ? '▶ ' : ''}{step}
                                            </span>
                                          </li>
                                        )
                                      })}
                                    </ol>
                                  )}
                                </div>
                              </div>
                            </div>
                          )
                        }

                        if (block.type === 'think') {
                          // 流式生成中自动展开思考块，生成完成后默认折叠
                          const isStreaming = block.isStreaming && isGenerating
                          const isExpanded = expandedThinkingIds[`${msg.id}-${block.id}`] ?? isStreaming
                          return (
                            <div id={`step-node-${msg.id}-${block.id || bIdx}`} key={block.id || bIdx} className="relative group scroll-mt-20">
                              {/* Timeline Connector Dot */}
                              <div className="absolute -left-[27px] top-2.5 w-3 h-3 rounded-full bg-indigo-500 border-2 border-white shadow-xs" />

                              {/* 🧠 Thinking Block */}
                              <div className="rounded-xl border border-indigo-100 bg-gradient-to-r from-[#FAF9FF] to-[#F5F3FF] overflow-hidden text-xs shadow-xs transition-all">
                                <div className="w-full px-3 py-2 flex items-center justify-between text-[#4F46E5] bg-indigo-50/40 select-none">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setExpandedThinkingIds((prev) => ({
                                        ...prev,
                                        [`${msg.id}-${block.id}`]: !(prev[`${msg.id}-${block.id}`] ?? false),
                                      }))
                                    }}
                                    className="flex items-center gap-2 font-medium text-xs cursor-pointer hover:text-indigo-900"
                                  >
                                    <Brain size={14} className="text-[#6366F1]" />
                                    <span className="font-semibold text-indigo-950">Thinking</span>
                                    <span className="text-[10px] text-indigo-400 font-mono">({block.content.length} 字符)</span>
                                    {block.isStreaming && isGenerating && (
                                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-indigo-100 text-indigo-700 font-mono animate-pulse">
                                        思考推导中...
                                      </span>
                                    )}
                                  </button>
                                  <div className="flex items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => handleCopyText(`think_${msg.id}_${block.id}`, block.content)}
                                      className="flex items-center gap-1 text-[10px] text-indigo-600 hover:text-indigo-900 px-1.5 py-0.5 rounded hover:bg-indigo-100/60 transition-colors cursor-pointer"
                                      title="复制思考链内容"
                                    >
                                      {copiedId === `think_${msg.id}_${block.id}` ? (
                                        <Check size={11} className="text-emerald-600" />
                                      ) : (
                                        <Copy size={11} />
                                      )}
                                      <span>{copiedId === `think_${msg.id}_${block.id}` ? '已复制' : '复制'}</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setExpandedThinkingIds((prev) => ({
                                          ...prev,
                                          [`${msg.id}-${block.id}`]: !(prev[`${msg.id}-${block.id}`] ?? false),
                                        }))
                                      }}
                                      className="cursor-pointer"
                                    >
                                      {isExpanded ? (
                                        <ChevronDown size={13} className="text-indigo-400" />
                                      ) : (
                                        <ChevronRight size={13} className="text-indigo-400" />
                                      )}
                                    </button>
                                  </div>
                                </div>
                                {isExpanded && (
                                  <div className="px-3.5 py-3 border-t border-indigo-100 text-[11.5px] font-mono text-[#374151] leading-relaxed whitespace-pre-wrap bg-white/80 select-text cursor-text selection:bg-[#BFDBFE]">
                                    {block.content}
                                    {block.isStreaming && isGenerating && (
                                      <span className="inline-block w-1.5 h-3.5 bg-[#6366F1] ml-1 animate-pulse align-middle" />
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          )
                        }

                        if (block.type === 'tool') {
                          const isToolExpanded = !!expandedToolIds[block.tool.id]
                          return (
                            <div id={`step-node-${msg.id}-${block.id || bIdx}`} key={block.id || bIdx} className="relative group scroll-mt-20">
                              {/* Timeline Connector Dot */}
                              <div className="absolute -left-[27px] top-2.5 w-3 h-3 rounded-full bg-amber-500 border-2 border-white shadow-xs" />

                              {/* 🛠️ Tool Execution Block */}
                              <div className="rounded-xl border border-[#E8E8E6] bg-white overflow-hidden text-xs shadow-xs">
                                <button
                                  type="button"
                                  onClick={() => toggleTool(block.tool.id)}
                                  className="w-full px-3 py-2 flex items-center justify-between hover:bg-[#FAF9F7] transition-colors cursor-pointer text-left select-none"
                                >
                                  <div className="flex items-center gap-2 font-mono">
                                    <Terminal size={13} className="text-[#2D63ED] shrink-0" />
                                    <span className="font-semibold text-[#1A1C1B]">{block.tool.name}</span>
                                    {block.tool.args && (
                                      <span className="text-[11px] text-[#76777B] truncate max-w-[320px]">
                                        {typeof block.tool.args === 'string' ? block.tool.args : JSON.stringify(block.tool.args)}
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2 shrink-0">
                                    <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${block.tool.status === 'success' ? 'bg-emerald-50 text-emerald-600 border border-emerald-200' :
                                      block.tool.status === 'running' ? 'bg-blue-50 text-blue-600 animate-pulse' :
                                        'bg-amber-50 text-amber-600 border border-amber-200'
                                      }`}>
                                      {block.tool.status === 'success' ? '✓ 完成' : block.tool.status === 'running' ? '⟳ 执行中' : '✕ 异常'}
                                    </span>
                                    {isToolExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                  </div>
                                </button>
                                {isToolExpanded && (
                                  <div className="px-3.5 py-2.5 border-t border-[#E8E8E6] bg-[#FAF9F7] space-y-2 select-text">
                                    {block.tool.args && (
                                      <div>
                                        <div className="text-[10px] font-semibold text-[#76777B] mb-1 select-none">Parameters:</div>
                                        <pre className="text-[11px] font-mono bg-white p-2 rounded border border-[#E8E8E6] overflow-x-auto select-text cursor-text selection:bg-[#BFDBFE]">
                                          {typeof block.tool.args === 'string' ? block.tool.args : JSON.stringify(block.tool.args, null, 2)}
                                        </pre>
                                      </div>
                                    )}
                                    {block.tool.output && (
                                      <div>
                                        <div className="flex items-center justify-between text-[10px] font-semibold text-[#76777B] mb-1 select-none">
                                          <span>Output:</span>
                                          <button
                                            type="button"
                                            onClick={() => handleCopyText(`tool_${block.tool.id}`, block.tool.output || '')}
                                            className="text-[10px] text-[#2D63ED] hover:underline flex items-center gap-1 cursor-pointer"
                                          >
                                            {copiedId === `tool_${block.tool.id}` ? <Check size={11} className="text-emerald-600" /> : <Copy size={11} />}
                                            <span>{copiedId === `tool_${block.tool.id}` ? '已复制' : '复制输出'}</span>
                                          </button>
                                        </div>
                                        <pre className="text-[11px] font-mono bg-[#1A1C1B] text-[#E8E8E6] p-2.5 rounded border border-[#333] max-h-48 overflow-y-auto whitespace-pre-wrap select-text cursor-text selection:bg-[#2D63ED]">
                                          {block.tool.output}
                                        </pre>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          )
                        }

                        if (block.type === 'text') {
                          return (
                            <div id={`step-node-${msg.id}-${block.id || bIdx}`} key={block.id || bIdx} className="relative scroll-mt-20">
                              {/* Timeline Connector Dot */}
                              <div className="absolute -left-[27px] top-1.5 w-3 h-3 rounded-full bg-[#2D63ED] border-2 border-white shadow-xs" />

                              {/* 💬 Rich Markdown & LaTeX Text */}
                              <div className="pl-0.5 select-text">
                                <MarkdownRenderer content={block.content} />
                                {block.isStreaming && isGenerating && (
                                  <span className="inline-block w-1.5 h-3.5 bg-[#2D63ED] ml-1 animate-pulse align-middle" />
                                )}
                              </div>
                            </div>
                          )
                        }

                        return null
                      })
                    ) : (
                      /* 兼容兜底 (Fallback) */
                      <div id={`msg-anchor-${msg.id}`} className="space-y-3 select-text scroll-mt-20">
                        {msg.thinking && (
                          <div className="rounded-xl border border-indigo-100 bg-[#FAF9FF] overflow-hidden text-xs shadow-xs">
                            <div className="w-full px-3 py-2 flex items-center justify-between text-[#4F46E5] select-none">
                              <button
                                type="button"
                                onClick={() => toggleThinking(msg.id)}
                                className="flex items-center gap-1.5 font-medium text-xs cursor-pointer hover:text-indigo-900"
                              >
                                <Brain size={13} className="text-[#6366F1]" />
                                <span className="font-semibold text-indigo-950">Thinking</span>
                                <span className="text-[10px] text-indigo-400 font-mono">({msg.thinking.length} 字符)</span>
                              </button>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleCopyText(`fb_think_${msg.id}`, msg.thinking || '')}
                                  className="flex items-center gap-1 text-[10px] text-indigo-600 hover:text-indigo-900 px-1.5 py-0.5 rounded hover:bg-indigo-100/60 transition-colors cursor-pointer"
                                  title="复制思考过程"
                                >
                                  {copiedId === `fb_think_${msg.id}` ? <Check size={11} className="text-emerald-600" /> : <Copy size={11} />}
                                  <span>{copiedId === `fb_think_${msg.id}` ? '已复制' : '复制'}</span>
                                </button>
                                <button type="button" onClick={() => toggleThinking(msg.id)} className="cursor-pointer">
                                  {expandedThinkingIds[msg.id] ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                                </button>
                              </div>
                            </div>
                            {expandedThinkingIds[msg.id] && (
                              <div className="px-3 py-2.5 border-t border-indigo-100 text-[11px] font-mono text-[#374151] leading-relaxed whitespace-pre-wrap bg-white/70 select-text cursor-text selection:bg-[#BFDBFE]">
                                {msg.thinking}
                              </div>
                            )}
                          </div>
                        )}

                        <div className="text-xs text-[#1A1C1B] leading-relaxed select-text">
                          {msg.content ? (
                            <MarkdownRenderer content={msg.content} />
                          ) : null}
                          {!msg.content && !msg.thinking && isGenerating && (
                            <div className="flex items-center gap-2 text-[#76777B] py-0.5 select-none">
                              <Loader2 size={13} className="animate-spin text-[#2D63ED]" />
                              <span className="font-mono text-[11px]">正在分析工程上下文并规划执行...</span>
                            </div>
                          )}
                          {isGenerating && msg.id === messages[messages.length - 1]?.id && msg.content && (
                            <span className="inline-block w-1.5 h-3.5 bg-[#2D63ED] ml-1 animate-pulse align-middle" />
                          )}
                        </div>
                      </div>
                    )}

                    {/* 🛡️ 4. Pending Approval Card (安全权限审批门禁) */}
                    {msg.pendingApproval && (
                      <div className="mt-3 p-3.5 rounded-xl bg-[#FFFBEB] border border-[#FCD34D] text-[#92400E] shadow-xs">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-1.5 font-semibold text-xs text-[#B45309]">
                            <AlertTriangle size={14} />
                            <span>{t('chat.approval.title')}</span>
                          </div>
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#FEF3C7] text-[#D97706]">
                            RequireApproval
                          </span>
                        </div>
                        <p className="text-[11px] mb-2">{msg.pendingApproval.reason}</p>
                        <div className="bg-[#FEF3C7] p-2 rounded text-[11px] font-mono text-[#78350F] mb-3">
                          {msg.pendingApproval.toolName} -- {msg.pendingApproval.args}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleApproval(msg.id, true)}
                            className="flex-1 py-1.5 px-3 rounded bg-[#D97706] hover:bg-[#B45309] text-white font-medium text-xs transition-colors flex items-center justify-center gap-1 cursor-pointer"
                            title="批准后执行该工具"
                          >
                            <CheckCircle2 size={13} />
                            <span>{t('chat.approval.approve')}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleApproval(msg.id, false)}
                            className="px-3 py-1.5 rounded border border-[#FCD34D] hover:bg-[#FEF3C7] text-[#92400E] font-medium text-xs transition-colors cursor-pointer"
                            title="拒绝后跳过该工具"
                          >
                            {t('chat.approval.deny')}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                    </>
                  ) : (
                    <AgentSummary
                      msg={msg}
                      onExpand={() => setExpandedAgentIds((prev) => new Set(prev).add(msg.id))}
                    />
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Advanced Codex/Cursor Style Chat Input Card */}
      <div className="shrink-0 pt-2 relative">
        <div className="bg-white border border-[#E2E3E1] focus-within:border-[#1A1C1B] rounded-2xl p-3 shadow-md transition-all flex flex-col gap-3">
          {/* Main Textarea Input */}
          <textarea
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isGenerating}
            placeholder={isGenerating ? "Agent 正在生成回复中..." : "输入指令给 Agent，或使用 @ 引用代码库、/ 调用技能...(Shift+Tab 切换模式)"}
            rows={2}
            className="w-full resize-none bg-transparent border-none outline-none text-xs text-[#1A1C1B] placeholder-[#76777B] leading-relaxed disabled:opacity-60"
          />

          {/* Bottom Toolbar & Action Row */}
          <div className="flex items-center justify-between pt-2 border-t border-[#F4F4F2]">
            {/* Left Tools & Mode Picker */}
            <div className="flex items-center gap-2">
              {/* Quick Helpers */}
              <button
                onClick={() => setInputValue((prev) => prev + ' @')}
                className="p-1.5 rounded-md hover:bg-[#F4F4F2] text-[#76777B] hover:text-[#1A1C1B] transition-colors"
                title="引用代码文件 (@file)"
              >
                <AtSign size={14} />
              </button>

              <button
                onClick={() => setInputValue((prev) => prev + ' /')}
                className="p-1.5 rounded-md hover:bg-[#F4F4F2] text-[#76777B] hover:text-[#1A1C1B] transition-colors"
                title="触发 Prompt 技能 (/skill)"
              >
                <Zap size={14} />
              </button>

              <button
                className="p-1.5 rounded-md hover:bg-[#F4F4F2] text-[#76777B] hover:text-[#1A1C1B] transition-colors"
                title="添加附件/图片"
              >
                <Paperclip size={14} />
              </button>

              {/* 安全 / 危险模式切换 */}
              <button
                type="button"
                onClick={() => setSafetyMode((prev) => (prev === 'safe' ? 'dangerous' : 'safe'))}
                className={`flex items-center gap-1 px-2 py-1.5 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
                  safetyMode === 'safe'
                    ? 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100'
                    : 'text-amber-700 bg-amber-50 hover:bg-amber-100'
                }`}
                title={
                  safetyMode === 'safe'
                    ? '安全模式：shell / 写文件 / 修改等危险工具需逐个审批确认'
                    : '危险模式：普通命令直接执行，仅高危命令（删除根目录/格式化等）仍需审批。点击切换回安全模式'
                }
              >
                {safetyMode === 'safe' ? <ShieldCheck size={14} /> : <Flame size={14} />}
                <span>{safetyMode === 'safe' ? '安全' : '危险'}</span>
              </button>
            </div>

            {/* Right Submit Button */}
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-[#76777B] font-mono hidden sm:inline-flex items-center gap-1">
                <CornerDownLeft size={10} /> 发送
              </span>

              {isGenerating ? (
                <button
                  onClick={handleStopGeneration}
                  className="px-3.5 py-1.5 rounded-xl bg-rose-500 hover:bg-rose-600 text-white font-medium text-xs transition-all flex items-center gap-1.5 shadow-sm cursor-pointer"
                  title="停止生成（保留已生成内容）"
                >
                  <Square size={13} /> 停止
                </button>
              ) : (
                <button
                  onClick={handleSendMessage}
                  disabled={!inputValue.trim() || isGenerating}
                  className="px-3.5 py-1.5 rounded-xl bg-[#1A1C1B] hover:bg-[#2F3130] disabled:opacity-30 text-white font-medium text-xs transition-all flex items-center gap-1.5 shadow-sm cursor-pointer"
                >
                  <Send size={13} /> 发送
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 🚀 步骤时间线缩略栏与悬浮预览 (Timeline Step Minimap & Popover) */}
      <TimelineMinimap messages={messages} isGenerating={isGenerating} />
    </div>
  )
}
