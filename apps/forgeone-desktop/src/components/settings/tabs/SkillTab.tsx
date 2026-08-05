import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, FileText, Loader2, RefreshCw, Sparkles } from 'lucide-react'

const API = 'http://127.0.0.1:9527'

interface SkillMeta {
  name: string
  description: string
  version: string | null
}

interface SkillDetail extends SkillMeta {
  body: string
}

interface SkillTabProps {
  /** 当前绑定的工作区路径；未绑定项目时为 null */
  workspace: string | null
}

/// Skill 卡片：默认显示元数据，点击展开指令正文（SKILL.md body）
function SkillCard({ skill, workspace }: { skill: SkillMeta; workspace: string | null }) {
  const [open, setOpen] = useState(false)
  const [detail, setDetail] = useState<SkillDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadDetail = useCallback(async () => {
    if (detail || loading) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `${API}/api/skills/detail?workspace=${encodeURIComponent(workspace ?? '')}&name=${encodeURIComponent(skill.name)}`
      )
      const data = await res.json()
      if (!data.ok) {
        setError(data.error ?? '加载详情失败')
        return
      }
      setDetail(data.skill)
    } catch {
      setError('加载详情失败：无法连接 Runtime 服务')
    } finally {
      setLoading(false)
    }
  }, [detail, loading, skill.name, workspace])

  return (
    <div className="bg-white p-3.5 rounded-xl border border-[#E8E8E6] shadow-sm">
      <button
        onClick={() => {
          if (!open) loadDetail()
          setOpen((v) => !v)
        }}
        className="w-full text-left flex items-center gap-2 cursor-pointer"
      >
        <FileText size={13} className="text-[#2D63ED] shrink-0" />
        <span className="text-xs font-semibold text-[#1A1C1B]">{skill.name}</span>
        {skill.version && (
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#F4F4F2] text-[#76777B]">
            v{skill.version}
          </span>
        )}
        <ChevronDown
          size={12}
          className={`text-[#A1A1AA] shrink-0 ml-auto transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {skill.description && (
        <p className="text-[11px] text-[#76777B] mt-1 leading-normal">{skill.description}</p>
      )}
      {open && (
        <div className="mt-2 pt-2 border-t border-[#F4F4F2]">
          {loading && (
            <div className="flex items-center gap-1.5 text-[10px] text-[#A1A1AA]">
              <Loader2 size={11} className="animate-spin" /> 加载指令…
            </div>
          )}
          {error && <p className="text-[10px] text-red-500">{error}</p>}
          {detail?.body && (
            <pre className="text-[10px] text-[#4B4C4E] whitespace-pre-wrap font-mono leading-relaxed bg-[#FBFBF9] rounded-lg p-2.5 max-h-72 overflow-y-auto">
              {detail.body}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

export default function SkillTab({ workspace }: SkillTabProps) {
  const [skills, setSkills] = useState<SkillMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API}/api/skills?workspace=${encodeURIComponent(workspace ?? '')}`)
      const data = await res.json()
      if (!data.ok) {
        setError(data.error ?? '加载失败')
        setSkills([])
        return
      }
      setSkills(data.skills ?? [])
    } catch {
      setError('加载失败：无法连接 Runtime 服务')
      setSkills([])
    } finally {
      setLoading(false)
    }
  }, [workspace])

  useEffect(() => {
    refresh()
  }, [refresh])

  return (
    <div className="grid grid-cols-1 gap-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-[#76777B]">
          {workspace ? `工作区：${workspace}` : '未绑定工作区（仅显示全局 Skills）'}
        </p>
        <button
          onClick={refresh}
          disabled={loading}
          className="flex items-center gap-1 text-[10px] text-[#2D63ED] hover:bg-[#F4F4F2] rounded-md px-2 py-1 cursor-pointer disabled:opacity-50"
        >
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
          刷新
        </button>
      </div>

      {error && (
        <div className="bg-red-50 text-red-600 text-[11px] rounded-lg px-3 py-2 border border-red-100">
          {error}
        </div>
      )}

      {!error && skills.length === 0 && !loading ? (
        <div className="bg-white p-8 rounded-xl border border-[#E8E8E6] shadow-sm flex flex-col items-center justify-center gap-2 text-center">
          <Sparkles size={18} className="text-[#A1A1AA]" />
          <p className="text-xs text-[#76777B]">暂无可用技能</p>
          <p className="text-[10px] text-[#A1A1AA] max-w-xs leading-relaxed">
            在 {workspace ? '工作区' : '全局目录'}/.forgeone/skills/&lt;name&gt;/SKILL.md 创建技能后刷新即可看到
          </p>
        </div>
      ) : (
        skills.map((skill) => (
          <SkillCard key={skill.name} skill={skill} workspace={workspace} />
        ))
      )}
    </div>
  )
}
