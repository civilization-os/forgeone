# ForgeOne Context Specification

## 目的

本文档定义 ForgeOne `Context Engine` 的输入、输出、压缩和透明性要求。`Context` 是 Runtime 在某一轮 `Agent Loop` 中可追踪、可裁剪、可回溯的结构化运行时上下文，不等同于单段 prompt。

当前规格以主仓库已实现结构为基线，避免把未来扩展能力误写成当前默认前提。

同时，ForgeOne 对 `Context` 的要求不止是预算内组装 Prompt，而是通过结构化上下文控制模型焦点、降低注意力漂移，并在接近窗口上限时自动压缩与重建。

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
- `layers`
- `prompt_messages`
- `budget`
- `budget_estimate`

约束：

- `ContextSnapshot` 按轮构建，不做无限追加
- `RuntimeState.active_context_snapshot` 只持有当前有效快照
- 全量历史保留在 `Trace`，不要求全部回灌到下一轮 `Context`
- `ContextSnapshot` 的首要目标是保持任务焦点，而不只是缩短 prompt

## 分层语义

当前 `Context Engine` 已开始显式支持以下分层语义：

- `goal_anchor`
- `working_set`
- `evidence_buffer`
- `archive_summary`

约束：

- `goal_anchor` 保留用户目标、关键约束和不可丢失前提
- `working_set` 保留当前轮最相关的活跃上下文
- `evidence_buffer` 保留近期仍影响决策的证据
- `archive_summary` 保留已完成阶段和旧历史摘要

当前实现说明：

- `ContextSource` 和 `SelectedSegment` 已带 `layer`
- `ContextSnapshot.layers` 会汇总每层片段引用和预算估算
- 当前映射规则为：
  - `task_input`、`system_prompt`、`policy_injection` -> `goal_anchor`
  - `working_memory`、`working_set` -> `working_set`
  - 最近 `tool_observation` -> `evidence_buffer`
  - 历史摘要和老 observation 摘要 -> `archive_summary`

后续演进不得退化为平铺式上下文追加。

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
- `working_set`
- `token_budget`

设计要求：

- `task_input` 作为任务锚点必须参与构建
- `working_memory` 用于稳定多轮执行中的当前目标和未完成事项
- `tool_observations` 只注入摘要，不默认注入原始大输出
- 接近预算上限时，应先触发自动压缩和上下文重建

## Context Source

`ContextSource` 表示原始上下文来源对象。

当前支持的 `source_type`：

- `task_input`
- `session_history`
- `tool_observation`
- `system_prompt`
- `policy_injection`
- `working_memory`
- `working_set`

当前实现字段：

- `source_id`
- `source_type`
- `layer`
- `label`
- `content`
- `priority`

约束：

- `system_prompt`、`task_input`、`working_memory` 默认高优先级
- `working_set` 当前也属于高优先级活跃上下文
- `session_history` 当前只保留最近若干项，不回灌全部历史
- `tool_observation` 当前只保留最近若干项摘要
- `ContextSource` 进入 Prompt 前应先被映射到显式的上下文层，而不是无限平铺

说明：

- `repository_file`、`repo_reasoning_result`、`skill_context`、`workflow_context` 不属于当前默认实现
- 若后续接入 `MCP`、`Plugin`、`Skill` 产出的上下文来源，应新增明确 `source_type`，并同步更新本规格

## Selected Segment

`SelectedSegment` 表示最终纳入本轮上下文的片段。

当前实现字段：

- `segment_id`
- `source_id`
- `layer`
- `content`
- `selection_reason`
- `token_estimate`
- `priority`

设计要求：

- 每个片段都必须可回溯到 `source_id`
- `selection_reason` 必须说明该片段为何被保留
- `token_estimate` 用于预算估算和压缩决策
- 片段选择应优先服务当前任务焦点，而不是简单保留最近内容

## Compression Event

当上下文因预算限制被裁剪时，必须记录 `CompressionEvent`。

当前实现字段：

- `event_id`
- `source_id`
- `layer`
- `strategy`
- `reason`

当前支持的 `strategy`：

- `truncate`
- `drop_low_priority`
- `merge_summary`

当前实现说明：

- 第一版默认已实现 `truncate`
- `drop_low_priority` 已在枚举中预留，后续可作为明确淘汰策略接入
- `merge_summary` 已用于合并老历史和老 observation
- 当前未实现模型摘要，不应把 `summarize` 写成默认能力

