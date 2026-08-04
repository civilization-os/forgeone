import React, { useMemo } from 'react'
import type { ChatMessage } from '../../types'
import { ExternalLink, Terminal, Brain, User, MessageSquare, CheckCircle2, Loader2, Play } from 'lucide-react'

export interface TimelineStepItem {
  id: string
  domId: string
  index: number
  type: 'user' | 'think' | 'tool' | 'text' | 'service'
  title: string
  subtitle?: string
  summary: string
  detectedUrls: string[]
  detectedFiles: string[]
  status: 'running' | 'success' | 'failed' | 'idle'
  isStreaming?: boolean
}

interface TimelineMinimapProps {
  messages: ChatMessage[]
  isGenerating?: boolean
  maxLimit?: number // 对话或步骤数上限，超过该数量则不展示（默认最大 15 条）
}

// 智能探测服务 URL 与健康检查端点 (支持 localhost, 127.0.0.1, 0.0.0.0 以及端口与路径)
function detectUrlsAndPorts(text: string): string[] {
  if (!text) return []
  const urlRegex = /(?:https?:\/\/)(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?(?:\/[^\s'"<>]*)?/gi
  const matches = text.match(urlRegex) || []
  return Array.from(new Set(matches))
}

// 智能探测文件路径
function detectFilePaths(text: string): string[] {
  if (!text) return []
  const fileRegex = /(?:[a-zA-Z0-9_\-\.]+\/)+[a-zA-Z0-9_\-\.]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|rs|py|go|html|css|md)/g
  const matches = text.match(fileRegex) || []
  return Array.from(new Set(matches)).slice(0, 3)
}

export const TimelineMinimap: React.FC<TimelineMinimapProps> = ({
  messages,
  isGenerating,
  maxLimit = 15,
}) => {
  // 从 messages 与 timeline blocks 抽取精炼的执行步骤列表
  const steps: TimelineStepItem[] = useMemo(() => {
    const list: TimelineStepItem[] = []
    let stepCount = 0

    messages.forEach((msg) => {
      if (msg.role === 'user') {
        stepCount++
        const userUrls = detectUrlsAndPorts(msg.content)
        const userFiles = detectFilePaths(msg.content)
        list.push({
          id: `step-user-${msg.id}`,
          domId: `msg-anchor-${msg.id}`,
          index: stepCount,
          type: 'user',
          title: '用户任务',
          subtitle: `第 ${stepCount} 轮任务输入`,
          summary: msg.content.slice(0, 80) + (msg.content.length > 80 ? '...' : ''),
          detectedUrls: userUrls,
          detectedFiles: userFiles,
          status: 'success',
        })
      }
    })

    return list
  }, [messages, isGenerating])

  // 点击刻度线平滑定位滚动
  const handleScrollToStep = (domId: string) => {
    const el = document.getElementById(domId)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.classList.add('ring-2', 'ring-[#2D63ED]/60', 'transition-all', 'duration-300')
      setTimeout(() => {
        el.classList.remove('ring-2', 'ring-[#2D63ED]/60')
      }, 1600)
    }
  }

  // 如果步骤为空，或者步骤/对话过多超过上限（默认 15 条），则不展示
  if (steps.length === 0 || steps.length > maxLimit) return null

  return (
    <div className="absolute right-2.5 top-20 bottom-28 w-9 flex flex-col items-center justify-center pointer-events-none z-30 select-none">
      {/* 纵向刻度胶囊条 (Vertical Minimap Track) */}
      <div className="flex flex-col items-center gap-1.5 p-1.5 rounded-full bg-[#1A1C1B]/5 hover:bg-[#1A1C1B]/15 border border-black/5 transition-all pointer-events-auto backdrop-blur-xs shadow-xs">
        {steps.map((step, idx) => {
          const isRunning = step.status === 'running' || step.isStreaming

          return (
            <div key={step.id} className="relative group/tick flex items-center justify-center">
              {/* 静默横条刻度按钮 (增加舒适的交互命中热区) */}
              <button
                type="button"
                onClick={() => handleScrollToStep(step.domId)}
                className="relative flex items-center justify-center w-6 h-4 cursor-pointer outline-none group"
                data-testid={`timeline-tick-${idx}`}
                title={`${step.title} (#${step.index})`}
              >
                <div
                  className={`transition-all duration-150 rounded-full ${
                    isRunning
                      ? 'w-3.5 h-1 bg-[#2D63ED] animate-pulse shadow-xs shadow-blue-500/50'
                      : step.type === 'service'
                      ? 'w-3 h-0.5 bg-emerald-600/80 group-hover/tick:w-4 group-hover/tick:h-1 group-hover/tick:bg-[#1A1C1B]'
                      : step.type === 'think'
                      ? 'w-2.5 h-0.5 bg-indigo-500/80 group-hover/tick:w-4 group-hover/tick:h-1 group-hover/tick:bg-[#1A1C1B]'
                      : step.type === 'tool'
                      ? 'w-3 h-0.5 bg-amber-500/80 group-hover/tick:w-4 group-hover/tick:h-1 group-hover/tick:bg-[#1A1C1B]'
                      : step.type === 'user'
                      ? 'w-3 h-0.5 bg-[#4A4C4D] group-hover/tick:w-4 group-hover/tick:h-1 group-hover/tick:bg-[#1A1C1B]'
                      : 'w-2.5 h-0.5 bg-[#76777B]/70 group-hover/tick:w-4 group-hover/tick:h-1 group-hover/tick:bg-[#1A1C1B]'
                  }`}
                />
              </button>

              {/* 悬浮气泡卡片 (Instant CSS Hover Popover Card) */}
              <div className="absolute right-7 top-1/2 -translate-y-1/2 opacity-0 pointer-events-none group-hover/tick:opacity-100 group-hover/tick:pointer-events-auto transition-all duration-150 scale-95 group-hover/tick:scale-100 z-50">
                <div className="bg-[#1A1C1B]/95 text-white border border-[#333534] rounded-2xl p-3.5 shadow-2xl backdrop-blur-md min-w-[240px] max-w-[320px] text-xs flex flex-col gap-2">
                  {/* Header: Title & Step Icon */}
                  <div className="flex items-center justify-between border-b border-[#2C2E2D] pb-1.5">
                    <div className="flex items-center gap-2">
                      {step.type === 'user' ? (
                        <User size={13} className="text-[#A0A2A1]" />
                      ) : step.type === 'think' ? (
                        <Brain size={13} className="text-[#818CF8]" />
                      ) : step.type === 'tool' ? (
                        <Terminal size={13} className="text-[#FBBF24]" />
                      ) : step.type === 'service' ? (
                        <Play size={13} className="text-emerald-400 fill-emerald-400" />
                      ) : (
                        <MessageSquare size={13} className="text-[#60A5FA]" />
                      )}
                      <span className="font-semibold text-[13px] text-white tracking-tight">
                        {step.title}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      {step.status === 'running' ? (
                        <span className="flex items-center gap-1 text-[10px] text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded font-mono">
                          <Loader2 size={10} className="animate-spin" /> 执行中
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-[10px] text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded font-mono">
                          <CheckCircle2 size={10} /> Step {step.index}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Subtitle / Status Lead (如 "已在后台启动完成：") */}
                  {step.subtitle && (
                    <div className="text-[11px] text-[#A0A2A1] font-medium leading-tight">
                      {step.subtitle}
                    </div>
                  )}

                  {/* Detected Local Services / URLs (如 前端: http://localhost:3000) */}
                  {step.detectedUrls.length > 0 && (
                    <div className="space-y-1.5 pt-0.5">
                      {step.detectedUrls.map((url, uIdx) => (
                        <div key={uIdx} className="flex items-start gap-1.5 text-[11px]">
                          <span className="text-[#76777B] select-none">•</span>
                          <span className="text-[#D1D5DB] font-medium shrink-0">
                            {url.includes(':3000') || url.includes(':5173') || url.includes(':1420')
                              ? '前端：'
                              : url.includes('health') || url.includes('api')
                              ? '后端健康检查：'
                              : '服务地址：'}
                          </span>
                          <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[#60A5FA] hover:text-[#93C5FD] hover:underline flex items-center gap-1 font-mono truncate max-w-[170px]"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <span className="truncate">{url}</span>
                            <ExternalLink size={10} className="shrink-0" />
                          </a>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Detected Files (如 server/tests/chapter_tool_library.mjs) */}
                  {step.detectedFiles.length > 0 && step.detectedUrls.length === 0 && (
                    <div className="space-y-1 pt-0.5">
                      {step.detectedFiles.map((file, fIdx) => (
                        <div key={fIdx} className="flex items-center gap-1.5 text-[11px] text-[#9CA3AF] font-mono truncate">
                          <span className="text-[#76777B] select-none">•</span>
                          <span className="truncate">{file}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Summary Text (When no URLs) */}
                  {step.detectedUrls.length === 0 && step.detectedFiles.length === 0 && step.summary && (
                    <div className="text-[11px] text-[#9CA3AF] leading-relaxed line-clamp-3">
                      {step.summary}
                    </div>
                  )}

                  {/* Footer Prompt */}
                  <div className="pt-1.5 border-t border-[#2D2F30] text-[10px] text-[#76777B] flex items-center justify-between">
                    <span>点击直接定位</span>
                    <span className="font-mono text-[#A0A2A1]">#{step.domId}</span>
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
