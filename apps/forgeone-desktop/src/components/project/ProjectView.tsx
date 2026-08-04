import { useTranslation } from 'react-i18next'
import { FolderGit2, Folder, Check, X, FolderPlus, Trash2 } from 'lucide-react'
import type { ProjectInfo } from '../../types'
import { DEFAULT_PROJECT_OPTIONS } from '../chat/ChatCanvas'

interface ProjectViewProps {
  projects?: ProjectInfo[]
  currentProject?: ProjectInfo | null
  onSelectProject?: (project: ProjectInfo | null) => void
  onOpenProjectModal?: () => void
  onRemoveProject?: (projId: string) => void
}

export default function ProjectView({
  projects = [],
  currentProject = null,
  onSelectProject,
  onOpenProjectModal,
  onRemoveProject,
}: ProjectViewProps) {
  const { t } = useTranslation()
  const projectList = projects && projects.length > 0 ? projects : DEFAULT_PROJECT_OPTIONS

  return (
    <div className="flex-1 flex flex-col h-full max-w-[1200px] w-full mx-auto p-6 overflow-y-auto">
      <div className="pb-4 border-b border-[#E8E8E6] mb-6">
        <h2 className="text-base font-semibold text-[#1A1C1B]">{t('project.title')}</h2>
        <p className="text-xs text-[#76777B]">{t('project.subtitle')}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Project Card */}
        <div className="bg-white p-5 rounded-xl border border-[#E8E8E6] shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2.5 rounded-lg bg-[#F4F4F2] text-[#1A1C1B]">
                <FolderGit2 size={20} />
              </div>
              <div>
                <h3 className="text-xs font-semibold text-[#1A1C1B]">
                  {currentProject ? `当前绑定仓库: ${currentProject.name}` : '未绑定项目工作区'}
                </h3>
                <p className="text-[11px] text-[#76777B]">
                  {currentProject
                    ? 'ForgeOne Runtime 自动注入当前 Workspace 上下文'
                    : '当前处于通用会话模式，未绑定具体文件系统目录'}
                </p>
              </div>
            </div>

            <div className="bg-[#F4F4F2] p-3 rounded-lg text-xs font-mono text-[#1A1C1B] mb-4 truncate border border-[#E8E8E6]">
              {currentProject ? currentProject.path : '（无活动工作区）'}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-[11px] font-semibold text-[#76777B] mb-1">
              <span>选择/切换项目工作区：</span>
              <button
                type="button"
                onClick={onOpenProjectModal}
                className="text-[#2D63ED] hover:underline flex items-center gap-1 cursor-pointer font-medium text-xs"
              >
                <FolderPlus size={13} />
                <span>+ 关联新文件夹</span>
              </button>
            </div>

            <div className="grid grid-cols-2 gap-1.5 max-h-56 overflow-y-auto p-0.5 custom-scrollbar">
              {projectList.map((proj) => {
                const isSelected = currentProject?.id === proj.id
                return (
                  <div
                    key={proj.id}
                    className={`group flex items-center justify-between p-2 rounded-lg text-xs border transition-all text-left ${
                      isSelected
                        ? 'bg-[#EBF3FF] border-[#BFDBFE] text-[#2D63ED] font-medium'
                        : 'bg-white border-[#E8E8E6] text-[#46474A] hover:bg-[#F9F9F7]'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onSelectProject?.(proj)}
                      className="flex-1 flex items-center gap-1.5 truncate cursor-pointer text-left mr-1"
                      title={`${proj.name} (${proj.path})`}
                    >
                      <Folder size={13} className={isSelected ? 'text-[#2D63ED]' : 'text-[#76777B]'} />
                      <span className="truncate">{proj.name}</span>
                    </button>

                    <div className="flex items-center gap-1 shrink-0">
                      {proj.isCustom && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            onRemoveProject?.(proj.id)
                          }}
                          className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:text-rose-600 hover:bg-rose-50 transition-all cursor-pointer"
                          title="移除项目"
                        >
                          <Trash2 size={11} />
                        </button>
                      )}
                      {isSelected && <Check size={12} className="text-[#2D63ED]" />}
                    </div>
                  </div>
                )
              })}
            </div>

            <button
              type="button"
              onClick={onOpenProjectModal}
              className="w-full mt-2 py-2 rounded-lg border border-dashed border-[#2D63ED]/40 bg-[#EBF3FF]/40 hover:bg-[#EBF3FF] text-[#2D63ED] text-xs font-semibold transition-all flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <FolderPlus size={14} />
              <span>选择/关联本地文件夹或新项目...</span>
            </button>

            {currentProject && (
              <button
                type="button"
                onClick={() => onSelectProject?.(null)}
                className="w-full py-1.5 rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50 text-xs font-medium transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <X size={13} />
                <span>解除当前项目绑定 (切换通用模式)</span>
              </button>
            )}
          </div>
        </div>

        {/* Protection Policies */}
        <div className="bg-white p-5 rounded-xl border border-[#E8E8E6] shadow-sm">
          <h3 className="text-xs font-semibold text-[#1A1C1B] mb-3">路径保护与沙箱规则</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-2.5 rounded-lg bg-[#F9F9F7] border border-[#EEEEEC]">
              <span className="text-xs font-medium text-[#46474A]">只读保护路径 (Read-only)</span>
              <span className="text-[11px] font-mono text-[#76777B]">
                {currentProject ? 'crates/forgeone-runtime' : '全局只读'}
              </span>
            </div>
            <div className="flex items-center justify-between p-2.5 rounded-lg bg-[#F9F9F7] border border-[#EEEEEC]">
              <span className="text-xs font-medium text-[#46474A]">自动忽略目录 (Ignored)</span>
              <span className="text-[11px] font-mono text-[#76777B]">target/, node_modules/, .git/</span>
            </div>
            <div className="flex items-center justify-between p-2.5 rounded-lg bg-[#F9F9F7] border border-[#EEEEEC]">
              <span className="text-xs font-medium text-[#46474A]">命令执行沙箱</span>
              <span className="text-[11px] font-mono text-emerald-600">Active (沙箱隔离开启)</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
