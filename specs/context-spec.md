# ForgeOne Context Specification

## 目的

本文档定义 ForgeOne `Context Engine` 的输入、输出、压缩和透明性要求。`Context` 是 Runtime 在某一轮 `Agent Loop` 中可追踪、可裁剪、可回溯的结构化运行时上下文，不等同于单段 prompt。

当前规格以主仓库已实现结构为基线，避免把未来扩展能力误写成当前默认前提。

## Context Snapshot

`ContextSnapshot` 是某一轮 Loop 可供 Runtime 和模型消费的结构化上下文对象。

当前实现字段：

- `snapshot_id`
- `session_id`
- `agent_id`
- `loop_index`
- `sources`
- `selected_segments`
- `compression_events`
- `prompt_messages`
- `budget`
- `budget_estimate`

约束：

- `ContextSnapshot` 按轮构建，不做无限追加
- `RuntimeState.active_context_snapshot` 只持有当前有效快照
- 全量历史保留在 `Trace`，不要求全部回灌到下一轮 `Context`

## Context Build Input

当前 `Context Engine` 的输入结构为 `ContextBuildInput`。

当前实现字段：

- `session_id`
- `agent_id`
- `loop_index`
- `task_input`
- `session_history`
- `tool_observations`
- `system_prompt`
- `policy_injections`
- `working_memory`
- `token_budget`

设计要求：

- `task_input` 作为任务锚点必须参与构建
- `working_memory` 用于稳定多轮执行中的当前目标和未完成事项
- `tool_observations` 只注入摘要，不默认注入原始大输出

## Context Source

`ContextSource` 表示原始上下文来源对象。

当前支持的 `source_type`：

- `task_input`
- `session_history`
- `tool_observation`
- `system_prompt`
- `policy_injection`
- `working_memory`

当前实现字段：

- `source_id`
- `source_type`
- `label`
- `content`
- `priority`

约束：

- `system_prompt`、`task_input`、`working_memory` 默认高优先级
- `session_history` 当前只保留最近若干项，不回灌全部历史
- `tool_observation` 当前只保留最近若干项摘要

说明：

- `repository_file`、`repo_reasoning_result`、`skill_context`、`workflow_context` 不属于当前默认实现
- 若后续接入 `MCP`、`Plugin`、`Skill` 产出的上下文来源，应新增明确 `source_type`，并同步更新本规格

## Selected Segment

`SelectedSegment` 表示最终纳入本轮上下文的片段。

当前实现字段：

- `segment_id`
- `source_id`
- `content`
- `selection_reason`
- `token_estimate`
- `priority`

设计要求：

- 每个片段都必须可回溯到 `source_id`
- `selection_reason` 必须说明该片段为何被保留
- `token_estimate` 用于预算估算和压缩决策

## Compression Event

当上下文因预算限制被裁剪时，必须记录 `CompressionEvent`。

当前实现字段：

- `event_id`
- `source_id`
- `strategy`
- `reason`

当前支持的 `strategy`：

- `truncate`
- `drop_low_priority`

当前实现说明：

- 第一版默认已实现 `truncate`
- `drop_low_priority` 已在枚举中预留，后续可作为明确淘汰策略接入
- 当前未实现模型摘要，不应把 `summarize` 写成默认能力

## Prompt Message

`PromptMessage` 表示最终发送给模型的消息对象。

当前实现字段：

- `message_id`
- `role`
- `content`
- `source_segment_refs`

当前组装规则：

- 高优先级片段当前组装为 `system` 消息
- 其余片段当前组装为 `user` 消息
- `source_segment_refs` 必须保留，以支持 Prompt 到来源片段的反向映射

## Working Memory

`WorkingMemory` 是当前实现中防止多轮爆炸的关键结构，不应与普通历史混用。

当前实现字段：

- `current_goal`
- `completed_items`
- `pending_items`

设计要求：

- `WorkingMemory` 应描述当前目标、已完成事项和待完成事项
- 该结构应优先于旧历史保留在当前轮上下文中

## Observation Summary

`ObservationSummary` 用于把 Tool 执行结果压缩成可回灌的工作证据。

当前实现字段：

- `tool_name`
- `summary`

约束：

- 原始 Tool 输出保留在 `Trace` 或 `ToolCallResult`
- `Context` 默认只消费摘要，不强制消费全量输出

## Context Budget

`ContextBudget` 用于将总预算分配给不同上下文层。

当前实现字段：

- `total_tokens`
- `reserved_system_tokens`
- `reserved_working_memory_tokens`
- `reserved_recent_tokens`
- `reserved_observation_tokens`

当前默认分配策略：

- `system_prompt`: 15%
- `working_memory`: 15%
- `recent history`: 20%
- `tool observations`: 30%

剩余预算由任务锚点和其他高优先级内容自然占用。该分配策略是当前实现细节，后续可演进，但必须保持显式可解释。

## 多轮控制要求

为避免多轮上下文爆炸，`Context Engine` 实现必须满足：

- 每轮重建 `ContextSnapshot`，而不是无限追加旧消息
- `Trace` 与 `Context` 职责分离
- `WorkingMemory` 与 `session_history` 分层保留
- `tool_observation` 默认只回灌摘要
- 压缩、截断和淘汰行为必须可见

## 透明性要求

Context Engine 实现必须满足：

- 能够列出所有来源对象
- 能够说明每个片段为何被选中
- 能够说明哪些内容被压缩、截断或丢弃
- 能够把最终 Prompt 反向映射回来源片段
- 能够给出当前轮预算估算

## 与其他模块的边界

- `Runtime` 负责触发构建、保存快照引用、写入 `Trace`
- `Context Engine` 不直接执行 Tool，不直接调用 `Policy Engine`
- `Model Adapter` 消费 `prompt_messages`，不应自行重建隐藏上下文
- `Repo Reasoning` 目前不属于默认输入源；如后续接入，应通过新增 `ContextSource` 类型进入，而不是绕过 `Context Engine`

## 错误处理

Context 构建失败至少应区分：

- 输入源不可用
- 预算无法满足
- 压缩后仍无法生成有效消息
- 引用映射失效
