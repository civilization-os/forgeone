# ForgeOne Repository Instructions

本文件面向后续在本仓库内工作的 AI Coding Agent，定义仓库级文档与术语约束。

## 基本要求

- 修改或新增文档时，默认使用中文
- 语气保持专业、工程化、面向基础设施项目
- 不要将 ForgeOne 写成聊天机器人、AI 助手壳层或通用 ChatBot
- 不要把 LangGraph 作为 ForgeOne 的核心依赖、核心架构或默认运行时前提

## 核心定位

在所有文档中，ForgeOne 应持续被描述为：

- Open Agent Runtime
- Open Agent Harness
- Coding Agent Platform
- Transparent Context
- Controllable Execution
- Observable Agent Loop

如果需要对比外部项目，可以参考 Codex CLI、Claude Code、OpenCode 的交互与能力边界，但应避免攻击性语言和无根据对比。

## 术语统一

优先保持以下术语一致，不随意替换成泛化表述：

- Runtime
- Harness
- Context
- Context Engine
- Tool Runtime
- Trace
- Agent Loop
- Policy Engine
- Repo Reasoning
- MCP
- Plugin
- Skill
- Workflow

术语使用要求：

- `Runtime` 指执行内核，不等同于应用层产品
- `Harness` 指承载与接入层，不等同于模型
- `Context` 指运行时可追踪上下文，不等同于单段 prompt
- `Trace` 指结构化执行轨迹，不等同于普通日志
- `Tool` 指受 Runtime 调度的能力单元，不等同于任意函数调用

## 文档写作约束

- 明确说明 ForgeOne 不是 LangGraph 上层应用，而是自研 Runtime
- 需要强调上下文透明、Prompt 可追踪、Tool Call 可追踪、Runtime State 可观测
- 需要强调 Agent Loop 可控，以及权限、沙箱、预算、最大循环次数可配置
- 可以写 MCP、Plugin、Skill、Workflow 扩展，但不要把它们写成核心执行逻辑的替代品
- `specs/` 下文档偏技术规格，不写愿景式表述

## 架构演进约束

- 新增架构说明时，优先保持 CLI / TUI / Runtime Core / Agent Loop / Context Engine / Tool Runtime / Policy Engine / Trace System / Repo Reasoning Engine 的边界清晰
- 不要把仓库理解能力降级成简单文件搜索
- 不要把 Tool Runtime 写成模型函数调用的薄封装，必须保留权限、审计、超时、预算和失败语义

## 修改策略

- 优先补充已有文档，而不是创建大量重复页面
- 新增章节时，确保 README、`docs/`、`specs/` 三层信息粒度一致
- 如果引入新术语，必须同步更新 README 或相关核心文档，避免语义漂移
