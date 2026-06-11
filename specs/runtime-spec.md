# ForgeOne Runtime Specification

## 目的

本文档定义 ForgeOne `Runtime` 的核心执行语义、状态约束、`Trace` 事件模型和本地会话控制面。本文档以主仓库当前实现为基线，不把未来扩展状态误写成既有能力。

## 术语

- `session`: 一次可恢复的运行会话
- `task`: 会话中的顶层用户任务
- `loop`: Agent Loop 的单轮执行
- `observation`: 工具执行或外部输入产生的结构化观察
- `stop_reason`: 会话结束原因

## Runtime 实体

### Session

当前实现字段：

- `session_id`
- `task`
- `config`

### Task

当前实现字段：

- `task_id`
- `input`

### Runtime State

当前实现字段：

- `session_id`
- `task_id`
- `agent_id`
- `parent_agent_id`
- `loop_index`
- `status`
- `current_phase`
- `active_step`
- `active_context_snapshot`
- `active_model_request`
- `last_model_response`
- `active_tool_call`
- `last_tool_result`
- `budget_usage`
- `observations`
- `policy_decisions`
- `pending_approval`
- `stop_reason`

补充说明：

- `RuntimeState` 是单 Agent 当前轮的可观测执行状态
- `active_context_snapshot`、`active_model_request`、`active_tool_call` 用于暴露当前活跃对象
- `last_model_response`、`last_tool_result` 用于保留上一关键阶段的结构化结果

### Budget Usage

当前实现字段：

- `tokens_estimate`
- `tool_call_count`

### Policy Record

当前实现字段：

- `scope`
- `decision`
- `detail`

### Pending Approval

当前实现字段：

- `tool_name`
- `reason`
- `argument_summary`

## 状态机

当前实现状态：

- `created`
- `running`
- `waiting_approval`
- `completed`

状态迁移约束：

- `created -> running`
- `running -> waiting_approval`
- `waiting_approval -> running`
- `running -> completed`

说明：

- `failed`、`cancelled` 尚未在当前实现中落地，不应当作既有状态表述

## 阶段与步骤

当前 `RuntimePhase`：

- `input`
- `context_build`
- `model_request`
- `tool_decision`
- `state_update`
- `finalize`

当前 `LoopStep`：

- `context_build`
- `model_request`
- `tool_decision`
- `tool_execution`
- `state_update`

约束：

- `RuntimePhase` 是面向外部观测的粗粒度阶段
- `LoopStep` 是 Runtime 内部推进当前轮的更细粒度步骤
- 每次状态迁移都应同步更新 `status`、`current_phase` 和 `active_step`

## Loop 语义

每一轮 Loop 至少包含：

1. 构建 Context Snapshot
2. 生成 Model Request
3. 解析 Model Response
4. 决定下一步动作
5. 如需工具则执行 Tool Call
6. 生成 Observation
7. 更新 Runtime State
8. 判断 Stop Condition

当前实现已支持：

- `task_received -> loop_started -> context_built -> model_requested -> model_responded`
- 多轮 Context -> Model -> Tool -> Observation 闭环
- Model Response 决定是 `RequestTool` 还是 `FinalResponse`
- Tool Execution 前统一经过 Policy Engine
- 命中确认门槛时进入 `waiting_approval`
- `approve` / `resume` 从待确认点继续执行

当前模型路径说明：

- 若模型返回 `RequestTool`，Runtime 生成 `ToolCallRequest`
- 若模型返回 `FinalResponse`，Runtime 本轮不再执行 Tool
- Tool 执行完成后，`Observation` 进入下一轮 `Context`

## Stop Condition

当前实现中的 `StopReason` 枚举仅包含：

- `final_response`
- `max_loops_reached`

当前确认态说明：

- `approval_required` 当前不是 `StopReason` 枚举成员
- 当会话命中确认门槛时，Runtime 通过：
  - `status=waiting_approval`
  - `pending_approval`
  - `SessionStopped` Trace 事件中的 `stop_reason=approval_required`
  来表达“当前轮暂停等待人工确认”

因此，确认态属于 Runtime 控制面语义，而不是当前 `StopReason` 枚举的一部分。

## 预算控制

当前实现已接入的预算维度：

