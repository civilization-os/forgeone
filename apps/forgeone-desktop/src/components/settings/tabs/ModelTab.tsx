import { useState, useEffect } from 'react'
import {
  CheckCircle2,
  FileCode2,
  Key,
  Globe,
  RefreshCw,
  AlertTriangle,
  Server,
  Check,
  Plus,
  Trash2,  Cpu,
  Radio,
  Code2,
  ShieldCheck,
  Tag,
  Brain,
  Image as ImageIcon,
  Wrench,
  Play,
  Pencil,
  X,
  Package,
} from 'lucide-react'
import type { ModelProtocol, ModelModality, ModelItem, ProviderConfig } from '../../../types'
import { TS_OLLAMA_DEMO_SCRIPT } from '../../../lib/tsScriptDemos'
import { runTsScript, transpileTs, listModelsFromTsScript } from '../../../lib/tsScriptRuntime'
import { load, getSync, setSync } from '../../../lib/store'

export type { ModelProtocol, ModelModality, ModelItem, ProviderConfig }

interface ModelTabProps {
  activeModel: string
  setActiveModel: (model: string) => void
}

const STORAGE_KEY = 'forgeone_model_providers_v5'

// 默认内置厂商 —— 配置包含多模态、思考、工具及上下文等丰富元数据
const defaultProviders: ProviderConfig[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    protocol: 'openai',
    defaultBaseUrl: 'https://api.openai.com/v1',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    customHeaders: {},
    status: 'unconfigured',
    models: [
      { id: 'gpt-4o', name: 'GPT-4o', modality: 'multimodal', supportsTools: true, supportsThinking: false, contextLength: '128k' },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini', modality: 'multimodal', supportsTools: true, supportsThinking: false, contextLength: '128k' },
      { id: 'o1', name: 'o1 (Reasoning)', modality: 'multimodal', supportsTools: true, supportsThinking: true, contextLength: '200k' },
      { id: 'o3-mini', name: 'o3-mini (Reasoning)', modality: 'text', supportsTools: true, supportsThinking: true, contextLength: '200k' },
    ],
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    protocol: 'anthropic',
    defaultBaseUrl: 'https://api.anthropic.com',
    baseUrl: 'https://api.anthropic.com',
    apiKey: '',
    customHeaders: {},
    status: 'unconfigured',
    models: [
      { id: 'claude-3-7-sonnet', name: 'Claude 3.7 Sonnet (Hybrid Think)', modality: 'multimodal', supportsTools: true, supportsThinking: true, contextLength: '200k' },
      { id: 'claude-3-5-sonnet', name: 'Claude 3.5 Sonnet', modality: 'multimodal', supportsTools: true, supportsThinking: false, contextLength: '200k' },
      { id: 'claude-3-5-haiku', name: 'Claude 3.5 Haiku', modality: 'text', supportsTools: true, supportsThinking: false, contextLength: '200k' },
    ],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    protocol: 'openai',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: '',
    customHeaders: {},
    status: 'unconfigured',
    models: [
      { id: 'deepseek-chat', name: 'DeepSeek V3 (Chat)', modality: 'text', supportsTools: true, supportsThinking: false, contextLength: '64k' },
      { id: 'deepseek-reasoner', name: 'DeepSeek R1 (Reasoner)', modality: 'text', supportsTools: false, supportsThinking: true, contextLength: '64k' },
    ],
  },
  {
    id: 'ollama',
    name: 'Ollama (Local)',
    protocol: 'ollama',
    defaultBaseUrl: 'http://localhost:11434',
    baseUrl: 'http://localhost:11434',
    apiKey: '',
    customHeaders: {},
    status: 'unconfigured',
    models: [
      { id: 'deepseek-r1:14b', name: 'DeepSeek R1 (14B Reasoning)', modality: 'text', supportsTools: false, supportsThinking: true, contextLength: '32k' },
      { id: 'qwen2.5-coder:14b', name: 'Qwen 2.5 Coder (14B)', modality: 'text', supportsTools: true, supportsThinking: false, contextLength: '32k' },
      { id: 'llava:13b', name: 'LLaVA (13B Vision)', modality: 'multimodal', supportsTools: false, supportsThinking: false, contextLength: '8k' },
    ],
  },
  {
    id: 'ts-script',
    name: 'TypeScript Custom Script',
    protocol: 'ts-script',
    defaultBaseUrl: 'http://localhost:11434',
    baseUrl: 'http://localhost:11434',
    apiKey: '',
    customHeaders: {},
    status: 'unconfigured',
    isCustomTs: true,
    scriptSource: TS_OLLAMA_DEMO_SCRIPT,
    tsNpmUrlTemplate: 'https://esm.sh/{pkg}',
    models: [
      { id: 'custom-ts-script-driver', name: 'TS Custom Driver', modality: 'multimodal', supportsTools: true, supportsThinking: true, contextLength: '128k' },
    ],
  },
]

// 将旧版存储迁移：自动推断并补齐 modality, supportsThinking, supportsTools, contextLength
function migrateProvider(p: any): ProviderConfig {
  const models = (p.models || []).map((m: any) => {
    const idLower = (m.id || '').toLowerCase()
    const nameLower = (m.name || '').toLowerCase()

    const isThinking =
      m.supportsThinking ??
      (idLower.includes('r1') || idLower.includes('reasoner') || idLower.includes('o1') || idLower.includes('o3') || idLower.includes('think') || nameLower.includes('think') || nameLower.includes('3.7'))

    const isMultimodal =
      m.modality === 'multimodal' ||
      idLower.includes('4o') || idLower.includes('sonnet') || idLower.includes('opus') || idLower.includes('vl') || idLower.includes('llava') || idLower.includes('vision')

    return {
      id: m.id,
      name: m.name || m.id,
      modality: isMultimodal ? 'multimodal' : 'text',
      supportsThinking: isThinking,
      supportsTools: m.supportsTools ?? true,
      contextLength: m.contextLength,
    }
  })

  return {
    ...p,
    // TS 驱动缺省脚本：内置 Ollama Demo（不引用本地文件）。
    // 任何旧版内置 demo（无当前 v3 特征）都强制升级为最新版；自定义脚本尽量保留
    scriptSource:
      p.protocol === 'ts-script' || p.isCustomTs
        ? typeof p.scriptSource === 'string' &&
          p.scriptSource.includes('ForgeOne TS 驱动 Demo') &&
          !p.scriptSource.includes('模型名必须是真实存在的')
          ? TS_OLLAMA_DEMO_SCRIPT
          : p.scriptSource ?? TS_OLLAMA_DEMO_SCRIPT
        : p.scriptSource,
    // TS 驱动 baseUrl 迁移：旧版存的是脚本路径（./scripts/xxx.ts），迁到 Ollama 服务地址
    baseUrl:
      p.protocol === 'ts-script' || p.isCustomTs
        ? typeof p.baseUrl === 'string' && /^https?:\/\//.test(p.baseUrl)
          ? p.baseUrl
          : 'http://localhost:11434'
        : p.baseUrl,
    customHeaders: p.customHeaders ?? {},
    apiKey: p.protocol === 'ollama' ? '' : (p.apiKey ?? ''),
    // TS 驱动 npm 加载源：旧数据缺省时用默认 esm.sh 模板
    tsNpmUrlTemplate:
      p.protocol === 'ts-script' || p.isCustomTs
        ? typeof p.tsNpmUrlTemplate === 'string' && p.tsNpmUrlTemplate.includes('{pkg}')
          ? p.tsNpmUrlTemplate
          : 'https://esm.sh/{pkg}'
        : p.tsNpmUrlTemplate,
    models,
  }
}

