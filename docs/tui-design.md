# ForgeOne TUI Design

## 目标

ForgeOne TUI 是 Runtime 的交互式 Harness，不是另一套独立执行逻辑。

它的职责是把以下能力以终端控制面的形式暴露出来：

- 聊天式任务输入
- 当前 Agent Loop 观察
- 多 Agent 树切换
- Tool Runtime 结果检查
- Trace Timeline 检查
- 运行中控制与确认操作

TUI 不替代 Runtime Core。所有输入、确认、恢复、派生和查询都必须回到 Runtime、Policy Engine 和 Trace System。

## 交互定位

TUI 采用 `chat-first, inspectable runtime` 模式：

- 聊天输入是主交互入口
- Loop / Tool / Trace 是主检查面
- 用户不需要一次性描述完整需求
- Runtime 需要承接澄清、追问、纠偏和中途控制

这意味着 ForgeOne TUI 既不是纯聊天窗口，也不是只读状态看板，而是面向 Coding Agent 的交互式控制面。

## 首屏结构

首屏采用一屏闭环布局，优先让用户在一个视图中完成：

1. 选择 Agent
2. 检查当前 Loop
3. 查看最近 Tool 结果
4. 回看 Trace Timeline
5. 继续自然语言输入

```text
+--------------------------------------------------------------------------------+
| ForgeOne v0.1.0  Session: s-xxx  Agents: 3  Focus: input                       |
+------------------+-----------------------------------+-------------------------+
| Agents           | Active Agent Loop                 | Tool Results            |
| * root           | Agent: agent-root (active)        | read_file               |
|   |- a1          | Loop 4/10   status=running        | crates/.../lib.rs       |
|   |- a2          | [x] ContextBuild                  | line 1420               |
|                  | [>] ModelRequest                  |                         |
|                  | [x] ToolExecution                 |                         |
|                  | [ ] StateUpdate                   |                         |
+------------------+-----------------------------------+-------------------------+
| Trace Timeline                                                      filter: all |
| [12:34:01] agent-root   task_received   inspect repo                           |
| [12:34:02] agent-root   model_requested openai:gpt-4o                          |
| [12:34:03] agent-a1     spawned         "search files"                         |
+--------------------------------------------------------------------------------+
| Chat Input                                                                     |
| > Type a task, follow-up, or /command                                          |
+--------------------------------------------------------------------------------+
```

## 面板定义

### Header Bar

显示运行级摘要：

- ForgeOne 版本
- 当前 `session_id`
- 当前活跃 Agent 数
- 当前焦点面板

后续可扩展：

- Policy 模式
- Token / 时间预算
- `waiting_approval` 徽标

### Agents Pane

左栏是 Agent 树，不是会话消息列表。

显示内容：

- 当前 Session 下的 Agent 层级
- 当前选中 Agent
- 父子 Agent 关系

交互目标：

- 在多 Agent 场景下快速切换观察对象
- 不把父子 Agent 混成一条聊天流

### Active Agent Loop Pane

中栏永远聚焦当前选中 Agent 的运行状态。

显示内容：

- `agent_id`
- 当前 `loop_index / max_loops`
- `status`
- 当前 Loop Step 序列
- 最近一次 Tool
- 当前预算消耗

这是首屏的主视觉中心，因为 ForgeOne 的核心差异是 `Observable Agent Loop`，不是消息流本身。

### Tool Results Pane

右栏展示最近一次或最近几次 Tool 结果摘要。

显示内容：

- Tool 名称
- 目标路径或参数摘要
- 成功 / 失败结果
- 预览内容或错误摘要

首版不要求完整结果浏览器，但必须能让用户在不跳屏的情况下知道 Agent 最近执行了什么。

### Trace Timeline Pane

底部中大区展示 Trace Timeline。

显示内容：

- 时间
- `agent_id`
- `TraceEvent.kind`
- 摘要信息

交互要求：

- 支持滚动
- 支持按 Agent 或事件类型过滤
- 支持跳转到最新事件

Trace 是运行轨迹，不应降级成普通日志输出。

### Chat Input Pane

底部输入区采用聊天形式。

支持输入类型：

- 新任务
- 跟进指令
- 澄清回答
- 运行时命令

命令形式建议采用轻量 `/command`，例如：

- `/approve`
- `/resume`
- `/trace filter agent-root`

但默认输入路径仍应是自然语言，而不是参数表单。

## 焦点模型

首版只保留三个焦点面板：

- `agents`
- `trace`
- `input`

切换原则：

- `Tab` 在三者之间循环
- `Up/Down` 在当前可滚动面板内移动
- 输入只在 `input` 焦点下生效

这样可以在首版避免复杂的多面板键位冲突。

## 聊天与观察的关系

ForgeOne TUI 不是把聊天和观察拆成两套产品，而是把两者叠合：

- 聊天负责表达意图、补充上下文和纠偏
- Runtime 负责推理、执行和拆分 Agent
- TUI 负责把执行过程和中间状态暴露出来

因此，聊天消息不应绕过 Runtime：

- 用户输入要进入 Session History / Context
- Agent 追问要进入 Trace
- Tool Call、Policy Decision、Approval 仍要结构化记录

## 多 Agent 视图

多 Agent 是 TUI 的一等能力，不是未来再补的附属列表。

首版只要求：

- 在 Agent 树中显示父子结构
- 能切换当前观察 Agent
- 在 Trace 中保留 `agent_id`

后续迭代再补：

- Agent 派生事件高亮
- 子 Agent 独立预算 / Policy / Context 详情
- 父 Agent 接收子 Agent Observation 的回流视图

## 可视调测策略

TUI 的可视调测不依赖手工盯屏，而依赖稳定渲染路径：

- 使用 `ratatui::backend::TestBackend` 做静态渲染测试
- 使用 mock session / mock trace 做重放
- 对关键面板做文本快照断言

这样可以保证：

- 布局变更可回归
- 首屏信息结构不会在迭代中被破坏
- 未来引入真实 Runtime 数据后仍能保留稳定测试

## 首版范围

当前已经落地的 `forgeone-tui` 首版骨架仅包含：

- `Header Bar`
- `Agents Pane`
- `Active Agent Loop Pane`
- `Tool Results Pane`
- `Trace Timeline Pane`
- `Chat Input Pane`

并采用 mock dashboard 数据渲染，不依赖 Runtime Core 改造。

## 后续迭代顺序

建议按以下顺序推进：

1. 接入真实 Session / Trace 读取
2. 接入真实 Agent Tree 数据源
3. 将输入映射到 Runtime 命令
4. 增加 `waiting_approval` 专用视图
5. 增加 Conversation Drawer
6. 增加 Context / Policy / Model 深入检查页

## 与 CLI 的边界

CLI 仍适合：

- 脚本化运行
- 批处理任务
- 外部自动化调用

TUI 适合：

- 长会话检查
- 多 Agent 观察
- 交互式运行控制
- 审批与恢复操作

两者共享同一套 Runtime 与 Trace 语义，不共享私有执行逻辑。
