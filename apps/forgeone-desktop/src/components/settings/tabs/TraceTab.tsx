export default function TraceTab() {
  const traces = [
    { time: '21:30:05', event: 'LOOP_START', detail: 'Loop #1 initialized for task "Fix TypeScript builds"' },
    { time: '21:30:06', event: 'CONTEXT_BUILD', detail: 'Snapshot created (1,420 tokens, 12 source files)' },
    { time: '21:30:08', event: 'MODEL_REQUEST', detail: 'Sent inference request to Anthropic Claude 3.5 Sonnet' },
    { time: '21:30:11', event: 'TOOL_CALL', detail: 'Tool: read_file(path: "apps/forgeone-desktop/src/App.tsx")' },
    { time: '21:30:12', event: 'POLICY_EVAL', detail: 'Policy: PASS (Read-only operation allowed)' },
  ]

  return (
    <div className="space-y-2.5">
      {traces.map((item, idx) => (
        <div key={idx} className="bg-white p-2.5 rounded-lg border border-[#E8E8E6] shadow-sm flex items-center gap-2 text-xs">
          <span className="text-[10px] font-mono text-[#76777B] shrink-0">{item.time}</span>
          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#F4F4F2] text-[#1A1C1B] font-semibold">
            {item.event}
          </span>
          <span className="text-[11px] text-[#46474A] font-mono truncate">{item.detail}</span>
        </div>
      ))}
    </div>
  )
}
