import { Fragment, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ChevronDown,
  ChevronRight,
  Folder,
  MessageSquare,
  Plus,
  Search,
  Bell,
  Settings,
  FolderPlus,
  Trash2,
  Pin,
  PinOff,
} from 'lucide-react'
import type { TabType, ProjectInfo, ChatSession } from '../../types'

interface SidebarProps {
  activeTab: TabType
  setActiveTab: (tab: TabType) => void
  projects?: ProjectInfo[]
  currentProject?: ProjectInfo | null
  onSelectProject?: (project: ProjectInfo | null) => void
  onNewSessionForProject?: (project: ProjectInfo) => void
  onOpenProjectModal?: () => void
  onRemoveProject?: (projId: string) => void
  onTogglePinProject?: (projId: string) => void
  sessions?: ChatSession[]
  currentSessionId?: string | null
  onSelectSession?: (sessionId: string) => void
  onTogglePinSession?: (sessionId: string) => void
  onDeleteSession?: (sessionId: string) => void
  onOpenSettings: () => void
  onNewChat?: () => void
  isConnected: boolean
}

export default function Sidebar({
  activeTab,
  setActiveTab,
  projects = [],
  currentProject = null,
  onSelectProject,
  onNewSessionForProject,
  onOpenProjectModal,
  onRemoveProject,
  onTogglePinProject,
  sessions = [],
  currentSessionId = null,
  onSelectSession,
  onTogglePinSession,
  onDeleteSession,
  onOpenSettings,
  onNewChat,
  isConnected,
}: SidebarProps) {
  const { t, i18n } = useTranslation()

  // 树状展开/折叠状态
  const [pinnedOpen, setPinnedOpen] = useState(true)
  const [projectsOpen, setProjectsOpen] = useState(true)
  const [recentsOpen, setRecentsOpen] = useState(true)
  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<string>>(new Set())
  // 删除二次确认：记录处于"确认删除"态的项目 id（再点一次才真正移除）
  const [confirmRemoveProjectId, setConfirmRemoveProjectId] = useState<string | null>(null)
  // 会话删除二次确认
  const [confirmRemoveSessionId, setConfirmRemoveSessionId] = useState<string | null>(null)
  // 展开更多项目/会话
  const [showAllProjects, setShowAllProjects] = useState(false)
  const [showAllRecents, setShowAllRecents] = useState(false)

  const toggleProjectExpand = (projectId: string) => {
    setExpandedProjectIds((prev) => {
      const next = new Set(prev)
      if (next.has(projectId)) {
        next.delete(projectId)
      } else {
        next.add(projectId)
      }
      return next
    })
  }
  const toggleLanguage = () => {
    i18n.changeLanguage(i18n.language.startsWith('zh') ? 'en' : 'zh')
  }

  // 过滤置顶的项目与会话
  const pinnedProjects = projects.filter((p) => p.isPinned)
  const pinnedSessions = sessions.filter((s) => s.isPinned)
  const hasPinnedItems = pinnedProjects.length > 0 || pinnedSessions.length > 0

  // 过滤最近未置顶会话（按最后消息活动时间降序）
  const recentSessions = sessions
    .filter((s) => !s.isPinned)
    .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))

  return (
    <aside className="w-[260px] bg-[#F4F4F2] border-r border-[#E8E8E6] flex flex-col justify-between p-3 shrink-0 select-none overflow-hidden text-[#1A1C1B]">
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header Title & Actions (Codex Style) */}
        <div className="flex items-center justify-between px-2 py-2 mb-3">
          <div className="flex items-center gap-1 cursor-pointer hover:bg-[#EEEEEC] px-1.5 py-1 rounded-md transition-colors">
            <span className="font-bold text-sm tracking-tight text-[#1A1C1B]">ForgeOne</span>
            <ChevronDown size={14} className="text-[#76777B]" />
          </div>

          <div className="flex items-center gap-1 text-[#76777B]">
            <button className="p-1 hover:bg-[#EEEEEC] hover:text-[#1A1C1B] rounded transition-colors" title="搜索">
              <Search size={15} />
            </button>
            <button className="p-1 hover:bg-[#EEEEEC] hover:text-[#1A1C1B] rounded transition-colors" title="通知">
              <Bell size={15} />
            </button>
          </div>
        </div>

        {/* Action: 新对话 (New Chat) */}
        <button
          type="button"
          onClick={() => {
            setActiveTab('chat')
            onNewChat?.()
          }}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg bg-white border border-[#E2E3E1] text-xs font-semibold text-[#1A1C1B] shadow-xs hover:bg-[#EEEEEC] transition-all mb-4 cursor-pointer"
        >
          <Plus size={16} className="text-[#1A1C1B]" />
          <span>新对话</span>
        </button>

        {/* Scrollable Tree Sections (置顶, 项目, 最近) */}
        <div className="flex-1 overflow-y-auto space-y-4 pr-1 custom-scrollbar text-xs">
          {/* Section 1: 置顶 (Pinned) */}
          <div>
            <button
              type="button"
              onClick={() => setPinnedOpen(!pinnedOpen)}
              className="w-full flex items-center gap-1.5 px-2 py-1 text-[#76777B] hover:text-[#1A1C1B] font-semibold text-[11px] transition-colors cursor-pointer"
            >
              {pinnedOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              <span>置顶</span>
            </button>

            {pinnedOpen && (
              <div className="mt-1 space-y-0.5 pl-1">
                {!hasPinnedItems ? (
                  <div className="px-2 py-1 text-[11px] text-[#A1A1AA]">
                    暂无置顶（点击项目或会话右侧 📌 置顶）
                  </div>
                ) : (
                  <>
                    {/* Pinned Projects */}
                    {pinnedProjects.map((p) => {
                      const isSelected = currentProject?.id === p.id
                      return (
                        <div
                          key={`pinned-proj-${p.id}`}
                          onMouseLeave={() => setConfirmRemoveProjectId(null)}
                          className={`group relative flex items-center justify-between px-2 py-1.5 rounded-md text-xs transition-colors ${isSelected
                            ? 'bg-white text-[#1A1C1B] font-medium shadow-xs border border-[#E2E3E1]'
                            : 'text-[#46474A] hover:bg-[#EEEEEC] hover:text-[#1A1C1B]'
                            }`}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              onSelectProject?.(p)
                              setActiveTab('chat')
                            }}
                            className="flex-1 flex items-center gap-2 truncate text-left cursor-pointer mr-1"
                            title={`置顶项目: ${p.name} (${p.path})`}
                          >
                            <Folder size={14} className={isSelected ? 'text-[#2D63ED]' : 'text-[#76777B]'} />
                            <span className="truncate">{p.name}</span>
                          </button>

                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                setActiveTab('chat')
                                onNewSessionForProject?.(p)
                              }}
                              className="p-0.5 rounded text-[#76777B] hover:text-[#2D63ED] hover:bg-blue-50 transition-colors cursor-pointer"
                              title={`在 ${p.name} 下新建会话`}
                            >
                              <Plus size={11} />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                onTogglePinProject?.(p.id)
                              }}
                              className="p-0.5 rounded text-[#2D63ED] hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                              title="取消置顶"
                            >
                              <PinOff size={11} />
                            </button>
                            {confirmRemoveProjectId === p.id ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setConfirmRemoveProjectId(null)
                                  onRemoveProject?.(p.id)
                                }}
                                className="px-1.5 py-0.5 rounded bg-rose-500 hover:bg-rose-600 text-white text-[10px] font-medium transition-all cursor-pointer"
                                title="再次点击确认移除该项目"
                              >
                                确认
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setConfirmRemoveProjectId(p.id)
                                }}
                                className="p-0.5 rounded text-[#76777B] hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                                title="移除该项目"
                              >
                                <Trash2 size={11} />
                              </button>
                            )}
                          </div>
                        </div>
                      )
                    })}

                    {/* Pinned Sessions */}
                    {pinnedSessions.map((s) => {
                      const isSelected = activeTab === 'chat' && currentSessionId === s.id
                      return (
                        <div
                          key={`pinned-sess-${s.id}`}
                          className={`group relative flex items-center justify-between px-2 py-1.5 rounded-md text-xs transition-colors ${isSelected
                            ? 'bg-white text-[#1A1C1B] font-medium shadow-xs border border-[#E2E3E1]'
                            : 'text-[#46474A] hover:bg-[#EEEEEC] hover:text-[#1A1C1B]'
                            }`}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              onSelectSession?.(s.id)
                              setActiveTab('chat')
                            }}
                            className="flex-1 flex items-center gap-2 truncate text-left cursor-pointer mr-1"
                            title={`置顶会话: ${s.title}`}
                          >
                            <MessageSquare size={13} className={isSelected ? 'text-[#2D63ED]' : 'text-[#76777B]'} />
                            <span className="truncate">{s.title}</span>
                          </button>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                onTogglePinSession?.(s.id)
                              }}
                              className="p-0.5 rounded text-[#2D63ED] hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                              title="取消置顶"
                            >
                              <PinOff size={11} />
                            </button>
                            {/* 未读新消息蓝点：点击后即消除 */}
                            {s.hasUnread && !isSelected && (
                              <span className="w-1.5 h-1.5 rounded-full bg-[#2D63ED] shrink-0 animate-pulse" title="未读新消息" />
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </>
                )}
              </div>
            )}
          </div>

          {/* Section 2: 项目 (Projects) */}
          <div>
            <div className="flex items-center justify-between px-2 py-1">
              <button
                type="button"
                onClick={() => setProjectsOpen(!projectsOpen)}
                className="flex items-center gap-1.5 text-[#76777B] hover:text-[#1A1C1B] font-semibold text-[11px] transition-colors cursor-pointer"
              >
                {projectsOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                <span>项目</span>
              </button>

              <button
                type="button"
                onClick={onOpenProjectModal}
                className="p-0.5 rounded text-[#76777B] hover:text-[#1A1C1B] hover:bg-[#EEEEEC] transition-colors cursor-pointer"
                title="选择/关联新本地文件夹"
              >
                <FolderPlus size={13} />
              </button>
            </div>

            {projectsOpen && (
              <div className="mt-1 space-y-0.5 pl-1">
                {projects.length === 0 ? (
                  <div className="px-2 py-1 text-[11px] text-[#A1A1AA]">
                    暂无项目，点击 + 关联本地文件夹
                  </div>
                ) : (
                  <>
                    {(showAllProjects ? projects : projects.slice(0, 5)).map((item) => {
                      const isSelected = currentProject?.id === item.id
                      const projectSessions = sessions
                        .filter((s) => s.projectId === item.id)
                        .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0))
                      return (
                        <Fragment key={item.id}>
                          <div
                            onMouseLeave={() => setConfirmRemoveProjectId(null)}
                            className={`group relative flex items-center justify-between px-2 py-1.5 rounded-md text-xs transition-colors ${isSelected
                              ? 'bg-white text-[#1A1C1B] font-medium shadow-xs border border-[#E2E3E1]'
                              : 'text-[#46474A] hover:bg-[#EEEEEC] hover:text-[#1A1C1B]'
                              }`}
                          >
                            {/* 展开/收起该项目的会话列表 */}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                toggleProjectExpand(item.id)
                              }}
                              className="p-0.5 rounded text-[#76777B] hover:text-[#1A1C1B] hover:bg-[#EAEAE8] transition-colors cursor-pointer shrink-0"
                              title={expandedProjectIds.has(item.id) ? '收起该项目的会话' : '展开该项目的会话'}
                            >
                              {expandedProjectIds.has(item.id) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                            </button>

                            {/* 选中项目 */}
                            <button
                              type="button"
                              onClick={() => {
                                onSelectProject?.(item)
                                setActiveTab('chat')
                              }}
                              className="flex-1 flex items-center gap-2 truncate text-left cursor-pointer min-w-0"
                              title={`${item.name} (${item.path})`}
                            >
                              <Folder size={14} className={isSelected ? 'text-[#2D63ED]' : 'text-[#76777B]'} />
                              <span className="truncate">{item.name}</span>
                            </button>

                            <div className="flex items-center gap-1 shrink-0">
                              {/* 在该项目下新建会话 */}
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setActiveTab('chat')
                                  onNewSessionForProject?.(item)
                                }}
                                className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-[#76777B] hover:text-[#2D63ED] hover:bg-blue-50 transition-all cursor-pointer"
                                title={`在 ${item.name} 下新建会话`}
                              >
                                <Plus size={11} />
                              </button>

                              {/* Pin / Unpin Project Button */}
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  onTogglePinProject?.(item.id)
                                }}
                                className={`p-0.5 rounded transition-all cursor-pointer ${item.isPinned
                                  ? 'text-[#2D63ED] hover:bg-blue-50'
                                  : 'opacity-0 group-hover:opacity-100 text-[#76777B] hover:text-[#1A1C1B] hover:bg-[#EAEAE8]'
                                  }`}
                                title={item.isPinned ? '取消置顶' : '置顶此项目'}
                              >
                                <Pin size={11} className={item.isPinned ? 'fill-current' : ''} />
                              </button>

                              {/* 移除项目引用（不删除本地文件），点击两次确认 */}
                              {confirmRemoveProjectId === item.id ? (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setConfirmRemoveProjectId(null)
                                    onRemoveProject?.(item.id)
                                  }}
                                  className="px-1.5 py-0.5 rounded bg-rose-500 hover:bg-rose-600 text-white text-[10px] font-medium transition-all cursor-pointer"
                                  title="再次点击确认移除该项目"
                                >
                                  确认
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    setConfirmRemoveProjectId(item.id)
                                  }}
                                  className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:text-rose-600 hover:bg-rose-50 transition-all cursor-pointer"
                                  title="移除该项目"
                                >
                                  <Trash2 size={11} />
                                </button>
                              )}
                            </div>
                          </div>

                          {/* 该项目的会话子列表 */}
                          {expandedProjectIds.has(item.id) && (
                            <div className="ml-3 mt-0.5 space-y-0.5 border-l border-[#E8E8E6] pl-2 pb-0.5">
                              {projectSessions.length === 0 ? (
                                <div className="px-2 py-1 text-[11px] text-[#A1A1AA]">暂无会话</div>
                              ) : (
                                projectSessions.map((s) => {
                                  const isSessionSelected = activeTab === 'chat' && currentSessionId === s.id
                                  return (
                                    <div
                                      key={s.id}
                                      onMouseLeave={() => setConfirmRemoveSessionId(null)}
                                      className={`group/sess relative flex items-center justify-between px-2 py-1 rounded-md text-[11px] transition-colors ${isSessionSelected
                                        ? 'bg-white text-[#1A1C1B] font-medium shadow-xs border border-[#E2E3E1]'
                                        : 'text-[#46474A] hover:bg-[#EEEEEC] hover:text-[#1A1C1B]'
                                        }`}
                                    >
                                      <button
                                        type="button"
                                        onClick={() => {
                                          onSelectSession?.(s.id)
                                          setActiveTab('chat')
                                        }}
                                        className="flex-1 flex items-center gap-1.5 truncate text-left cursor-pointer mr-1 min-w-0"
                                        title={s.title}
                                      >
                                        <MessageSquare size={11} className={isSessionSelected ? 'text-[#2D63ED]' : 'text-[#76777B]'} />
                                        <span className="truncate">{s.title}</span>
                                        {s.isPinned && (
                                          <Pin size={10} className="text-[#2D63ED] fill-current shrink-0" />
                                        )}
                                      </button>

                                      <div className="flex items-center gap-1 shrink-0">
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            onTogglePinSession?.(s.id)
                                          }}
                                          className="opacity-0 group-hover/sess:opacity-100 p-0.5 rounded text-[#76777B] hover:text-[#2D63ED] hover:bg-blue-50 transition-all cursor-pointer"
                                          title="置顶此会话"
                                        >
                                          <Pin size={11} />
                                        </button>
                                        {confirmRemoveSessionId === s.id ? (
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation()
                                              setConfirmRemoveSessionId(null)
                                              onDeleteSession?.(s.id)
                                            }}
                                            className="px-1.5 py-0.5 rounded bg-rose-500 hover:bg-rose-600 text-white text-[10px] font-medium transition-all cursor-pointer"
                                            title="再次点击确认删除该会话"
                                          >
                                            确认
                                          </button>
                                        ) : (
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation()
                                              setConfirmRemoveSessionId(s.id)
                                            }}
                                            className="opacity-0 group-hover/sess:opacity-100 p-0.5 rounded text-[#76777B] hover:text-rose-600 hover:bg-rose-50 transition-all cursor-pointer"
                                            title="删除会话"
                                          >
                                            <Trash2 size={11} />
                                          </button>
                                        )}
                                        {s.hasUnread && !isSessionSelected && (
                                          <span className="w-1.5 h-1.5 rounded-full bg-[#2D63ED] shrink-0 animate-pulse" title="未读新消息" />
                                        )}
                                      </div>
                                    </div>
                                  )
                                })
                              )}
                            </div>
                          )}
                        </Fragment>
                      )
                    })}

                    {projects.length > 5 && (
                      <button
                        type="button"
                        onClick={() => setShowAllProjects(!showAllProjects)}
                        className="w-full text-left px-2 py-1 text-[11px] font-medium text-[#76777B] hover:text-[#1A1C1B] transition-colors cursor-pointer"
                      >
                        {showAllProjects ? '收起' : `展开显示全部 (${projects.length})`}
                      </button>
                    )}
                  </>
                )}

                <button
                  type="button"
                  onClick={onOpenProjectModal}
                  className="w-full flex items-center gap-1.5 px-2 py-1.5 mt-1 rounded-md text-[11px] text-[#76777B] hover:text-[#2D63ED] hover:bg-[#EBF3FF] transition-all cursor-pointer"
                >
                  <FolderPlus size={13} />
                  <span>+ 关联新文件夹...</span>
                </button>
              </div>
            )}
          </div>

          {/* Section 3: 最近 (Recent Sessions) */}
          <div>
            <button
              type="button"
              onClick={() => setRecentsOpen(!recentsOpen)}
              className="w-full flex items-center gap-1.5 px-2 py-1 text-[#76777B] hover:text-[#1A1C1B] font-semibold text-[11px] transition-colors cursor-pointer"
            >
              {recentsOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              <span>最近</span>
            </button>

            {recentsOpen && (
              <div className="mt-1 space-y-0.5 pl-1">
                {recentSessions.length === 0 ? (
                  <div className="px-2 py-1 text-[11px] text-[#A1A1AA]">
                    暂无历史会话（点击上方「新对话」开始）
                  </div>
                ) : (
                  <>
                    {(showAllRecents ? recentSessions : recentSessions.slice(0, 8)).map((s) => {
                      const isSelected = activeTab === 'chat' && currentSessionId === s.id
                      return (
                        <div
                          key={s.id}
                          onMouseLeave={() => setConfirmRemoveSessionId(null)}
                          className={`group relative flex items-center justify-between px-2 py-1.5 rounded-md text-xs transition-colors ${isSelected
                            ? 'bg-white text-[#1A1C1B] font-medium shadow-xs border border-[#E2E3E1]'
                            : 'text-[#46474A] hover:bg-[#EEEEEC] hover:text-[#1A1C1B]'
                            }`}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              onSelectSession?.(s.id)
                              setActiveTab('chat')
                            }}
                            className="flex-1 flex items-center gap-2 truncate text-left cursor-pointer mr-1"
                            title={s.title}
                          >
                            <MessageSquare size={13} className={isSelected ? 'text-[#2D63ED]' : 'text-[#76777B]'} />
                            <span className="truncate">{s.title}</span>
                          </button>

                          <div className="flex items-center gap-1.5 shrink-0">
                            {/* Project Tag if session has project */}
                            {s.projectName && (
                              <span className="text-[9px] px-1 py-0.2 rounded bg-[#EAEAE8] text-[#76777B] font-mono group-hover:hidden">
                                {s.projectName}
                              </span>
                            )}

                            {/* Pin session button */}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                onTogglePinSession?.(s.id)
                              }}
                              className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-[#76777B] hover:text-[#2D63ED] hover:bg-blue-50 transition-all cursor-pointer"
                              title="置顶此会话"
                            >
                              <Pin size={11} />
                            </button>

                            {/* Delete session button（二次确认） */}
                            {confirmRemoveSessionId === s.id ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setConfirmRemoveSessionId(null)
                                  onDeleteSession?.(s.id)
                                }}
                                className="px-1.5 py-0.5 rounded bg-rose-500 hover:bg-rose-600 text-white text-[10px] font-medium transition-all cursor-pointer"
                                title="再次点击确认删除该会话"
                              >
                                确认
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setConfirmRemoveSessionId(s.id)
                                }}
                                className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-[#76777B] hover:text-rose-600 hover:bg-rose-50 transition-all cursor-pointer"
                                title="删除会话"
                              >
                                <Trash2 size={11} />
                              </button>
                            )}

                            {/* 未读新消息蓝点：点击后即消除 */}
                            {s.hasUnread && !isSelected && (
                              <span className="w-1.5 h-1.5 rounded-full bg-[#2D63ED] shrink-0 animate-pulse" title="未读新消息" />
                            )}
                          </div>
                        </div>
                      )
                    })}

                    {recentSessions.length > 8 && (
                      <button
                        type="button"
                        onClick={() => setShowAllRecents(!showAllRecents)}
                        className="w-full text-left px-2 py-1 text-[11px] font-medium text-[#76777B] hover:text-[#1A1C1B] transition-colors cursor-pointer"
                      >
                        {showAllRecents ? '收起' : `展开显示全部 (${recentSessions.length})`}
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Footer Actions (Settings & Locale) */}
      <div className="pt-2 border-t border-[#E8E8E6] flex items-center justify-between">
        <button
          type="button"
          onClick={onOpenSettings}
          className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs font-medium text-[#46474A] hover:text-[#1A1C1B] hover:bg-[#EEEEEC] transition-colors cursor-pointer"
        >
          <Settings size={15} />
          <span>{t('settings.title')}</span>
        </button>

        <div className="flex items-center gap-2">
          {/* Status Indicator */}
          <div
            className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-500 shadow-xs' : 'bg-rose-500'}`}
            title={isConnected ? 'Runtime 核心已连接' : 'Runtime 未连接'}
          />

          <button
            type="button"
            onClick={toggleLanguage}
            className="text-[11px] font-mono font-medium text-[#76777B] hover:text-[#1A1C1B] px-1.5 py-0.5 rounded hover:bg-[#EEEEEC] transition-colors cursor-pointer"
          >
            {i18n.language.startsWith('zh') ? 'EN' : '中'}
          </button>
        </div>
      </div>
    </aside>
  )
}
