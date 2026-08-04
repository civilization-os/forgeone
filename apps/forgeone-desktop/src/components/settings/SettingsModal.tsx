import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Settings, Cpu, Plug, Zap, ShieldCheck, Activity, XCircle, CheckCircle2 } from 'lucide-react'
import type { SettingsTabType } from '../../types'
import GeneralTab from './tabs/GeneralTab'
import ModelTab from './tabs/ModelTab'
import McpTab from './tabs/McpTab'
import SkillTab from './tabs/SkillTab'
import PolicyTab from './tabs/PolicyTab'
import TraceTab from './tabs/TraceTab'

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
  activeModel: string
  setActiveModel: (model: string) => void
  initialTab?: SettingsTabType
}

export default function SettingsModal({
  isOpen,
  onClose,
  activeModel,
  setActiveModel,
  initialTab = 'model',
}: SettingsModalProps) {
  const { t } = useTranslation()
  const [activeSettingsTab, setActiveSettingsTab] = useState<SettingsTabType>(initialTab)

  useEffect(() => {
    if (isOpen && initialTab) {
      setActiveSettingsTab(initialTab)
    }
  }, [isOpen, initialTab])

  if (!isOpen) return null

  const tabs = [
    { id: 'general' as SettingsTabType, label: '通用 (General)', icon: Settings },
    { id: 'model' as SettingsTabType, label: t('tab.model'), icon: Cpu },
    { id: 'mcp' as SettingsTabType, label: t('tab.mcp'), icon: Plug },
    { id: 'skill' as SettingsTabType, label: t('tab.skill'), icon: Zap },
    { id: 'policy' as SettingsTabType, label: t('tab.policy'), icon: ShieldCheck },
    { id: 'trace' as SettingsTabType, label: t('tab.trace'), icon: Activity },
  ]

  return (
    <div data-tauri-no-drag className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50 p-6">
      <div data-tauri-no-drag className="bg-white w-full max-w-4xl h-[640px] rounded-2xl shadow-2xl border border-[#E2E3E1] flex overflow-hidden">
        {/* Modal Left Sidebar Nav */}
        <div className="w-[200px] bg-[#F4F4F2] border-r border-[#E8E8E6] flex flex-col justify-between p-4 shrink-0">
          <div>
            <h3 className="text-xs font-bold text-[#1A1C1B] px-2 mb-3 tracking-wider uppercase">
              {t('settings.title')}
            </h3>
            <nav className="flex flex-col gap-1">
              {tabs.map((tab) => {
                const Icon = tab.icon
                const isActive = activeSettingsTab === tab.id
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveSettingsTab(tab.id)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                      isActive
                        ? 'bg-white text-[#1A1C1B] shadow-sm border border-[#E2E3E1]'
                        : 'text-[#46474A] hover:bg-[#EEEEEC] hover:text-[#1A1C1B]'
                    }`}
                  >
                    <Icon size={15} className={isActive ? 'text-[#1A1C1B]' : 'text-[#76777B]'} />
                    <span>{tab.label}</span>
                  </button>
                )
              })}
            </nav>
          </div>

          <div className="pt-3 border-t border-[#E8E8E6] text-[11px] text-[#76777B] px-2 font-mono">
            ForgeOne v0.1.0
          </div>
        </div>

        {/* Modal Right Content Canvas */}
        <div className="flex-1 flex flex-col h-full bg-[#F9F9F7] overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-[#E8E8E6] bg-white shrink-0">
            <h4 className="text-sm font-semibold text-[#1A1C1B]">
              {activeSettingsTab === 'general' && '通用首选项 (General Preferences)'}
              {activeSettingsTab === 'model' && t('model.title')}
              {activeSettingsTab === 'mcp' && t('mcp.title')}
              {activeSettingsTab === 'skill' && t('skill.title')}
              {activeSettingsTab === 'policy' && t('policy.title')}
              {activeSettingsTab === 'trace' && t('trace.title')}
            </h4>
            <button
              onClick={onClose}
              className="text-[#76777B] hover:text-[#1A1C1B] p-1 rounded-lg hover:bg-[#F4F4F2] transition-colors"
            >
              <XCircle size={18} />
            </button>
          </div>

          {/* Body Views */}
          <div className="flex-1 overflow-y-auto p-6">
            {activeSettingsTab === 'general' && <GeneralTab />}
            {activeSettingsTab === 'model' && (
              <ModelTab activeModel={activeModel} setActiveModel={setActiveModel} />
            )}
            {activeSettingsTab === 'mcp' && <McpTab />}
            {activeSettingsTab === 'skill' && <SkillTab />}
            {activeSettingsTab === 'policy' && <PolicyTab />}
            {activeSettingsTab === 'trace' && <TraceTab />}
          </div>

          {/* Modal Footer */}
          <div className="px-6 py-3 border-t border-[#E8E8E6] bg-white flex items-center justify-between shrink-0">
            <span className="text-[11px] text-emerald-600 font-medium flex items-center gap-1">
              <CheckCircle2 size={13} />
              <span>所有 API Key 与厂商配置均自动持久化本地保存</span>
            </span>

            <button
              onClick={onClose}
              className="px-4 py-1.5 bg-[#1A1C1B] hover:bg-[#2F3130] text-white text-xs font-medium rounded-lg transition-all shadow-xs flex items-center gap-1.5 cursor-pointer"
            >
              <span>保存并完成 (Save & Close)</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
