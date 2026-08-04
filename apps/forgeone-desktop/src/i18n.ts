import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

const resources = {
  en: {
    translation: {
      "app.title": "ForgeOne",
      "status.connected": "Runtime Active",
      "status.disconnected": "Runtime Offline",
      
      "tab.chat": "Chat",
      "tab.project": "Project",
      "tab.model": "Model",
      "tab.mcp": "MCP",
      "tab.skill": "Skill",
      "tab.policy": "Policy",
      "tab.trace": "Trace",
      "tab.settings": "Preferences",

      "chat.placeholder": "Send a command or prompt to Agent...",
      "chat.empty": "Start a new Agent Loop task.",
      "chat.approval.title": "Pending Tool Approval",
      "chat.approval.approve": "Approve",
      "chat.approval.deny": "Deny",

      "project.title": "Project Workspace",
      "project.subtitle": "Configure active codebase and path execution permissions",
      "project.select": "Select Repository",

      "model.title": "Model Management",
      "model.subtitle": "Manage LLM endpoints, API keys, and TS script custom adapters",
      "model.ts_bridge.title": "TypeScript Custom Adapter",
      "model.ts_bridge.desc": "Connect models using custom .ts script hooks for complex enterprise proxies",
      "model.ts_bridge.script_path": "Script Entry Path",
      "model.ts_bridge.test_btn": "Test TS Script Connection",
      "model.ts_bridge.test_success": "TS Adapter connection verified successfully!",

      "mcp.title": "MCP Service Manager",
      "mcp.subtitle": "Control external Model Context Protocol server instances",

      "skill.title": "Skill Registry",
      "skill.subtitle": "Manage prompt templates and local python/js capabilities",

      "policy.title": "Policy & Security Engine",
      "policy.subtitle": "Configure execution sandboxes, tool interceptors, and budgets",

      "trace.title": "Runtime Trace Inspector",
      "trace.subtitle": "Deep inspection into Agent execution loops, context snapshots, and tool events",

      "settings.title": "App Preferences",
      "settings.proxy": "Global Network Proxy",
      "settings.language": "Language Preference",

      "sys.connected": "[System] ForgeOne Runtime Connected",
      "sys.reconnecting": "[System] Reconnecting..."
    }
  },
  zh: {
    translation: {
      "app.title": "ForgeOne",
      "status.connected": "Runtime 已连接",
      "status.disconnected": "Runtime 未连接",
      
      "tab.chat": "聊天 (Chat)",
      "tab.project": "项目 (Project)",
      "tab.model": "模型 (Model)",
      "tab.mcp": "MCP 服务",
      "tab.skill": "技能 (Skill)",
      "tab.policy": "策略 (Policy)",
      "tab.trace": "追踪 (Trace)",
      "tab.settings": "偏好设置",

      "chat.placeholder": "输入指令或任务给 Agent...",
      "chat.empty": "开启一个新的 Agent Loop 执行任务。",
      "chat.approval.title": "待审批工具调用 (Pending Approval)",
      "chat.approval.approve": "批准执行",
      "chat.approval.deny": "拒绝",

      "project.title": "项目工作区 (Workspace)",
      "project.subtitle": "配置 Agent 工作的本地代码仓库与路径读写权限",
      "project.select": "选择仓库",

      "model.title": "大语言模型管理 (Model Management)",
      "model.subtitle": "统一配置 LLM Endpoint、API 密钥以及 TS 脚本自定义模型适配器",
      "model.ts_bridge.title": "TypeScript 脚本模型适配器",
      "model.ts_bridge.desc": "使用自定义 .ts 脚本动态中转/接入大模型，轻松应对复杂鉴权与私有网关",
      "model.ts_bridge.script_path": "TS 脚本入口路径",
      "model.ts_bridge.test_btn": "测试 TS 脚本连接",
      "model.ts_bridge.test_success": "TS 适配器逻辑校验通过，能够正常接收并转发推理请求！",

      "mcp.title": "MCP 服务管理 (MCP Services)",
      "mcp.subtitle": "管理外部 Model Context Protocol 服务进程的启动与监听",

      "skill.title": "技能库管理 (Skill Registry)",
      "skill.subtitle": "管理静态 Prompt 技能与本地 Python / JS 扩展脚本",

      "policy.title": "策略与安全引擎 (Policy Engine)",
      "policy.subtitle": "设置高危 Tool 拦截拦截规则、沙箱隔离及 Token/步数熔断阈值",

      "trace.title": "运行时 Trace 检视器 (Trace Inspector)",
      "trace.subtitle": "全局查看 Agent Loop 的思考链路、Context 快照与 Tool 原始报文",

      "settings.title": "全局偏好设置",
      "settings.proxy": "网络代理 (Socks5 / HTTP Proxy)",
      "settings.language": "界面语言",

      "sys.connected": "[系统] ForgeOne Runtime 核心服务就绪",
      "sys.reconnecting": "[系统] 正在尝试重连..."
    }
  }
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'zh',
    interpolation: {
      escapeValue: false 
    }
  });

export default i18n;
