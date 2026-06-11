# ForgeOne CLI Design

## 设计目标

ForgeOne CLI 是 Runtime 的主要本地入口，面向开发者、自动化脚本和调试工作流。

CLI 设计应服务于 Runtime 的透明与可控，而不是隐藏底层执行细节。

## 设计原则

- 命令以任务执行为中心
- 运行参数显式化
- 权限与预算一等化
- Trace 可导出、可检查、可回放
- 与 TUI 共用同一套 Runtime

## 命令分层

当前已实现或已占位的 CLI 子命令如下：

- `run`: 启动一次任务执行
- `approve`: 继续待确认会话
- `resume`: 恢复可继续的历史会话
- `trace`: 检查与清理执行轨迹
- `session`: 检查与清理待确认会话

尚未实现但已保留方向的命令族包括：

- `tool`
- `plugin`
- `mcp`
- `config`

## 关键参数

当前已实现的核心参数：

- `--model`
- `--max-loops`
- `--budget-tokens`
- `--allow-tool`
- `--allow-tools`
- `--approval-read-root`

后续可继续补齐的参数：

- `--budget-seconds`
- `--sandbox`
- `--deny-tools`
- `--trace`
- `--approval-policy`
- `--skill`
- `--workflow`

## CLI 预览

```bash
forgeone run "解释当前仓库架构并给出重构建议"
forgeone run --max-loops 10 --budget-tokens 64000 "修复测试失败"
forgeone run --allow-tools read_file "检查 Runtime 状态机"
forgeone run --approval-read-root crates/ "继续待确认工具调用"
forgeone trace list
forgeone trace show session_xxx
forgeone session list
forgeone approve session_xxx
forgeone resume session_xxx
forgeone trace prune
forgeone session prune
```

## 输出设计

CLI 输出应包含三层信息：

- 用户可读结果
- 执行摘要
- 可进一步查询的 Trace 引用

在调试模式下，还应支持显示：

- 当前上下文来源
- 最后一次模型请求摘要
- 最近一次 Tool Call
- 当前预算消耗
- 当前会话是否处于 `waiting_approval`
- 待确认 Tool 的原因与参数摘要

## 与 TUI 的边界

CLI 适合脚本化和一次性任务；TUI 适合长会话检查与交互式控制。两者共享 Runtime，不共享私有逻辑。
