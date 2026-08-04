import { useState } from 'react'
import { Folder, FolderPlus, X, Check } from 'lucide-react'
import type { ProjectInfo } from '../../types'

interface OpenProjectModalProps {
  isOpen: boolean
  onClose: () => void
  onAddProject: (project: ProjectInfo) => void
}

export default function OpenProjectModal({
  isOpen,
  onClose,
  onAddProject,
}: OpenProjectModalProps) {
  const [folderPath, setFolderPath] = useState('')
  const [projectName, setProjectName] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [isPicking, setIsPicking] = useState(false)

  if (!isOpen) return null

  const handlePathChange = (val: string) => {
    setFolderPath(val)
    setErrorMsg('')
    if (val.trim()) {
      // 自动提取路径最后的文件夹名称作为项目名
      const normalized = val.trim().replace(/[/\\]+$/, '')
      const parts = normalized.split(/[/\\]/)
      const last = parts[parts.length - 1]
      if (last && !projectName) {
        setProjectName(last)
      }
    }
  }

  // 唤起系统原生文件夹选择器
  const handlePickDirectory = async () => {
    setIsPicking(true)
    setErrorMsg('')
    try {
      // 1. 优先走 Tauri v2 原生 OS 文件夹选择框（完整绕过 WebView2/浏览器系统文件夹限制）
      const tauriInternals = (window as any).__TAURI_INTERNALS__
      if (tauriInternals?.invoke) {
        try {
          const selected = await tauriInternals.invoke('plugin:dialog|open', {
            options: {
              directory: true,
              multiple: false,
              title: '选择本地工作区文件夹',
            },
          })
          if (selected && typeof selected === 'string') {
            handlePathChange(selected)
            return
          }
          if (selected === null) return // 用户取消
        } catch (err: any) {
          console.warn('Tauri __TAURI_INTERNALS__ dialog error:', err)
        }
      }

      // 2. Tauri v2 兼容层 __TAURI__ 路径
      const tauri = (window as any).__TAURI__
      if (tauri?.dialog?.open) {
        try {
          const selected = await tauri.dialog.open({
            directory: true,
            multiple: false,
            title: '选择本地工作区文件夹',
          })
          if (selected && typeof selected === 'string') {
            handlePathChange(selected)
            return
          }
          if (selected === null) return // 用户取消
        } catch (err: any) {
          console.warn('Tauri dialog.open error:', err)
        }
      }

      // 3. 后端服务接口选择器
      try {
        const res = await fetch('http://127.0.0.1:9527/api/workspace/pick-folder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
        if (res.ok) {
          const data = await res.json()
          if (data?.path) {
            handlePathChange(data.path)
            return
          }
        }
      } catch {
        // 后端不可用，继续降级
      }

      // 4. 最终降级：浏览器 File System Access API
      //    注意：WebView2 对系统文件夹（Windows、Program Files 等）有内置安全限制，无法规避
      if ('showDirectoryPicker' in window) {
        try {
          const dirHandle = await (window as any).showDirectoryPicker()
          if (dirHandle?.name) {
            setProjectName(dirHandle.name)
            if (!folderPath) {
              setFolderPath(`d:\\project\\${dirHandle.name}`)
            } else {
              const prefix = folderPath.replace(/[/\\][^/\\]*$/, '')
              setFolderPath(prefix ? `${prefix}\\${dirHandle.name}` : dirHandle.name)
            }
            return
          }
        } catch (err: any) {
          if (err?.name === 'AbortError') return
          // 被浏览器安全策略拦截（如选择了系统文件夹），提示用户手动输入
          setErrorMsg('浏览器无法选择该文件夹，请直接在上方输入框中粘贴完整路径（如 D:\\my-project）')
          console.warn('showDirectoryPicker error:', err)
        }
      }
    } catch (e) {
      console.warn('Pick directory error:', e)
    } finally {
      setIsPicking(false)
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmedPath = folderPath.trim()
    if (!trimmedPath) {
      setErrorMsg('请输入或选择本地文件夹路径')
      return
    }

    const finalName = projectName.trim() || trimmedPath.split(/[/\\]/).pop() || 'Custom Project'
    const newProj: ProjectInfo = {
      id: `proj-${Date.now()}`,
      name: finalName,
      path: trimmedPath,
      isCustom: true,
    }

    onAddProject(newProj)
    setFolderPath('')
    setProjectName('')
    setErrorMsg('')
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150">
      <div
        className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-[#E2E3E1] overflow-hidden animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E8E8E6] bg-[#FAF9F7]">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-[#EBF3FF] text-[#2D63ED]">
              <FolderPlus size={18} />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-[#1A1C1B]">关联新文件夹 / 本地项目</h3>
              <p className="text-[11px] text-[#76777B]">为 ForgeOne Runtime 绑定自定义代码工作区</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-[#76777B] hover:text-[#1A1C1B] hover:bg-[#EAEAE8] transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs">
          {/* 文件夹路径输入 */}
          <div>
            <label className="block font-medium text-[#1A1C1B] mb-1.5">
              文件夹绝对路径 <span className="text-rose-500">*</span>
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder="请输入文件夹绝对路径"
                value={folderPath}
                onChange={(e) => handlePathChange(e.target.value)}
                className="flex-1 px-3 py-2 rounded-lg border border-[#E2E3E1] focus:border-[#2D63ED] focus:outline-none font-mono text-xs text-[#1A1C1B] placeholder-[#A1A1AA] bg-[#FDFDFD]"
                autoFocus
              />
              <button
                type="button"
                onClick={handlePickDirectory}
                disabled={isPicking}
                className="px-3 py-2 rounded-lg bg-[#F4F4F2] hover:bg-[#EAEAE8] border border-[#E2E3E1] text-[#1A1C1B] font-medium transition-colors flex items-center gap-1.5 shrink-0 cursor-pointer disabled:opacity-50"
                title="选择本地文件夹"
              >
                <Folder size={13} className="text-[#2D63ED]" />
                <span>{isPicking ? '选择中...' : '选择目录...'}</span>
              </button>
            </div>
            {errorMsg && <p className="mt-1 text-[11px] text-rose-500">{errorMsg}</p>}
          </div>

          {/* 项目名称输入 */}
          <div>
            <label className="block font-medium text-[#1A1C1B] mb-1.5">
              项目显示名称 <span className="text-[#76777B] font-normal">（选填，默认同文件夹名）</span>
            </label>
            <input
              type="text"
              placeholder="例如: my-project"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-[#E2E3E1] focus:border-[#2D63ED] focus:outline-none text-xs text-[#1A1C1B] placeholder-[#A1A1AA] bg-[#FDFDFD]"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#E8E8E6]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-[#E2E3E1] hover:bg-[#F4F4F2] text-xs font-medium text-[#46474A] transition-colors cursor-pointer"
            >
              取消
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-[#1A1C1B] hover:bg-black text-white text-xs font-semibold shadow-xs transition-all flex items-center gap-1.5 cursor-pointer"
            >
              <Check size={14} />
              <span>关联并切换工作区</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
