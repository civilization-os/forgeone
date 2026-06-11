# ForgeOne Vision

## 定位

ForgeOne 是一个开放式 Agent Runtime / Agent Harness，面向代码仓库中的任务执行、上下文构建、工具编排和运行时观测。

项目的核心目标不是提供一个“更会聊天”的界面，而是构建一套工程化的 Agent 基础设施，使 Agent 的执行过程能够被理解、限制、审计和扩展。

ForgeOne 的核心定位：

- Open Agent Runtime
- Open Agent Harness
- Coding Agent Platform
- Transparent Context
- Controllable Execution
- Observable Agent Loop

## 设计原则

### 1. Runtime First

ForgeOne 优先定义运行时模型、状态机、上下文协议和工具协议，再讨论 UI、命令风格或产品封装。

### 2. 可观测优先

Prompt、Context、Tool Call、Runtime State、Agent Loop 都应具备结构化观测面。

### 3. 可控优先

执行权限、沙箱模式、预算上限、循环次数、可用工具集合、外部连接能力都必须可配置。

### 4. 开放扩展

系统原生支持 MCP、Plugin、Skill、Workflow，但扩展能力必须接入统一的 Runtime 与 Trace 语义。

### 5. 仓库理解原生化

Repository Understanding / Repo Reasoning 不作为外部附加功能，而是 Context Engine 和 Runtime 决策的一部分。

## 参考对象

ForgeOne 会参考 Codex CLI、Claude Code、OpenCode 在本地开发工作流中的交互方式和任务组织方式，但实现目标不同：

- 对这些系统中已被证明有效的交互形态保持兼容思路
- 在底层 Runtime、Context、Trace、Policy 和 Tool 执行语义上建立自有实现
- 不依赖 LangGraph 作为执行核心，不将 Agent 定义为图编排应用

## 非目标

以下内容不属于 ForgeOne 的首要目标：

- 通用聊天产品
- 以营销文案为主的 Agent 展示层
- 以固定流程图为核心的编排平台
- 仅做模型 API 的极薄封装

## 成功标准

ForgeOne 的第一阶段成功标准包括：

- 可以清晰展示一次 Agent Task 的完整上下文构建链路
- 可以精确追踪每次模型请求和 Tool Call
- 可以在 Runtime 层配置权限、沙箱、预算与循环上限
- 可以在仓库任务中提供稳定的 Repo Reasoning 能力
- 可以通过 Plugin、Skill、MCP 扩展能力而不破坏核心 Runtime 语义
