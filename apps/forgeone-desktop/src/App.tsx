import { useState, useEffect } from 'react'

// 启动时彻底清除旧版 localStorage 脏数据，强制使用 v4/v5 干净数据
;['forgeone_model_providers_v1', 'forgeone_model_providers_v2', 'forgeone_model_providers_v3'].forEach((k) =>
  localStorage.removeItem(k)
)
import CustomHeader from './components/header/CustomHeader'
import Sidebar from './components/sidebar/Sidebar'
import ChatCanvas from './components/chat/ChatCanvas'
import ProjectView from './components/project/ProjectView'
import SettingsModal from './components/settings/SettingsModal'
import OpenProjectModal from './components/project/OpenProjectModal'
import StatusBar from './components/statusbar/StatusBar'
import type { TabType, SettingsTabType, ProjectInfo, ChatSession, ChatMessage, RuntimeStats } from './types'
import { load, getSync, setSync } from './lib/store'

const STORAGE_PROJECTS_KEY = 'forgeone_custom_projects_v2'
const STORAGE_SESSIONS_KEY = 'forgeone_sessions_v1'

// 旧版本内置的预置项目 id（用于清理用户 localStorage 中的残留，彻底移除内置项目）
const PRESET_PROJECT_IDS = new Set(['forgeone', 'aischool', 'component-one', 'langgraph-flow', 'claude-cli-plugins', 'forgeone-web'])

