import { useState } from 'react'
import { Shield, ShieldAlert, FolderLock, Terminal, CheckCircle2, AlertCircle, FolderPlus } from 'lucide-react'

interface PolicyTabProps {
  currentProject?: string | null
}

export default function PolicyTab({ currentProject: initialProject = 'd:\\project\\forgeone' }: PolicyTabProps) {
  const [activeProject, setActiveProject] = useState<string | null>(initialProject)
  const [approvalMode, setApprovalMode] = useState<'strict' | 'auto_safe' | 'autonomous'>('strict')
  const [globalSandbox, setGlobalSandbox] = useState(true)
  const [projectSandbox, setProjectSandbox] = useState(true)
  const [allowedCommands, setAllowedCommands] = useState('cargo check, cargo test, npm run build, git status')

  return (
    <div className="space-y-4">
      {/* 1. 全局通用权限策略 (Global Policy Rules) */}
      <div className="bg-white p-4 rounded-xl border border-[#E8E8E6] shadow-sm space-y-3.5">
        <div className="flex items-center justify-between pb-2 border-b border-[#F4F4F2]">
          <div className="flex items-center gap-2">
            <Shield size={16} className="text-[#2D63ED]" />
            <h5 className="text-xs font-semibold text-[#1A1C1B]">🌐 全局通用权限策略 (Global Policy Rules)</h5>
          </div>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#F4F4F2] text-[#76777B]">
            Global Base Level
          </span>
        </div>

        {/* 拦截模式 */}
        <div>
          <label className="text-[11px] font-medium text-[#76777B] mb-1.5 block">全局工具拦截模式</label>
          <div className="grid grid-cols-3 gap-2">
            {[
              { id: 'strict', title: 'Strict 严格模式', desc: '高危命令与写文件强制审批' },
              { id: 'auto_safe', title: 'Auto-Safe 半自动', desc: '低危只读工具自动授权' },
              { id: 'autonomous', title: 'Autonomous 放行', desc: '极速自动执行无需手动确认' },
            ].map((mode) => (
              <button
                key={mode.id}
                onClick={() => setApprovalMode(mode.id as any)}
                className={`p-2.5 rounded-lg border text-left transition-all ${
                  approvalMode === mode.id
                    ? 'border-[#1A1C1B] bg-[#F9F9F7] ring-1 ring-[#1A1C1B]'
                    : 'border-[#E2E3E1] hover:bg-[#F4F4F2]'
                }`}
              >
                <div className="text-xs font-semibold text-[#1A1C1B]">{mode.title}</div>
                <p className="text-[10px] text-[#76777B] mt-0.5">{mode.desc}</p>
              </button>
            ))}
          </div>
        </div>

        <div className="pt-2 flex items-center justify-between">
          <div>
            <h6 className="text-xs font-semibold text-[#1A1C1B]">全局系统黑名单隔离</h6>
            <p className="text-[10px] text-[#76777B]">底线防护：严禁 Agent 访问 C:\Windows 或系统环境变量敏感区</p>
          </div>
          <input
            type="checkbox"
            checked={globalSandbox}
            onChange={(e) => setGlobalSandbox(e.target.checked)}
            className="w-4 h-4 accent-[#1A1C1B]"
          />
        </div>
      </div>

      {/* 2. 项目级专属权限策略 (Project-Scoped Policy) */}
      <div className="bg-white p-4 rounded-xl border border-[#E8E8E6] shadow-sm space-y-3.5">
        <div className="flex items-center justify-between pb-2 border-b border-[#F4F4F2]">
          <div className="flex items-center gap-2">
            <FolderLock size={16} className="text-amber-600" />
            <h5 className="text-xs font-semibold text-[#1A1C1B]">📂 项目级专属权限策略 (Project-Scoped Policy)</h5>
          </div>

          {/* 切换模拟项目选择逻辑 */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setActiveProject(activeProject ? null : 'd:\\project\\forgeone')}
              className="text-[10px] font-mono px-2 py-0.5 rounded border border-[#E8E8E6] bg-[#FAF9F7] hover:bg-[#EEEEEC] text-[#46474A] transition-colors"
            >
              {activeProject ? '模拟断开项目' : '模拟选择项目'}
            </button>

            {activeProject && (
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#FEF3C7] text-[#D97706] font-medium">
                .agents/AGENTS.md
              </span>
            )}
          </div>
        </div>

        {/* 条件渲染：未选择项目 vs 已选择项目 */}
        {activeProject ? (
          <div className="space-y-3.5 animate-in fade-in duration-150">
            <p className="text-[11px] text-[#76777B]">
              已绑定项目：<span className="font-mono font-semibold text-[#1A1C1B]">{activeProject}</span>
            </p>

            {/* 项目沙箱隔离 */}
            <div className="p-3 rounded-lg bg-[#FAF9F7] border border-[#E8E8E6] space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShieldAlert size={14} className="text-amber-600" />
                  <span className="text-xs font-medium text-[#1A1C1B]">项目文件读写越界拦截</span>
                </div>
                <input
                  type="checkbox"
                  checked={projectSandbox}
                  onChange={(e) => setProjectSandbox(e.target.checked)}
                  className="w-4 h-4 accent-[#1A1C1B]"
                />
              </div>
              <p className="text-[10px] text-[#76777B]">
                开启后，Agent Loop 被严格限定在项目根目录内，任何向上递归访问父目录的 Tool 请求将被自动阻断。
              </p>
            </div>

            {/* 项目白名单命令 */}
            <div>
              <label className="text-[11px] font-medium text-[#76777B] mb-1.5 flex items-center gap-1">
                <Terminal size={12} />
                <span>当前项目 Shell 命令允许白名单 (Comma-separated)</span>
              </label>
              <input
                type="text"
                value={allowedCommands}
                onChange={(e) => setAllowedCommands(e.target.value)}
                className="w-full px-3 py-1.5 rounded-lg border border-[#E2E3E1] text-xs font-mono bg-white focus:outline-none focus:border-[#1A1C1B]"
              />
            </div>

            <div className="flex items-center gap-2 pt-1 text-[11px] text-[#76777B]">
              <CheckCircle2 size={13} className="text-emerald-600 shrink-0" />
              <span>项目级规则变更将自动同步至当前 Workspace 策略存储</span>
            </div>
          </div>
        ) : (
          /* 未选择项目时的空状态 (Empty State) */
          <div className="p-5 rounded-xl border border-dashed border-[#CBD5E1] bg-[#F8FAFC] flex flex-col items-center justify-center text-center space-y-2.5 my-2">
            <div className="w-9 h-9 rounded-full bg-[#E2E8F0] flex items-center justify-center text-[#64748B]">
              <AlertCircle size={20} />
            </div>
            <div>
              <h6 className="text-xs font-semibold text-[#1E293B]">当前未关联任何本地项目 (No Active Project)</h6>
              <p className="text-[11px] text-[#64748B] max-w-[380px] mt-1 leading-relaxed">
                目前处于通用对话模式。项目专属沙箱与 Shell 白名单未激活，此时系统由上方【🌐 全局通用权限策略】全程防护。
              </p>
            </div>

            <button
              onClick={() => setActiveProject('d:\\project\\forgeone')}
              className="mt-1 px-3 py-1.5 rounded-lg bg-[#1A1C1B] hover:bg-[#2F3130] text-white text-xs font-medium transition-all flex items-center gap-1.5 shadow-sm cursor-pointer"
            >
              <FolderPlus size={14} />
              <span>绑定当前 Workspace (forgeone)</span>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
