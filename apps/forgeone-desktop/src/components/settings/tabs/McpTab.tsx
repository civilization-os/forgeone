import { Plug } from 'lucide-react'

export default function McpTab() {
  const mcpList = [
    { name: 'sqlite-mcp-server', type: 'Stdio Process', status: 'Running', tools: 6 },
    { name: 'github-mcp-service', type: 'HTTP / SSE', status: 'Running', tools: 12 },
    { name: 'filesystem-mcp', type: 'Stdio Process', status: 'Stopped', tools: 4 },
  ]

  return (
    <div className="space-y-3">
      {mcpList.map((mcp) => (
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
      ))}
    </div>
  )
}
