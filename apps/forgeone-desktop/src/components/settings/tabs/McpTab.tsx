import { Plug } from 'lucide-react'

export default function McpTab() {
  // TODO: 接入真实 MCP 服务列表（Runtime 启动时注册的 MCP Server 将展示在此）
  const mcpList: { name: string; type: string; status: string; tools: number }[] = []

  return (
    <div className="space-y-3">
      {mcpList.length === 0 ? (
        <div className="bg-white p-8 rounded-xl border border-[#E8E8E6] shadow-sm flex flex-col items-center justify-center gap-2 text-center">
          <Plug size={18} className="text-[#A1A1AA]" />
          <p className="text-xs text-[#76777B]">暂无已连接的 MCP 服务</p>
          <p className="text-[10px] text-[#A1A1AA] max-w-xs leading-relaxed">
            MCP Server 接入后将随 Runtime 启动自动注册并展示在此处
          </p>
        </div>
      ) : (
        mcpList.map((mcp) => (
          <div
            key={mcp.name}
            className="bg-white p-3.5 rounded-xl border border-[#E8E8E6] shadow-sm flex items-center justify-between"
          >
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-[#F4F4F2] text-[#1A1C1B]">
                <Plug size={16} />
              </div>
              <div>
                <h5 className="text-xs font-semibold text-[#1A1C1B]">{mcp.name}</h5>
                <p className="text-[10px] text-[#76777B] font-mono">{mcp.type} • {mcp.tools} Tools</p>
              </div>
            </div>
            <span
              className={`text-[10px] font-mono px-2 py-0.5 rounded ${
                mcp.status === 'Running'
                  ? 'bg-emerald-50 text-emerald-600 border border-emerald-200'
                  : 'bg-stone-100 text-stone-500'
              }`}
            >
              {mcp.status}
            </span>
          </div>
        ))
      )}
    </div>
  )
}