- Token 预算
- Tool Call 次数预算

当前实现说明：

- `token_budget` 已进入 `RuntimeConfig`，并传入 `Context Engine` / `Model Request` 观测链路
- `max_tool_calls` 由 `Policy Engine` 执行
- `tokens_estimate` 与 `tool_call_count` 会写入 `RuntimeState` 和 `SessionTraceRecord`

预留但未落地：

- 时间预算
- 外部请求预算
- 预算超限后的专门停止原因

## Trace 要求

Runtime 必须为以下事件生成 Trace：

- `task_received`
- `loop_started`
- `context_built`
- `model_requested`
- `model_responded`
- `policy_checked`
- `tool_requested`
- `tool_completed`
- `state_updated`
- `session_stopped`

当前实现中：

- 每条 `TraceEvent` 当前包含：
  - `timestamp_ms`
  - `session_id`
  - `agent_id`
  - `parent_agent_id`
  - `loop_index`
  - `kind`
  - `message`
- `policy_checked` 用于记录 `allowed / require_approval / approved_by_user / denied`
- `tool_requested` 与 `tool_completed` 已从泛化 `state_updated` 中拆出
- 当模型直接返回最终答案时，当前实现会用一条 `state_updated` 记录 `tool_decision=final_response`
- `Trace` 会落盘到 `.forgeone/traces/<session_id>.json`

### Trace Event 语义

- `task_received`
  - 顶层任务被 Runtime 接收
- `loop_started`
  - 新一轮 `Agent Loop` 开始
- `context_built`
  - 当前轮 `ContextSnapshot` 已生成
- `model_requested`
  - 当前轮 `ModelRequest` 已构造
- `model_responded`
  - 模型返回结构化响应
- `tool_requested`
  - Runtime 已生成 `ToolCallRequest`
- `policy_checked`
  - `Policy Engine` 已给出允许、拒绝或要求确认的决策
- `tool_completed`
  - Tool 执行完成并产生结果
- `state_updated`
  - 关键状态字段、预算和计数已刷新
- `session_stopped`
  - 当前运行结束或暂停

### Trace Store

当前实现的本地 `Trace Store` 记录结构为 `SessionTraceRecord`。

当前字段：

- `session_id`
- `task_id`
- `task_input`
- `agent_id`
- `status`
- `current_phase`
- `loop_index`
- `stop_reason`
- `final_response`
- `approval_required`
- `pending_approval`
- `token_budget`
- `tokens_estimate`
- `tool_call_count`
- `trace`

约束：

- `trace` 是本次运行输出的事件数组
- `approval_required=true` 时，`pending_approval` 必须存在
- 完成态会话可检查，但当前不支持通用重放

## 会话控制

当前实现已支持以下 CLI 恢复与检查语义：

- `approve <session_id>`
- `resume <session_id>`
- `trace list`
- `trace show <session_id>`
- `session list`
- `trace prune`
- `session prune`

其中：

- `resume` 当前优先支持从待确认会话继续
- 完成态 trace 可检查，但不支持通用执行重放

### Pending Approval Store

待确认会话会落盘到 `.forgeone/sessions/<session_id>.json`。

当前记录结构为 `ApprovalSessionRecord`，包含：

- `session_id`
- `task_id`
- `task_input`
- `agent_id`
- `loop_index`
- `max_loops`
- `token_budget`
- `model_name`
- `allowed_tools`
- `read_roots`
- `approval_read_roots`
- `max_tool_calls`
- `tokens_estimate`
- `tool_call_count`
- `observations`
- `policy_decisions`
- `active_tool_call`
- `pending_approval`

设计要求：

- 确认恢复所需的最小执行状态必须完整保留
- `approve` 与当前 `resume` 都依赖该记录恢复运行
- 待确认记录在会话完成后应被删除

## 一致性要求

- 所有工具执行都必须可归属到某个 `loop_index`
- 所有 Observation 都必须可追溯到触发它的工具或输入事件
- 所有停止原因都必须具有结构化字段，不允许只保留自然语言描述
- 需要人工确认的 Tool Call 必须在 Runtime State 与 Trace 中留下结构化恢复点
- `SessionTraceRecord` 与 `ApprovalSessionRecord` 不得绕过 Runtime 私自生成
