# ForgeOne Model Specification

## 目的

本文档定义 ForgeOne `Model Adapter` 的最小协议、输入输出结构以及与 `Runtime`、`Context Engine`、`Tool Runtime` 的边界。`Model Adapter` 是 Runtime 的一个受控组件，不负责隐藏执行状态，也不直接执行 Tool。

当前规格以主仓库已实现结构为基线。

## 设计定位

`Model Adapter` 在 ForgeOne 中负责：

- 消费结构化 `ModelRequest`
- 返回结构化 `ModelResponse`
- 通过显式 `ModelAction` 告诉 Runtime 下一步动作

`Model Adapter` 不负责：

- 自行构建隐式上下文
- 绕过 Runtime 直接调用 Tool
- 自行维护会话状态机
- 直接处理权限、审批或预算

## Model Request

`ModelRequest` 表示一次面向模型的结构化请求。

当前实现字段：

- `request_id`
- `model_name`
- `messages`
- `prompt_token_estimate`

字段说明：

- `request_id`
  - 当前由 Runtime 生成
- `model_name`
  - 来自 `RuntimeConfig.model_name`
- `messages`
  - 来自当前轮 `ContextSnapshot.prompt_messages`
- `prompt_token_estimate`
  - 来自当前轮 `ContextSnapshot.budget_estimate`

约束：

- `Model Adapter` 必须消费显式 `messages`
- 不允许依赖不可观测的隐藏 Prompt 拼接
- `prompt_token_estimate` 必须可进入 `Trace`

## Message 输入约束

当前 `ModelRequest.messages` 使用 `forgeone-context` 中的 `PromptMessage`。

当前字段：

- `message_id`
- `role`
- `content`
- `source_segment_refs`

设计要求：

- `role` 当前主要使用 `system` 和 `user`
- `source_segment_refs` 必须保留，以支持从模型输入反查来源片段
- `Model Adapter` 不应丢弃来源引用语义

## Model Response

`ModelResponse` 表示模型返回的结构化结果。

当前实现字段：

- `response_id`
- `action`
- `summary`

字段说明：

- `response_id`
  - 当前由 `Model Adapter` 生成
- `action`
  - 由模型显式决定下一步动作
- `summary`
  - 用于 `Trace` 和运行时观测摘要

## Model Action

当前 `ModelAction` 枚举：

- `RequestTool`
- `FinalResponse`

### RequestTool

当前字段：

- `tool_name`
- `arguments`

约束：

- `RequestTool` 只表达请求，不直接执行 Tool
- Runtime 收到该动作后，必须生成结构化 `ToolCallRequest`
- Tool 是否可执行由 `Policy Engine` 决定

### FinalResponse

当前字段：

- `content`

约束：

- Runtime 收到该动作后，本轮不再发起 Tool Call
- `content` 将成为当前会话的最终响应内容

## Adapter 接口

当前 `Model Adapter` trait：

```rust
pub trait ModelAdapter {
    fn respond(&self, request: &ModelRequest) -> ModelResponse;
}
```

设计要求：

- Runtime 只依赖统一 `respond(...)` 协议
- 不同模型提供方应通过适配器接入，而不是把 provider 逻辑散落到 Runtime 中
- 适配器替换不应改变 Runtime 的 Loop 语义

## 当前 Mock 实现

主仓库当前提供 `MockModelAdapter`，用于打通 Runtime 主循环。

当前行为：

- 若当前消息中尚未出现 `tool=read_file` 观察摘要，则返回：
  - `ModelAction::RequestTool`
  - `tool_name=read_file`
  - `path=crates/forgeone-runtime/src/lib.rs`
- 若当前消息中已包含 `tool=read_file` 观察摘要，则返回：
  - `ModelAction::FinalResponse`
  - `content=Mock model produced final response after observation`

该实现仅用于验证多轮 `Context -> Model -> Tool -> Observation -> Model` 闭环，不代表 ForgeOne 的最终模型能力边界。

## 与 Runtime 的边界

- Runtime 负责生成 `ModelRequest`
- Runtime 负责持有 `active_model_request` 和 `last_model_response`
- Runtime 负责解释 `ModelAction`
- Runtime 负责把 `model_requested`、`model_responded` 写入 `Trace`

`Model Adapter` 不应：

- 直接更新 `RuntimeState`
- 直接写入 `Trace Store`
- 直接执行 Tool
- 直接访问 `.forgeone/sessions` 或 `.forgeone/traces`

## 与 Context Engine 的边界

- `Context Engine` 负责生成 `ContextSnapshot.prompt_messages`
- `Model Adapter` 只消费这些消息
- 上下文压缩、来源选择、预算裁剪属于 `Context Engine`

因此：

- `Model Adapter` 不应自行重写上下文选择策略
- `Context` 透明性应保留到 `ModelRequest`

## 与 Tool Runtime 的边界

- `Model Adapter` 只能通过 `ModelAction::RequestTool` 请求工具
- Runtime 收到工具请求后，必须进入：
  - `tool_requested`
  - `policy_checked`
  - `tool_completed`
  或 `waiting_approval`

模型不能绕过该链路直接获得工具结果。

## Trace 要求

当前模型链路至少应产生以下 `Trace` 事件：

- `model_requested`
- `model_responded`

当前要求：

- `model_requested` 至少记录模型名、消息数、角色分布、来源引用数、Prompt 预算估算
- `model_responded` 至少记录 `response_id` 和响应摘要

## 当前限制

当前主仓库尚未实现：

- 多 provider 适配
- 模型级错误分类
- 流式响应
- JSON schema 约束输出
- 重试与退避策略

这些能力后续可在 `Model Adapter` 层扩展，但不得破坏当前显式 `ModelRequest / ModelResponse / ModelAction` 协议。
