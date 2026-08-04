import { Sparkles } from 'lucide-react'

export default function SkillTab() {
  // TODO: 接入真实 Skill 列表（Skill 注册表 / 内置 playbook 将展示在此）
  const skills: { name: string; desc: string; trigger: string }[] = []

  return (
    <div className="grid grid-cols-1 gap-3">
      {skills.length === 0 ? (
        <div className="bg-white p-8 rounded-xl border border-[#E8E8E6] shadow-sm flex flex-col items-center justify-center gap-2 text-center">
          <Sparkles size={18} className="text-[#A1A1AA]" />
          <p className="text-xs text-[#76777B]">暂无可用技能</p>
          <p className="text-[10px] text-[#A1A1AA] max-w-xs leading-relaxed">
            Skill / Playbook 注册后可通过 /命令 在对话中触发
          </p>
        </div>
      ) : (
        skills.map((skill) => (
          <div key={skill.name} className="bg-white p-3.5 rounded-xl border border-[#E8E8E6] shadow-sm">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold text-[#1A1C1B]">{skill.name}</span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#F4F4F2] text-[#2D63ED]">
                {skill.trigger}
              </span>
            </div>
            <p className="text-[11px] text-[#76777B] leading-normal">{skill.desc}</p>
          </div>
        ))
      )}
    </div>
  )
}
