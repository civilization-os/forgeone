import {
  GitBranch,
  Folder,
  Zap,
  Cpu,
  Layers,
  Sparkles,
  Loader2,
} from 'lucide-react'
import type { ProjectInfo, RuntimeStats } from '../../types'

interface StatusBarProps {
  currentProject: ProjectInfo | null
  activeModel: string
  runtimeStats: RuntimeStats
  onOpenSettings?: () => void
  onOpenProjectModal?: () => void
}

export default function StatusBar({
  currentProject,
  activeModel,
  runtimeStats,
  onOpenSettings,
  onOpenProjectModal,
}: StatusBarProps) {
  const {
    contextUsedTokens,
    contextMaxTokens,
    tokensPerSecond,
    cacheHitRate,
    gitBranch,
    gitChangesCount = 0,
    isGenerating,
  } = runtimeStats

  // 计算上下文使用百分比
  const contextPercent = contextMaxTokens > 0
    ? Math.min(100, Math.round((contextUsedTokens / contextMaxTokens) * 100))
    : 0

  const formatTokens = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`
    if (num >= 1000) return `${(num / 1000).toFixed(1)}k`
    return `${num}`
  }

  return (
    <footer
      data-tauri-no-drag
      className="h-6 w-full bg-[#F0EFEB] border-t border-[#E2E3E1] px-3 flex items-center justify-between text-[11px] text-[#55575A] shrink-0 select-none z-40"
    >
      {/* Left items: Git Branch, Workspace Folder */}
      <div className="flex items-center gap-3 overflow-hidden">
        {/* Git Branch */}
        <button
          type="button"
          onClick={onOpenProjectModal}
          className="flex items-center gap-1 hover:text-[#1A1C1B] hover:bg-[#E4E4E0] px-1.5 py-0.5 rounded transition-colors cursor-pointer truncate"
          title={`Git 分支: ${gitBranch}${gitChangesCount > 0 ? ` (${gitChangesCount} 处本地改动)` : ''}`}
        >
          <GitBranch size={12} className="text-[#2D63ED] shrink-0" />
          <span className="font-mono truncate">{gitBranch || '—'}</span>
          {gitChangesCount > 0 && (
            <span className="text-[10px] text-amber-600 font-mono font-semibold">
              *{gitChangesCount}
            </span>
          )}
        </button>

        <span className="text-[#D0D1CD] shrink-0">|</span>

        {/* Workspace Directory */}
        <button
          type="button"
          onClick={onOpenProjectModal}
          className="flex items-center gap-1 hover:text-[#1A1C1B] hover:bg-[#E4E4E0] px-1.5 py-0.5 rounded transition-colors cursor-pointer truncate max-w-[280px]"
          title={currentProject ? `工作区路径: ${currentProject.path}` : '未绑定项目工作区 (点击关联)'}
        >
          <Folder size={12} className={currentProject ? 'text-[#2D63ED]' : 'text-[#8E9094]'} />
          <span className="truncate">
            {currentProject ? (
              <>
                <span className="font-medium text-[#1A1C1B]">{currentProject.name}</span>
                <span className="text-[#8E9094] font-mono ml-1 text-[10px]">({currentProject.path})</span>
              </>
            ) : (
              '未绑定目录 (通用模式)'
            )}
          </span>
        </button>
      </div>

      {/* Right items: Speed, Cache, Context usage, Model */}
      <div className="flex items-center gap-3 font-mono shrink-0">
        {/* Generation Speed / Tok/s */}
        <div
          className="flex items-center gap-1 hover:text-[#1A1C1B] px-1 py-0.5"
          title="大模型实时生成速度 (Tokens Per Second)"
        >
          <Zap size={11} className={isGenerating ? 'text-amber-500 animate-pulse' : 'text-[#8E9094]'} />
          <span>
            {tokensPerSecond > 0 ? `${tokensPerSecond.toFixed(1)} tok/s` : '0.0 tok/s'}
          </span>
        </div>

        <span className="text-[#D0D1CD]">|</span>

        {/* Prompt Cache Hit Percentage */}
        <div
          className="flex items-center gap-1 hover:text-[#1A1C1B] px-1 py-0.5"
          title="Prefix / Prompt Cache 缓存命中率"
        >
          <Sparkles size={11} className="text-[#2D63ED]" />
          <span>缓存命中: {cacheHitRate.toFixed(1)}%</span>
        </div>

        <span className="text-[#D0D1CD]">|</span>

        {/* Context Window Usage */}
        <div
          className="flex items-center gap-1.5 hover:text-[#1A1C1B] px-1 py-0.5"
          title={`上下文窗口使用量: ${contextUsedTokens.toLocaleString()} / ${contextMaxTokens.toLocaleString()} Tokens (${contextPercent}%)`}
        >
          <Layers size={11} className="text-[#8E9094]" />
          <span>
            {formatTokens(contextUsedTokens)} / {contextMaxTokens > 0 ? formatTokens(contextMaxTokens) : '—'}
          </span>
          {/* Mini Progress Bar（未知上下文上限时隐藏，不假装） */}
          {contextMaxTokens > 0 && (
            <div className="w-10 h-1.5 bg-[#D8D8D4] rounded-full overflow-hidden inline-flex">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  contextPercent > 80
                    ? 'bg-rose-500'
                    : contextPercent > 50
                    ? 'bg-amber-500'
                    : 'bg-[#2D63ED]'
                }`}
                style={{ width: `${Math.max(4, contextPercent)}%` }}
              />
            </div>
          )}
        </div>

        <span className="text-[#D0D1CD]">|</span>

        {/* Active Model Switcher / Display */}
        <button
          type="button"
          onClick={onOpenSettings}
          className="flex items-center gap-1 text-[#1A1C1B] font-semibold hover:bg-[#E4E4E0] px-1.5 py-0.5 rounded transition-colors cursor-pointer"
          title="当前执行大模型 (点击前往配置)"
        >
          <Cpu size={12} className="text-[#2D63ED]" />
          <span className="max-w-[140px] truncate">{activeModel || '未配置模型'}</span>
        </button>

        {/* Live Runtime Status dot */}
        <div className="flex items-center gap-1 pl-1" title={isGenerating ? 'Agent Loop 执行中...' : 'Runtime 就绪'}>
          {isGenerating ? (
            <Loader2 size={11} className="animate-spin text-[#2D63ED]" />
          ) : (
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          )}
        </div>
      </div>
    </footer>
  )
}
