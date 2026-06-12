# ForgeOne Roadmap

## 原则

路线图以 Runtime 能力落地顺序为主，而不是以界面功能堆叠为主。

当前阶段优先对标 Codex CLI、Claude Code、OpenCode 这类 terminal-first Coding Agent 的核心交互与执行边界，先把单 Agent Runtime 做实，再逐步补齐扩展能力。

## Phase 0: 文档与规格

- 明确 Runtime、Context、Tool、Trace 的概念边界
- 完成 CLI、Policy、Plugin、MCP、Skill 的架构文档
- 建立首版技术规格文档

## Phase 1: 最小可运行 Runtime

- 实现会话级 Trace System
- 实现单任务单会话 Agent Loop
- 实现 Context Snapshot 与 Prompt Trace
- 实现基础 Tool Runtime
- 实现文件、补丁、shell、搜索等核心工具
- 支持最大循环次数、超时和预算限制

## Phase 2: 控制面与模型接入

- 实现更完整的 Policy Engine
- 支持多种沙箱模式
- 支持统一的 Model Adapter
- 实现 Trace 查询与回放
- 支持会话恢复和中断续跑

## Phase 3: 扩展系统

- 接入 MCP Adapter
- 接入 Plugin System
- 接入 Skill System
- 引入 Workflow 运行器
- 形成标准扩展注册与权限声明机制

## Phase 4: 多 Agent 与多执行环境

- 支持父子 Agent 任务拆分
- 支持 Agent 级 Context / Policy / Budget 隔离
- 支持父子 Agent Trace 关联
- 支持本地与远程执行器

## Phase 5: 平台化

- 支持多仓库任务
- 支持多 Agent 协作实验
- 支持组织级策略与审计出口
- 支持性能分析与可视化观测面

## 实施说明

项目级总体步骤以本路线图和 [specs/implementation-plan.md](/root/project/ai/forgeone/specs/implementation-plan.md) 为准。

单次运行中的当前步骤不记录在路线图中，而应记录在 Runtime State 与 Trace 中。后续实现建议至少包含：

- `RuntimeState.current_phase`
- `RuntimeState.loop_index`
- `TraceEvent.kind`
- `TraceEvent.agent_id`
- `TraceEvent.parent_agent_id`
## 后端演进补充

在当前路线图之上，后端实现顺序建议进一步细化为：

1. 拆分 `Session Store`、`Runtime Runner`、`Trace Projection`
2. 为 `Context` 引入 `Context Epoch` 与 safe-boundary reconcile
3. 为 `Tool Runtime` 引入作用域、注册身份和陈旧调用拒绝
4. 将 `Policy Engine` 与运行时 `Permission Service` 分层
5. 先把 `MCP` 接入主执行链路
6. 再开放 `Plugin`
7. 最后开放 `Skill`

该顺序的目标是先稳住 Runtime、Context、Tool、Permission 这些后端基础设施，再继续扩展能力面。