后续要求：

- 压缩必须是多级链路，而不是单次截断
- 压缩顺序应优先从 `archive_summary` 和低价值 observation 开始
- 只有在多级压缩后仍无法维持最小可执行上下文时，才允许进入异常路径

## Prompt Message

`PromptMessage` 表示最终发送给模型的消息对象。

当前实现字段：

- `message_id`
- `role`
- `content`
- `source_segment_refs`

当前组装规则：

- `goal_anchor` 当前组装为 `system` 消息
- `working_set`、`evidence_buffer`、`archive_summary` 当前组装为 `user` 消息
- `user` 消息当前会附带 `Context Layers` 摘要头
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
- `WorkingMemory` 应作为焦点稳定器，而不是普通历史摘要

## Working Set

`WorkingSet` 是当前实现中显式建模的活跃工作集对象，用于稳定当前轮真正需要保留的文件、子任务和未解问题。

当前实现字段：

- `active_files`
- `active_subtasks`
- `open_questions`

设计要求：

- `WorkingSet` 应显式描述当前活跃文件、当前子任务和当前未解决问题
- `WorkingSet` 应进入 `working_set` 层，而不是退化为普通 observation 文本
- Runtime 应根据当前 Tool Call、最近 Tool Result 和当前模型意图持续重建 `WorkingSet`

## Observation Summary

`ObservationSummary` 用于把 Tool 执行结果压缩成可回灌的工作证据。

当前实现字段：

- `tool_name`
- `summary`

约束：

- 原始 Tool 输出保留在 `Trace` 或 `ToolCallResult`
- `Context` 默认只消费摘要，不强制消费全量输出
- `ObservationSummary` 应优先承载当前决策所需证据，而不是机械回灌所有工具输出

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

后续要求：

- 预算分配应服务焦点保持，而不是平均分配
- `goal_anchor` 和 `working_set` 应优先于 `archive_summary`
- 工具描述、历史和 observation 在预算紧张时必须能够降级

## 多轮控制要求

为避免多轮上下文爆炸，`Context Engine` 实现必须满足：

- 每轮重建 `ContextSnapshot`，而不是无限追加旧消息
- `Trace` 与 `Context` 职责分离
- `WorkingMemory` 与 `session_history` 分层保留
- `tool_observation` 默认只回灌摘要
- 压缩、截断和淘汰行为必须可见
- 接近窗口上限时优先自动压缩与自动重建
- `context overflow` 不应作为常规停止路径

## 最小可执行上下文

`Context Engine` 后续必须能识别“最小可执行上下文”，至少包括：

- `goal_anchor`
- `active_working_set`
- `recent_evidence`
- `operational_policy`
- `working_memory`

约束：

- 正常执行中应尽量保住这组最小上下文
- 若这组最小上下文无法被保留，说明继续执行已可能破坏任务正确性
- 只有此时，Runtime 才可以进入异常恢复或失败路径

## 透明性要求

Context Engine 实现必须满足：

- 能够列出所有来源对象
- 能够说明每个片段为何被选中
- 能够说明哪些内容被压缩、截断或丢弃
- 能够把最终 Prompt 反向映射回来源片段
- 能够给出当前轮预算估算
- 能够说明哪些内容被移出活跃工作集
- 能够说明哪些内容被转入摘要层

## 与其他模块的边界

- `Runtime` 负责触发构建、保存快照引用、写入 `Trace`
- `Context Engine` 不直接执行 Tool，不直接调用 `Policy Engine`
- `Model Adapter` 消费 `prompt_messages`，不应自行重建隐藏上下文
- `Repo Reasoning` 目前不属于默认输入源；如后续接入，应通过新增 `ContextSource` 类型进入，而不是绕过 `Context Engine`
- `Runtime` 应把上下文重建视为正常控制流的一部分，而不是只在失败时调用

## 错误处理

Context 构建失败至少应区分：

- 输入源不可用
- 预算无法满足
- 压缩后仍无法生成有效消息
- 引用映射失效

说明：

- “超限导致无法继续”只应出现在多级压缩和重建已经失败之后
- 单纯因为接近上下文窗口而直接停止，不符合 ForgeOne 的目标边界