export default function App() {
  const [activeTab, setActiveTab] = useState<TabType>('chat')
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsTabType>('model')
  const [isConnected] = useState(true)
  const [activeModel, setActiveModel] = useState('')
  const [chatSessionKey, setChatSessionKey] = useState(0)
  const [currentProject, setCurrentProject] = useState<ProjectInfo | null>(null)
  const [isOpenProjectModalOpen, setIsOpenProjectModalOpen] = useState(false)

  // 项目列表（标准桌面存储：app_config_dir 文件；启动时异步加载）
  const [projects, setProjects] = useState<ProjectInfo[]>([])

  // 会话列表（标准桌面存储：app_config_dir 文件；启动时异步加载）
  const [sessions, setSessions] = useState<ChatSession[]>([])

  // 启动时从文件存储载入项目与会话；旧 localStorage 数据由 store 自动迁移
  const [storeLoaded, setStoreLoaded] = useState(false)
  useEffect(() => {
    load().then(() => {
      const savedProjects = getSync<ProjectInfo[]>(STORAGE_PROJECTS_KEY)
      if (Array.isArray(savedProjects)) {
        // 过滤掉旧版内置预置项目残留，只保留用户自己关联的项目
        setProjects(savedProjects.filter((p) => !PRESET_PROJECT_IDS.has(p.id)))
      }
      const savedSessions = getSync<ChatSession[]>(STORAGE_SESSIONS_KEY)
      if (Array.isArray(savedSessions)) {
        setSessions(savedSessions)
      }
      setStoreLoaded(true)
    })
  }, [])

  useEffect(() => {
    if (!storeLoaded) return
    try {
      setSync(STORAGE_PROJECTS_KEY, projects)
    } catch (e) {}
  }, [projects, storeLoaded])

  useEffect(() => {
    if (sessions.length === 0) return
    // 防抖：流式生成期间高频 setSessions，停止写入后 500ms 才持久化一次
    const timer = setTimeout(() => {
      try {
        setSync(STORAGE_SESSIONS_KEY, sessions)
      } catch (e) {
        console.warn('[App] 会话存储失败:', e)
      }
    }, 500)
    return () => clearTimeout(timer)
  }, [sessions])

  // 当前激活的会话 ID
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)

  // 底部状态栏指标 (Runtime Stats)
  const [runtimeStats, setRuntimeStats] = useState<RuntimeStats>({
    contextUsedTokens: 1450,
    contextMaxTokens: 128000,
    tokensPerSecond: 0,
    cacheHitRate: 88.5,
    gitBranch: 'main',
    gitChangesCount: 0,
    isGenerating: false,
  })

  // 项目切换时获取真实 git 状态（Tauri MCP server /api/project/git_status；Web 模式无服务则留空）
  useEffect(() => {
    if (!currentProject?.path) {
      setRuntimeStats((prev) => ({ ...prev, gitBranch: '', gitChangesCount: 0 }))
      return
    }
    fetch(`http://127.0.0.1:9527/api/project/git_status?path=${encodeURIComponent(currentProject.path)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) {
          setRuntimeStats((prev) => ({
            ...prev,
            gitBranch: d.branch || '',
            gitChangesCount: d.changes_count ?? 0,
          }))
        }
      })
      .catch(() => {
        setRuntimeStats((prev) => ({ ...prev, gitBranch: '', gitChangesCount: 0 }))
      })
  }, [currentProject?.id, currentProject?.path])

  const handleUpdateRuntimeStats = (partial: Partial<RuntimeStats>) => {
    setRuntimeStats((prev) => ({ ...prev, ...partial }))
  }

  // 关联项目变化时同步更新状态栏 Git 分支与改动信息
  useEffect(() => {
    if (currentProject) {
      setRuntimeStats((prev) => ({
        ...prev,
        gitBranch: 'main',
        gitChangesCount: currentProject.id === 'forgeone' ? 2 : 0,
      }))
    } else {
      setRuntimeStats((prev) => ({
        ...prev,
        gitBranch: 'main',
        gitChangesCount: 0,
      }))
    }
  }, [currentProject])

  // 切换项目置顶
  const handleTogglePinProject = (projId: string) => {
    setProjects((prev) =>
      prev.map((p) => (p.id === projId ? { ...p, isPinned: !p.isPinned } : p))
    )
  }

  // 切换会话置顶
  const handleTogglePinSession = (sessionId: string) => {
    setSessions((prev) =>
      prev.map((s) => (s.id === sessionId ? { ...s, isPinned: !s.isPinned } : s))
    )
  }

  // 删除会话
  const handleDeleteSession = (sessionId: string) => {
    setSessions((prev) => prev.filter((s) => s.id !== sessionId))
    if (currentSessionId === sessionId) {
      setCurrentSessionId(null)
      setChatSessionKey((prev) => prev + 1)
    }
  }

  // 选择会话（自动清除该会话的未读蓝点提示）
  const handleSelectSession = (sessionId: string) => {
    setCurrentSessionId(sessionId)
    setActiveTab('chat')
    setSessions((prev) =>
      prev.map((s) => (s.id === sessionId ? { ...s, hasUnread: false } : s))
    )
    const sess = sessions.find((s) => s.id === sessionId)
    if (sess) {
      if (sess.projectId) {
        const foundProj = projects.find((p) => p.id === sess.projectId)
        if (foundProj) {
          setCurrentProject(foundProj)
        } else if (sess.projectName && sess.projectPath) {
          setCurrentProject({
            id: sess.projectId,
            name: sess.projectName,
            path: sess.projectPath,
            isCustom: true,
          })
        }
      } else {
        setCurrentProject(null)
      }
    }
  }

  // 创建新会话
  const handleCreateSession = (firstMessage: ChatMessage, project?: ProjectInfo | null): string => {
    const rawTitle = firstMessage.content.replace(/[\r\n]+/g, ' ').trim()
    const title = rawTitle.length > 25 ? rawTitle.slice(0, 25) + '...' : rawTitle || '新会话'
    const newSessionId = `sess_${Date.now()}`
    const newSession: ChatSession = {
      id: newSessionId,
      title,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      projectId: project?.id || null,
      projectName: project?.name || null,
      projectPath: project?.path || null,
      isPinned: false,
      messages: [firstMessage],
    }
    setSessions((prev) => [newSession, ...prev])
    setCurrentSessionId(newSessionId)
    return newSessionId
  }

  // 更新会话消息 (仅在消息产生实质新增/改动时才刷新 updatedAt，避免单纯点击查看改变最近排序)
  const handleUpdateSession = (sessionId: string, updatedMessages: ChatMessage[], newTitle?: string) => {
    setSessions((prev) => {
      const idx = prev.findIndex((s) => s.id === sessionId)
      if (idx === -1) {
        const firstUser = updatedMessages.find((m) => m.role === 'user')
        const rawTitle = newTitle || (firstUser ? firstUser.content.replace(/[\r\n]+/g, ' ').trim() : '新会话')
        const title = rawTitle.length > 25 ? rawTitle.slice(0, 25) + '...' : rawTitle
        const newSess: ChatSession = {
          id: sessionId,
          title,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          projectId: currentProject?.id || null,
          projectName: currentProject?.name || null,
          projectPath: currentProject?.path || null,
          isPinned: false,
          messages: updatedMessages,
        }
        return [newSess, ...prev]
      }

      const current = prev[idx]
      // 深度比较最后一条消息（含 blocks / tool 输出与状态），识别任何实质变化
      const isMessagesChanged =
        current.messages.length !== updatedMessages.length ||
        (current.messages.length > 0 &&
          JSON.stringify(current.messages[current.messages.length - 1]) !==
            JSON.stringify(updatedMessages[updatedMessages.length - 1]))

      // 若无变化且无新标题，直接保持原状态，不触发重排
      if (!isMessagesChanged && !newTitle) {
        return prev
      }

      const updated = [...prev]
      updated[idx] = {
        ...current,
        messages: updatedMessages,
        updatedAt: isMessagesChanged ? Date.now() : current.updatedAt,
        ...(newTitle ? { title: newTitle } : {}),
      }
      return updated
    })
  }

  const handleAddProject = (newProj: ProjectInfo) => {
    setProjects((prev) => {
      const filtered = prev.filter((p) => p.path !== newProj.path && p.id !== newProj.id)
      return [newProj, ...filtered]
    })
    setCurrentProject(newProj)
    setActiveTab('chat')
  }

  const handleRemoveProject = (projId: string) => {
    setProjects((prev) => prev.filter((p) => p.id !== projId))
    if (currentProject?.id === projId) {
      setCurrentProject(null)
    }
  }

  const handleNewChat = () => {
    setCurrentSessionId(null)
    setCurrentProject(null)
    setActiveTab('chat')
    setChatSessionKey((prev) => prev + 1)
  }

  // 在指定项目下新建会话（选中项目 + 清空当前会话，首条消息将自动绑定该项目）
  const handleNewSessionForProject = (project: ProjectInfo) => {
    setCurrentProject(project)
    setCurrentSessionId(null)
    setActiveTab('chat')
    setChatSessionKey((prev) => prev + 1)
  }

  const handleOpenSettings = (tab: SettingsTabType = 'model') => {
    setSettingsInitialTab(tab)
    setIsSettingsOpen(true)
  }

  const currentSession = sessions.find((s) => s.id === currentSessionId) || null

  return (
    <div className="h-screen w-screen bg-[#F9F9F7] text-[#1A1C1B] flex flex-col font-sans overflow-hidden select-none">
      {/* Custom Frameless Window Titlebar / Header */}
      <CustomHeader currentProject={currentProject} />

      {/* Main App Body — data-tauri-no-drag 防止标题栏拖拽区域吞掉内容区点击事件 */}
      <div data-tauri-no-drag className="flex-1 flex overflow-hidden">
        {/* Sidebar Navigation Component */}
        <Sidebar
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          projects={projects}
          currentProject={currentProject}
          onSelectProject={setCurrentProject}
          onOpenProjectModal={() => setIsOpenProjectModalOpen(true)}
          onRemoveProject={handleRemoveProject}
          onTogglePinProject={handleTogglePinProject}
          sessions={sessions}
          currentSessionId={currentSessionId}
          onSelectSession={handleSelectSession}
          onTogglePinSession={handleTogglePinSession}
          onDeleteSession={handleDeleteSession}
          onOpenSettings={() => handleOpenSettings('general')}
          onNewChat={handleNewChat}
          onNewSessionForProject={handleNewSessionForProject}
          isConnected={isConnected}
        />

        {/* Main Canvas Area */}
        <main data-tauri-no-drag className="flex-1 flex flex-col h-full bg-[#F9F9F7] relative overflow-hidden">
          {activeTab === 'chat' && (
            <ChatCanvas
              key={chatSessionKey}
              activeModel={activeModel}
              onSelectModel={setActiveModel}
              projects={projects}
              currentProject={currentProject}
              onSelectProject={setCurrentProject}
              onOpenProjectModal={() => setIsOpenProjectModalOpen(true)}
              onRemoveProject={handleRemoveProject}
              onOpenSettings={() => handleOpenSettings('model')}
              currentSession={currentSession}
              onCreateSession={handleCreateSession}
              onUpdateSession={handleUpdateSession}
              onUpdateRuntimeStats={handleUpdateRuntimeStats}
            />
          )}
          {activeTab === 'project' && (
            <ProjectView
              projects={projects}
              currentProject={currentProject}
              onSelectProject={setCurrentProject}
              onOpenProjectModal={() => setIsOpenProjectModalOpen(true)}
              onRemoveProject={handleRemoveProject}
            />
          )}
        </main>
      </div>

      {/* Bottom Status Bar */}
      <StatusBar
        currentProject={currentProject}
        activeModel={activeModel}
        runtimeStats={runtimeStats}
        onOpenSettings={() => handleOpenSettings('model')}
        onOpenProjectModal={() => setIsOpenProjectModalOpen(true)}
      />

      {/* Global Preferences & Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        activeModel={activeModel}
        setActiveModel={setActiveModel}
        initialTab={settingsInitialTab}
        workspace={currentProject?.path || null}
      />

      {/* Open/Bind Custom Folder Project Modal */}
      <OpenProjectModal
        isOpen={isOpenProjectModalOpen}
        onClose={() => setIsOpenProjectModalOpen(false)}
        onAddProject={handleAddProject}
      />
    </div>
  )
}
