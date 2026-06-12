# ForgeOne Plugin System

## 目标

Plugin System 用于在不修改 Runtime Core 的情况下扩展 ForgeOne 能力边界。

插件是面向仓库级或组织级复用的扩展单元，适合承载工具集成、上下文提供器、策略扩展器、Trace 输出器和执行器适配器。

## 设计原则

- 插件通过显式注册接入 Runtime
- 插件能力必须声明权限与兼容版本
- 插件不能绕过 Tool Runtime、Policy Engine 和 Trace System
- 插件失败不能破坏核心 Runtime 一致性

## 可扩展点

插件可以注册以下类型的扩展点：

- Tool Provider
- Context Provider
- Policy Hook
- Trace Sink
- Output Formatter
- Repo Reasoning Provider

## 生命周期

```mermaid
flowchart LR
    A[Discover Plugin] --> B[Load Manifest]
    B --> C[Check Compatibility]
    C --> D[Register Capabilities]
    D --> E[Policy Review]
    E --> F[Runtime Activation]
```

## Manifest 建议字段

- `name`
- `version`
- `api_version`
- `capabilities`
- `required_permissions`
- `entrypoints`
- `config_schema`

## 当前落地边界

- 工作区通过 `.forgeone/plugins/*.json` 声明 Plugin 清单
- 当前清单用于 Provider 发现、能力枚举与 `forgeone plugin list`
- Plugin Entrypoint 尚未接入主执行链路，执行态仍待后续 Runtime 集成
- 一旦进入执行态，Plugin Tool 仍必须经过 `Tool Runtime -> Policy Engine -> Trace System`

## 与 Tool Runtime 的关系

若插件提供工具能力，这些能力必须：

- 注册到 Tool Runtime
- 定义输入输出模式
- 声明权限需求
- 参与 Trace 记录
- 遵守预算与沙箱约束

## 与 Skill System 的关系

Plugin 更偏向能力提供，Skill 更偏向任务模式组织。插件可以提供 Skill 所需工具，但不应把 Skill 与插件本身混为一体。
