import { useState, useEffect } from 'react'
import { Minus, Square, Copy, X } from 'lucide-react'
import { getCurrentWindow } from '@tauri-apps/api/window'

import type { ProjectInfo } from '../../types'

interface CustomHeaderProps {
  currentProject?: ProjectInfo | null
}

export default function CustomHeader({ currentProject }: CustomHeaderProps) {
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    try {
      const appWin = getCurrentWindow()
      appWin.isMaximized().then(setIsMaximized).catch(() => {})
    } catch (e) {
      // 仅在非 Tauri 浏览器环境回退
    }
  }, [])

  const handleMinimize = async () => {
    try {
      const appWin = getCurrentWindow()
      await appWin.minimize()
    } catch (e) {
      console.log('Window minimize triggered (Web fallback)')
    }
  }

  const handleToggleMaximize = async () => {
    try {
      const appWin = getCurrentWindow()
      await appWin.toggleMaximize()
      const state = await appWin.isMaximized()
      setIsMaximized(state)
    } catch (e) {
      setIsMaximized(!isMaximized)
    }
  }

  const handleClose = async () => {
    try {
      const appWin = getCurrentWindow()
      await appWin.close()
    } catch (e) {
      console.log('Window close triggered (Web fallback)')
    }
  }

  return (
    <header
      data-tauri-drag-region
      className="h-9 bg-[#F4F4F2] border-b border-[#E8E8E6] flex items-center justify-between px-3 select-none shrink-0 cursor-default"
    >
      {/* Left Area: Title & Status */}
      <div data-tauri-drag-region className="flex items-center gap-2.5">
        <div className="flex items-center gap-1.5 font-medium text-xs text-[#1A1C1B]">
          <span className="w-2 h-2 rounded-full bg-[#1A1C1B]" />
          <span className="font-semibold tracking-tight">ForgeOne</span>
        </div>
      </div>

      {/* Center Drag Region */}
      <div data-tauri-drag-region className="flex-1 h-full flex items-center justify-center">
        <span data-tauri-drag-region className="text-[11px] font-mono text-[#76777B] opacity-70 flex items-center gap-1.5">
          {currentProject ? (
            <>
              <span className="text-[#1A1C1B] font-medium">{currentProject.name}</span>
              <span className="opacity-60 font-mono">({currentProject.path})</span>
            </>
          ) : (
            <span className="text-[#A1A1AA] italic">未绑定项目工作区 (通用会话)</span>
          )}
        </span>
      </div>

      {/* Right Window Control Buttons */}
      <div className="flex items-center gap-1">
        <button
          onClick={handleMinimize}
          className="w-7 h-6 flex items-center justify-center rounded hover:bg-[#EEEEEC] text-[#76777B] hover:text-[#1A1C1B] transition-colors"
          title="最小化"
        >
          <Minus size={13} />
        </button>

        <button
          onClick={handleToggleMaximize}
          className="w-7 h-6 flex items-center justify-center rounded hover:bg-[#EEEEEC] text-[#76777B] hover:text-[#1A1C1B] transition-colors"
          title={isMaximized ? '还原' : '最大化'}
        >
          {isMaximized ? <Copy size={11} /> : <Square size={11} />}
        </button>

        <button
          onClick={handleClose}
          className="w-7 h-6 flex items-center justify-center rounded hover:bg-rose-500 hover:text-white text-[#76777B] transition-colors"
          title="关闭"
        >
          <X size={13} />
        </button>
      </div>
    </header>
  )
}
