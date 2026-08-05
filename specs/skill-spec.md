# Skill 规格

状态：已落地（v0.1，上下文/指令注入）

## 1. 定位

Skill 是面向任务模式的轻量**上下文/指令注入**能力：

- SKILL.md 通过 frontmatter 声明元数据，body 为 Markdown 指令
- 调用时以 `{{param}}` 模板注入参数，渲染后的内容作为指令提供给模型
- 模型在 Agent Loop 内自主执行，Runtime 不驱动 Skill 内的多步执行

Skill **不替代核心 Agent Loop**，也不是 Workflow（可执行多步模板）的替代品。

## 2. 目录约定

| 范围 | 路径 | 优先级 |
|---|---|---|
| 项目级 | `{workspace}/.forgeone/skills/<dir>/SKILL.md` | 高（同名覆盖全局） |
| 全局 | `{user_home}/.forgeone/skills/<dir>/SKILL.md` | 低 |

- `<dir>` 为任意目录名；调用标识以 frontmatter `name` 为准，不依赖目录名
- 全局目录 Windows 为 `%USERPROFILE%\.forgeone\skills`，Unix 为 `$HOME/.forgeone/skills`
- Skill 不再使用 `.forgeone/skills/*.json` manifest（已废弃，统一 SKILL.md）

## 3. SKILL.md 格式

```
---
name: <必填，调用标识，如 code-review>
description: <可选，一句话说明>
version: <可选，如 0.1.0>
---

## Instructions

<Markdown 指令正文，支持 {{param}} 模板占位符>
```

- frontmatter 为 `---` 分隔的 YAML 风格标量键值（仅支持标量，不支持嵌套结构）
- `name` 必填且应全局唯一；缺失 `name` 或缺少闭合 `---` 的 SKILL.md 视为无效，发现时跳过并记录警告
- body 为 Markdown 指令，首尾空白会被裁剪

## 4. 模板渲染

- body 中 `{{param}}` 占位符由 `invoke_skill` 同名参数替换
- 未提供的参数**保留原占位符**，便于模型识别缺失变量
- 参数均为字符串

## 5. 调用契约：invoke_skill

| 项 | 值 |
|---|---|
| 工具名 | `invoke_skill` |
| kind | `ToolKind::Skill` |
| 必填参数 | `name`（frontmatter name） |
| 可选参数 | 任意字符串键，用于模板渲染 |
| 输出 | `content`（渲染后的指令正文）、`description`、`skill` |
| 错误 | `missing_argument=name`、`skill_not_found={name}`、`invalid_skill={name}: ...`、`read_failed=...` |

执行路径：

1. Agent Loop 拦截 `invoke_skill`，以 `workspace` 根解析（`SkillTool` 本体以进程 CWD 解析，作为兜底）
2. `discover_skills` 定位匹配 `name` 的 SKILL.md（项目级优先）
3. `parse_skill` 解析 frontmatter + body
4. `render_skill` 以调用参数渲染模板
5. 渲染结果作为 Observation 返回给模型，模型按其指令继续执行

## 6. 上下文注入

Agent Loop 启动时调用 `discover_skills(workspace)` 枚举可用 Skill，将清单（name + version + description）渲染为 `【可用 Skills】` 块追加到 system 上下文；实际调用走 `invoke_skill`，不预加载全部 body。

## 7. 权限边界

- `invoke_skill` 声明 `fs_read` 权限
- 权限联动（Policy Engine 校验、沙箱约束）暂未实现，列为后续工作

## 8. 与其它扩展的边界

| 能力 | 形态 | 说明 |
|---|---|---|
| MCP | 外部工具/资源接入 | 提供能力，经 MCP Adapter 注册为标准 Tool |
| Plugin | 粗粒度能力包 | 可提供 Skill 所需工具，不与 Skill 混为一体 |
| Skill | 任务模式指令 | 上下文/指令注入，不替代 Agent Loop |
| Workflow | 多步执行模板 | 由 Runtime 驱动，与 Skill 的注入语义不同 |
