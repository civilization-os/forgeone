# ForgeOne 桌面端应用设计方案 (Desktop Application Design Notes)

本文档记录了关于 ForgeOne 桌面客户端应用整体架构与主菜单界面的讨论及设计结论。本方案由团队共同制定，作为后续前端开发和后端 API 适配的重要依据。

## 整体架构 (Overall Architecture)

ForgeOne 桌面端采用经典的 **Vite + React + TS (前端)** 与 **Rust Sidecar 进程 (后端)** 的混合架构，利用 **Electron** 作为桌面窗体容器：

1. **渲染进程 (React Front-end)**：提供高质感的毛玻璃与深色 Slate 主题 UI，通过安全 IPC 管道向主进程收发指令。
2. **主进程 (Electron Main Process)**：管理窗口生命周期，并在启动时拉起后台 Rust Sidecar 进程，建立管道双向通信（Stdio JSON-RPC 2.0）。
3. **独立后台 (Rust Sidecar Server)**：通过 `forgeone-server` 暴露 Runtime 接口，具有完整的本地系统读写和 Terminal 执行权限。

---

## 侧边栏主菜单导航 (Main Sidebar Navigation)

为符合“硬核、透明、可控”的运行时承载层（Runtime Harness）定位，主菜单功能板块将不采用松散的 Web 模板样式，而是采用原生桌面端应用的标准设计。

主菜单将仅保留以下 **7 大核心业务板块**：

1. 💬 **聊天 (Chat)**
   * **功能**：与 Agent 交互的主对话流界面。
   * **设计**：采用 IM 气泡对话设计，将流式 Trace 运行日志折叠嵌入在 Agent 回答气泡中，并将需要安全授权的工具调用卡片行内嵌入对话流。
2. 📂 **项目 (Project)**
   * **功能**：选定 Agent 工作的本地仓库目录，配置其路径读写规则（只读/禁止读写等）。
3. 🤖 **模型 (Model)**
   * **功能**：管理底层大语言模型（如 OpenAI、本地 Ollama 等），提供连接测试与温度、Token 预算等全局大模型参数配置。
4. 🔌 **MCP**
   * **功能**：以 Client-Server 进程模式连接外部 Model Context Protocol 服务的管理看板，支持启动/暂停特定 MCP 服务。
5. ⚡ **技能 (Skill)**
   * **功能**：管理本地静态加载的 Python/JS 插件脚本或本地 Prompt 技能集。
6. 🛡️ **策略 (Policy)**
   * **功能**：设定高危工具（如运行 Shell、重构文件）的拦截策略，以及任务熔断的预算阈值（最大步数、最大 Token 消耗）。
7. 📊 **追踪 (Trace)**
   * **功能**：全局的 Agent 思考过程深度调试查看器，可审计 Token 膨胀曲线和历史 Tool Call 的原始报文。

---

## 软件全局偏好设置 (App Preferences & Settings)

为保持主菜单区域的专注与整洁，**全局网络代理（Socks5/HTTP Proxy）配置**、磁盘缓存清理、自动更新等杂项设置将**不占用主菜单栏**。

偏好设置将采取以下两种原生解耦交互模式之一：
* **侧边栏底部齿轮 (Sidebar Footer)**：在侧边栏最底部左下角放置独立的 `⚙️` 图标，点击后弹窗展示全局 App Settings 面板。
* **原生 OS 菜单栏 (Native Menu)**：挂载于 Windows 操作系统的窗口顶部原生菜单栏中（如 `文件 -> 设置` 或 `编辑 -> 首选项`），并支持通过快捷键 `Ctrl + ,` 唤醒。
