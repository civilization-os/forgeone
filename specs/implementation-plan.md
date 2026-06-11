# ForgeOne Implementation Plan

## 目的

本文档定义 ForgeOne 当前阶段的核心功能实现顺序、模块边界和交付约束。

ForgeOne 当前优先对标 Codex CLI、Claude Code、OpenCode 这类 terminal-first Coding Agent，不将单纯 Workflow 编排作为核心目标。

## 实现原则

- 先完成单 Agent Runtime，再引入多 Agent 能力
- 先完成 Runtime 核心执行链路，再引入 MCP、Plugin、Skill 扩展
- 先完成可追踪、可控制、可审计的底层语义，再扩展交互体验
- 不把仓库理解能力作为 Runtime 核心承诺，相关能力通过 Tool、MCP、Plugin、Skill 扩展

## 总体步骤

### Phase A: Trace System

目标：建立统一 Trace 语义，作为 Runtime、Context、Tool、Policy 的观测底座。

交付范围：

- 定义统一 `TraceEvent` 结构
- 定义事件种类与最小字段集
- 支持会话级 Trace 收集与查询
- 支持基础 timeline 输出

建议字段：

- `trace_id`
- `session_id`
- `agent_id`
- `parent_agent_id`
- `loop_index`
- `kind`
- `message`
- `created_at`

### Phase B: Runtime Core

目标：跑通单 Agent 的最小 Agent Loop。

交付范围：

- `Session`
- `RunRequest`
- `RuntimeConfig`
- `RuntimeState`
- `StopReason`
- `LoopStep`
- 状态迁移与停止判断

当前阶段不要求：

- 真实模型接入
- 多 Agent 调度
- 复杂恢复机制

### Phase C: Context Engine

目标：把 Context 变成结构化运行时对象，而不是隐式 prompt 拼接。

交付范围：

- `ContextSource`
- `ContextSnapshot`
- `SelectedSegment`
- `PromptMessage`
- `CompressionEvent`
- `budget_estimate`

第一版来源范围：

- `task_input`
- `session_history`
- `tool_observation`
- `system_prompt`

### Phase D: Tool Runtime

目标：提供统一 Tool 调度、权限校验和执行结果标准化能力。

交付范围：

- `ToolDescriptor`
- `ToolRegistry`
- `ToolCallRequest`
- `ToolCallResult`
- `Observation`
- 超时、失败、取消语义

第一批内建 Tool 建议：

- `read_file`
- `write_file`
- `apply_patch`
- `shell`
- `glob`
- `grep`

### Phase E: Policy Engine

目标：把权限、沙箱、预算、审批从 Runtime 和 Tool 中解耦。

交付范围：

- 工具白名单 / 黑名单
- 路径访问策略
- 沙箱模式
- Token / 时间 / Tool Call 预算
- 最大循环次数限制
- 审批策略接口

### Phase F: Model Adapter

目标：以统一接口接入模型，而不把模型行为固化进 Runtime Core。

交付范围：

- 模型请求协议
- 模型响应协议
- provider 无关适配层
- mock model 与真实 model 的统一接口

### Phase G: MCP / Plugin / Skill

目标：建立 ForgeOne 的标准扩展面。

建议顺序：

1. `MCP`
2. `Plugin`
3. `Skill`

交付约束：

- 所有扩展都必须经过 Tool Runtime、Policy Engine、Trace System
- 扩展不能绕过 Runtime State
- Skill 不是核心执行逻辑替代品

### Phase H: Multi-Agent

目标：在单 Agent Runtime 稳定后，引入受控的多 Agent 能力。

第一版只支持：

- 父 Agent 派生子 Agent
- 子 Agent 独立 `agent_id`
- 子 Agent 独立 Context / Policy / Budget
- 子 Agent 结果以 Observation 返回父 Agent
- 父子 Agent Trace 可关联

当前阶段不做：

- 复杂 Agent 网络编排
- 自由群体协作模式
- 抽象化的工作流优先调度系统

## 当前步骤记录

ForgeOne 需要区分两类“步骤”：

### 项目级总体步骤

记录位置：

- [docs/roadmap.md](/root/project/ai/forgeone/docs/roadmap.md)
- 本文档

用途：

- 说明实现顺序
- 说明阶段目标
- 说明暂不实现的能力

### 运行时当前步骤

记录位置：

- `RuntimeState`
- `Trace`

建议最小字段：

- `RuntimeState.current_phase`
- `RuntimeState.loop_index`
- `RuntimeState.status`
- `RuntimeState.active_tool_call`
- `RuntimeState.active_context_snapshot`
- `TraceEvent.kind`
- `TraceEvent.agent_id`
- `TraceEvent.parent_agent_id`

## 当前默认实现顺序

当前仓库建议按以下顺序推进：

1. `Trace System`
2. `Runtime Core`
3. `Context Engine`
4. `Tool Runtime`
5. `Policy Engine`
6. `Model Adapter`
7. `MCP / Plugin / Skill`
8. `Multi-Agent`

## 非目标说明

当前阶段以下内容不作为核心承诺：

- 内建通用 `Repo Reasoning Engine`
- 以 Workflow 编排为核心的运行模型
- 仅做模型 API 的薄封装
- 没有权限、沙箱、Trace 的 Tool 调用系统
