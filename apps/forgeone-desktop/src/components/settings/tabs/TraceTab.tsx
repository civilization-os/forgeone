import { Activity } from 'lucide-react'

export default function TraceTab() {
  // TODO: 接入真实 Trace 流（Trace System 结构化执行轨迹将实时展示在此）
  const traces: { time: string; event: string; detail: string }[] = []

  return (
    <div className="space-y-2.5">
      {traces.length === 0 ? (
        <div className="bg-white p-8 rounded-xl border border-[#E8E8E6] shadow-sm flex flex-col items-center justify-center gap-2 text-center">
          <Activity size={18} className="text-[#A1A1AA]" />
          <p className="text-xs text-[#76777B]">暂无 Trace 记录</p>
          <p className="text-[10px] text-[#A1A1AA] max-w-xs leading-relaxed">
            开始一次 Agent 任务后，结构化执行轨迹（LOOP / CONTEXT / TOOL_CALL / POLICY）将实时展示在此
          </p>
        </div>
      ) : (
        traces.map((item, idx) => (
          <div key={idx} className="bg-white p-2.5 rounded-lg border border-[#E8E8E6] shadow-sm flex items-center gap-2 text-xs">
            <span className="text-[10px] font-mono text-[#76777B] shrink-0">{item.time}</span>
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#F4F4F2] text-[#1A1C1B] font-semibold">
              {item.event}
            </span>
            <span className="text-[11px] text-[#46474A] font-mono truncate">{item.detail}</span>
          </div>
        ))
      )}
    </div>
  )
}
