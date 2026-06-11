# ForgeOne Tool Specification

## 目的

本文档定义 ForgeOne `Tool Runtime` 中工具的注册、调度、策略检查、执行和返回协议。`Tool` 是受 Runtime 调度和审计的能力单元，不等同于任意函数调用。

当前规格以主仓库已实现结构为基线，重点覆盖统一描述符、Tool Call 协议和 `Policy Engine` 接入点。

## Tool Descriptor

每个 Tool 必须通过结构化描述符注册。

当前实现字段：

- `tool_name`
- `description`
- `kind`
- `required_permissions`

当前 `kind` 枚举：

- `builtin`
- `mcp`
- `plugin`
- `skill`
- `workflow`

当前实现说明：

- 主仓库当前只内建了 `read_file`
- `MCP`、`Plugin`、`Skill`、`Workflow` 类型已在协议层预留，但尚未在主链路中落地执行器

## Tool Registry

`ToolRegistry` 负责维护可用工具集合，并按 `tool_name` 分发执行。

当前要求：

- 未注册工具必须返回结构化 `validation_error`
- Runtime 不应绕过 `ToolRegistry` 直接调用底层执行逻辑
- 新增工具必须先注册，再由 Runtime 调度

## Tool Call Request

`ToolCallRequest` 表示一次结构化工具调用请求。

当前实现字段：

- `call_id`
- `session_id`
- `agent_id`
- `loop_index`
- `tool_name`
- `arguments`
- `requested_by`

当前实现说明：

- `arguments` 当前为 `HashMap<String, String>`
- `requested_by` 当前为字符串，已实际使用 `model` 和 `runtime`
- 后续若扩展 `operator` 或其他来源，应保持可追踪来源语义

## Tool Call Result

`ToolCallResult` 表示一次工具执行的结构化结果。

当前实现字段：

- `call_id`
- `status`
- `structured_output`
- `error`
- `completed_at_ms`

当前 `status` 枚举：

- `success`
- `validation_error`
- `permission_denied`
- `failed`

当前实现说明：

- `structured_output` 当前为 `HashMap<String, String>`
- `error` 当前为单字符串
- `completed_at_ms` 使用毫秒时间戳，便于和 Trace 对齐
- `sandbox_denied`、`timeout`、`cancelled` 尚未在当前实现中落地，不应当作既有能力表述

## Observation

Tool 执行结果进入下一轮上下文前，应先压缩成 `Observation`。

当前实现字段：

- `tool_name`
- `summary`

设计要求：

- `Observation` 面向 `Context Engine` 回灌
- 原始输出保留在 `ToolCallResult` 和 `Trace`
- 不要求把大体积 `structured_output` 原样塞回下一轮上下文

## 当前内建 Tool

当前主仓库已实现的内建 Tool：

- `read_file`

当前行为：

- 输入参数必须包含 `path`
- 成功时返回：
  - `path`
  - `preview`
  - `bytes`
- 未提供 `path` 时返回 `validation_error`
- 文件读取失败时返回 `failed`

## 权限与审批模型

Tool 不自行做最终权限决策，必须由 `Policy Engine` 在执行前统一检查。

当前 `PolicyConfig` 覆盖：

- `allowed_tools`
- `read_roots`
- `max_tool_calls`
- `approval_read_roots`

当前 `PolicyDecision`：

- `Allowed`
- `RequireApproval`
- `Denied`

当前行为：

- 工具不在 `allowed_tools` 中时拒绝执行
- 超出最大工具调用数时拒绝执行
- `read_file` 路径不在允许前缀中时拒绝执行
- `read_file` 命中审批前缀时进入 `RequireApproval`

约束：

- `Tool Runtime` 不得绕过 `Policy Engine`
- 审批要求属于 Runtime 控制面，不属于 Tool 自身逻辑

## 人工确认语义

当策略返回 `RequireApproval` 时：

- Runtime 不执行该 Tool
- 会话进入 `waiting_approval`
- 待确认请求持久化到 `.forgeone/sessions/<session_id>.json`
- 后续通过 `approve` 或 `resume` 恢复执行

这条链路是当前已实现能力，应视为 `Tool Runtime` 和 `Policy Engine` 的标准交互路径之一。

## Trace 要求

每次 Tool Call 至少应在 `Trace` 中可见以下阶段：

- `tool_requested`
- `policy_checked`
- `tool_completed`

当前要求：

- `tool_requested` 记录工具名称、参数摘要和请求来源
- `policy_checked` 记录 `allowed / require_approval / denied`
- `tool_completed` 记录状态码和输出摘要

如果策略要求人工确认，则本轮通常只会出现：

- `tool_requested`
- `policy_checked`

并以 `approval_required` 结束当前执行，直到人工恢复。

## 错误语义

当前实现中的错误至少应区分：

- 工具未注册
- 参数缺失或格式不合法
- 权限拒绝
- 底层执行失败

后续若引入沙箱、超时、取消等控制面，应新增明确状态和错误对象，而不是复用 `failed`。

## 与其他模块的边界

- `Runtime` 负责生成 `ToolCallRequest`、接收 `ToolCallResult`、推进 `Agent Loop`
- `Policy Engine` 负责权限、预算和审批决策
- `Context Engine` 只消费 `Observation` 摘要，不直接执行 Tool
- `Model Adapter` 可以请求 Tool，但不直接调用 Tool Executor
- `Workflow` 若触发执行能力，必须映射为结构化 Tool Call，不得绕过 `Tool Runtime`

## 兼容性要求

- `builtin`、`MCP`、`Plugin`、`Skill` 类型工具都应暴露统一 `ToolDescriptor`
- Runtime 对外只依赖统一 `ToolCallRequest / ToolCallResult` 协议
- 后续扩展不得破坏当前 `Tool Runtime -> Policy Engine -> Trace` 的可观测链路