export default function ModelTab({ activeModel, setActiveModel }: ModelTabProps) {
  // 标准桌面存储：默认配置起步，启动时异步载入文件数据（旧 localStorage 由 store 自动迁移）
  const [providers, setProviders] = useState<ProviderConfig[]>(defaultProviders)
  // load 完成前禁止落盘，避免默认值覆盖已迁移/已有文件数据
  const [storeLoaded, setStoreLoaded] = useState(false)

  useEffect(() => {
    load().then(() => {
      const saved = getSync<ProviderConfig[]>(STORAGE_KEY)
      if (Array.isArray(saved) && saved.length > 0) {
        setProviders(saved.map(migrateProvider))
      }
      setStoreLoaded(true)
    })
  }, [])

  // 自动落盘（仅在 store 载入完成后）
  useEffect(() => {
    if (!storeLoaded) return
    try {
      setSync(STORAGE_KEY, providers)
      window.dispatchEvent(new Event('forgeone_models_updated'))
    } catch (e) {
      console.error('Failed to save model config:', e)
    }
  }, [providers, storeLoaded])

  const [selectedProviderId, setSelectedProviderId] = useState<string>('openai')
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)
  const [isTesting, setIsTesting] = useState(false)

  // 新增自定义厂商表单
  const [isAddProviderOpen, setIsAddProviderOpen] = useState(false)
  const [newProviderName, setNewProviderName] = useState('')
  const [newProviderProtocol, setNewProviderProtocol] = useState<ModelProtocol>('openai')
  const [newProviderBaseUrl, setNewProviderBaseUrl] = useState('https://')
  const [newProviderApiKey, setNewProviderApiKey] = useState('')

  // 自定义 Header 编辑
  const [newHeaderKey, setNewHeaderKey] = useState('')
  const [newHeaderValue, setNewHeaderValue] = useState('')

  // 新增模型表单状态
  const [isAddModelExpanded, setIsAddModelExpanded] = useState(false)
  const [newModelId, setNewModelId] = useState('')
  const [newModelName, setNewModelName] = useState('')
  const [newModelModality, setNewModelModality] = useState<ModelModality>('text')
  // TS 脚本驱动：在线编辑 / 在线测试弹层状态
  const [editScriptOpen, setEditScriptOpen] = useState(false)
  const [scriptDraft, setScriptDraft] = useState('')
  const [testOpen, setTestOpen] = useState(false)
  const [testPrompt, setTestPrompt] = useState('你好，请简单介绍你自己')
  const [testOutput, setTestOutput] = useState('')
  const [testRunning, setTestRunning] = useState(false)
  const [newModelThinking, setNewModelThinking] = useState(false)
  const [newModelTools, setNewModelTools] = useState(true)
  const [newModelContext, setNewModelContext] = useState('128k')

  const selectedProvider = providers.find((p) => p.id === selectedProviderId) || providers[0]

  const updateProvider = (field: keyof ProviderConfig, value: any) => {
    setProviders((prev) =>
      prev.map((p) => (p.id === selectedProviderId ? { ...p, [field]: value } : p))
    )
  }

  // 2. 真实 HTTP 探针（全协议支持，含自定义 Headers）
  const handleTestConnection = async () => {
    // TS 本地驱动
    if (selectedProvider.isCustomTs || selectedProvider.protocol === 'ts-script') {
      if (!selectedProvider.baseUrl?.trim()) {
        setProviders((prev) =>
          prev.map((p) => (p.id === selectedProviderId ? { ...p, status: 'unconfigured' } : p))
        )
        setTestResult({ success: false, message: '❌ 请指定有效的 TypeScript 驱动脚本路径。' })
        return
      }
      setProviders((prev) =>
        prev.map((p) => (p.id === selectedProviderId ? { ...p, status: 'connected' } : p))
      )
      setTestResult({
        success: true,
        message: '✅ TS 驱动脚本路径校验通过。已激活自定义调度（请确保已在脚本中编写实际鉴权与模型调用逻辑）。',
      })
      return
    }

    // Ollama 本地探针
    if (selectedProvider.protocol === 'ollama') {
      setIsTesting(true)
      setTestResult({ success: true, message: `正在探测 Ollama 服务 ${selectedProvider.baseUrl}/api/tags ...` })
      try {
        const t0 = Date.now()
        const tagsUrl = `${selectedProvider.baseUrl.replace(/\/+$/, '')}/api/tags`
        const res = await fetch(tagsUrl, {
          method: 'GET',
          headers: { ...selectedProvider.customHeaders },
        })
        const elapsed = Date.now() - t0
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json().catch(() => null)
        let fetchedModels: ModelItem[] = selectedProvider.models
        if (data?.models?.length > 0) {
          fetchedModels = data.models.map((m: any) => ({ id: m.name, name: m.name }))
        }
        setProviders((prev) =>
          prev.map((p) =>
            p.id === selectedProviderId ? { ...p, status: 'connected', models: fetchedModels } : p
          )
        )
        setTestResult({
          success: true,
          message: `✅ Ollama 检测成功！找到 ${fetchedModels.length} 个本地模型 [${elapsed}ms]`,
        })
      } catch (err: any) {
        setProviders((prev) =>
          prev.map((p) => (p.id === selectedProviderId ? { ...p, status: 'unconfigured' } : p))
        )
        setTestResult({
          success: false,
          message: `❌ 无法连接 Ollama - ${err.message || '请确认已执行 ollama serve'}`,
        })
      } finally {
        setIsTesting(false)
      }
      return
    }

    // 云端 API（OpenAI 兼容 / Anthropic）
    if (!selectedProvider.apiKey.trim()) {
      setTestResult({ success: false, message: '❌ 请先填写 API Key 再测试' })
      setProviders((prev) =>
        prev.map((p) => (p.id === selectedProviderId ? { ...p, status: 'unconfigured' } : p))
      )
      return
    }

    setIsTesting(true)
    setTestResult({ success: true, message: `正在向 ${selectedProvider.baseUrl} 发起鉴权探针...` })

    try {
      // 合并：协议标准头 + 用户自定义头
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...selectedProvider.customHeaders,
      }
      let targetUrl = selectedProvider.baseUrl.replace(/\/+$/, '')

      if (selectedProvider.protocol === 'openai') {
        headers['Authorization'] = `Bearer ${selectedProvider.apiKey}`
        targetUrl = `${targetUrl}/models`
      } else if (selectedProvider.protocol === 'anthropic') {
        headers['x-api-key'] = selectedProvider.apiKey
        headers['anthropic-version'] = '2023-06-01'
        targetUrl = `${targetUrl}/v1/models`
      }

      const t0 = Date.now()
      const res = await fetch(targetUrl, { method: 'GET', headers })
      const elapsed = Date.now() - t0

      if (res.status === 401 || res.status === 403) {
        throw new Error(`${res.status} Unauthorized —— API Key 无效，目标端点已拒绝`)
      }

      if (res.ok) {
        const data = await res.json().catch(() => null)
        let dynamicModels: ModelItem[] = selectedProvider.models
        if (data?.data?.length > 0) {
          dynamicModels = (data.data as any[]).slice(0, 12).map((m) => ({
            id: m.id,
            name: m.id,
          }))
        }
        setProviders((prev) =>
          prev.map((p) =>
            p.id === selectedProviderId ? { ...p, status: 'connected', models: dynamicModels } : p
          )
        )
        setTestResult({
          success: true,
          message: `✅ 鉴权成功 [HTTP ${res.status}] 延迟: ${elapsed}ms，获取到 ${dynamicModels.length} 个模型`,
        })
      } else {
        const errText = await res.text().catch(() => '')
        throw new Error(`HTTP ${res.status}: ${errText.slice(0, 100) || '鉴权未通过'}`)
      }
    } catch (err: any) {
      setProviders((prev) =>
        prev.map((p) => (p.id === selectedProviderId ? { ...p, status: 'unconfigured' } : p))
      )
      setTestResult({
        success: false,
        message: `❌ 校验失败 —— ${err.message || '网络不可达或 Key 无效'}`,
      })
    } finally {
      setIsTesting(false)
    }
  }

  // 3. 新增自定义厂商
  const handleCreateCustomProvider = () => {
    if (!newProviderName.trim()) return
    const p: ProviderConfig = {
      id: `custom-${Date.now()}`,
      name: newProviderName.trim(),
      protocol: newProviderProtocol,
      defaultBaseUrl: newProviderBaseUrl.trim(),
      baseUrl: newProviderBaseUrl.trim(),
      apiKey: newProviderApiKey.trim(),
      customHeaders: {},
      status: 'unconfigured',
      isCustomProvider: true,
      models: [{ id: `${newProviderName.toLowerCase().replace(/\s/g, '-')}-default`, name: `${newProviderName.trim()} Default` }],
    }
    setProviders((prev) => [...prev, p])
    setSelectedProviderId(p.id)
    setIsAddProviderOpen(false)
    setNewProviderName('')
    setNewProviderBaseUrl('https://')
    setNewProviderApiKey('')
  }

  // 4. 添加自定义请求头
  const handleAddHeader = () => {
    if (!newHeaderKey.trim()) return
    const updated = { ...selectedProvider.customHeaders, [newHeaderKey.trim()]: newHeaderValue }
    updateProvider('customHeaders', updated)
    setNewHeaderKey('')
    setNewHeaderValue('')
  }

  const handleRemoveHeader = (key: string) => {
    const updated = { ...selectedProvider.customHeaders }
    delete updated[key]
    updateProvider('customHeaders', updated)
  }

  // 5. 手动新增模型 (含完整能力元数据)
  const handleAddModel = () => {
    if (!newModelId.trim()) return
    const id = newModelId.trim()
    const name = newModelName.trim() || id
    if (!selectedProvider.models.some((m) => m.id === id)) {
      updateProvider('models', [
        ...selectedProvider.models,
        {
          id,
          name,
          modality: newModelModality,
          supportsThinking: newModelThinking,
          supportsTools: newModelTools,
          contextLength: newModelContext,
        },
      ])
    }
    setNewModelId('')
    setNewModelName('')
    setIsAddModelExpanded(false)
  }

  // 切换单个模型的特性支持
  const toggleModelCapability = (modelId: string, cap: 'modality' | 'supportsThinking' | 'supportsTools', e: React.MouseEvent) => {
    e.stopPropagation()
    const updated = selectedProvider.models.map((m) => {
      if (m.id === modelId) {
        if (cap === 'modality') {
          return { ...m, modality: (m.modality === 'multimodal' ? 'text' : 'multimodal') as ModelModality }
        }
        if (cap === 'supportsThinking') {
          return { ...m, supportsThinking: !m.supportsThinking }
        }
        if (cap === 'supportsTools') {
          return { ...m, supportsTools: !m.supportsTools }
        }
      }
      return m
    })
    updateProvider('models', updated)
  }

  // 删除模型
  const handleDeleteModel = (modelId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const updated = selectedProvider.models.filter((m) => m.id !== modelId)
    updateProvider('models', updated)
  }

  // 6. 删除自定义厂商
  const handleDeleteProvider = (id: string) => {
    setProviders((prev) => prev.filter((p) => p.id !== id))
    if (selectedProviderId === id) setSelectedProviderId('openai')
  }

  return (
    <div className="space-y-4 text-[#1A1C1B]">
      {/* 安全凭据说明 */}
      <div className="p-3 bg-white border border-[#E8E8E6] rounded-xl flex items-center justify-between text-xs text-[#46474A] shadow-xs">
        <div className="flex items-center gap-2">
          <ShieldCheck size={16} className="text-emerald-600 shrink-0" />
          <span>API Key 由 Rust 物理内核加密，存储于系统级安全凭据库 (WinCred / Keychain)</span>
        </div>
        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#F4F4F2] text-[#76777B] border border-[#E8E8E6]">
          Trace 自动脱敏
        </span>
      </div>

      {/* 厂商列表 */}
      <div className="bg-white p-4 rounded-xl border border-[#E8E8E6] shadow-sm space-y-3">
        <div className="flex items-center justify-between pb-2 border-b border-[#F4F4F2]">
          <div className="flex items-center gap-2">
            <Server size={15} className="text-[#2D63ED]" />
            <h5 className="text-xs font-semibold">模型厂商 (Providers)</h5>
          </div>
          <button
            onClick={() => setIsAddProviderOpen(true)}
            className="px-2.5 py-1 rounded-lg bg-[#1A1C1B] hover:bg-[#2F3130] text-white text-xs font-medium transition-all flex items-center gap-1 cursor-pointer shadow-xs"
          >
            <Plus size={13} />
            <span>添加自定义 Endpoint</span>
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {providers.map((provider) => {
            const isSelected = selectedProviderId === provider.id
            return (
              <div
                key={provider.id}
                onClick={() => { setSelectedProviderId(provider.id); setTestResult(null) }}
                className={`cursor-pointer p-3 rounded-xl border transition-all ${
                  isSelected
                    ? 'bg-[#F9F9F7] border-[#1A1C1B] ring-1 ring-[#1A1C1B] shadow-sm'
                    : 'bg-white border-[#E8E8E6] hover:border-[#C7C6CA]'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold flex items-center gap-1.5 truncate">
                    {provider.isCustomTs ? (
                      <FileCode2 size={13} className="text-[#2D63ED] shrink-0" />
                    ) : provider.protocol === 'ollama' ? (
                      <Cpu size={13} className="text-emerald-600 shrink-0" />
                    ) : (
                      <Server size={13} className="text-[#76777B] shrink-0" />
                    )}
                    <span className="truncate">{provider.name}</span>
                  </span>
                  <div className="flex items-center gap-1">
                    {provider.status === 'connected' ? (
                      <span className="flex items-center gap-1 text-[10px] font-medium text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                        <CheckCircle2 size={11} className="text-emerald-600" /> 已连通
                      </span>
                    ) : (
                      <span className="text-[10px] font-medium text-zinc-500 bg-zinc-100 px-1.5 py-0.5 rounded border border-zinc-200">
                        未连接
                      </span>
                    )}
                    {provider.isCustomProvider && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeleteProvider(provider.id) }}
                        className="p-1 hover:bg-[#FEF2F2] hover:text-red-600 rounded text-[#76777B] transition-colors"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between text-[10px] text-[#76777B] font-mono">
                  <span className="px-1.5 rounded bg-[#F4F4F2] text-[#46474A] uppercase">{provider.protocol}</span>
                  <span>{provider.models.length} 个模型</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* 新增自定义厂商表单 */}
      {isAddProviderOpen && (
        <div className="bg-[#FBFBF9] p-4 rounded-xl border-2 border-[#1A1C1B] shadow-md space-y-3 animate-in fade-in duration-150">
          <div className="flex items-center justify-between pb-2 border-b border-[#E8E8E6]">
            <h5 className="text-xs font-bold flex items-center gap-1.5">
              <Plus size={14} className="text-[#2D63ED]" />
              新增自定义 Endpoint 厂商
            </h5>
            <button onClick={() => setIsAddProviderOpen(false)} className="text-xs text-[#76777B] hover:text-[#1A1C1B]">取消</button>
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <label className="block text-[11px] font-medium text-[#46474A] mb-1">厂商名称</label>
              <input
                type="text" value={newProviderName}
                onChange={(e) => setNewProviderName(e.target.value)}
                placeholder="例如: 公司私有 vLLM"
                className="w-full px-2.5 py-1.5 border border-[#E2E3E1] rounded-lg outline-none focus:border-[#1A1C1B] bg-white font-mono"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-[#46474A] mb-1 flex items-center gap-1">
                <Radio size={12} className="text-[#2D63ED]" /> 通信协议
              </label>
              <select
                value={newProviderProtocol}
                onChange={(e) => setNewProviderProtocol(e.target.value as ModelProtocol)}
                className="w-full px-2.5 py-1.5 border border-[#E2E3E1] rounded-lg outline-none focus:border-[#1A1C1B] bg-white font-mono"
              >
                <option value="openai">OpenAI 兼容协议</option>
                <option value="anthropic">Anthropic 原生协议</option>
                <option value="ollama">Ollama 本地协议</option>
                <option value="ts-script">TypeScript 脚本驱动</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-[#46474A] mb-1">Base URL</label>
              <input
                type="text" value={newProviderBaseUrl}
                onChange={(e) => setNewProviderBaseUrl(e.target.value)}
                placeholder="https://api.mycompany.com/v1"
                className="w-full px-2.5 py-1.5 border border-[#E2E3E1] rounded-lg outline-none focus:border-[#1A1C1B] bg-white font-mono"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-[#46474A] mb-1">API Key (如需)</label>
              <input
                type="password" value={newProviderApiKey}
                onChange={(e) => setNewProviderApiKey(e.target.value)}
                placeholder="sk-custom-••••••"
                className="w-full px-2.5 py-1.5 border border-[#E2E3E1] rounded-lg outline-none focus:border-[#1A1C1B] bg-white font-mono"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-[#E8E8E6]">
            <button
              onClick={() => setIsAddProviderOpen(false)}
              className="px-3 py-1.5 rounded-lg border border-[#E2E3E1] text-xs hover:bg-[#F4F4F2]"
            >
              取消
            </button>
            <button
              onClick={handleCreateCustomProvider}
              disabled={!newProviderName.trim()}
              className="px-3.5 py-1.5 rounded-lg bg-[#1A1C1B] text-white text-xs font-medium hover:bg-[#2F3130] disabled:opacity-50"
            >
              确认添加
            </button>
          </div>
        </div>
      )}

      {/* 选中的厂商配置面板 */}
      <div className="bg-white p-4 rounded-xl border border-[#E8E8E6] shadow-sm space-y-4">
        <div className="flex items-center justify-between pb-2 border-b border-[#F4F4F2]">
          <div>
            <h4 className="text-xs font-bold text-[#1A1C1B] flex items-center gap-2">
              <span>{selectedProvider.name} 配置</span>
              <span className="font-mono text-[10px] px-2 py-0.5 rounded bg-[#F4F4F2] text-[#76777B] font-normal uppercase">
                {selectedProvider.protocol}
              </span>
            </h4>
            <p className="text-[11px] text-[#76777B] mt-0.5">配置厂商 API Key 及 Endpoint 连通性探针</p>
          </div>
          {selectedProvider.status === 'connected' ? (
            <span className="flex items-center gap-1.5 text-xs text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200 font-semibold">
              <CheckCircle2 size={14} className="text-emerald-600" /> 已连通可用
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-xs text-zinc-600 bg-zinc-100 px-2.5 py-1 rounded-lg border border-zinc-200">
              未配置 / 待连接
            </span>
          )}
        </div>

        {/* 表单字段 */}
        {selectedProvider.isCustomTs || selectedProvider.protocol === 'ts-script' ? (
          <div className="space-y-3">
            <div>
              <label className="text-[11px] font-medium text-[#46474A] block mb-1 flex items-center gap-1">
                <Globe size={12} className="text-[#2D63ED]" /> 模型服务地址（Base URL）
              </label>
              <input
                type="text" value={selectedProvider.baseUrl}
                onChange={(e) => updateProvider('baseUrl', e.target.value)}
                placeholder="http://localhost:11434"
                className="w-full px-3 py-1.5 border border-[#E2E3E1] rounded-lg text-xs font-mono outline-none focus:border-[#1A1C1B] bg-white"
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-[#46474A] block mb-1 flex items-center gap-1">
                <Package size={12} className="text-[#2D63ED]" /> npm 包加载地址模板
              </label>
              <input
                type="text" value={selectedProvider.tsNpmUrlTemplate || 'https://esm.sh/{pkg}'}
                onChange={(e) => updateProvider('tsNpmUrlTemplate', e.target.value)}
                placeholder="https://esm.sh/{pkg}"
                className="w-full px-3 py-1.5 border border-[#E2E3E1] rounded-lg text-xs font-mono outline-none focus:border-[#1A1C1B] bg-white"
              />
              <p className="text-[10px] text-[#76777B] mt-1 leading-relaxed">
                <code>{'{pkg}'}</code> 会被替换为包名。支持 esm.sh / jsdelivr（<code>{'https://cdn.jsdelivr.net/npm/{pkg}/+esm'}</code>）/ unpkg / 自建代理等，需返回 ESM 格式。
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => { setScriptDraft(selectedProvider.scriptSource || TS_OLLAMA_DEMO_SCRIPT); setEditScriptOpen(true) }}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-[#E2E3E1] bg-white hover:bg-[#F4F4F2] text-xs font-medium text-[#1A1C1B] transition-colors cursor-pointer"
              >
                <Pencil size={13} /> 在线编辑脚本
              </button>
              <button
                type="button"
                onClick={() => {
                  const first = selectedProvider.models?.[0]
                  if (!first || first.id === 'custom-ts-script-driver' || first.id === 'TS Custom Driver') {
                    alert('请先点击「获取模型列表」拉取本机模型，再使用在线测试（测试使用模型列表的第一个模型）')
                    return
                  }
                  setTestOutput('')
                  setTestPrompt('你好，请简单介绍你自己')
                  setTestOpen(true)
                }}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[#2D63ED] hover:bg-[#1E4FD8] text-white text-xs font-medium transition-colors cursor-pointer"
              >
                <Play size={13} /> 在线测试
              </button>
            </div>
            <button
              type="button"
              onClick={async () => {
                try {
                  const source = selectedProvider.scriptSource || TS_OLLAMA_DEMO_SCRIPT
                  const list = await listModelsFromTsScript(source, selectedProvider.baseUrl, selectedProvider.tsNpmUrlTemplate)
                  if (list.length === 0) {
                    alert('脚本未返回模型列表（脚本需导出 listModels，Ollama 需已运行）')
                    return
                  }
                  updateProvider('models', list.map((m) => ({
                    id: m.id,
                    name: m.name,
                    modality: 'text' as const,
                    supportsTools: true,
                    supportsThinking: false,
                  })))
                  alert(`已获取 ${list.length} 个模型:\n${list.map((m) => m.id).join('\n')}`)
                } catch (e: any) {
                  alert(`获取模型列表失败: ${e?.message || e}`)
                }
              }}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-[#BFDBFE] bg-[#EBF3FF] hover:bg-[#DBEAFE] text-xs font-medium text-[#1E40AF] transition-colors cursor-pointer"
            >
              <RefreshCw size={13} /> 获取模型列表（Ollama /api/tags）
            </button>
            <div className="p-3 bg-[#EBF3FF] border border-[#BFDBFE] rounded-lg text-[11px] text-[#1E40AF] leading-relaxed">
              💡 TS 驱动通过脚本连接模型（默认内置 Ollama Demo，无需本地文件）。<b>在线编辑</b>可修改脚本（鉴权 / 转发 / 后处理）；<b>在线测试</b>直接运行脚本验证连通性。脚本契约：导出 <code>runModel</code>。<br />
              📦 脚本内 <code>import</code> 支持<b>任意 npm 包</b>（通过 esm.sh CDN 在线加载，如 <code>import axios from 'axios'</code>）。需要网络；包的正确性与加载失败由脚本作者自行负责。不支持相对路径/内置模块 import。
            </div>
            <div className="p-3.5 bg-[#F9F9F7] rounded-xl border border-[#E8E8E6] space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold flex items-center gap-1.5">
                  <Code2 size={14} className="text-[#2D63ED]" /> TS 驱动接口契约
                </span>
                <span className="text-[10px] font-mono text-[#76777B]">runModel</span>
              </div>
              <div className="bg-[#1A1C1B] text-[#E8E8E6] p-3 rounded-lg text-[11px] font-mono leading-relaxed overflow-x-auto select-text">
                <pre>{`// 对话/流式生成（必须导出）
export async function runModel(params: {
  model: string          // 模型名（来自模型列表）
  baseUrl: string        // 服务地址，如 http://localhost:11434
  messages: { role: string; content: string }[]
  onDelta: (text: string, reasoning?: string) => void
  signal?: AbortSignal   // 「停止」按钮取消信号
}): Promise<void>

// 获取模型列表（可选导出，供「获取模型列表」按钮）
export async function listModels(params: {
  baseUrl: string
}): Promise<{ id: string; name: string }[]>

// 示例：import 任意 npm 包（经 esm.sh CDN 在线加载，需网络）
// import axios from 'axios'
// import { twMerge } from 'tailwind-merge'
// import _ from 'lodash'   // 动态: const _ = await import('lodash')`}</pre>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {/* API Key (Ollama 不需要) */}
            {selectedProvider.protocol !== 'ollama' && (
              <div>
                <label className="text-[11px] font-medium text-[#46474A] block mb-1 flex items-center gap-1">
                  <Key size={12} /> API Key 密钥
                </label>
                <input
                  type="password" value={selectedProvider.apiKey}
                  onChange={(e) => updateProvider('apiKey', e.target.value)}
                  placeholder={`请输入 ${selectedProvider.name} API Key...`}
                  className="w-full px-3 py-1.5 border border-[#E2E3E1] rounded-lg text-xs font-mono outline-none focus:border-[#1A1C1B] bg-white"
                />
              </div>
            )}

            {/* Base URL */}
            <div>
              <label className="text-[11px] font-medium text-[#46474A] block mb-1 flex items-center gap-1">
                <Globe size={12} /> Base URL Endpoint
              </label>
              <input
                type="text" value={selectedProvider.baseUrl}
                onChange={(e) => updateProvider('baseUrl', e.target.value)}
                placeholder={selectedProvider.defaultBaseUrl}
                className="w-full px-3 py-1.5 border border-[#E2E3E1] rounded-lg text-xs font-mono outline-none focus:border-[#1A1C1B] bg-white"
              />
            </div>

            {/* 自定义请求头 */}
            <div>
              <label className="text-[11px] font-medium text-[#46474A] block mb-1.5 flex items-center gap-1">
                <Tag size={12} className="text-[#2D63ED]" /> 自定义请求头 (Custom Headers)
                <span className="text-[10px] text-[#76777B] font-normal ml-1">如企业代理 Token、特殊鉴权 Header 等</span>
              </label>

              {/* 已有 Header 列表 */}
              {Object.keys(selectedProvider.customHeaders).length > 0 && (
                <div className="space-y-1 mb-2">
                  {Object.entries(selectedProvider.customHeaders).map(([k, v]) => (
                    <div key={k} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#F9F9F7] border border-[#E8E8E6] rounded-lg font-mono text-[11px]">
                      <span className="text-[#2D63ED] font-semibold shrink-0">{k}</span>
                      <span className="text-[#76777B]">:</span>
                      <span className="truncate flex-1 text-[#1A1C1B]">{v}</span>
                      <button
                        onClick={() => handleRemoveHeader(k)}
                        className="text-[#76777B] hover:text-red-600 transition-colors ml-auto shrink-0"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* 新增 Header 输入行 */}
              <div className="flex gap-1.5">
                <input
                  type="text" value={newHeaderKey}
                  onChange={(e) => setNewHeaderKey(e.target.value)}
                  placeholder="Header 键 (如 X-Token)"
                  className="flex-1 px-2.5 py-1.5 border border-[#E2E3E1] rounded-lg text-xs font-mono outline-none focus:border-[#1A1C1B]"
                />
                <input
                  type="text" value={newHeaderValue}
                  onChange={(e) => setNewHeaderValue(e.target.value)}
                  placeholder="值"
                  className="flex-1 px-2.5 py-1.5 border border-[#E2E3E1] rounded-lg text-xs font-mono outline-none focus:border-[#1A1C1B]"
                />
                <button
                  onClick={handleAddHeader}
                  disabled={!newHeaderKey.trim()}
                  className="px-2.5 py-1.5 rounded-lg bg-[#F4F4F2] hover:bg-[#EEEEEC] border border-[#E2E3E1] text-[#1A1C1B] text-xs font-medium transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-40 shrink-0"
                >
                  <Plus size={12} /> 添加
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 测试连接 */}
        <div className="pt-2 flex items-center justify-between border-t border-[#F4F4F2]">
          <button
            onClick={handleTestConnection}
            disabled={isTesting}
            className="px-3.5 py-1.5 rounded-lg bg-[#1A1C1B] hover:bg-[#2F3130] disabled:opacity-50 text-white text-xs font-medium transition-all shadow-sm flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw size={13} className={isTesting ? 'animate-spin' : ''} />
            <span>测试连接 ({selectedProvider.protocol.toUpperCase()})</span>
          </button>
          <span className="text-[10px] text-[#76777B]">
            {selectedProvider.protocol === 'ollama' ? '无需 Key，检测本地服务可达性' : '填写 Key 后才能通过测试'}
          </span>
        </div>

        {testResult && (
          <div
            className={`p-2.5 rounded-lg border text-xs font-mono flex items-start gap-2 ${
              testResult.success
                ? 'bg-[#F0FDF4] border-[#DCFCE7] text-emerald-800'
                : 'bg-[#FEF2F2] border-[#FCA5A5] text-[#991B1B]'
            }`}
          >
            {testResult.success ? (
              <CheckCircle2 size={14} className="shrink-0 text-emerald-600 mt-0.5" />
            ) : (
              <AlertTriangle size={14} className="shrink-0 text-red-600 mt-0.5" />
            )}
            <span>{testResult.message}</span>
          </div>
        )}

        {/* 模型列表与能力配置 */}
        <div className="pt-3 space-y-3 border-t border-[#F4F4F2]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-semibold">
              <Cpu size={14} className="text-[#2D63ED]" />
              <span>{selectedProvider.name} 的模型列表 ({selectedProvider.models.length})</span>
            </div>
            <button
              onClick={() => setIsAddModelExpanded(!isAddModelExpanded)}
              className="px-2.5 py-1 rounded-lg bg-[#1A1C1B] hover:bg-[#2F3130] text-white text-xs font-medium flex items-center gap-1 cursor-pointer"
            >
              <Plus size={12} /> {isAddModelExpanded ? '收起新增' : '新增模型'}
            </button>
          </div>

          {/* 新增模型扩展表单 */}
          {isAddModelExpanded && (
            <div className="bg-[#FAF9F7] p-3.5 rounded-xl border border-[#E8E8E6] space-y-3 animate-in fade-in duration-150">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <label className="block text-[11px] font-medium text-[#46474A] mb-1">模型 ID (唯一标识)</label>
                  <input
                    type="text"
                    value={newModelId}
                    onChange={(e) => setNewModelId(e.target.value)}
                    placeholder="如: claude-3-7-sonnet"
                    className="w-full px-2.5 py-1.5 border border-[#E2E3E1] rounded-lg font-mono text-xs outline-none bg-white focus:border-[#1A1C1B]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-[#46474A] mb-1">显示名称</label>
                  <input
                    type="text"
                    value={newModelName}
                    onChange={(e) => setNewModelName(e.target.value)}
                    placeholder="如: Claude 3.7 Sonnet (Hybrid Think)"
                    className="w-full px-2.5 py-1.5 border border-[#E2E3E1] rounded-lg text-xs outline-none bg-white focus:border-[#1A1C1B]"
                  />
                </div>
              </div>

              {/* 能力元数据配置 */}
              <div className="pt-2 border-t border-[#E8E8E6] flex flex-wrap items-center gap-3 text-xs">
                {/* 模态选择 */}
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-[#46474A] font-medium">模态类型:</span>
                  <div className="inline-flex rounded-lg border border-[#E2E3E1] p-0.5 bg-white text-[11px]">
                    <button
                      type="button"
                      onClick={() => setNewModelModality('text')}
                      className={`px-2 py-0.5 rounded cursor-pointer ${
                        newModelModality === 'text' ? 'bg-[#1A1C1B] text-white font-medium' : 'text-[#76777B]'
                      }`}
                    >
                      纯文本
                    </button>
                    <button
                      type="button"
                      onClick={() => setNewModelModality('multimodal')}
                      className={`px-2 py-0.5 rounded flex items-center gap-1 cursor-pointer ${
                        newModelModality === 'multimodal' ? 'bg-[#1A1C1B] text-white font-medium' : 'text-[#76777B]'
                      }`}
                    >
                      <ImageIcon size={10} /> 视觉多模态
                    </button>
                  </div>
                </div>

                {/* 深度思考能力 */}
                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={newModelThinking}
                    onChange={(e) => setNewModelThinking(e.target.checked)}
                    className="rounded border-[#E2E3E1] text-[#6366F1] focus:ring-[#6366F1]"
                  />
                  <span className="text-[11px] flex items-center gap-1 font-medium text-[#46474A]">
                    <Brain size={12} className="text-[#6366F1]" /> 深度思考 (Think / Reasoning)
                  </span>
                </label>

                {/* 工具调用能力 */}
                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={newModelTools}
                    onChange={(e) => setNewModelTools(e.target.checked)}
                    className="rounded border-[#E2E3E1] text-emerald-600 focus:ring-emerald-600"
                  />
                  <span className="text-[11px] flex items-center gap-1 font-medium text-[#46474A]">
                    <Wrench size={12} className="text-emerald-600" /> 工具调度 (Tools)
                  </span>
                </label>

                {/* 上下文窗口 */}
                <div className="flex items-center gap-1.5 ml-auto">
                  <span className="text-[11px] text-[#46474A] font-medium">窗口:</span>
                  <select
                    value={newModelContext}
                    onChange={(e) => setNewModelContext(e.target.value)}
                    className="px-2 py-1 border border-[#E2E3E1] rounded-lg text-[11px] font-mono outline-none bg-white"
                  >
                    <option value="32k">32k</option>
                    <option value="64k">64k</option>
                    <option value="128k">128k</option>
                    <option value="200k">200k</option>
                    <option value="1M">1M</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-[#E8E8E6]">
                <button
                  type="button"
                  onClick={() => setIsAddModelExpanded(false)}
                  className="px-3 py-1 rounded-lg border border-[#E2E3E1] text-xs hover:bg-[#F4F4F2]"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleAddModel}
                  disabled={!newModelId.trim()}
                  className="px-3.5 py-1 rounded-lg bg-[#1A1C1B] text-white text-xs font-medium hover:bg-[#2F3130] disabled:opacity-50"
                >
                  保存模型
                </button>
              </div>
            </div>
          )}

          {/* 模型卡片流 */}
          <div className="space-y-2">
            {selectedProvider.models.map((modelItem) => {
              const isActive = activeModel === modelItem.id
              const canClick = selectedProvider.status === 'connected'
              return (
                <div
                  key={modelItem.id}
                  onClick={() => canClick && setActiveModel(modelItem.id)}
                  className={`p-3 rounded-xl border text-xs transition-all ${
                    canClick ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'
                  } ${
                    isActive
                      ? 'bg-[#EBF3FF] border-[#2D63ED] ring-1 ring-[#2D63ED] shadow-xs'
                      : 'bg-white border-[#E8E8E6] hover:border-[#C7C6CA]'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-xs text-[#1A1C1B]">{modelItem.name}</span>
                      {modelItem.name !== modelItem.id && (
                        <span className="text-[10px] font-mono text-[#76777B] px-1.5 py-0.5 rounded bg-[#F4F4F2]">
                          {modelItem.id}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {isActive ? (
                        <span className="flex items-center gap-1 text-[11px] font-semibold text-[#2D63ED] bg-white px-2 py-0.5 rounded border border-[#BFDBFE]">
                          <Check size={13} /> 聊天已选用
                        </span>
                      ) : (
                        <span className="text-[10px] text-[#76777B]">
                          {canClick ? '点击选用' : '需先测试通过'}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={(e) => handleDeleteModel(modelItem.id, e)}
                        className="p-1 hover:bg-[#FEF2F2] hover:text-red-600 rounded text-[#A1A1AA] transition-colors"
                        title="删除此模型"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>

                  {/* 能力徽章栏与动态微调 */}
                  <div className="flex flex-wrap items-center gap-1.5 pt-1.5 border-t border-[#F4F4F2]">
                    {/* 模态 */}
                    <button
                      type="button"
                      onClick={(e) => toggleModelCapability(modelItem.id, 'modality', e)}
                      title="点击切换 纯文本 / 多模态"
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium border transition-colors cursor-pointer ${
                        modelItem.modality === 'multimodal'
                          ? 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100'
                          : 'bg-zinc-100 text-zinc-600 border-zinc-200 hover:bg-zinc-200'
                      }`}
                    >
                      {modelItem.modality === 'multimodal' ? (
                        <>
                          <ImageIcon size={10} className="text-amber-600" />
                          <span>多模态 (Vision)</span>
                        </>
                      ) : (
                        <span>文本 (Text)</span>
                      )}
                    </button>

                    {/* 深度思考 Think */}
                    <button
                      type="button"
                      onClick={(e) => toggleModelCapability(modelItem.id, 'supportsThinking', e)}
                      title="点击开启/关闭 深度思考推理支持"
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium border transition-colors cursor-pointer ${
                        modelItem.supportsThinking
                          ? 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100'
                          : 'bg-zinc-50 text-zinc-400 border-zinc-200 line-through opacity-60 hover:opacity-100'
                      }`}
                    >
                      <Brain size={10} className={modelItem.supportsThinking ? 'text-[#6366F1]' : 'text-zinc-400'} />
                      <span>{modelItem.supportsThinking ? '支持思考 (Think)' : '无深度思考'}</span>
                    </button>

                    {/* 工具调用 Tools */}
                    <button
                      type="button"
                      onClick={(e) => toggleModelCapability(modelItem.id, 'supportsTools', e)}
                      title="点击开启/关闭 工具调度支持"
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium border transition-colors cursor-pointer ${
                        modelItem.supportsTools
                          ? 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
                          : 'bg-zinc-50 text-zinc-400 border-zinc-200 line-through opacity-60 hover:opacity-100'
                      }`}
                    >
                      <Wrench size={10} className={modelItem.supportsTools ? 'text-emerald-600' : 'text-zinc-400'} />
                      <span>{modelItem.supportsTools ? '支持工具 (Tools)' : '无工具'}</span>
                    </button>

                    {/* 上下文窗口 */}
                    {modelItem.contextLength && (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-gray-50 text-gray-500 border border-gray-200 text-[10px] font-mono ml-auto">
                        {modelItem.contextLength}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* TS 脚本在线编辑弹层 */}
      {editScriptOpen && (
        <div className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center p-6" onClick={() => setEditScriptOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl flex flex-col h-[88vh]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#E8E8E6]">
              <span className="text-sm font-semibold flex items-center gap-2">
                <FileCode2 size={15} className="text-[#2D63ED]" /> 在线编辑 TS 脚本
              </span>
              <button type="button" onClick={() => setEditScriptOpen(false)} className="p-1 rounded hover:bg-[#F4F4F2] cursor-pointer">
                <X size={15} />
              </button>
            </div>
            <textarea
              value={scriptDraft}
              onChange={(e) => setScriptDraft(e.target.value)}
              spellCheck={false}
              style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', tabSize: 2 }}
              className="flex-1 min-h-0 w-full p-3 text-[12px] leading-relaxed bg-[#1A1C1B] text-[#E8E8E6] outline-none resize-none custom-scrollbar"
            />
            <div className="flex items-center justify-between px-4 py-3 border-t border-[#E8E8E6]">
              <span className="text-[10px] font-mono text-[#76777B]">导出 runModel 或 default 异步函数</span>
              <div className="flex gap-2">
                <button type="button" onClick={() => setEditScriptOpen(false)} className="px-3 py-1.5 rounded-lg border border-[#E2E3E1] text-xs cursor-pointer hover:bg-[#F4F4F2]">
                  取消
                </button>
                <button
                  type="button"
                  onClick={() => {
                    try {
                      transpileTs(scriptDraft)
                    } catch (e: any) {
                      alert(`脚本语法错误: ${e?.message || e}`)
                      return
                    }
                    updateProvider('scriptSource', scriptDraft)
                    setEditScriptOpen(false)
                  }}
                  className="px-3 py-1.5 rounded-lg bg-[#2D63ED] hover:bg-[#1E4FD8] text-white text-xs cursor-pointer"
                >
                  保存脚本
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TS 脚本在线测试弹层 */}
      {testOpen && (
        <div className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center p-6" onClick={() => setTestOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl flex flex-col max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#E8E8E6]">
              <span className="text-sm font-semibold flex items-center gap-2">
                <Play size={15} className="text-[#2D63ED]" /> 在线测试（运行脚本调用模型）
              </span>
              <button type="button" onClick={() => setTestOpen(false)} className="p-1 rounded hover:bg-[#F4F4F2] cursor-pointer">
                <X size={15} />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <textarea
                value={testPrompt}
                onChange={(e) => setTestPrompt(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 border border-[#E2E3E1] rounded-lg text-xs outline-none focus:border-[#1A1C1B] resize-none"
                placeholder="输入测试消息..."
              />
              <button
                type="button"
                onClick={async () => {
                  if (testRunning) return
                  setTestRunning(true)
                  setTestOutput('')
                  try {
                    const source = selectedProvider.scriptSource || TS_OLLAMA_DEMO_SCRIPT
                    await runTsScript(source, {
                      model: selectedProvider.models[0]?.id || 'custom-ts-script-driver',
                      baseUrl: selectedProvider.baseUrl,
                      messages: [{ role: 'user', content: testPrompt }],
                      onDelta: (t) => setTestOutput((prev) => prev + t),
                    })
                  } catch (e: any) {
                    setTestOutput((prev) => prev + `\n\n❌ 测试失败: ${e?.message || e}`)
                  } finally {
                    setTestRunning(false)
                  }
                }}
                disabled={testRunning}
                className="w-full px-3 py-2 rounded-lg bg-[#2D63ED] hover:bg-[#1E4FD8] disabled:opacity-50 text-white text-xs font-medium cursor-pointer"
              >
                {testRunning ? '测试中...' : '▶ 运行测试'}
              </button>
              <pre className="bg-[#F9F9F7] border border-[#E8E8E6] rounded-lg p-3 text-[11px] font-mono whitespace-pre-wrap max-h-64 overflow-y-auto custom-scrollbar">
                {testOutput || '（等待运行，流式输出将显示在这里）'}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
