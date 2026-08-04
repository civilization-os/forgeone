export default function SkillTab() {
  const skills = [
    { name: 'code-review', desc: '深入审查 TypeScript / Rust 代码逻辑与范式规约', trigger: '/review' },
    { name: 'git-commit-gen', desc: '根据 git status / diff 自动总结并格式化 commit 提交描述', trigger: '/commit' },
    { name: 'rust-clippy-fix', desc: '运行 clippy 并自动修正代码风格告警', trigger: '/clippy' },
  ]

  return (
    <div className="grid grid-cols-1 gap-3">
      {skills.map((skill) => (
        <div key={skill.name} className="bg-white p-3.5 rounded-xl border border-[#E8E8E6] shadow-sm">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-semibold text-[#1A1C1B]">{skill.name}</span>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#F4F4F2] text-[#2D63ED]">
              {skill.trigger}
            </span>
          </div>
          <p className="text-[11px] text-[#76777B] leading-normal">{skill.desc}</p>
        </div>
      ))}
    </div>
  )
}
