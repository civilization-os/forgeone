import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle,
  ChevronDown,
  FolderOpen,
  Globe,
  Loader2,
  Plug,
  Plus,
  Radio,
  RefreshCw,
  Terminal,
  Trash2,
  Wrench,
} from 'lucide-react'

const API = 'http://127.0.0.1:9527'

interface McpServer {
  name: string
  scope: string
  transport: string
  status: string
  tool_count: number
  entrypoint: string | null
}

interface McpTool {
  name: string
  description: string
  input_schema: Record<string, unknown> | null
}

interface McpServerDetail extends McpServer {
  tools: McpTool[]
  manifest_path: string | null
}

interface McpTabProps {
  /** 当前绑定的工作区路径；未绑定项目时为 null */
  workspace: string | null
}

type Scope = 'global' | 'project'

const SCOPE_LABEL: Record<Scope, string> = {
  global: '全局',
  project: '项目',
}

/// 单个工具卡片：默认只显示名称与描述，点击展开参数（避免列表过长）
function ToolCard({ tool }: { tool: McpTool }) {
  const [open, setOpen] = useState(false)
  const hasParams =
    !!tool.input_schema &&
    typeof tool.input_schema === 'object' &&
    Object.keys((tool.input_schema.properties as Record<string, unknown> | undefined) ?? {}).length >
      0
  return (
    <div className="rounded-lg border border-[#F4F4F2] bg-[#FBFBF9] px-3 py-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left flex items-center gap-1.5 cursor-pointer"
      >
        <Wrench size={12} className="text-[#2D63ED] shrink-0" />
        <span className="font-mono text-[11px] font-semibold text-[#1A1C1B] break-all flex-1">
          {tool.name}
        </span>
        {hasParams && (
          <ChevronDown
            size={12}
            className={`text-[#A1A1AA] shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          />
        )}
      </button>
      {tool.description && (
        <p className="text-[10px] text-[#76777B] mt-0.5 leading-relaxed">{tool.description}</p>
      )}
      {open && hasParams && <ToolParams schema={tool.input_schema} />}
    </div>
  )
}

/// 解析 inputSchema 并渲染参数列表（名称 / 类型 / 必填 / 描述）
function ToolParams({ schema }: { schema: Record<string, unknown> | null }) {
  if (!schema || typeof schema !== 'object') return null
  const props = (schema.properties ?? {}) as Record<
    string,
    { type?: string; description?: string }
  >
  const required = Array.isArray(schema.required) ? (schema.required as string[]) : []
  const entries = Object.entries(props)
  if (entries.length === 0) return null
  return (
    <div className="mt-1.5 pl-2 border-l-2 border-[#E8E8E6] space-y-0.5">
      {entries.map(([key, prop]) => (
        <div key={key} className="flex items-baseline gap-1.5 text-[10px] leading-relaxed">
          <span className="font-mono font-semibold text-[#1A1C1B] shrink-0">{key}</span>
          <span className="font-mono text-[#76777B] shrink-0">{prop.type ?? 'any'}</span>
          {required.includes(key) && (
            <span className="text-red-400 shrink-0" title="必填">
              *
            </span>
          )}
          {prop.description && (
            <span className="text-[#A1A1AA] truncate min-w-0">{prop.description}</span>
          )}
        </div>
      ))}
    </div>
  )
}

export default function McpTab({ workspace }: McpTabProps) {
  const [servers, setServers] = useState<McpServer[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [addScope, setAddScope] = useState<Scope>('project')
  const [addTransport, setAddTransport] = useState<'stdio' | 'sse'>('stdio')
  const [name, setName] = useState('')
  const [entrypoint, setEntrypoint] = useState('')
  const [endpoint, setEndpoint] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [details, setDetails] = useState<Record<string, McpServerDetail>>({})
  const [reconnecting, setReconnecting] = useState<string | null>(null)
  const [toolFilter, setToolFilter] = useState('')
  const [pendingDelete, setPendingDelete] = useState<McpServer | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // 未绑定项目时 workspace 传空：后端仅注册/返回全局级
      const ws = workspace || ''
      const res = await fetch(`${API}/api/mcp/servers?workspace=${encodeURIComponent(ws)}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setServers(data.servers ?? [])
    } catch {
      setError('无法连接 Runtime 服务（127.0.0.1:9527），请确认桌面端后端已启动')
      setServers([])
    } finally {
      setLoading(false)
    }
  }, [workspace])

  useEffect(() => {
    refresh()
  }, [refresh])

  const handleAdd = async () => {
    if (!name.trim()) return
    if (addTransport === 'stdio' && !entrypoint.trim()) return
    if (addTransport === 'sse' && !endpoint.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`${API}/api/mcp/servers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace: workspace || '',
          scope: addScope,
          transport: addTransport,
          name: name.trim(),
          entrypoint: entrypoint.trim(),
          endpoint: endpoint.trim(),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? '添加失败')
        return
      }
      setName('')
      setEntrypoint('')
      setEndpoint('')
      setShowAdd(false)
      await refresh()
    } catch {
      setError('添加失败：无法连接 Runtime 服务')
    } finally {
      setSubmitting(false)
    }
  }

  const handleRemove = (server: McpServer) => {
    // 打开确认弹窗（防误触），确认后再执行删除
    setPendingDelete(server)
  }

  const confirmDelete = async () => {
    if (!pendingDelete) return
    const server = pendingDelete
    setPendingDelete(null)
    setError(null)
    try {
      const res = await fetch(`${API}/api/mcp/servers`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace: workspace || '',
          scope: server.scope,
          name: server.name,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? '删除失败')
        return
      }
      await refresh()
    } catch {
      setError('删除失败：无法连接 Runtime 服务')
    }
  }

  const keyOf = (server: McpServer) => `${server.scope}__${server.name}`

  const fetchDetail = async (server: McpServer) => {
    const key = keyOf(server)
    if (details[key]) return
    try {
      const res = await fetch(
        `${API}/api/mcp/servers/detail?workspace=${encodeURIComponent(workspace || '')}&scope=${encodeURIComponent(server.scope)}&name=${encodeURIComponent(server.name)}`,
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? '获取详情失败')
      setDetails((d) => ({ ...d, [key]: data.server as McpServerDetail }))
    } catch (e) {
      setError(e instanceof Error ? e.message : '获取详情失败')
    }
  }

  const handleToggleDetail = (server: McpServer) => {
    const key = keyOf(server)
    setExpandedKey((prev) => (prev === key ? null : key))
    setToolFilter('')
    if (expandedKey !== key) fetchDetail(server)
  }

  const handleReconnect = async (server: McpServer) => {
    const key = keyOf(server)
    setReconnecting(key)
    setError(null)
    try {
      const res = await fetch(`${API}/api/mcp/servers/reconnect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace: workspace || '',
          scope: server.scope,
          name: server.name,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? '重连失败')
        return
      }
      // 重连接口返回的 server 不含 tools，丢弃旧的详情缓存（下次展开重新拉取）
      setDetails((d) => {
        const next = { ...d }
        delete next[key]
        return next
      })
      await refresh()
    } catch {
      setError('重连失败：无法连接 Runtime 服务')
    } finally {
      setReconnecting(null)
    }
  }

  const globalServers = servers.filter((s) => s.scope === 'global')
  const projectServers = servers.filter((s) => s.scope === 'project')

  const renderSection = (
    title: string,
    icon: React.ReactNode,
    list: McpServer[],
    emptyHint: string,
  ) => (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 pt-1">
        {icon}
        <h5 className="text-[11px] font-semibold text-[#46474A] uppercase tracking-wide">{title}</h5>
        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#F4F4F2] text-[#76777B]">
          {list.length}
        </span>
      </div>
      {list.length === 0 ? (
        <div className="bg-white p-6 rounded-xl border border-[#E8E8E6] shadow-sm flex flex-col items-center justify-center gap-2 text-center">
          <Plug size={16} className="text-[#A1A1AA]" />
          <p className="text-[11px] text-[#76777B]">{emptyHint}</p>
        </div>
      ) : (
        list.map((mcp) => {
          const key = keyOf(mcp)
          const expanded = expandedKey === key
          const detail = details[key]
          return (
            <div
              key={key}
              className="bg-white rounded-xl border border-[#E8E8E6] shadow-sm overflow-hidden"
            >
              {/* 卡片主体：点击展开/收起详情 */}
              <div
                onClick={() => handleToggleDetail(mcp)}
                className="p-3.5 flex items-center justify-between gap-3 cursor-pointer hover:bg-[#FBFBF9] transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="p-2 rounded-lg bg-[#F4F4F2] text-[#1A1C1B] shrink-0">
                    <Plug size={16} />
                  </div>
                  <div className="min-w-0">
                    <h5 className="text-xs font-semibold text-[#1A1C1B]">{mcp.name}</h5>
                    <p className="text-[10px] text-[#76777B] font-mono">
                      {mcp.tool_count} Tools
                      {mcp.entrypoint ? ' • ' + mcp.entrypoint : ''}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#F4F4F2] text-[#76777B] border border-[#E8E8E6]">
                    {SCOPE_LABEL[(mcp.scope as Scope) ?? 'project'] ?? mcp.scope}
                  </span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-200">
                    {mcp.transport || 'stdio'}
                  </span>
                  <span
                    className={`text-[10px] font-mono px-2 py-0.5 rounded ${
                      mcp.status === 'running'
                        ? 'bg-emerald-50 text-emerald-600 border border-emerald-200'
                        : 'bg-stone-100 text-stone-500'
                    }`}
                  >
                    {mcp.status}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleReconnect(mcp)
                    }}
                    disabled={reconnecting === key}
                    title={
                      mcp.status === 'running'
                        ? `重连 ${mcp.name}（重建连接，应用配置更新）`
                        : `重连 ${mcp.name}`
                    }
                    className="p-1.5 hover:bg-emerald-50 hover:text-emerald-600 rounded text-[#76777B] transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw size={14} className={reconnecting === key ? 'animate-spin' : ''} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleRemove(mcp)
                    }}
                    title={`删除 ${mcp.name}`}
                    className="p-1.5 hover:bg-[#FEF2F2] hover:text-red-600 rounded text-[#76777B] transition-colors cursor-pointer"
                  >
                    <Trash2 size={14} />
                  </button>
                  <ChevronDown
                    size={15}
                    className={`text-[#A1A1AA] transition-transform ${expanded ? 'rotate-180' : ''}`}
                  />
                </div>
              </div>

              {/* 详情面板：配置 + 工具列表 */}
              {expanded && (
                <div className="px-3.5 pb-3.5">
                  <div className="border-t border-[#F4F4F2] pt-2.5 space-y-2">
                    {detail?.manifest_path && (
                      <p className="text-[10px] text-[#A1A1AA] font-mono break-all">
                        配置: {detail.manifest_path}
                      </p>
                    )}
                    {(detail?.tools?.length ?? 0) > 0 ? (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[10px] font-medium text-[#46474A]">
                            共 {detail.tools.length} 个工具
                          </p>
                          <input
                            value={toolFilter}
                            onChange={(e) => setToolFilter(e.target.value)}
                            placeholder="过滤工具…"
                            className="w-28 px-2 py-0.5 text-[10px] font-mono border border-[#E2E3E1] rounded outline-none focus:border-[#1A1C1B] bg-white"
                          />
                        </div>
                        <div className="max-h-64 overflow-y-auto pr-1 space-y-1.5">
                          {detail.tools
                            .filter((t) =>
                              t.name.toLowerCase().includes(toolFilter.trim().toLowerCase()),
                            )
                            .map((tool) => (
                              <ToolCard key={tool.name} tool={tool} />
                            ))}
                          {toolFilter.trim() !== '' &&
                            !detail.tools.some((t) =>
                              t.name.toLowerCase().includes(toolFilter.trim().toLowerCase()),
                            ) && (
                              <p className="text-[10px] text-[#A1A1AA] text-center py-2">
                                无匹配的工具
                              </p>
                            )}
                        </div>
                      </div>
                    ) : (
                      <p className="text-[10px] text-[#A1A1AA]">
                        {detail
                          ? mcp.status === 'running'
                            ? '该 server 未暴露工具'
                            : '未连接成功，无法获取工具列表，可点击重连'
                          : '工具列表加载中…'}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })
      )}
    </div>
  )

  return (
    <div className="space-y-4">
      {/* 顶部：说明 + 添加按钮 */}
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-[#76777B]">
          配置文件位于{' '}
          <span className="font-mono text-[#1A1C1B]">.forgeone/mcp/*.json</span>
          <span className="mx-1.5 text-[#A1A1AA]">·</span>
          全局对<span className="font-semibold text-[#1A1C1B]">所有项目</span>生效，项目仅对
          <span className="font-semibold text-[#1A1C1B]">当前项目</span>生效
        </p>
        <button
          onClick={() => setShowAdd((v) => !v)}
          className="px-2.5 py-1 rounded-lg bg-[#1A1C1B] hover:bg-[#2F3130] text-white text-xs font-medium transition-all flex items-center gap-1 cursor-pointer shadow-xs"
        >
          <Plus size={13} />
          {showAdd ? '取消' : '添加 Server'}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-[11px] px-3 py-2 rounded-lg">
          {error}
        </div>
      )}

      {/* 添加表单 */}
      {showAdd && (
        <div className="bg-[#FBFBF9] p-4 rounded-xl border-2 border-[#1A1C1B] shadow-md space-y-3 animate-in fade-in duration-150">
          <h5 className="text-xs font-bold flex items-center gap-1.5 pb-2 border-b border-[#E8E8E6]">
            <Plug size={14} className="text-[#2D63ED]" />
            新增 MCP Server
          </h5>
          <div className="space-y-3 text-xs">
            <div>
              <label className="block text-[11px] font-medium text-[#46474A] mb-1">生效层级</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setAddScope('global')}
                  className={`flex-1 px-3 py-1.5 rounded-lg border text-left transition-all ${
                    addScope === 'global'
                      ? 'border-[#1A1C1B] bg-white shadow-sm'
                      : 'border-[#E2E3E1] bg-white hover:border-[#A1A1AA]'
                  }`}
                >
                  <span className="flex items-center gap-1 font-medium">
                    <Globe size={12} className="text-[#2D63ED]" /> 全局
                  </span>
                  <span className="block text-[10px] text-[#76777B] mt-0.5">
                    写入 {`~/.forgeone/mcp/`}，所有项目可用
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setAddScope('project')}
                  disabled={!workspace}
                  className={`flex-1 px-3 py-1.5 rounded-lg border text-left transition-all ${
                    !workspace
                      ? 'opacity-40 cursor-not-allowed'
                      : addScope === 'project'
                        ? 'border-[#1A1C1B] bg-white shadow-sm'
                        : 'border-[#E2E3E1] bg-white hover:border-[#A1A1AA]'
                  }`}
                >
                  <span className="flex items-center gap-1 font-medium">
                    <FolderOpen size={12} className="text-[#2D63ED]" /> 项目
                  </span>
                  <span className="block text-[10px] text-[#76777B] mt-0.5">
                    {workspace ? `写入 ${workspace}\\.forgeone\\mcp\\` : '需先绑定项目工作区'}
                  </span>
                </button>
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-[#46474A] mb-1">连接方式</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setAddTransport('stdio')}
                  className={`flex-1 px-3 py-1.5 rounded-lg border text-left transition-all ${
                    addTransport === 'stdio'
                      ? 'border-[#1A1C1B] bg-white shadow-sm'
                      : 'border-[#E2E3E1] bg-white hover:border-[#A1A1AA]'
                  }`}
                >
                  <span className="flex items-center gap-1 font-medium">
                    <Terminal size={12} className="text-[#2D63ED]" /> stdio
                  </span>
                  <span className="block text-[10px] text-[#76777B] mt-0.5">
                    本地子进程（node / npx 等命令）
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setAddTransport('sse')}
                  className={`flex-1 px-3 py-1.5 rounded-lg border text-left transition-all ${
                    addTransport === 'sse'
                      ? 'border-[#1A1C1B] bg-white shadow-sm'
                      : 'border-[#E2E3E1] bg-white hover:border-[#A1A1AA]'
                  }`}
                >
                  <span className="flex items-center gap-1 font-medium">
                    <Radio size={12} className="text-[#2D63ED]" /> SSE
                  </span>
                  <span className="block text-[10px] text-[#76777B] mt-0.5">
                    HTTP 站点（填 http(s) 地址）
                  </span>
                </button>
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-[#46474A] mb-1">
                名称（用于生成工具前缀 {name.trim() ? `${name.trim()}__` : 'name__'}tool）
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如: filesystem（仅允许字母/数字/_/-/.）"
                className="w-full px-2.5 py-1.5 border border-[#E2E3E1] rounded-lg outline-none focus:border-[#1A1C1B] bg-white font-mono"
              />
            </div>
            {addTransport === 'stdio' ? (
              <div>
                <label className="block text-[11px] font-medium text-[#46474A] mb-1">
                  启动命令 entrypoint
                </label>
                <input
                  type="text"
                  value={entrypoint}
                  onChange={(e) => setEntrypoint(e.target.value)}
                  placeholder="例如: npx -y @modelcontextprotocol/server-filesystem ."
                  className="w-full px-2.5 py-1.5 border border-[#E2E3E1] rounded-lg outline-none focus:border-[#1A1C1B] bg-white font-mono"
                />
              </div>
            ) : (
              <div>
                <label className="block text-[11px] font-medium text-[#46474A] mb-1">
                  SSE 端点 URL（HTTP+SSE 传输）
                </label>
                <input
                  type="text"
                  value={endpoint}
                  onChange={(e) => setEndpoint(e.target.value)}
                  placeholder="例如: https://mcp.example.com/mcp"
                  className="w-full px-2.5 py-1.5 border border-[#E2E3E1] rounded-lg outline-none focus:border-[#1A1C1B] bg-white font-mono"
                />
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-[#E8E8E6]">
            <button
              onClick={() => setShowAdd(false)}
              className="px-3 py-1.5 rounded-lg border border-[#E2E3E1] text-xs hover:bg-[#F4F4F2]"
            >
              取消
            </button>
            <button
              onClick={handleAdd}
              disabled={
                submitting ||
                !name.trim() ||
                (addTransport === 'stdio' && !entrypoint.trim()) ||
                (addTransport === 'sse' && !endpoint.trim()) ||
                (addScope === 'project' && !workspace)
              }
              className="px-3.5 py-1.5 rounded-lg bg-[#1A1C1B] text-white text-xs font-medium hover:bg-[#2F3130] disabled:opacity-50 flex items-center gap-1"
            >
              {submitting && <Loader2 size={12} className="animate-spin" />}
              {submitting ? '连接并启动中…' : '添加并启动'}
            </button>
          </div>
        </div>
      )}

      {/* 列表 */}
      {loading ? (
        <div className="bg-white p-8 rounded-xl border border-[#E8E8E6] shadow-sm flex items-center justify-center gap-2 text-xs text-[#76777B]">
          <Loader2 size={15} className="animate-spin" />
          加载中…
        </div>
      ) : (
        <div className="space-y-4">
          {renderSection('全局 MCP', <Globe size={13} className="text-[#2D63ED]" />, globalServers, '暂无全局 MCP 服务，可添加后对所有项目生效')}
          {renderSection(
            '项目 MCP',
            <FolderOpen size={13} className="text-emerald-600" />,
            projectServers,
            workspace ? '暂无项目 MCP 服务，可添加后仅当前项目生效' : '绑定项目工作区后，可在此管理项目级 MCP',
          )}
        </div>
      )}

      {/* 删除确认弹窗（防误触） */}
      {pendingDelete && (
        <div
          data-tauri-no-drag
          className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-[60] p-6"
        >
          <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl border border-[#E2E3E1] p-5 space-y-4 animate-in fade-in duration-150">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-lg bg-red-50 text-red-600 shrink-0">
                <AlertTriangle size={16} />
              </div>
              <div className="min-w-0">
                <h5 className="text-sm font-semibold text-[#1A1C1B]">删除 MCP Server</h5>
                <p className="text-[11px] text-[#76777B]">
                  {SCOPE_LABEL[(pendingDelete.scope as Scope) ?? 'project'] ?? pendingDelete.scope}级 ·{' '}
                  {pendingDelete.name}
                </p>
              </div>
            </div>
            <p className="text-xs text-[#46474A] leading-relaxed">
              将移除{' '}
              <span className="font-mono">.forgeone/mcp/{pendingDelete.name}.json</span>{' '}
              配置并停止其进程，该操作不可撤销。
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => setPendingDelete(null)}
                className="px-3.5 py-1.5 rounded-lg border border-[#E2E3E1] text-xs hover:bg-[#F4F4F2] cursor-pointer"
              >
                取消
              </button>
              <button
                onClick={confirmDelete}
                className="px-3.5 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-medium cursor-pointer"
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
