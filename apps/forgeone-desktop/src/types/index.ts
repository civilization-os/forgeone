export interface ToolExecution {
  id: string
  name: string
  args?: Record<string, any> | string
  output?: string
  status?: 'running' | 'success' | 'failed'
  durationMs?: number
}

export type PlanStepStatus = 'todo' | 'active' | 'done'

export type ExecutionBlock = (
  | { type: 'think'; id: string; content: string; isStreaming?: boolean }
  | { type: 'tool'; id: string; tool: ToolExecution }
  | { type: 'text'; id: string; content: string; isStreaming?: boolean }
  | { type: 'approval'; id: string; toolName: string; args: string; reason: string }
  | {
      type: 'plan'
      id: string
      goal: string
      steps: string[]
      stepStatuses?: PlanStepStatus[]
      status?: 'running' | 'done'
      durationMs?: number
      isStreaming?: boolean
    }
) & { loopIndex?: number }

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  thinking?: string
  tools?: ToolExecution[]
  blocks?: ExecutionBlock[]
  pendingApproval?: {
    toolCallId?: string
    toolName: string
    args: string
    reason: string
  }
}

export interface ProjectInfo {
  id: string
  name: string
  path: string
  isCustom?: boolean
  isPinned?: boolean
}

export interface ChatSession {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  projectId?: string | null
  projectName?: string | null
  projectPath?: string | null
  isPinned?: boolean
  hasUnread?: boolean
  messages: ChatMessage[]
}

export interface RuntimeStats {
  contextUsedTokens: number
  contextMaxTokens: number
  tokensPerSecond: number
  cacheHitRate: number
  gitBranch: string
  gitChangesCount?: number
  isGenerating?: boolean
  lastLatencyMs?: number
}

export type TabType = 'chat' | 'project'
export type SettingsTabType = 'general' | 'model' | 'mcp' | 'skill' | 'policy' | 'trace'

export type ModelProtocol = 'openai' | 'anthropic' | 'ollama' | 'ts-script'
export type ModelModality = 'text' | 'multimodal'

export interface ModelItem {
  id: string
  name: string
  modality?: ModelModality
  supportsThinking?: boolean
  supportsTools?: boolean
  contextLength?: string
}

export interface ProviderConfig {
  id: string
  name: string
  protocol: ModelProtocol
  defaultBaseUrl: string
  baseUrl: string
  apiKey: string
  customHeaders: Record<string, string>
  status: 'connected' | 'unconfigured' | 'error'
  models: ModelItem[]
  isCustomProvider?: boolean
  isCustomTs?: boolean
  /** TS 脚本驱动：脚本源码（转译后执行，可在线编辑/测试） */
  scriptSource?: string
}
