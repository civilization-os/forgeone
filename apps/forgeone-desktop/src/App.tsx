import React, { useState, useEffect, useRef } from 'react';
import hljs from 'highlight.js';
import 'highlight.js/styles/github.css';

interface TraceEvent {
  timestamp_ms: number;
  session_id: string;
  agent_id: string;
  parent_agent_id: string | null;
  loop_index: number;
  kind: string;
  message: string;
}

interface PendingApproval {
  tool_name: string;
  reason: string;
  argument_summary: string;
}

interface RuntimeState {
  session_id: string;
  task_id: string;
  agent_id: string;
  parent_agent_id: string | null;
  loop_index: number;
  status: string;
  current_phase: string;
  observations: Array<{ tool_name: string; summary: string; content: string | null }>;
  policy_decisions: Array<{ scope: string; decision: string; detail: string }>;
  pending_approval: PendingApproval | null;
  budget_usage: { tokens_estimate: number; tool_call_count: number };
  stop_reason: string | null;
}

interface RunResult {
  state: RuntimeState;
  final_response: string;
  trace: TraceEvent[];
}

interface HistoricalTrace {
  session_id: string;
  conversation_id: string;
  turn_index: number;
  task_input: string;
  status: string;
  loop_index: number;
  stop_reason: string;
  approval_required: boolean;
  updated_at_ms: number;
}

interface ConversationTurn {
  role: 'user' | 'agent';
  content: string;
}

interface ConversationSummary {
  conversation_id: string;
  title: string;
  session_id: string;
  status: string;
  loop_index: number;
  latestSessionId: string;
  latestStatus: string;
  turnCount: number;
  updatedAtMs: number;
  sessionIds: string[];
}

interface Message {
  id: string;
  sender: 'user' | 'agent';
  content: string;
  timestamp: number;
  trace?: TraceEvent[];
  pendingApproval?: PendingApproval | null;
  status?: string;
  budgetUsage?: { tokens_estimate: number; tool_call_count: number };
  streaming?: boolean; // 正在流式输出中
  animateOnLoad?: boolean;
  runStartedAt?: number;
  runCompletedAt?: number;
  agentId?: string;
}

interface ModelProfile {
  id: string;
  name: string;
  type: 'official' | 'custom_simple' | 'custom_script';
  protocol: 'openai' | 'anthropic';
  provider: string;
  baseUrl: string;
  apiKey: string;
  modelId: string;
  authScript?: string;
  temperature: number;
  topP: number;
  maxTokens: number;
  autoTruncate?: boolean;
}

interface MCPServer {
  id: string;
  name: string;
  transport: 'stdio' | 'streamable_http';
  endpoint: string;
  status: 'connected' | 'disabled' | 'error' | 'connecting';
  permission: string;
  authMode: string;
  startupMode: string;
  mountScope: 'global' | 'workspace' | 'session' | 'disabled';
  mountTarget: string;
  policyMode: string;
  capabilities: {
    tools: number;
    resources: number;
    prompts: number;
  };
  toolNames: string[];
  resourceNames: string[];
  promptNames: string[];
  description: string;
  lastHandshake: string;
  lastTrace: string;
  lastError?: string;
  command?: string;
  args?: string;
  env?: Array<{ key: string; value: string }>;
  remoteTransport?: 'SSE' | 'WebSocket';
  timeout?: number;
  headers?: Array<{ key: string; value: string }>;
  sandbox?: boolean;
}

interface WindowState {
  isMaximized: boolean;
}

// 国际化词典定义
const translations = {
  zh: {
    brandName: 'ForgeOne',
    brandSub: '开放智能代理运行时',
    newAgentBtn: '新建任务',
    tabChat: '聊天',
    tabAgent: 'Agent',
    tabExplorer: '资源管理器',
    tabProject: '项目',
    tabModel: '模型',
    tabMcp: 'MCP 服务',
    tabSkill: '技能插件',
    tabPolicy: '安全策略',
    tabTrace: '执行追踪',
    tabSettings: '软件设置',
    tabSupport: '使用帮助',
    searchPlaceholder: '搜索配置、代码、项目或追踪日志...',
    runningOnline: '内核联机就绪',
    userLabel: '开发者',
    agentLabel: 'ForgeOne 核心智能体',
    statusRunning: '自治执行中',
    statusCompleted: '执行完成',
    statusSuspended: '已挂起',
    statusAborted: '已终止',
    expandTrace: '展开执行 Trace 日志',
    collapseTrace: '折叠执行 Trace 日志',
    todayBadge: '今天',
    runtimePreparing: '构建上下文',
    runtimeReasoning: '模型推理',
    runtimeTooling: '工具执行',
    runtimeComposing: '整理响应',
    runtimeRunning: '运行中',
    runtimeElapsed: '已耗时',
    runtimeTraceSummary: '执行摘要',
    runtimeLoops: '轮次',
    runtimeModelCalls: '模型调用',
    runtimeToolCalls: '工具调用',
    runtimeTotalTime: '总耗时',
    contextBarTitle: '上下文',
    contextBarUsage: '使用量',
    contextBarTurns: '回合',
    contextBarNoContext: '当前是空白上下文，新消息会开启新会话。',
    welcomeTitle: 'ForgeOne 控制台',
    welcomeText: '开放式智能代理运行时（Agent Runtime）控制台。在下方输入您的自然语言任务，Runtime 会拉起自治智能体循环（Agent Loop），透明地调用安全工具及 MCP 数据源以完成您的要求。',
    inputPlaceholder: '向 ForgeOne 描述您的开发任务，或指定指令...',
    inputDisclaimer: '注意：由于 ForgeOne 拥有执行命令及重构本地文件的完整权限，请谨慎配置 Policy 拦截规则。',
    approvalTitle: '高危工具权限审批申请',
    toolNameLabel: '工具名称',
    reasonLabel: '申请原因',
    argLabel: '调用参数',
    btnReject: '拒绝调用',
    btnApprove: '批准授权执行',
    
    // Project Panel
    projTitle: '项目管理',
    projSub: '管理 Agent 的工作区目录和本地权限范围，设置受限制的隔离级别。',
    projNewBtn: '新建工作区',
    projActiveCard: '当前活跃工作区: ForgeOne Core',
    projPathLabel: '本地目录绝对路径',
    projBrowseBtn: '浏览',
    projPermissionLabel: '智能体文件系统读写权限控制',
    projReadTitle: '只读索引',
    projReadDesc: '允许 Agent 读取工作区中代码文件，用于建索引与上下文感知。',
    projWriteTitle: '文件修改与写入',
    projWriteDesc: '允许 Agent 针对代码文件执行保存、创建、更新或重写操作。',
    projExecuteTitle: '脚本与终端命令执行',
    projExecuteDesc: '允许拉起终端进程并执行自动化脚本与命令。触发敏感词时会被策略拦截。',
    projDeleteTitle: '彻底删除文件 (禁用)',
    projDeleteDesc: '全局策略硬编码拦截任何形式的文件彻底移除，仅允许移动到回收站。',
    projSaveBtn: '保存配置',
    projHistoryTitle: '历史项目',
    projStatusActive: '当前活跃',
    
    // Model Panel
    modelTitle: '模型管理',
    modelSub: '管理接入的大语言模型提供商、API 密钥以及全局模型温度等超参数。',
    modelDiscardBtn: '丢弃修改',
    modelSaveBtn: '保存模型配置',
    modelProviderCard: '云端与本地大模型连接',
    modelSelectLabel: '选择模型服务商',
    modelKeyLabel: '接口密钥 (API Key)',
    modelUrlLabel: '接口代理地址 (Base URL)',
    modelDefaultSelect: '当前默认模型 (Default Model)',
    modelParamsCard: '推理参数',
    modelTempLabel: '温度 (Temperature)',
    modelPrecise: '高度精确',
    modelCreative: '发散创意',
    modelTopPLabel: '核采样 (Top P)',
    modelMaxTokensLabel: '最大生成 Token 数 (Max Tokens)',
    modelTruncateTitle: '自动截断过长上下文',
    modelTruncateDesc: '在接近大模型窗口上限时，自动移出旧远 Trace 报文。',

    // MCP Panel
    mcpTitle: 'Model Context Protocol',
    mcpSub: '管理 MCP Server 的连接、启停状态与暴露能力，让 Runtime 可控接入外部 tools、resources 与 prompts。',
    mcpAddBtn: '添加 Server',
    mcpActiveConn: '已连接 Server',
    mcpActiveDesc: '当前处于 connected 状态的 MCP Server',
    mcpThroughput: '暴露能力总数',
    mcpThroughputDesc: '所有已注册 tools、resources、prompts 的汇总',
    mcpHealth: '异常 Server',
    mcpHealthDesc: '需要处理的 error / connecting 状态实例',
    mcpSourceCardTitle: 'MCP Server 列表',
    mcpConfigureBtn: '详情',

    // Skill Panel
    skillTitle: '智能体技能插件',
    skillSub: '为您的 Agent 添加独立的 Python、JavaScript 执行脚本或预定义提示词模板包。',
    skillImportBtn: '载入本地技能包',
    skillCardTitle: '已加载的技能插件',
    skillEnabled: '已启用',
    skillDisabled: '已禁用',

    // Policy Panel
    policyTitle: '安全与预算策略',
    policySub: '限制自治智能体的执行边界，配置命令拦截阻断器和单次任务的预算熔断值。',
    policySaveBtn: '保存安全策略',
    policyCostCard: '预算与硬性熔断',
    policyLimitLabel: '单次任务硬性 Token 预算费用上限 ($)',
    policyWarnLabel: '到达费用警告阈值 ($)',
    policyLoopsLabel: '单次任务最大思考循环次数 (Max Loops)',
    policyLoopsDesc: '超出此循环次数后，Runtime 将强制切断 Agent 思考并强制退出。',
    policyRulesCard: '权限拦截与安全审计等级',
    policyShellToggle: '终端敏感命令强制开启安全审批 (Shell Confirm)',
    policyShellDesc: '在调用 Shell 工具运行带有 rm, curl, wget 等网络与写操作指令前必须经过审批确认。',
    policyAllowedLabel: '白名单/允许的工具集 (英文逗号分隔)',
    policyBlacklistLabel: '黑名单命令词检测过滤 (正则匹配)',
    policyBlacklistDesc: '当生成的终端命令匹配黑名单时，Policy Engine 会抛出拒绝提示并强制挂起。',

    // Trace Panel
    traceTitle: '全局执行追踪',
    traceSub: '以结构化轨迹查看所有 Agent 会话与系统工具调用的原始交互数据报文，支持深度 Trace 调试。',
    traceRefreshBtn: '刷新 Trace 记录',
    traceListCard: '会话快照',
    traceDetailCard: '会话执行流水 Trace：',
    traceBannerText: '以下为当前载入的 Trace 的执行轨迹日志，记录了每次模型推理所调用的底层参数与受保护工具的回执响应。',
    traceEmptyList: '暂无历史执行轨迹',
    traceEmptyDetail: '请在左侧列表中点击选择要分析调试的 Trace 会话记录。',
    historyListTitle: '历史记录',
    historyDeleteTitle: '删除这条历史记录',
    historyClearTitle: '清空历史记录',

    // Settings Modal
    setModalTitle: 'ForgeOne 软件偏好设置',
    setLanguageLabel: '软件显示语言 (Language)',
    setHttpLabel: 'HTTP 网络代理',
    setSocksLabel: 'SOCKS5 网络代理',
    setCacheToggle: '软件关闭时自动清空本地 Trace 缓存',
    setCacheDesc: '在退出客户端时自动擦除历史大语言模型对话数据。',
    setStatusLabel: '运行测试环境连接状态',
    setStatusActiveText: '已成功探测到 Rust Sidecar 二进制执行内核：forgeone-server.exe（本地 stdio 通道在线）。',
    setCancelBtn: '取消',
    setSaveBtn: '保存设置'
  },
  en: {
    brandName: 'ForgeOne',
    brandSub: 'Open Agent Runtime',
    newAgentBtn: 'New Task',
    tabChat: 'Chat',
    tabAgent: 'Agent',
    tabExplorer: 'Explorer',
    tabProject: 'Project',
    tabModel: 'Model',
    tabMcp: 'MCP',
    tabSkill: 'Skills',
    tabPolicy: 'Policies',
    tabTrace: 'Traces',
    tabSettings: 'Settings',
    tabSupport: 'Support',
    searchPlaceholder: 'Search configs, code, projects or traces...',
    runningOnline: 'Kernel Online',
    userLabel: 'Developer',
    agentLabel: 'ForgeOne Agent',
    statusRunning: 'Executing',
    statusCompleted: 'Completed',
    statusSuspended: 'Suspended',
    statusAborted: 'Aborted',
    expandTrace: 'Expand Trace Logs',
    collapseTrace: 'Collapse Trace Logs',
    todayBadge: 'TODAY',
    runtimePreparing: 'Preparing Context',
    runtimeReasoning: 'Reasoning',
    runtimeTooling: 'Tool Execution',
    runtimeComposing: 'Composing Response',
    runtimeRunning: 'Running',
    runtimeElapsed: 'Elapsed',
    runtimeTraceSummary: 'Execution Summary',
    runtimeLoops: 'Loops',
    runtimeModelCalls: 'Model Calls',
    runtimeToolCalls: 'Tool Calls',
    runtimeTotalTime: 'Total Time',
    contextBarTitle: 'Context',
    contextBarUsage: 'Usage',
    contextBarTurns: 'Turns',
    contextBarNoContext: 'Blank context. Your next message will start a new conversation.',
    welcomeTitle: 'ForgeOne Console',
    welcomeText: 'Welcome to the ForgeOne Agent Runtime Console. Describe your development goal below. The runtime will initialize the Agent Loop, transparently invoking tools and MCP database context providers to fulfill your goal.',
    inputPlaceholder: 'Message ForgeOne or describe your tasks...',
    inputDisclaimer: 'Note: ForgeOne has full file modification and terminal execution rights. Set Policies carefully.',
    approvalTitle: 'Dangerous Tool Execution Request',
    toolNameLabel: 'Tool Name',
    reasonLabel: 'Reason',
    argLabel: 'Arguments',
    btnReject: 'Reject & Terminate',
    btnApprove: 'Approve & Resume',
    
    // Project Panel
    projTitle: 'Projects',
    projSub: 'Manage workspaces, root paths, and agent read/write limitations.',
    projNewBtn: 'New Workspace',
    projActiveCard: 'Active Workspace: ForgeOne Core',
    projPathLabel: 'Project Root Path',
    projBrowseBtn: 'Browse',
    projPermissionLabel: 'Agent File Permissions',
    projReadTitle: 'Read Directory',
    projReadDesc: 'Allows agents to search and read codebase files for index context.',
    projWriteTitle: 'Write Files',
    projWriteDesc: 'Allows agents to modify existing code files or write new ones.',
    projExecuteTitle: 'Execute Script / Terminal Commands',
    projExecuteDesc: 'Allows invoking shell environments and running local scripts.',
    projDeleteTitle: 'Delete Files (Disabled)',
    projDeleteDesc: 'Deletion is hard-coded as disabled. Files can only be moved to trash bin.',
    projSaveBtn: 'Save Configuration',
    projHistoryTitle: 'Recent Projects',
    projStatusActive: 'Active',
    
    // Model Panel
    modelTitle: 'Models',
    modelSub: 'Configure model providers, API keys, endpoints, and LLM temperature.',
    modelDiscardBtn: 'Discard Changes',
    modelSaveBtn: 'Save Configuration',
    modelProviderCard: 'LLM Connection Settings',
    modelSelectLabel: 'Select Provider',
    modelKeyLabel: 'API Key',
    modelUrlLabel: 'Base URL (Optional)',
    modelDefaultSelect: 'Default Model',
    modelParamsCard: 'Parameters',
    modelTempLabel: 'Temperature',
    modelPrecise: 'Precise',
    modelCreative: 'Creative',
    modelTopPLabel: 'Top P',
    modelMaxTokensLabel: 'Max Tokens',
    modelTruncateTitle: 'Auto-truncate Context',
    modelTruncateDesc: 'Prune oldest trace messages when nearing LLM window bounds.',

    // MCP Panel
    mcpTitle: 'Model Context Protocol',
    mcpSub: 'Manage MCP servers, lifecycle, and exposed tools, resources, and prompts for the runtime.',
    mcpAddBtn: 'Add Server',
    mcpActiveConn: 'Connected Servers',
    mcpActiveDesc: 'MCP servers currently in connected state',
    mcpThroughput: 'Exposed Capabilities',
    mcpThroughputDesc: 'Aggregate tools, resources, and prompts available to the runtime',
    mcpHealth: 'Servers With Issues',
    mcpHealthDesc: 'Instances currently in error or connecting state',
    mcpSourceCardTitle: 'MCP Server List',
    mcpConfigureBtn: 'Details',

    // Skill Panel
    skillTitle: 'Agent Skills',
    skillSub: 'Empower agent with local Python execution scripts or static prompts packages.',
    skillImportBtn: 'Import Skills package',
    skillCardTitle: 'Loaded Plugin Packages',
    skillEnabled: 'Enabled',
    skillDisabled: 'Disabled',

    // Policy Panel
    policyTitle: 'Policies & Safety',
    policySub: 'Enforce security boundaries, cost limits, and auto-abort safety loops.',
    policySaveBtn: 'Save Safety Policies',
    policyCostCard: 'Budget & Loop Limits',
    policyLimitLabel: 'Max Session Cost Limit ($)',
    policyWarnLabel: 'Cost Warning Threshold ($)',
    policyLoopsLabel: 'Max Execution Loops',
    policyLoopsDesc: 'Force terminates execution if loop exceeds this count.',
    policyRulesCard: 'Shell Security Restrictions',
    policyShellToggle: 'Require Manual Confirmation for Shell',
    policyShellDesc: 'Always request user confirmation before running rm, curl, wget etc.',
    policyAllowedLabel: 'Allowed Tools list (Comma Separated)',
    policyBlacklistLabel: 'Forbidden Commands Regex Check',
    policyBlacklistDesc: 'Policy Engine terminates execution instantly if command matches this pattern.',

    // Trace Panel
    traceTitle: 'Traces Log Auditor',
    traceSub: 'Audit step-by-step agent loops, prompt templates, and raw JSON-RPC packages.',
    traceRefreshBtn: 'Refresh Traces',
    traceListCard: 'Sessions List',
    traceDetailCard: 'Execution Trace for: ',
    traceBannerText: 'Following lists the raw trace log of model invocations, decision trees, and tool execution reports.',
    traceEmptyList: 'No history traces',
    traceEmptyDetail: 'Select a trace session from the left sidebar to audit.',
    historyListTitle: 'History',
    historyDeleteTitle: 'Delete this history entry',
    historyClearTitle: 'Clear history',

    // Settings Modal
    setModalTitle: 'ForgeOne Preferences',
    setLanguageLabel: 'Language',
    setHttpLabel: 'HTTP Network Proxy',
    setSocksLabel: 'SOCKS5 Network Proxy',
    setCacheToggle: 'Clear Session Caches on Exit',
    setCacheDesc: 'Automatically wipe all conversation history from memory upon exit.',
    setStatusLabel: 'Sidecar Daemon status',
    setStatusActiveText: 'Rust Sidecar process (forgeone-server.exe) is online over stdio channels.',
    setCancelBtn: 'Cancel',
    setSaveBtn: 'Save Settings'
  }
};

// SVG 极简矢量图标绘制组件 (Feather 风格)
function Icon({ name, className = '', style = {} }: { name: string; className?: string; style?: React.CSSProperties }) {
  const icons: Record<string, React.ReactNode> = {
    chat: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>,
    agent: (
      <>
        <circle cx="12" cy="9" r="4.5"></circle>
        <path d="M5 20v-1a7 7 0 0 1 14 0v1"></path>
        <circle cx="19" cy="6" r="2.5" fill="currentColor" opacity="0.6"></circle>
        <path d="M19 8.5v2M19 8.5l-2 1M19 8.5l2 1" strokeWidth="1.5" opacity="0.6"></path>
      </>
    ),
    light_mode: (
      <>
        <circle cx="12" cy="12" r="5"></circle>
        <line x1="12" y1="1" x2="12" y2="3"></line>
        <line x1="12" y1="21" x2="12" y2="23"></line>
        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
        <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
        <line x1="1" y1="12" x2="3" y2="12"></line>
        <line x1="21" y1="12" x2="23" y2="12"></line>
        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
        <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
      </>
    ),
    dark_mode: (
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
    ),
    folder_open: (
      <>
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
        <path d="M2 10h20"></path>
      </>
    ),
    smart_toy: (
      <>
        <rect x="3" y="11" width="18" height="10" rx="2"></rect>
        <circle cx="8" cy="16" r="1"></circle>
        <circle cx="16" cy="16" r="1"></circle>
        <path d="M12 6v5M9 6h6"></path>
      </>
    ),
    extension: (
      <>
        <rect x="3" y="3" width="7" height="9" rx="1"></rect>
        <rect x="14" y="3" width="7" height="5" rx="1"></rect>
        <rect x="14" y="12" width="7" height="9" rx="1"></rect>
        <rect x="3" y="16" width="7" height="5" rx="1"></rect>
      </>
    ),
    construction: <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path>,
    policy: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>,
    analytics: (
      <>
        <line x1="18" y1="20" x2="18" y2="10"></line>
        <line x1="12" y1="20" x2="12" y2="4"></line>
        <line x1="6" y1="20" x2="6" y2="14"></line>
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3"></circle>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
      </>
    ),
    help: (
      <>
        <circle cx="12" cy="12" r="10"></circle>
        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
        <line x1="12" y1="17" x2="12.01" y2="17"></line>
      </>
    ),
    search: (
      <>
        <circle cx="11" cy="11" r="8"></circle>
        <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
      </>
    ),
    notifications: (
      <>
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
        <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
      </>
    ),
    open_in_new: (
      <>
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
        <polyline points="15 3 21 3 21 9"></polyline>
        <line x1="10" y1="14" x2="21" y2="3"></line>
      </>
    ),
    cloud_done: (
      <>
        <path d="M18 10h-.08A7 7 0 0 0 4.75 11.2a4.8 4.8 0 0 0 2.75 8.6H18a5 5 0 0 0 0-10z"></path>
        <path d="M9 13l2.5 2.5L15 11" strokeWidth="2.5"></path>
      </>
    ),
    account_circle: (
      <>
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
        <circle cx="12" cy="7" r="4"></circle>
      </>
    ),
    add: (
      <>
        <line x1="12" y1="5" x2="12" y2="19"></line>
        <line x1="5" y1="12" x2="19" y2="12"></line>
      </>
    ),
    database: (
      <>
        <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
        <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path>
        <path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3"></path>
      </>
    ),
    description: (
      <>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
        <line x1="16" y1="13" x2="8" y2="13"></line>
        <line x1="16" y1="17" x2="8" y2="17"></line>
      </>
    ),
    api: (
      <>
        <polyline points="16 18 22 12 16 6"></polyline>
        <polyline points="8 6 2 12 8 18"></polyline>
      </>
    ),
    info: (
      <>
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="12" y1="16" x2="12" y2="12"></line>
        <line x1="12" y1="8" x2="12.01" y2="8"></line>
      </>
    ),
    warning: (
      <>
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
        <line x1="12" y1="9" x2="12" y2="13"></line>
        <line x1="12" y1="17" x2="12.01" y2="17"></line>
      </>
    ),
    delete: (
      <>
        <polyline points="3 6 5 6 21 6"></polyline>
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        <line x1="10" y1="11" x2="10" y2="17"></line>
        <line x1="14" y1="11" x2="14" y2="17"></line>
      </>
    ),
    refresh: (
      <>
        <path d="M23 4v6h-6"></path>
        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
      </>
    ),
    close: (
      <>
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </>
    ),
    minimize: <line x1="6" y1="12" x2="18" y2="12"></line>,
    maximize: <rect x="5.5" y="5.5" width="13" height="13" rx="1"></rect>,
    restore: (
      <>
        <path d="M9 7h8v8"></path>
        <path d="M7 9h8v8H7z"></path>
      </>
    ),
    arrow_upward: (
      <>
        <line x1="12" y1="19" x2="12" y2="5"></line>
        <polyline points="5 12 12 5 19 12"></polyline>
      </>
    ),
    sync: (
      <>
        <path d="M23 4v6h-6"></path>
        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
      </>
    ),
    monetization_on: (
      <>
        <line x1="12" y1="1" x2="12" y2="23"></line>
        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
      </>
    ),
    shield_lock: (
      <>
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
        <rect x="9" y="11" width="6" height="4" rx="1"></rect>
        <path d="M10 11V9a2 2 0 0 1 4 0v2"></path>
      </>
    ),
    terminal: (
      <>
        <polyline points="4 17 10 11 4 5"></polyline>
        <line x1="12" y1="19" x2="20" y2="19"></line>
      </>
    ),
    history: (
      <>
        <circle cx="12" cy="12" r="10"></circle>
        <polyline points="12 6 12 12 16 14"></polyline>
      </>
    ),
    folder_managed: (
      <>
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2v2"></path>
        <circle cx="12" cy="14" r="3"></circle>
      </>
    ),
    cable: (
      <>
        <rect x="9" y="6" width="6" height="8" rx="1"></rect>
        <line x1="12" y1="14" x2="12" y2="22"></line>
        <line x1="10" y1="2" x2="10" y2="6"></line>
        <line x1="14" y1="2" x2="14" y2="6"></line>
      </>
    ),
    swap_vert: (
      <>
        <line x1="12" y1="5" x2="12" y2="19"></line>
        <polyline points="19 12 12 19 5 12"></polyline>
        <polyline points="5 12 12 5 19 12"></polyline>
      </>
    ),
    check_circle: (
      <>
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
        <polyline points="22 4 12 14.01 9 11.01"></polyline>
      </>
    ),
    add_box: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
        <line x1="12" y1="8" x2="12" y2="16"></line>
        <line x1="8" y1="12" x2="16" y2="12"></line>
      </>
    ),
    add_link: (
      <>
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
      </>
    ),
    attach_file: <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>,
    data_object: (
      <>
        <polyline points="16 18 22 12 16 6"></polyline>
        <polyline points="8 6 2 12 8 18"></polyline>
      </>
    ),
    psychology: (
      <>
        <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1 0-3.88 2.5 2.5 0 1 1 2.46-4.06 2.5 2.5 0 0 1-2.46-4.06 2.5 2.5 0 0 1 0-3.88A2.5 2.5 0 0 1 9.5 2z"></path>
        <path d="M14.5 2a2.5 2.5 0 0 1 2.46 2.06 2.5 2.5 0 0 1 0 3.88 2.5 2.5 0 1 1-2.46 4.06 2.5 2.5 0 0 1 2.46 4.06 2.5 2.5 0 0 1 0 3.88 2.5 2.5 0 1 1-2.46-2.06v-15.9z"></path>
      </>
    ),
    folder: (
      <>
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
      </>
    ),
    publish: (
      <>
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"></path>
      </>
    ),
    save: (
      <>
        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
        <polyline points="17 21 17 13 7 13 7 21"></polyline>
        <polyline points="7 3 7 8 15 8"></polyline>
      </>
    ),
    visibility: (
      <>
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
        <circle cx="12" cy="12" r="3"></circle>
      </>
    ),
    visibility_off: (
      <>
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
        <line x1="1" y1="1" x2="23" y2="23"></line>
      </>
    ),
    arrow_back: (
      <>
        <line x1="19" y1="12" x2="5" y2="12"></line>
        <polyline points="12 19 5 12 12 5"></polyline>
      </>
    ),
    tune: (
      <>
        <line x1="4" y1="21" x2="4" y2="14"></line>
        <line x1="4" y1="10" x2="4" y2="3"></line>
        <line x1="12" y1="21" x2="12" y2="12"></line>
        <line x1="12" y1="8" x2="12" y2="3"></line>
        <line x1="20" y1="21" x2="20" y2="16"></line>
        <line x1="20" y1="12" x2="20" y2="3"></line>
        <line x1="1" y1="14" x2="7" y2="14"></line>
        <line x1="9" y1="8" x2="15" y2="8"></line>
        <line x1="17" y1="16" x2="23" y2="16"></line>
      </>
    )
  };

  const svgContent = icons[name] || null;

  return (
    <svg 
      className={className} 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round" 
      style={{ 
        display: 'inline-block', 
        verticalAlign: 'middle', 
        width: '1.2em', 
        height: '1.2em',
        ...style 
      }}
    >
      {svgContent}
    </svg>
  );
}

interface OfficialVendor {
  key: string;
  name: string;
  protocol: 'openai' | 'anthropic';
  baseUrl: string;
  defaultModelId: string;
  placeholderKey: string;
  models: string[];
}

const OFFICIAL_VENDORS: OfficialVendor[] = [
  { key: 'OpenAI', name: 'OpenAI', protocol: 'openai', baseUrl: 'https://api.openai.com/v1', defaultModelId: 'gpt-4o', placeholderKey: 'sk-proj-...', models: ['gpt-4o', 'gpt-4o-mini', 'o1-preview', 'o1-mini', 'gpt-4-turbo'] },
  { key: 'Anthropic', name: 'Anthropic (Claude)', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', defaultModelId: 'claude-3-5-sonnet', placeholderKey: 'sk-ant-...', models: ['claude-3-5-sonnet', 'claude-3-opus', 'claude-3-5-haiku'] },
  { key: 'DeepSeek', name: 'DeepSeek', protocol: 'openai', baseUrl: 'https://api.deepseek.com', defaultModelId: 'deepseek-chat', placeholderKey: 'sk-...', models: ['deepseek-chat', 'deepseek-coder'] },
  { key: 'Minimax', name: 'MiniMax', protocol: 'openai', baseUrl: 'https://api.minimax.chat/v1', defaultModelId: 'abab6.5g-chat', placeholderKey: 'ey...', models: ['abab6.5g-chat', 'abab6.5t-chat', 'abab6.5-chat'] },
  { key: 'Gemini', name: 'Google Gemini', protocol: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', defaultModelId: 'gemini-1.5-pro', placeholderKey: 'AIzaSy...', models: ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-1.0-pro'] },
  { key: 'Groq', name: 'Groq', protocol: 'openai', baseUrl: 'https://api.groq.com/openai/v1', defaultModelId: 'llama3-70b-8192', placeholderKey: 'gsk_...', models: ['llama-3.1-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768'] },
  { key: 'Mistral', name: 'Mistral AI', protocol: 'openai', baseUrl: 'https://api.mistral.ai/v1', defaultModelId: 'mistral-large-latest', placeholderKey: '...', models: ['mistral-large-latest', 'open-mixtral-8x22b', 'mistral-small-latest'] },
  { key: 'OpenRouter', name: 'OpenRouter', protocol: 'openai', baseUrl: 'https://openrouter.ai/api/v1', defaultModelId: 'google/gemini-pro', placeholderKey: 'sk-or-...', models: ['google/gemini-pro', 'meta-llama/llama-3-8b-instruct', 'anthropic/claude-3.5-sonnet'] }
];

function inferSuggestedOutputTokens(modelId: string): number {
  const normalized = modelId.trim().toLowerCase();

  if (!normalized) {
    return 4096;
  }

  if (
    normalized.includes('deepseek') ||
    normalized.includes('gpt-4.1') ||
    normalized.includes('gpt-4o') ||
    normalized.includes('claude-3') ||
    normalized.includes('sonnet') ||
    normalized.includes('opus') ||
    normalized.includes('pro') ||
    normalized.includes('large') ||
    normalized.includes('70b') ||
    normalized.includes('32b')
  ) {
    return 8192;
  }

  if (
    normalized.includes('14b') ||
    normalized.includes('coder') ||
    normalized.includes('gemini') ||
    normalized.includes('mistral')
  ) {
    return 4096;
  }

  return 4096;
}

function inferRuntimeContextWindow(modelId: string, protocol: 'openai' | 'anthropic'): number {
  const normalized = modelId.trim().toLowerCase();

  if (protocol === 'openai' || protocol === 'anthropic') {
    if (normalized.includes('gpt-4.1')) {
      return 1_000_000;
    }
    return 128_000;
  }

  return 32_000;
}

function formatTokenCount(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(value % 1_000 === 0 ? 0 : 1)}K`;
  }
  return `${value}`;
}

// ─── MessageContent ───────────────────────────────────────────────────────────
// \u6e32\u67d3\u4e00\u6761\u6d88\u606f\u7684\u5185\u5bb9\uff0c\u652f\u6301\uff1a
//  1. \u6d41\u5f0f\u5149\u6807\uff08streaming=true \u65f6\u663e\u793a\u95ea\u70c1\u7684 | \uff09
//  2. <think>...</think> \u53ef\u6298\u53e0\u601d\u8003\u5757
//  3. \u666e\u901a\u6587\u672c\u6e32\u67d3
// ──────────────────────────────────────────────────────────────────────────────
function parseThinkBlocks(text: string): Array<{ type: 'think' | 'text'; content: string }> {
  const parts: Array<{ type: 'think' | 'text'; content: string }> = [];
  // \u652f\u6301 <think> \u548c <thinking> \u4e24\u79cd\u6807\u7b7e\uff08Qwen3 / DeepSeek \u7b49\uff09
  const regex = /<think(?:ing)?>([\s\S]*?)<\/think(?:ing)?>/gi;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', content: text.slice(lastIndex, match.index) });
    }
    parts.push({ type: 'think', content: match[1].trim() });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push({ type: 'text', content: text.slice(lastIndex) });
  }
  return parts.length ? parts : [{ type: 'text', content: text }];
}

type FormattedSegment =
  | { type: 'text'; content: string }
  | { type: 'code'; content: string; language: string };

type StructuredTableData = {
  kind: 'windows-dir';
  title: string;
  subtitle?: string;
  columns: string[];
  rows: string[][];
  summary: string[];
};

type InlineToken =
  | { type: 'text'; content: string }
  | { type: 'code'; content: string }
  | { type: 'bold'; content: string }
  | { type: 'italic'; content: string }
  | { type: 'strikethrough'; content: string }
  | { type: 'link'; text: string; url: string }
  | { type: 'auto_link'; url: string };

type MarkdownBlock =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'unordered-list'; items: string[] }
  | { type: 'ordered-list'; items: string[] }
  | { type: 'blockquote'; lines: string[] }
  | { type: 'hr' }
  | { type: 'table'; headers: string[]; rows: string[][] };

function parseFormattedSegments(text: string): FormattedSegment[] {
  const segments: FormattedSegment[] = [];
  const regex = /```([^\n`]*)\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', content: text.slice(lastIndex, match.index) });
    }
    segments.push({
      type: 'code',
      language: match[1].trim().toLowerCase(),
      content: match[2].replace(/\r/g, '').trim(),
    });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({ type: 'text', content: text.slice(lastIndex) });
  }

  return segments.length ? segments : [{ type: 'text', content: text }];
}

function parseInlineTokens(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  const regex = /(\[([^\]]+)\]\(([^)]+)\))|(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(~~([^~]+)~~)|(`([^`\n]+)`)|((?:https?:\/\/|www\.)[^\s<>"']+)/gi;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ type: 'text', content: text.slice(lastIndex, match.index) });
    }
    if (match[1] !== undefined) {
      tokens.push({ type: 'link', text: match[2], url: match[3] });
    } else if (match[4] !== undefined) {
      tokens.push({ type: 'bold', content: match[5] });
    } else if (match[6] !== undefined) {
      tokens.push({ type: 'italic', content: match[7] });
    } else if (match[8] !== undefined) {
      tokens.push({ type: 'strikethrough', content: match[9] });
    } else if (match[10] !== undefined) {
      tokens.push({ type: 'code', content: match[11] });
    } else {
      tokens.push({ type: 'auto_link', url: match[0] });
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    tokens.push({ type: 'text', content: text.slice(lastIndex) });
  }

  return tokens.length ? tokens : [{ type: 'text', content: text }];
}

function parseMarkdownBlocks(text: string): MarkdownBlock[] {
  const normalized = text.replace(/\r/g, '');
  const lines = normalized.split('\n');
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  const flushParagraph = (buffer: string[]) => {
    const content = buffer.join('\n').trim();
    if (content) {
      blocks.push({ type: 'paragraph', text: content });
    }
    buffer.length = 0;
  };

  const paragraphBuffer: string[] = [];

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph(paragraphBuffer);
      index += 1;
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      flushParagraph(paragraphBuffer);
      blocks.push({
        type: 'heading',
        level: headingMatch[1].length,
        text: headingMatch[2].trim(),
      });
      index += 1;
      continue;
    }

    // --- 分割线
    if (/^(?:-{3,}|\*{3,}|_{3,})\s*$/.test(trimmed)) {
      flushParagraph(paragraphBuffer);
      blocks.push({ type: 'hr' });
      index += 1;
      continue;
    }

    // GFM 表格
    const tableSepPattern = /^\|[\s:-]+\|(?:[\s:-]+\|\s*)*$/; // |---|---|
    if (trimmed.startsWith('|') && index + 1 < lines.length && tableSepPattern.test(lines[index + 1].trim())) {
      flushParagraph(paragraphBuffer);
      const headers = trimmed.split('|').map(c => c.trim()).filter(Boolean);
      index += 2; // skip header row + separator row
      const rows: string[][] = [];
      while (index < lines.length) {
        const rowLine = lines[index].trim();
        if (!rowLine.startsWith('|')) break;
        const cells = rowLine.split('|').map(c => c.trim()).filter(Boolean);
        if (cells.length === 0) { index += 1; continue; }
        rows.push(cells);
        index += 1;
      }
      blocks.push({ type: 'table', headers, rows });
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      flushParagraph(paragraphBuffer);
      const quoteLines: string[] = [];
      while (index < lines.length) {
        const current = lines[index].trim();
        if (!/^>\s?/.test(current)) break;
        quoteLines.push(current.replace(/^>\s?/, ''));
        index += 1;
      }
      blocks.push({ type: 'blockquote', lines: quoteLines });
      continue;
    }

    if (/^[-*+]\s+/.test(trimmed)) {
      flushParagraph(paragraphBuffer);
      const items: string[] = [];
      while (index < lines.length) {
        const current = lines[index];
        const trimmedLine = current.trim();
        const match = trimmedLine.match(/^[-*+]\s+(.+)$/);
        if (match) {
          items.push(match[1].trim());
          index += 1;
          continue;
        }
        // --- / *** / ___ 不是列表续行，中断列表
        if (/^(?:-{3,}|\*{3,}|_{3,})\s*$/.test(trimmedLine)) {
          break;
        }
        // Indented continuation of the last item
        if (items.length > 0 && /^\s/.test(current) && trimmedLine.length > 0) {
          const last = items.pop() || '';
          items.push(last + '\n' + trimmedLine);
          index += 1;
          continue;
        }
        // Skip blank lines within the list (don't break on empty lines)
        if (trimmedLine.length === 0) {
          index += 1;
          continue;
        }
        break;
      }
      blocks.push({ type: 'unordered-list', items });
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      flushParagraph(paragraphBuffer);
      const items: string[] = [];
      while (index < lines.length) {
        const current = lines[index];
        const trimmedLine = current.trim();
        const match = trimmedLine.match(/^\d+\.\s+(.+)$/);
        if (match) {
          items.push(match[1].trim());
          index += 1;
          continue;
        }
        // --- / *** / ___ 不是列表续行，中断列表
        if (/^(?:-{3,}|\*{3,}|_{3,})\s*$/.test(trimmedLine)) {
          break;
        }
        // ### heading 不是列表续行，中断列表
        if (/^#{1,4}\s/.test(trimmedLine)) {
          break;
        }
        // Continuation of last item: indented sub-bullet OR word-wrapped line
        if (items.length > 0 && trimmedLine.length > 0) {
          const last = items.pop() || '';
          items.push(last + '\n' + trimmedLine);
          index += 1;
          continue;
        }
        // Skip blank lines within the list
        if (trimmedLine.length === 0) {
          index += 1;
          continue;
        }
        break;
      }
      blocks.push({ type: 'ordered-list', items });
      continue;
    }

    paragraphBuffer.push(line);
    index += 1;
  }

  flushParagraph(paragraphBuffer);
  return blocks.length ? blocks : [{ type: 'paragraph', text: normalized }];
}

function formatCodeForDisplay(code: string, language: string): string {
  const normalized = code.replace(/\r/g, '').trim();
  const lang = language.toLowerCase();
  const maybeJson = lang === 'json' || (!lang && /^[\[{]/.test(normalized));

  if (maybeJson) {
    try {
      return JSON.stringify(JSON.parse(normalized), null, 2);
    } catch {
      return normalized;
    }
  }

  return normalized;
}

function parseWindowsDirectoryTable(code: string, lang: 'zh' | 'en'): StructuredTableData | null {
  const lines = code
    .replace(/\u0000/g, '')
    .split('\n')
    .map(line => line.trimEnd());
  const entryRegex = /^\s*(\d{4}[/-]\d{2}[/-]\d{2})\s+(\d{1,2}:\d{2})(?:\s+(AM|PM))?\s+(<DIR>|[\d,]+)\s+(.+?)\s*$/i;
  const rows: string[][] = [];
  let firstEntryIndex = -1;
  let lastEntryIndex = -1;

  lines.forEach((line, index) => {
    const match = line.match(entryRegex);
    if (!match) return;
    const [, date, time, ampm, marker, name] = match;
    const timeLabel = ampm ? `${date} ${time} ${ampm}` : `${date} ${time}`;
    const isDir = marker.toUpperCase() === '<DIR>';
    rows.push([
      timeLabel,
      isDir ? (lang === 'zh' ? '文件夹' : 'Folder') : (lang === 'zh' ? '文件' : 'File'),
      isDir ? '-' : marker,
      name,
    ]);
    if (firstEntryIndex === -1) {
      firstEntryIndex = index;
    }
    lastEntryIndex = index;
  });

  if (rows.length < 2) {
    return null;
  }

  const candidatePath = lines
    .slice(0, Math.max(0, firstEntryIndex))
    .map(line => line.trim())
    .reverse()
    .find(line => /[A-Za-z]:\\/.test(line) || /directory of/i.test(line) || /目录/.test(line));

  const subtitle = candidatePath
    ? candidatePath
        .replace(/^directory of\s+/i, '')
        .replace(/\s+的目录$/, '')
        .trim()
    : undefined;

  const summary = lines
    .slice(lastEntryIndex + 1)
    .map(line => line.trim())
    .filter(line => line && /\d/.test(line))
    .slice(0, 2);

  return {
    kind: 'windows-dir',
    title: lang === 'zh' ? '目录结果' : 'Directory Listing',
    subtitle,
    columns: lang === 'zh'
      ? ['修改时间', '类型', '大小', '名称']
      : ['Modified', 'Type', 'Size', 'Name'],
    rows,
    summary,
  };
}

function StructuredTableView({ table }: { table: StructuredTableData }) {
  return (
    <div className="structured-output-table-wrap">
      {table.subtitle && <div className="structured-output-path">{table.subtitle}</div>}
      <div className="structured-output-table-scroll">
        <table className="structured-output-table">
          <thead>
            <tr>
              {table.columns.map(column => (
                <th key={column}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, rowIndex) => (
              <tr key={`${row[row.length - 1]}-${rowIndex}`}>
                {row.map((cell, cellIndex) => (
                  <td key={`${cellIndex}-${cell}`}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {table.summary.length > 0 && (
        <div className="structured-output-summary">
          {table.summary.map(line => (
            <span key={line}>{line}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function FormattedCodeBlock({
  code,
  language,
  lang,
}: {
  code: string;
  language: string;
  lang: 'zh' | 'en';
}) {
  const formattedCode = React.useMemo(() => formatCodeForDisplay(code, language), [code, language]);
  const table = React.useMemo(() => parseWindowsDirectoryTable(formattedCode, lang), [formattedCode, lang]);
  const [view, setView] = React.useState<'table' | 'raw'>(table ? 'table' : 'raw');
  const [copied, setCopied] = React.useState(false);
  const codeRef = React.useRef<HTMLElement>(null);

  React.useEffect(() => {
    setView(table ? 'table' : 'raw');
  }, [table, formattedCode]);

  // 代码高亮
  React.useEffect(() => {
    if (codeRef.current && view === 'raw') {
      hljs.highlightElement(codeRef.current);
    }
  }, [formattedCode, language, view]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(formattedCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch (error) {
      console.error('Failed to copy code block', error);
    }
  };

  // 将语言标识映射到 highlight.js 支持的语言
  const hljsLang = React.useMemo(() => {
    const langMap: Record<string, string> = {
      'js': 'javascript',
      'ts': 'typescript',
      'tsx': 'typescript',
      'jsx': 'javascript',
      'rs': 'rust',
      'py': 'python',
      'rb': 'ruby',
      'sh': 'bash',
      'shell': 'bash',
      'zsh': 'bash',
      'yaml': 'yaml',
      'yml': 'yaml',
      'html': 'xml',
      'md': 'markdown',
      'c++': 'cpp',
      'c#': 'csharp',
      'fs': 'fsharp',
      'kt': 'kotlin',
      'swift': 'swift',
      'go': 'go',
      'toml': 'ini',
      'dockerfile': 'dockerfile',
      'diff': 'diff',
      'json': 'json',
    };
    return langMap[language.toLowerCase()] || language.toLowerCase();
  }, [language]);

  return (
    <div className="formatted-output-card">
      <div className="formatted-output-header">
        <div className="formatted-output-title-group">
          <span className="formatted-output-title">{lang === 'zh' ? '格式化输出' : 'Formatted Output'}</span>
          {language && <span className="formatted-output-badge">{language}</span>}
        </div>
        <div className="formatted-output-actions">
          {table && (
            <div className="formatted-output-toggle-group">
              <button
                type="button"
                className={`formatted-output-toggle ${view === 'table' ? 'active' : ''}`}
                onClick={() => setView('table')}
              >
                {lang === 'zh' ? '表格' : 'Table'}
              </button>
              <button
                type="button"
                className={`formatted-output-toggle ${view === 'raw' ? 'active' : ''}`}
                onClick={() => setView('raw')}
              >
                {lang === 'zh' ? '原文' : 'Raw'}
              </button>
            </div>
          )}
          <button
            type="button"
            className="formatted-output-copy"
            onClick={handleCopy}
            title={lang === 'zh' ? '复制代码块' : 'Copy code block'}
          >
            {copied ? (lang === 'zh' ? '已复制' : 'Copied') : (lang === 'zh' ? '复制' : 'Copy')}
          </button>
        </div>
      </div>
      {table && view === 'table'
        ? <StructuredTableView table={table} />
        : (
          <div className="formatted-output-code-wrap">
            <div className="formatted-output-ln" aria-hidden="true">
              {formattedCode.split('\n').map((_, i) => (
                <span key={i} className="formatted-output-ln-num">{i + 1}</span>
              ))}
            </div>
            <pre className="formatted-output-pre">
              <code ref={codeRef} className={`hljs language-${hljsLang}`}>
                {formattedCode}
              </code>
            </pre>
          </div>
        )}
    </div>
  );
}

function InlineMarkdown({ text }: { text: string }) {
  const tokens = parseInlineTokens(text);
  return (
    <>
      {tokens.map((token, index) => {
        switch (token.type) {
          case 'code':
            return <code key={`ic-${index}`} className="message-inline-code">{token.content}</code>;
          case 'bold':
            return <strong key={`b-${index}`}>{token.content}</strong>;
          case 'italic':
            return <em key={`i-${index}`}>{token.content}</em>;
          case 'strikethrough':
            return <del key={`s-${index}`}>{token.content}</del>;
          case 'link':
            return <a key={`l-${index}`} href={token.url} target="_blank" rel="noopener noreferrer">{token.text}</a>;
          case 'auto_link':
            return <a key={`al-${index}`} href={token.url} target="_blank" rel="noopener noreferrer">{token.url}</a>;
          default:
            return <React.Fragment key={`t-${index}`}>{token.content}</React.Fragment>;
        }
      })}
    </>
  );
}

function MarkdownTextBlock({ text }: { text: string }) {
  const blocks = parseMarkdownBlocks(text);

  return (
    <div className="message-markdown-blocks">
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          const Tag = `h${Math.min(block.level + 2, 6)}` as keyof JSX.IntrinsicElements;
          return (
            <Tag key={`heading-${index}`} className={`message-heading heading-level-${block.level}`}>
              <InlineMarkdown text={block.text} />
            </Tag>
          );
        }

        if (block.type === 'hr') {
          return <hr key={`hr-${index}`} className="message-hr" />;
        }

        if (block.type === 'unordered-list') {
          return (
            <ul key={`ul-${index}`} className="message-list">
              {block.items.map((item, itemIndex) => (
                <li key={`ul-item-${itemIndex}`}><InlineMarkdown text={item} /></li>
              ))}
            </ul>
          );
        }

        if (block.type === 'ordered-list') {
          return (
            <ol key={`ol-${index}`} className="message-list ordered">
              {block.items.map((item, itemIndex) => (
                <li key={`ol-item-${itemIndex}`}><InlineMarkdown text={item} /></li>
              ))}
            </ol>
          );
        }

        if (block.type === 'blockquote') {
          return (
            <blockquote key={`quote-${index}`} className="message-quote">
              {block.lines.map((line, lineIndex) => (
                <div key={`quote-line-${lineIndex}`}><InlineMarkdown text={line} /></div>
              ))}
            </blockquote>
          );
        }

        if (block.type === 'table') {
          return (
            <div key={`table-${index}`} className="message-table-wrap">
              <table className="message-table">
                <thead>
                  <tr>
                    {block.headers.map((h, i) => (
                      <th key={`th-${i}`}><InlineMarkdown text={h} /></th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, ri) => (
                    <tr key={`tr-${ri}`}>
                      {row.map((cell, ci) => (
                        <td key={`td-${ri}-${ci}`}><InlineMarkdown text={cell} /></td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }

        return (
          <p key={`paragraph-${index}`} className="message-paragraph">
            <InlineMarkdown text={block.text} />
          </p>
        );
      })}
    </div>
  );
}

function MessageTextBody({ text, lang }: { text: string; lang: 'zh' | 'en' }) {
  const segments = parseFormattedSegments(text);

  return (
    <>
      {segments.map((segment, index) => {
        if (segment.type === 'code') {
          return (
            <FormattedCodeBlock
              key={`code-${index}`}
              code={segment.content}
              language={segment.language}
              lang={lang}
            />
          );
        }

        return (
          <MarkdownTextBlock key={`text-${index}`} text={segment.content} />
        );
      })}
    </>
  );
}

function ThinkBlock({ content }: { content: string }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="think-block">
      <button className="think-toggle" onClick={() => setOpen(o => !o)}>
        <span className="think-icon">{open ? '▾' : '▸'}</span>
        <span className="think-label">{open ? '\u6536\u8d77\u601d\u8003\u8fc7\u7a0b' : '\u5c55\u5f00\u601d\u8003\u8fc7\u7a0b'}</span>
      </button>
      {open && (
        <div className="think-content">{content}</div>
      )}
    </div>
  );
}

function formatDuration(ms: number, lang: 'zh' | 'en') {
  const seconds = ms / 1000;
  if (seconds < 10) {
    return lang === 'zh' ? `${seconds.toFixed(1)} 秒` : `${seconds.toFixed(1)}s`;
  }
  if (seconds < 60) {
    return lang === 'zh' ? `${Math.round(seconds)} 秒` : `${Math.round(seconds)}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const restSeconds = Math.round(seconds % 60);
  return lang === 'zh'
    ? `${minutes} 分 ${restSeconds} 秒`
    : `${minutes}m ${restSeconds}s`;
}

function buildTraceStats(trace: TraceEvent[] = []) {
  if (!trace.length) {
    return {
      totalMs: 0,
      loops: 0,
      modelCalls: 0,
      toolCalls: 0,
    };
  }

  const timestamps = trace.map(evt => evt.timestamp_ms).filter(Boolean);
  const totalMs = timestamps.length ? Math.max(...timestamps) - Math.min(...timestamps) : 0;
  const loops = trace.reduce((max, evt) => Math.max(max, evt.loop_index || 0), 0);
  const modelCalls = trace.filter(evt => evt.kind === 'ModelRequested').length;
  const toolCalls = trace.filter(evt => evt.kind === 'ToolCompleted').length;

  return {
    totalMs,
    loops,
    modelCalls,
    toolCalls,
  };
}

function nextConversationId() {
  return `conversation-${Date.now()}`;
}

function serializeConversationHistory(messages: Message[]): ConversationTurn[] {
  return messages
    .filter(message => {
      if (!message.content.trim()) return false;
      if (message.streaming) return false;
      return message.sender === 'user' || message.sender === 'agent';
    })
    .map(message => ({
      role: message.sender,
      content: message.content,
    }));
}

function buildConversationSummaries(traces: HistoricalTrace[]): ConversationSummary[] {
  const grouped = new Map<string, HistoricalTrace[]>();

  for (const trace of traces) {
    const key = trace.conversation_id || trace.session_id;
    const items = grouped.get(key) || [];
    items.push(trace);
    grouped.set(key, items);
  }

  return Array.from(grouped.entries())
    .map(([conversationId, items]) => {
      const ordered = [...items].sort((a, b) => {
        if (a.turn_index !== b.turn_index) {
          return a.turn_index - b.turn_index;
        }
        return a.updated_at_ms - b.updated_at_ms;
      });
      const latest = [...ordered].sort((a, b) => b.updated_at_ms - a.updated_at_ms)[0];
      const titleSource = ordered[0]?.task_input || latest?.task_input || conversationId;

      return {
        conversation_id: conversationId,
        title: titleSource,
        session_id: latest?.session_id || ordered[ordered.length - 1]?.session_id || conversationId,
        status: latest?.status || 'completed',
        loop_index: latest?.loop_index || 0,
        latestSessionId: latest?.session_id || ordered[ordered.length - 1]?.session_id || conversationId,
        latestStatus: latest?.status || 'completed',
        turnCount: ordered.length,
        updatedAtMs: latest?.updated_at_ms || 0,
        sessionIds: ordered.map(item => item.session_id),
      };
    })
    .sort((a, b) => b.updatedAtMs - a.updatedAtMs);
}

function inferRuntimePhase(elapsedMs: number, t: typeof translations['zh']) {
  const phases = [
    t.runtimePreparing,
    t.runtimeReasoning,
    t.runtimeTooling,
    t.runtimeComposing,
  ];
  const phaseIndex = Math.min(Math.floor(elapsedMs / 1800), phases.length - 1);
  return phases[phaseIndex];
}

function MessageContent({ msg, lang }: { msg: Message; lang: 'zh' | 'en' }) {
  const [displayed, setDisplayed] = React.useState('');
  const [done, setDone] = React.useState(false);
  const prevContent = React.useRef('');
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    const full = msg.content || '';
    if (!msg.animateOnLoad) {
      prevContent.current = full;
      setDisplayed(full);
      setDone(true);
      return;
    }
    // \u5982\u679c streaming \u5df2\u7ed3\u675f\uff08streaming=false\uff09\uff0c\u5c31\u505a typewriter \u52a8\u753b
    if (!msg.streaming && full !== prevContent.current) {
      prevContent.current = full;
      setDone(false);
      let i = 0;
      const speed = full.length > 800 ? 4 : full.length > 300 ? 8 : 14; // ms/\u5b57
      const tick = () => {
        i += Math.ceil(full.length / 300); // \u81ea\u9002\u5e94\u5757\u5927\u5c0f
        if (i >= full.length) {
          setDisplayed(full);
          setDone(true);
          return;
        }
        setDisplayed(full.slice(0, i));
        timerRef.current = setTimeout(tick, speed);
      };
      timerRef.current = setTimeout(tick, speed);
      return () => { if (timerRef.current) clearTimeout(timerRef.current); };
    }
    if (msg.streaming) {
      setDisplayed('');
      setDone(false);
    }
  }, [msg.animateOnLoad, msg.content, msg.streaming]);

  // \u6d41\u5f0f\u72b6\u6001\uff1a\u663e\u793a\u95ea\u70c1\u5149\u6807
  if (msg.streaming) {
    return (
      <div className="message-text streaming-text">
        <span className="streaming-cursor" />
      </div>
    );
  }

  // \u89e3\u6790 think \u5757
  const text = done ? msg.content : displayed;
  const parts = parseThinkBlocks(text);

  return (
    <div className="message-text">
      {parts.map((part, i) =>
        part.type === 'think'
          ? <ThinkBlock key={i} content={part.content} />
          : <MessageTextBody key={i} text={part.content} lang={lang} />
      )}
      {!done && <span className="streaming-cursor" />}
    </div>
  );
}

function MessageRuntimeMeta({
  msg,
  nowMs,
  lang,
  t,
}: {
  msg: Message;
  nowMs: number;
  lang: 'zh' | 'en';
  t: typeof translations['zh'];
}) {
  if (msg.sender !== 'agent') return null;

  const startedAt = msg.runStartedAt ?? msg.timestamp;
  const finishedAt = msg.runCompletedAt ?? (msg.streaming ? nowMs : startedAt);
  const elapsedMs = Math.max(0, finishedAt - startedAt);
  const stats = buildTraceStats(msg.trace || []);

  if (msg.streaming) {
    return (
      <div className="runtime-meta-card">
        <div className="runtime-meta-header">
          <span className="runtime-live-pill">{t.runtimeRunning}</span>
          <span className="runtime-phase-text">{inferRuntimePhase(elapsedMs, t)}</span>
          <span className="runtime-elapsed-text">
            {t.runtimeElapsed} {formatDuration(elapsedMs, lang)}
          </span>
        </div>
      </div>
    );
  }

  if (!msg.trace?.length && !elapsedMs) {
    return null;
  }

  return (
    <div className="runtime-meta-card">
      <div className="runtime-meta-header">
        <span className="runtime-summary-label">{t.runtimeTraceSummary}</span>
        <span className="runtime-elapsed-text">
          {t.runtimeTotalTime} {formatDuration(stats.totalMs || elapsedMs, lang)}
        </span>
      </div>
      <div className="runtime-stats-grid">
        <div className="runtime-stat-chip">
          <span>{t.runtimeLoops}</span>
          <strong>{stats.loops || 1}</strong>
        </div>
        <div className="runtime-stat-chip">
          <span>{t.runtimeModelCalls}</span>
          <strong>{stats.modelCalls}</strong>
        </div>
        <div className="runtime-stat-chip">
          <span>{t.runtimeToolCalls}</span>
          <strong>{stats.toolCalls}</strong>
        </div>
      </div>
    </div>
  );
}
// ─────────────────────────────────────────────────────────────────────────────

export default function App() {
  const forgeoneDesktop = (window as any).forgeone;
  // 核心板块切换状态：'chat' | 'project' | 'model' | 'mcp' | 'skill' | 'policy' | 'trace'
  const [activeTab, setActiveTab] = useState<'chat' | 'agent' | 'project' | 'model' | 'mcp' | 'skill' | 'policy' | 'trace'>('chat');
  
  // 主题状态：默认暗色 'dark'
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    return (localStorage.getItem('theme') as 'light' | 'dark') || 'dark';
  });

  useEffect(() => {
    if (theme === 'dark') {
      document.body.classList.add('dark-theme');
    } else {
      document.body.classList.remove('dark-theme');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    if (!forgeoneDesktop?.onWindowStateChange) return;

    let mounted = true;
    forgeoneDesktop
      .getWindowState?.()
      .then((state: WindowState) => {
        if (mounted && state) {
          setWindowState({ isMaximized: Boolean(state.isMaximized) });
        }
      })
      .catch((error: unknown) => {
        console.error('Failed to load window state', error);
      });

    const unsubscribe = forgeoneDesktop.onWindowStateChange((state: WindowState) => {
      setWindowState({ isMaximized: Boolean(state?.isMaximized) });
    });

    return () => {
      mounted = false;
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, []);
  
  // 语言选项状态（默认中文 'zh'，可在设置中切换为 'en'）
  const [lang, setLang] = useState<'zh' | 'en'>('zh');
  const t = translations[lang];

  // 全局偏好设置弹窗状态
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  
  const [httpProxy, setHttpProxy] = useState('http://127.0.0.1:7890');
  const [socksProxy, setSocksProxy] = useState('');
  const [clearCacheOnExit, setClearCacheOnExit] = useState(false);
  const [windowState, setWindowState] = useState<WindowState>({ isMaximized: false });

  // MCP 视图控制与表单输入状态
  const [mcpView, setMcpView] = useState<'list' | 'form'>('list');
  const [mcpFormMode, setMcpFormMode] = useState<'create' | 'edit'>('create');
  const [mcpFormServerId, setMcpFormServerId] = useState<string | null>(null);

  const [mcpFormName, setMcpFormName] = useState('');
  const [mcpFormType, setMcpFormType] = useState<'local' | 'remote'>('local');
  const [mcpFormCommand, setMcpFormCommand] = useState('');
  const [mcpFormArgs, setMcpFormArgs] = useState('');
  const [mcpFormEnv, setMcpFormEnv] = useState<Array<{ key: string; value: string }>>([{ key: '', value: '' }]);
  const [mcpFormRemoteTransport, setMcpFormRemoteTransport] = useState<'SSE' | 'WebSocket'>('SSE');
  const [mcpFormTimeout, setMcpFormTimeout] = useState(30000);
  const [mcpFormUrl, setMcpFormUrl] = useState('');
  const [mcpFormHeaders, setMcpFormHeaders] = useState<Array<{ key: string; value: string }>>([{ key: '', value: '' }]);
  const [mcpFormSandbox, setMcpFormSandbox] = useState(true);

  // Agent 管理状态
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>('general-assistant');
  const [showCreateAgentModal, setShowCreateAgentModal] = useState(false);

  // 自定义 Agent 存储 (localStorage 持久化)
  const [customAgents, setCustomAgents] = useState<any[]>(() => {
    try {
      const saved = localStorage.getItem('forgeone_custom_agents');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

  // Agent 创建表单状态
  const initialFormState = {
    name: '',
    avatar: '🤖',
    systemPrompt: '',
    temperature: 0.5,
    modelId: '',
    tools: [] as string[],
    maxIterations: 5,
    editingId: null as string | null,
  };
  const [agentForm, setAgentForm] = useState({ ...initialFormState });

  const AVAILABLE_AVATARS = ['🤖', '💻', '📝', '📊', '🎨', '🔬', '🧠', '🛠️', '🎯', '⚡', '🌟', '🔍'];

  // 预置默认 Agent 列表
  const defaultAgents = [
    {
      id: 'general-assistant',
      name: lang === 'zh' ? '通用助手' : 'General Assistant',
      role: lang === 'zh' ? '通用对话与任务执行' : 'General conversation & task execution',
      icon: '🤖',
      color: '#6366f1',
      systemPrompt: lang === 'zh'
        ? '你是一个通用 AI 助手，擅长处理各类对话和任务。你可以回答问题、编写代码、分析数据、撰写文档等。请根据用户的具体需求，提供准确、全面的帮助。'
        : 'You are a general-purpose AI assistant skilled at handling various conversations and tasks. You can answer questions, write code, analyze data, write documents, etc. Provide accurate and comprehensive help based on the user\'s specific needs.',
      tools: ['read_file', 'search_content', 'web_search', 'run_command', 'chat'],
    },
    {
      id: 'code-expert',
      name: lang === 'zh' ? '代码专家' : 'Code Expert',
      role: lang === 'zh' ? '专注代码编写与审查' : 'Code writing & review specialist',
      icon: '💻',
      color: '#22c55e',
      systemPrompt: lang === 'zh'
        ? '你是一个代码专家 Agent，专注于软件开发和代码审查。你擅长：阅读和理解代码库、编写高质量代码、审查代码变更、调试问题、优化性能。请始终提供清晰、可维护的代码示例和解释。'
        : 'You are a Code Expert Agent focused on software development and code review. You excel at: reading and understanding codebases, writing high-quality code, reviewing code changes, debugging issues, and optimizing performance. Always provide clean, maintainable code examples and explanations.',
      tools: ['read_file', 'search_content', 'glob', 'edit_file', 'run_command'],
    },
    {
      id: 'document-writer',
      name: lang === 'zh' ? '文档撰写' : 'Document Writer',
      role: lang === 'zh' ? '专注文档与设计文档' : 'Documentation & design docs',
      icon: '📝',
      color: '#f59e0b',
      systemPrompt: lang === 'zh'
        ? '你是一个文档撰写 Agent，擅长编写技术文档、API 文档、架构设计文档和用户指南。你注重：清晰的结构、准确的技术描述、合适的示例和良好的可读性。请根据项目上下文生成专业文档。'
        : 'You are a Documentation Agent skilled at writing technical documentation, API docs, architecture design docs, and user guides. You focus on: clear structure, accurate technical descriptions, appropriate examples, and good readability.',
      tools: ['read_file', 'search_content', 'glob', 'write_file', 'edit_file'],
    },
    {
      id: 'data-analyst',
      name: lang === 'zh' ? '数据分析' : 'Data Analyst',
      role: lang === 'zh' ? '数据查询与可视化' : 'Data query & visualization',
      icon: '📊',
      color: '#8b5cf6',
      systemPrompt: lang === 'zh'
        ? '你是一个数据分析 Agent，擅长处理数据相关问题。你可以：查询和过滤数据、执行统计分析、生成可视化图表、解释数据趋势和模式。请基于数据提供准确的洞察。'
        : 'You are a Data Analyst Agent skilled at handling data-related questions. You can: query and filter data, perform statistical analysis, generate visualizations, and explain data trends and patterns. Provide accurate insights based on data.',
      tools: ['read_file', 'search_content', 'run_command', 'web_search'],
    },
  ];

  // 合并所有 Agent（默认 + 自定义）
  const allAgents = [...defaultAgents, ...customAgents];

  // 持久化自定义 Agent
  useEffect(() => {
    localStorage.setItem('forgeone_custom_agents', JSON.stringify(customAgents));
  }, [customAgents]);

  // 聊天交互相关状态
  const [inputText, setInputText] = useState('');
  const [inputHistory, setInputHistory] = useState<string[]>(() => {
    const saved = localStorage.getItem('forgeone_input_history');
    if (!saved) return [];

    try {
      const parsed = JSON.parse(saved);
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
    } catch {
      return [];
    }
  });
  const [inputHistoryIndex, setInputHistoryIndex] = useState<number | null>(null);
  const [inputDraft, setInputDraft] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [tracesList, setTracesList] = useState<HistoricalTrace[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [traceExpanded, setTraceExpanded] = useState<Record<string, boolean>>({});
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [isApprovalCollapsed, setIsApprovalCollapsed] = useState(false);
  const [runtimeNowMs, setRuntimeNowMs] = useState(Date.now());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputTextareaRef = useRef<HTMLTextAreaElement>(null);
  const conversationSummaries = buildConversationSummaries(tracesList);
  const conversationTraceEvents = messages
    .filter(message => message.sender === 'agent' && Array.isArray(message.trace))
    .flatMap(message => message.trace || []);
  const currentConversationSummary = selectedConversationId
    ? conversationSummaries.find(item => item.conversation_id === selectedConversationId) || null
    : null;
  const latestAgentMessage = [...messages].reverse().find(message => message.sender === 'agent') || null;

  // 项目面板状态
  const [explorerTree, setExplorerTree] = useState<any[]>([]);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [dirChildren, setDirChildren] = useState<Record<string, any[]>>({});
  const [previewFile, setPreviewFile] = useState<{ name: string; path: string; content: string } | null>(null);
  const [isDraggingPreview, setIsDraggingPreview] = useState(false);
  const [previewWidth, setPreviewWidth] = useState(45);
  const [showProjectList, setShowProjectList] = useState(false);
  const [currentProjectPath, setCurrentProjectPath] = useState<string | null>(null);
  const [currentProjectName, setCurrentProjectName] = useState<string | null>(null);
  const [projectsList, setProjectsList] = useState<any[]>(() => {
    try {
      const saved = localStorage.getItem('forgeone_projects_list');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

  // 持久化项目列表
  useEffect(() => {
    localStorage.setItem('forgeone_projects_list', JSON.stringify(projectsList));
  }, [projectsList]);

  // 切换项目
  const handleSwitchProject = async (path: string, name: string) => {
    setCurrentProjectPath(path);
    setCurrentProjectName(name);
    setShowProjectList(false);
    try {
      const tree = await (window as any).forgeone.readDir(path);
      setExplorerTree(tree);
    } catch (e) {
      console.error(e);
    }
  };

  // 添加项目
  const handleAddProject = async () => {
    setShowProjectList(false);
    const dirPath = await (window as any).forgeone.selectDir();
    if (dirPath) {
      const name = dirPath.split(/[/\\]/).filter(Boolean).pop() || dirPath;
      if (!projectsList.some((p: any) => p.path === dirPath)) {
        setProjectsList((prev: any[]) => [...prev, { path: dirPath, name }]);
      }
      try {
        const tree = await (window as any).forgeone.readDir(dirPath);
        setExplorerTree(tree);
        setCurrentProjectPath(dirPath);
        setCurrentProjectName(name);
      } catch (e) {
        console.error(e);
      }
    }
  };

  // 删除项目
  const handleRemoveProject = (idx: number) => {
    setProjectsList((prev: any[]) => prev.filter((_: any, i: number) => i !== idx));
  };

  // 渲染可展开的文件树
  const renderTreeItems = (items: any[], parentPath: string, depth: number): React.ReactNode => {
    const sorted = [...items].sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return sorted.map((item) => {
      const fullPath = item.path || (parentPath ? `${parentPath}/${item.name}` : item.name);
      const isExpanded = expandedDirs.has(fullPath);
      const children = dirChildren[fullPath];
      return (
        <div key={fullPath}>
          <div
            className={`file-tree-item ${!item.isDirectory ? 'file' : 'directory'}`}
            style={{
              padding: '4px 8px', paddingLeft: `${12 + depth * 14}px`,
              borderRadius: '4px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: '4px',
              fontSize: '12px',
            }}
            onClick={async () => {
              if (item.isDirectory) {
                if (isExpanded) {
                  const next = new Set(expandedDirs);
                  next.delete(fullPath);
                  setExpandedDirs(next);
                } else {
                  if (!children) {
                    try {
                      const sub = await (window as any).forgeone.readDir(fullPath);
                      setDirChildren(prev => ({ ...prev, [fullPath]: sub }));
                    } catch (e) {
                      console.error(e);
                    }
                  }
                  const next = new Set(expandedDirs);
                  next.add(fullPath);
                  setExpandedDirs(next);
                }
              } else {
                try {
                  const result = await (window as any).forgeone.readFile(fullPath);
                  const fileContent = result.content || result.error || '';
                  setPreviewFile({ name: item.name, path: fullPath, content: fileContent });
                } catch (e) {
                  console.error(e);
                }
              }
            }}
          >
            <Icon
              name={item.isDirectory ? (isExpanded ? 'folder_open' : 'folder') : 'description'}
              style={{ fontSize: '13px', color: 'var(--on-surface-variant)', flexShrink: 0 }}
            />
            <span style={{ color: 'var(--on-surface)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
          </div>
          {item.isDirectory && isExpanded && children && (
            <div>{renderTreeItems(children, fullPath, depth + 1)}</div>
          )}
        </div>
      );
    });
  };

  // 预览面板拖拽
  const handlePreviewMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingPreview(true);
    const startX = e.clientX;
    const startWidth = previewWidth;
    const container = (e.target as HTMLElement).closest('.stitch-project-layout') as HTMLElement;
    const containerWidth = container?.offsetWidth || 1200;

    const handleMouseMove = (ev: MouseEvent) => {
      const delta = (startX - ev.clientX) / containerWidth;
      const newWidth = Math.max(20, Math.min(70, startWidth + delta * 100));
      setPreviewWidth(newWidth);
    };
    const handleMouseUp = () => {
      setIsDraggingPreview(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };
  
  // 项目助手聊天状态
  const [projectMessages, setProjectMessages] = useState<Message[]>([]);
  const [projectInput, setProjectInput] = useState('');
  const [isProjectSending, setIsProjectSending] = useState(false);
  const projectMessagesEndRef = useRef<HTMLDivElement>(null);

  // 项目助手发送消息
  const handleProjectSend = async () => {
    const text = projectInput.trim();
    if (!text || isProjectSending) return;
    setProjectInput('');
    setProjectMessages(prev => [...prev, {
      id: 'user-' + Date.now(),
      sender: 'user',
      content: text,
      timestamp: Date.now(),
      agentId: selectedChatAgentId || undefined,
    }]);
    setIsProjectSending(true);
    try {
      // 用 file_search + 读取 + 上下文 响应
      const contextLines = explorerTree.slice(0, 20).map((item: any) => `${item.isDirectory ? '📁' : '📄'} ${item.name}`).join('\n');
      setProjectMessages(prev => [...prev, {
        id: 'resp-' + Date.now(),
        sender: 'agent',
        content: lang === 'zh'
          ? `收到您的问题。正在分析项目上下文...\n\n**当前项目文件：**\n\`\`\`\n${contextLines || '(暂无文件)'}\n\`\`\`\n\n您可以点击左侧文件树中的文件，我会读取其内容供您查看和分析。`
          : `Received your question. Analyzing project context...\n\n**Current project files:**\n\`\`\`\n${contextLines || '(No files)'}\n\`\`\`\n\nYou can click a file in the tree to read its content.`,
        timestamp: Date.now(),
      }]);
    } catch (e) {
      setProjectMessages(prev => [...prev, {
        id: 'err-' + Date.now(),
        sender: 'agent',
        content: lang === 'zh' ? '处理请求时出错，请重试。' : 'Error processing request, please retry.',
        timestamp: Date.now(),
      }]);
    }
    setIsProjectSending(false);
  };

  const [projectRoot] = useState('D:/project/forgeone');
  
  // 模型面板状态 - 升级为多配置 (Model Profiles) 管理
  const DEFAULT_PROFILES: ModelProfile[] = [
    {
      id: 'openai-default',
      name: 'Official OpenAI GPT-4o',
      type: 'official',
      protocol: 'openai',
      provider: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-proj-••••••••••••••••••••••••••••••••',
      modelId: 'gpt-4o',
      temperature: 0.2,
      topP: 1.0,
      maxTokens: 4096,
      autoTruncate: true
    },
    {
      id: 'anthropic-default',
      name: 'Official Anthropic Claude 3.5',
      type: 'official',
      protocol: 'anthropic',
      provider: 'Anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
      apiKey: 'sk-ant-••••••••••••••••••••••••••••••••',
      modelId: 'claude-3-5-sonnet',
      temperature: 0.2,
      topP: 1.0,
      maxTokens: 4096,
      autoTruncate: true
    },
    {
      id: 'local-default',
      name: 'Local Ollama Llama 3',
      type: 'custom_simple',
      protocol: 'openai',
      provider: 'Ollama',
      baseUrl: 'http://localhost:11434/v1',
      apiKey: '',
      modelId: 'llama3',
      temperature: 0.8,
      topP: 1.0,
      maxTokens: 2048,
      autoTruncate: false
    }
  ];

  const [profiles, setProfiles] = useState<ModelProfile[]>(DEFAULT_PROFILES);
  const [activeProfileId, setActiveProfileId] = useState<string>('openai-default');
  const [profilesLoaded, setProfilesLoaded] = useState(false);

  // 启动时从文件加载配置（比 localStorage 可靠，进程重启不丢失）
  useEffect(() => {
    (async () => {
      const result = await (window as any).forgeone.loadProfiles();
      if (result?.success && result.data) {
        try {
          const parsed = JSON.parse(result.data);
          setProfiles(parsed.profiles || DEFAULT_PROFILES);
          setActiveProfileId(parsed.activeProfileId || 'openai-default');
        } catch (e) {
          console.error('Failed to parse saved profiles', e);
        }
      }
      setProfilesLoaded(true);
    })();
  }, []);

  // profiles 或 activeProfileId 变化时保存到文件
  useEffect(() => {
    if (!profilesLoaded) return;
    const payload = JSON.stringify({ profiles, activeProfileId });
    (window as any).forgeone.saveProfiles(payload);
  }, [profiles, activeProfileId, profilesLoaded]);

  const activeProfile = profiles.find(p => p.id === activeProfileId);
  const activeContextWindow = activeProfile
    ? inferRuntimeContextWindow(activeProfile.modelId, activeProfile.protocol)
    : 32_000;
  const currentContextTokens = latestAgentMessage?.budgetUsage?.tokens_estimate || 0;
  const currentContextRatio = activeContextWindow > 0
    ? Math.min(100, (currentContextTokens / activeContextWindow) * 100)
    : 0;

  const [approvalMode, setApprovalMode] = useState<'danger' | 'approval'>('approval');
  const [showMiniSelector, setShowMiniSelector] = useState(false);
  const [showChatAgentSelector, setShowChatAgentSelector] = useState(false);
  const [selectedChatAgentId, setSelectedChatAgentId] = useState<string | null>(null);

  // 编辑状态: null -> 主页列表, 'new' -> 新建, 字符串(id) -> 编辑现有
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);

  // 查看详情的 Modal 选择
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);

  // 连接测试状态
  const [connectionStatus, setConnectionStatus] = useState<Record<string, { status: 'testing' | 'success' | 'failed', delay?: number, error?: string }>>({});

  // 二级编辑表单的临时状态
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState<'official' | 'custom_simple' | 'custom_script'>('official');
  const [formProtocol, setFormProtocol] = useState<'openai' | 'anthropic'>('openai');
  const [formProvider, setFormProvider] = useState('OpenAI');
  const [formBaseUrl, setFormBaseUrl] = useState('');
  const [formApiKey, setFormApiKey] = useState('');
  const [formModelId, setFormModelId] = useState('');
  const [formAuthScript, setFormAuthScript] = useState(`// Node.js Execution Context\nasync function getAuthHeaders() {\n  return {\n    "Authorization": "Bearer YOUR_TOKEN"\n  };\n}`);
  const [formTemperature, setFormTemperature] = useState(0.7);
  const [formTopP, setFormTopP] = useState(1.0);
  const [formMaxTokens, setFormMaxTokens] = useState(4096);
  const [formAutoTruncate, setFormAutoTruncate] = useState(true);
  const [showFormApiKey, setShowFormApiKey] = useState(false);

  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [fetchModelsError, setFetchModelsError] = useState<string | null>(null);
  const inferredContextWindow = inferRuntimeContextWindow(formModelId, formProtocol);

  // 持久化存储（模型配置已通过 saveProfiles IPC 写入文件）
  useEffect(() => {
    localStorage.setItem('forgeone_input_history', JSON.stringify(inputHistory.slice(0, 50)));
  }, [inputHistory]);

  // MCP 面板状态
  const [mcpServers, setMcpServers] = useState<MCPServer[]>(() => {
    const saved = localStorage.getItem('forgeone_mcp_servers');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          // 过滤掉虚拟的 Mock 数据，只保留本地真实服务和用户添加的自定义服务
          const filtered = parsed.filter((s: any) => s && (s.id === 'filesystem-local' || s.id.startsWith('custom-')));
          // 立即同步回 localStorage，避免被其它地方覆盖
          localStorage.setItem('forgeone_mcp_servers', JSON.stringify(filtered));
          return filtered;
        }
      } catch (e) {
        console.error(e);
      }
    }
    const defaultList: MCPServer[] = [
      {
        id: 'filesystem-local',
        name: 'filesystem-local',
        transport: 'stdio',
        endpoint: 'npx @modelcontextprotocol/server-filesystem D:\\project\\forgeone',
        status: 'connected',
        permission: 'workspace read/write',
        authMode: 'none',
        startupMode: 'spawn on app boot',
        mountScope: 'workspace',
        mountTarget: 'ForgeOne Core workspace',
        policyMode: 'allowed for current workspace',
        capabilities: { tools: 6, resources: 4, prompts: 0 },
        toolNames: ['read_file', 'write_file', 'list_directory', 'move_file', 'stat_path', 'glob_search'],
        resourceNames: ['workspace://root', 'workspace://src', 'workspace://docs', 'workspace://recent'],
        promptNames: [],
        description: '本地文件系统 Server，向 Runtime 暴露工作区读写与目录资源。',
        lastHandshake: '2026-06-14 21:30',
        lastTrace: '2 minutes ago'
      }
    ];
    localStorage.setItem('forgeone_mcp_servers', JSON.stringify(defaultList));
    return defaultList;
  });

  useEffect(() => {
    const filtered = mcpServers.filter((s: any) => s && (s.id === 'filesystem-local' || s.id.startsWith('custom-')));
    if (filtered.length !== mcpServers.length) {
      setMcpServers(filtered);
    } else {
      localStorage.setItem('forgeone_mcp_servers', JSON.stringify(mcpServers));
    }
  }, [mcpServers]);

  const [selectedMcpServerId, setSelectedMcpServerId] = useState<string>('');

  // 技能面板状态
  const [skills, setSkills] = useState([
    { id: 'file_indexer', name: '文件智能检索', desc: '利用向量数据库对当前工作目录下的文件内容进行语义化建索引与检索', enabled: true },
    { id: 'python_sandbox', name: 'Python 沙箱执行', desc: '在隔离的轻量容器环境中运行代理生成的 Python 代码脚本', enabled: true },
    { id: 'web_scraper', name: '网页数据爬取', desc: '支持抓取外部公开网页内容并将其清洗为 Markdown 文档格式', enabled: true },
    { id: 'database_writer', name: '数据库写入工具', desc: '根据批准直接对连接的 MCP 数据源执行增删改查 SQL 指令', enabled: false }
  ]);

  // 策略面板状态
  const [maxLoops, setMaxLoops] = useState(20);
  const [allowedTools, setAllowedTools] = useState('read_file,write_file,search_files,search_content,edit_file,glob,directory_tree,diff,shell');
  const [maxCostBudget, setMaxCostBudget] = useState(5.00);
  const [warningThreshold, setWarningThreshold] = useState(3.00);
  const [requireApprovalForShell, setRequireApprovalForShell] = useState(true);

  // 加载会话历史
  useEffect(() => {
    loadTraces();
  }, []);

  // 聊天滚到底部
  useEffect(() => {
    const timer = setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
    }, 100);
    return () => clearTimeout(timer);
  }, [messages]);

  useEffect(() => {
    const hasStreamingMessage = messages.some(message => message.streaming);
    if (!hasStreamingMessage) return;

    const timer = window.setInterval(() => {
      setRuntimeNowMs(Date.now());
    }, 250);

    return () => window.clearInterval(timer);
  }, [messages]);

  const loadTraces = async () => {
    try {
      const list = await (window as any).forgeone.listTraces();
      setTracesList(list || []);
    } catch (e) {
      console.error('Failed to load traces', e);
    }
  };

  const loadConversation = async (conversationId: string, preferredSessionId?: string | null) => {
    const related = tracesList
      .filter(item => (item.conversation_id || item.session_id) === conversationId)
      .sort((a, b) => {
        if (a.turn_index !== b.turn_index) {
          return a.turn_index - b.turn_index;
        }
        return a.updated_at_ms - b.updated_at_ms;
      });

    if (!related.length) {
      setMessages([]);
      setSelectedConversationId(conversationId);
      setSelectedSessionId(preferredSessionId || null);
      return;
    }

    try {
      const records = await Promise.all(
        related.map(item => (window as any).forgeone.inspectTrace(item.session_id))
      );

      const orderedRecords = records.filter(Boolean).sort((a, b) => {
        if ((a.turn_index || 0) !== (b.turn_index || 0)) {
          return (a.turn_index || 0) - (b.turn_index || 0);
        }
        return (a.updated_at_ms || 0) - (b.updated_at_ms || 0);
      });

      const nextMessages: Message[] = orderedRecords.flatMap((record: any) => {
        const traceTimestamps = (record.trace || []).map((evt: TraceEvent) => evt.timestamp_ms);
        const startedAt = traceTimestamps.length ? Math.min(...traceTimestamps) : Date.now();
        const completedAt = traceTimestamps.length ? Math.max(...traceTimestamps) : startedAt;

        return [
          {
            id: `user-${record.session_id}`,
            sender: 'user',
            content: record.task_input,
            timestamp: startedAt,
            animateOnLoad: false,
          },
          {
            id: `agent-${record.session_id}`,
            sender: 'agent',
            content: record.final_response || (record.pending_approval ? (lang === 'zh' ? 'Agent suspended, awaiting approval.' : 'Agent suspended, awaiting approval.') : (lang === 'zh' ? '任务已执行完成。' : 'Task completed.')),
            status: record.status,
            trace: record.trace || [],
            pendingApproval: record.pending_approval,
            budgetUsage: {
              tokens_estimate: record.tokens_estimate,
              tool_call_count: record.tool_call_count,
            },
            timestamp: completedAt,
            animateOnLoad: false,
            runStartedAt: startedAt,
            runCompletedAt: completedAt,
          },
        ];
      });

      setMessages(nextMessages);
      setSelectedConversationId(conversationId);
      setSelectedSessionId(preferredSessionId || related[related.length - 1]?.session_id || null);
    } catch (e) {
      console.error('Failed to load conversation', e);
    }
  };

  const handleClearHistory = async () => {
    if (confirm(lang === 'zh' ? '确定要清空所有会话历史记录吗？这会清除上下文并重置智能体状态。' : 'Are you sure you want to clear all session history? This will clear context and reset the agent state.')) {
      try {
        if ((window as any).forgeone) {
          await (window as any).forgeone.pruneTraces();
          await (window as any).forgeone.prunePending();
        }
        setMessages([]);
        setSelectedConversationId(null);
        setSelectedSessionId(null);
        setTracesList([]);
        alert(lang === 'zh' ? '会话历史已清空！' : 'Session history cleared!');
      } catch (err) {
        console.error('Failed to clear history:', err);
        setMessages([]);
        setSelectedConversationId(null);
        setSelectedSessionId(null);
        setTracesList([]);
      }
    }
  };

  const moveTextareaCursorToEnd = () => {
    window.requestAnimationFrame(() => {
      const textarea = inputTextareaRef.current;
      if (!textarea) return;
      const end = textarea.value.length;
      textarea.focus();
      textarea.setSelectionRange(end, end);
    });
  };

  const recallInputHistory = (direction: 'older' | 'newer') => {
    if (!inputHistory.length) return;

    if (direction === 'older') {
      const nextIndex = inputHistoryIndex === null
        ? inputHistory.length - 1
        : Math.max(0, inputHistoryIndex - 1);

      if (inputHistoryIndex === null) {
        setInputDraft(inputText);
      }

      setInputHistoryIndex(nextIndex);
      setInputText(inputHistory[nextIndex] || '');
      moveTextareaCursorToEnd();
      return;
    }

    if (inputHistoryIndex === null) return;

    if (inputHistoryIndex >= inputHistory.length - 1) {
      setInputHistoryIndex(null);
      setInputText(inputDraft);
      moveTextareaCursorToEnd();
      return;
    }

    const nextIndex = inputHistoryIndex + 1;
    setInputHistoryIndex(nextIndex);
    setInputText(inputHistory[nextIndex] || '');
    moveTextareaCursorToEnd();
  };

  const handleDeleteHistoryItem = async (conversationId: string) => {
    const confirmed = confirm(
      lang === 'zh'
        ? '确定删除这条历史记录吗？该会话的 Trace 与审批状态会一并移除。'
        : 'Delete this history entry? Its trace and pending approval state will be removed.'
    );
    if (!confirmed) return;

    try {
      const related = tracesList.filter(
        item => (item.conversation_id || item.session_id) === conversationId
      );
      await Promise.all(
        related.map(item => (window as any).forgeone.deleteTrace(item.session_id))
      );
      setTracesList(prev =>
        prev.filter(item => (item.conversation_id || item.session_id) !== conversationId)
      );

      if (selectedConversationId === conversationId) {
        setSelectedConversationId(null);
        setSelectedSessionId(null);
        setMessages([]);
      }
    } catch (error) {
      console.error('Failed to delete history item', error);
      alert(lang === 'zh' ? '删除失败，请稍后重试。' : 'Failed to delete history entry. Please try again.');
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || isRunning) return;

    const taskToSend = inputText;
    const conversationId = selectedConversationId || nextConversationId();
    const priorConversationHistory = serializeConversationHistory(messages);
    if (taskToSend.trim() === '/clear') {
      setInputText('');
      handleClearHistory();
      return;
    }

    const trimmedTask = taskToSend.trim();
    setInputHistory(prev => {
      const deduped = prev.filter(item => item !== trimmedTask);
      return [...deduped, trimmedTask].slice(-50);
    });
    setInputHistoryIndex(null);
    setInputDraft('');
    setInputText('');
    setIsRunning(true);
    setSelectedConversationId(conversationId);

    const userMessageId = `user-${Date.now()}`;
    const agentMessageId = `agent-${Date.now()}`;

    setMessages(prev => [
      ...prev,
      {
        id: userMessageId,
        sender: 'user',
        content: taskToSend,
        timestamp: Date.now(),
        agentId: selectedChatAgentId || undefined,
      },
      {
        id: agentMessageId,
        sender: 'agent',
        content: '',
        timestamp: Date.now(),
        status: 'running',
        agentId: selectedChatAgentId || undefined,
        streaming: true,
        trace: [],
        animateOnLoad: true,
        runStartedAt: Date.now(),
      }
    ]);

    const toolsArr = allowedTools.split(',').map(t => t.trim()).filter(Boolean);

    try {
      const activeProfile = profiles.find(p => p.id === activeProfileId);
      
      let modelNameParam = 'mock';
      let apiKeyParam = undefined;
      let baseUrlParam = undefined;
      
      if (activeProfile) {
        apiKeyParam = activeProfile.apiKey;
        baseUrlParam = activeProfile.baseUrl;
        if (activeProfile.protocol === 'openai') {
          modelNameParam = `openai:${activeProfile.modelId}`;
        } else if (activeProfile.protocol === 'anthropic') {
          modelNameParam = `openai:${activeProfile.modelId}`; // 将其映射给 openai 适配器处理，支持 proxy
        } else if (activeProfile.type === 'custom_simple' || activeProfile.type === 'custom_script') {
          modelNameParam = `openai:${activeProfile.modelId}`;
        } else {
          modelNameParam = activeProfile.modelId;
        }
      }

      const res: RunResult = await (window as any).forgeone.runTask({
        task: taskToSend,
        conversation_id: conversationId,
        conversation_history: priorConversationHistory,
        model_name: modelNameParam,
        api_key: apiKeyParam,
        base_url: baseUrlParam,
        max_loops: maxLoops,
        token_budget: 32000,
        max_output_tokens: activeProfile?.maxTokens,
        allowed_tools: toolsArr,
        read_roots: approvalMode === 'danger' ? [projectRoot] : [],
        approval_read_roots: approvalMode === 'danger' ? [] : [],
        agent_prompt: (() => {
          if (!selectedChatAgentId) return undefined;
          const agent = allAgents.find(a => a.id === selectedChatAgentId);
          return agent ? agent.systemPrompt : undefined;
        })(),
        mcp_servers: mcpServers
          .filter(server => server.status === 'connected')
          .map(server => ({
            name: server.name,
            transport: server.transport,
            command: server.command,
            args: server.args,
            env: server.env,
            endpoint: server.endpoint,
            headers: server.headers,
            timeout: server.timeout,
          })),
      });

      setSelectedConversationId(conversationId);
      setSelectedSessionId(res.state.session_id);
      
      const isMaxLoops = res.state.stop_reason === 'max_loops_reached';
      setMessages(prev => prev.map(m => m.id === agentMessageId ? {
        ...m,
        content: res.final_response || (res.state.pending_approval ? (lang === 'zh' ? 'Agent 执行由于触发高危工具已被 Policy Engine 挂起，正在等待您的安全审批。' : 'Agent loop suspended by Policy Engine, awaiting developer authorization.') : isMaxLoops ? (lang === 'zh' ? '已达到最大循环次数（20次），但任务可能尚未完成。您可以继续描述目标，Agent 会继续执行。' : 'Max loops (20) reached, but the task may not be complete. You can continue describing your goal and the agent will keep working.') : (lang === 'zh' ? '任务已顺利执行完成。' : 'Task successfully executed.')),
        status: res.state.status,
        streaming: false,
        trace: res.trace,
        pendingApproval: res.state.pending_approval,
        budgetUsage: res.state.budget_usage,
        runCompletedAt: Date.now(),
      } : m));

      loadTraces();
    } catch (err: any) {
      setMessages(prev => prev.map(m => m.id === agentMessageId ? {
        ...m,
        content: `${lang === 'zh' ? '执行出错' : 'Error'}: ${err.message || err}`,
        status: 'failed',
        streaming: false,
        runCompletedAt: Date.now(),
      } : m));
    } finally {
      setIsRunning(false);
    }
  };

  const handleSelectHistory = async (sessionId: string) => {
    setSelectedSessionId(sessionId);
    try {
      const record = await (window as any).forgeone.inspectTrace(sessionId);
      if (record) {
        const traceTimestamps = (record.trace || []).map((evt: TraceEvent) => evt.timestamp_ms);
        const startedAt = traceTimestamps.length ? Math.min(...traceTimestamps) : Date.now();
        const completedAt = traceTimestamps.length ? Math.max(...traceTimestamps) : startedAt;
        setMessages([
          {
            id: `user-${record.session_id}`,
            sender: 'user',
            content: record.task_input,
            timestamp: startedAt,
            animateOnLoad: false,
          },
          {
            id: `agent-${record.session_id}`,
            sender: 'agent',
            content: record.final_response || (record.pending_approval ? (lang === 'zh' ? 'Agent 执行被 Policy Engine 挂起，等待安全审批。' : 'Agent suspended, awaiting approval.') : (lang === 'zh' ? '任务已执行完成。' : 'Task completed.')),
            status: record.status,
            trace: record.trace || [],
            pendingApproval: record.pending_approval,
            budgetUsage: {
              tokens_estimate: record.tokens_estimate,
              tool_call_count: record.tool_call_count
            },
            timestamp: completedAt,
            animateOnLoad: false,
            runStartedAt: startedAt,
            runCompletedAt: completedAt,
          }
        ]);
      }
    } catch (e) {
      console.error('Failed to inspect trace', e);
    }
  };

  const handleSelectConversation = async (conversationId: string, sessionId?: string | null) => {
    await loadConversation(conversationId, sessionId);
  };

  void handleSelectHistory;

  const handleApprove = async (agentMsgId: string, sessionId: string) => {
    setIsRunning(true);
    
    setMessages(prev => prev.map(m => m.id === agentMsgId ? {
      ...m,
      pendingApproval: null,
      status: 'running',
      content: lang === 'zh' ? '安全授权已批准。正在恢复 Agent 沙箱并恢复执行循环...' : 'Authorization granted. Restoring Agent Sandbox and resuming loop...',
      streaming: true,
      runStartedAt: Date.now(),
      runCompletedAt: undefined,
    } : m));

    try {
      const res: RunResult = await (window as any).forgeone.approveSession(sessionId);
      setMessages(prev => prev.map(m => m.id === agentMsgId ? {
        ...m,
        content: res.final_response || (lang === 'zh' ? '任务已顺利执行完成。' : 'Task successfully executed.'),
        status: res.state.status,
        streaming: false,
        trace: res.trace,
        pendingApproval: res.state.pending_approval,
        budgetUsage: res.state.budget_usage,
        runCompletedAt: Date.now(),
      } : m));
      loadTraces();
    } catch (err: any) {
      const errMsg = err?.message || (typeof err === 'string' ? err : JSON.stringify(err));
      const isStaleSession = errMsg.includes('系统找不到指定的文件') || errMsg.includes('No such file');
      setMessages(prev => prev.map(m => m.id === agentMsgId ? {
        ...m,
        pendingApproval: isStaleSession ? null : m.pendingApproval,
        content: isStaleSession
          ? (lang === 'zh' ? '该审批请求已过期（会话已结束或已重启），请重新发送消息。' : 'This approval request has expired (session ended or restarted). Please send a new message.')
          : `${lang === 'zh' ? '恢复执行审批出错' : 'Error resuming loop'}: ${errMsg}`,
        status: isStaleSession ? 'aborted' : 'failed',
        streaming: false,
        runCompletedAt: Date.now(),
      } : m));
      if (isStaleSession) loadTraces();
    } finally {
      setIsRunning(false);
    }
  };

  const handleReject = async (agentMsgId: string, sessionId: string) => {
    setIsRunning(true);
    setMessages(prev => prev.map(m => m.id === agentMsgId ? {
      ...m,
      pendingApproval: null,
      status: 'running',
      content: lang === 'zh' ? '用户拒绝了该操作。正在通知 Agent...' : 'User rejected the operation. Notifying agent...',
      streaming: true,
      runStartedAt: Date.now(),
      runCompletedAt: undefined,
    } : m));

    try {
      const res: RunResult = await (window as any).forgeone.rejectSession(sessionId);
      setMessages(prev => prev.map(m => m.id === agentMsgId ? {
        ...m,
        content: res.final_response || (lang === 'zh' ? '操作已被用户拒绝。' : 'Operation rejected by user.'),
        status: res.state.status,
        streaming: false,
        trace: res.trace,
        pendingApproval: res.state.pending_approval,
        budgetUsage: res.state.budget_usage,
        runCompletedAt: Date.now(),
      } : m));
      loadTraces();
    } catch (err: any) {
      setMessages(prev => prev.map(m => m.id === agentMsgId ? {
        ...m,
        content: `${lang === 'zh' ? '拒绝操作出错' : 'Error rejecting operation'}: ${err.message || err}`,
        status: 'failed',
        streaming: false,
        runCompletedAt: Date.now(),
      } : m));
    } finally {
      setIsRunning(false);
    }
  };

  const toggleTrace = (id: string) => {
    setTraceExpanded(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleSkill = (id: string) => {
    setSkills(prev => prev.map(s => s.id === id ? { ...s, enabled: !s.enabled } : s));
  };

  const selectedMcpServer = mcpServers.find(server => server.id === selectedMcpServerId) ?? mcpServers[0] ?? null;
  const mcpConnectedCount = mcpServers.filter(server => server.status === 'connected').length;
  const mcpIssueCount = mcpServers.filter(server => server.status === 'error' || server.status === 'connecting').length;
  const mcpMountedCount = mcpServers.filter(server => server.mountScope !== 'disabled').length;
  const mcpCapabilityTotals = mcpServers.reduce(
    (totals, server) => ({
      tools: totals.tools + server.capabilities.tools,
      resources: totals.resources + server.capabilities.resources,
      prompts: totals.prompts + server.capabilities.prompts,
    }),
    { tools: 0, resources: 0, prompts: 0 }
  );
  const selectedMcpSections = selectedMcpServer
    ? [
        { label: 'Tools', items: selectedMcpServer.toolNames },
        { label: 'Resources', items: selectedMcpServer.resourceNames },
        { label: 'Prompts', items: selectedMcpServer.promptNames },
      ]
    : [];
  const getMcpStatusLabel = (status: MCPServer['status']) => {
    if (lang === 'zh') {
      switch (status) {
        case 'connected':
          return '已连接';
        case 'connecting':
          return '连接中';
        case 'error':
          return '异常';
        case 'disabled':
        default:
          return '已禁用';
      }
    }

    switch (status) {
      case 'connected':
        return 'Connected';
      case 'connecting':
        return 'Connecting';
      case 'error':
        return 'Error';
      case 'disabled':
      default:
        return 'Disabled';
    }
  };
  const getMcpStatusTone = (status: MCPServer['status']) => {
    if (status === 'connected') return 'success';
    if (status === 'error') return 'warning';
    return 'info';
  };
  const getMcpTransportLabel = (transport: MCPServer['transport']) =>
    transport === 'streamable_http' ? 'Streamable HTTP' : 'STDIO';
  const getMcpMountScopeLabel = (scope: MCPServer['mountScope']) => {
    if (lang === 'zh') {
      switch (scope) {
        case 'global':
          return '全局';
        case 'workspace':
          return '工作区';
        case 'session':
          return '会话';
        case 'disabled':
        default:
          return '未挂载';
      }
    }

    switch (scope) {
      case 'global':
        return 'Global';
      case 'workspace':
        return 'Workspace';
      case 'session':
        return 'Session';
      case 'disabled':
      default:
        return 'Not Mounted';
    }
  };

  const handleGoToCreate = () => {
    setMcpFormMode('create');
    setMcpFormServerId(null);
    
    setMcpFormName(`custom-server-${mcpServers.length + 1}`);
    setMcpFormType('local');
    setMcpFormCommand('');
    setMcpFormArgs('');
    setMcpFormEnv([{ key: '', value: '' }]);
    setMcpFormRemoteTransport('SSE');
    setMcpFormTimeout(30000);
    setMcpFormUrl('');
    setMcpFormHeaders([{ key: '', value: '' }]);
    setMcpFormSandbox(true);

    setMcpView('form');
  };

  const handleGoToEdit = (id: string) => {
    const server = mcpServers.find(s => s.id === id);
    if (!server) return;

    setMcpFormMode('edit');
    setMcpFormServerId(id);
    
    setMcpFormName(server.name);
    setMcpFormType(server.transport === 'stdio' ? 'local' : 'remote');
    setMcpFormCommand(server.command || '');
    setMcpFormArgs(server.args || '');
    setMcpFormEnv(server.env && server.env.length > 0 ? server.env : [{ key: '', value: '' }]);
    setMcpFormRemoteTransport(server.remoteTransport || 'SSE');
    setMcpFormTimeout(server.timeout || 30000);
    setMcpFormUrl(server.endpoint || '');
    setMcpFormHeaders(server.headers && server.headers.length > 0 ? server.headers : [{ key: '', value: '' }]);
    setMcpFormSandbox(server.sandbox !== undefined ? server.sandbox : true);

    setMcpView('form');
  };

  const handleSaveMcpForm = () => {
    if (!mcpFormName.trim()) {
      alert(lang === 'zh' ? '请输入 Server 名称' : 'Please enter server name');
      return;
    }

    if (mcpFormType === 'local') {
      if (!mcpFormCommand.trim()) {
        alert(lang === 'zh' ? '请输入 Stdio 命令 (Command)' : 'Please enter Stdio Command');
        return;
      }
    } else {
      if (!mcpFormUrl.trim()) {
        alert(lang === 'zh' ? '请输入 URL' : 'Please enter URL');
        return;
      }
    }

    const filteredEnv = mcpFormEnv.filter(item => item.key.trim() !== '');
    const filteredHeaders = mcpFormHeaders.filter(item => item.key.trim() !== '');

    let endpoint = '';
    if (mcpFormType === 'local') {
      endpoint = `${mcpFormCommand} ${mcpFormArgs}`.trim();
    } else {
      endpoint = mcpFormUrl;
    }

    if (mcpFormMode === 'create') {
      const nextId = `custom-${Date.now()}`;
      const nextServer: MCPServer = {
        id: nextId,
        name: mcpFormName,
        transport: mcpFormType === 'local' ? 'stdio' : 'streamable_http',
        endpoint: endpoint,
        status: 'connected',
        permission: mcpFormType === 'local' ? (mcpFormSandbox ? 'sandbox' : 'unrestricted') : 'remote HTTP API',
        authMode: mcpFormType === 'local' ? 'env defined' : (filteredHeaders.length > 0 ? 'header key auth' : 'none'),
        startupMode: mcpFormType === 'local' ? 'spawn on demand' : 'HTTP client',
        mountScope: 'session',
        mountTarget: lang === 'zh' ? '当前会话' : 'Current session',
        policyMode: mcpFormType === 'local' && mcpFormSandbox ? 'sandboxed execution' : 'allowed',
        capabilities: { 
          tools: mcpFormType === 'local' ? 4 : 8, 
          resources: mcpFormType === 'local' ? 2 : 12, 
          prompts: 0 
        },
        toolNames: mcpFormType === 'local' ? ['custom_tool_1', 'custom_tool_2'] : ['fetch_api', 'query_endpoint'],
        resourceNames: mcpFormType === 'local' ? ['file://local/config'] : ['api://remote/endpoint'],
        promptNames: [],
        description: mcpFormType === 'local' 
          ? `本地启动命令: ${mcpFormCommand}`
          : `远程 SSE/WS 服务器: ${mcpFormUrl}`,
        lastHandshake: new Date().toLocaleString(),
        lastTrace: lang === 'zh' ? '初始化并发现能力' : 'Initialized and discovered capabilities',
        command: mcpFormCommand,
        args: mcpFormArgs,
        env: filteredEnv,
        remoteTransport: mcpFormRemoteTransport,
        timeout: mcpFormTimeout,
        headers: filteredHeaders,
        sandbox: mcpFormSandbox,
      };

      setMcpServers(prev => [nextServer, ...prev]);
      setSelectedMcpServerId(nextId);
    } else {
      setMcpServers(prev => prev.map(server => {
        if (server.id !== mcpFormServerId) return server;
        return {
          ...server,
          name: mcpFormName,
          transport: mcpFormType === 'local' ? 'stdio' : 'streamable_http',
          endpoint: endpoint,
          permission: mcpFormType === 'local' ? (mcpFormSandbox ? 'sandbox' : 'unrestricted') : 'remote HTTP API',
          authMode: mcpFormType === 'local' ? 'env defined' : (filteredHeaders.length > 0 ? 'header key auth' : 'none'),
          description: mcpFormType === 'local' 
            ? `本地启动命令: ${mcpFormCommand}`
            : `远程 SSE/WS 服务器: ${mcpFormUrl}`,
          command: mcpFormCommand,
          args: mcpFormArgs,
          env: filteredEnv,
          remoteTransport: mcpFormRemoteTransport,
          timeout: mcpFormTimeout,
          headers: filteredHeaders,
          sandbox: mcpFormSandbox,
          status: server.status === 'disabled' ? 'connected' : server.status,
        };
      }));
    }

    setMcpView('list');
  };

  const handleCancelMcpForm = () => {
    setMcpView('list');
  };

  const handleToggleMcpServer = (id: string) => {
    setMcpServers(prev => prev.map(server => {
      if (server.id !== id) return server;
      const nextStatus = server.status === 'connected' ? 'disabled' : 'connected';
      return {
        ...server,
        status: nextStatus,
        mountScope: nextStatus === 'connected' && server.mountScope === 'disabled' ? 'session' : server.mountScope,
        mountTarget: nextStatus === 'connected' && server.mountScope === 'disabled'
          ? (lang === 'zh' ? '当前会话' : 'Current session')
          : nextStatus === 'disabled'
            ? (lang === 'zh' ? '未挂载' : 'Not mounted')
            : server.mountTarget,
        lastHandshake: nextStatus === 'connected'
          ? new Date().toLocaleString()
          : server.lastHandshake,
        lastError: nextStatus === 'connected' ? undefined : server.lastError,
        lastTrace: nextStatus === 'connected'
          ? (lang === 'zh' ? '手动启动后成功初始化并发现能力' : 'Initialized and discovered capabilities after manual start')
          : server.lastTrace,
      };
    }));
  };

  const handleReconnectMcpServer = (id: string) => {
    setMcpServers(prev => prev.map(server => {
      if (server.id !== id) return server;
      return {
        ...server,
        status: 'connected',
        mountScope: server.mountScope === 'disabled' ? 'session' : server.mountScope,
        mountTarget: server.mountScope === 'disabled' ? (lang === 'zh' ? '当前会话' : 'Current session') : server.mountTarget,
        lastHandshake: new Date().toLocaleString(),
        lastError: undefined,
        lastTrace: lang === 'zh' ? '重连后恢复并重新发现能力' : 'Recovered after reconnect and capability discovery',
      };
    }));
  };
  const handleRemoveMcpServer = (id: string) => {
    const remaining = mcpServers.filter(server => server.id !== id);
    setMcpServers(remaining);
    if (selectedMcpServerId === id) {
      setSelectedMcpServerId(remaining[0]?.id ?? '');
    }
  };

  const handleTestConnection = async (id: string) => {
    const profile = profiles.find(p => p.id === id);
    if (!profile) return;

    setConnectionStatus(prev => ({ ...prev, [id]: { status: 'testing' } }));
    const startTime = Date.now();

    try {
      let url = profile.baseUrl || '';
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };

      // 处理自定义脚本鉴权以获取自定义 Headers
      if (profile.type === 'custom_script' && profile.authScript) {
        try {
          const runScript = new Function(`
            return (async () => {
              ${profile.authScript}
              if (typeof getAuthHeaders === 'function') {
                return await getAuthHeaders();
              }
              return {};
            })();
          `);
          const customHeaders = await runScript();
          if (customHeaders && typeof customHeaders === 'object') {
            Object.assign(headers, customHeaders);
          }
        } catch (scriptErr) {
          console.error('Failed to execute auth script:', scriptErr);
        }
      }

      let method = 'POST';
      let body = '';

      if (profile.protocol === 'openai') {
        const cleanBase = url.replace(/\/$/, '');
        url = `${cleanBase}/chat/completions`;
        if (profile.apiKey && !headers['Authorization']) {
          headers['Authorization'] = `Bearer ${profile.apiKey}`;
        }
        body = JSON.stringify({
          model: profile.modelId,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1
        });
      } else if (profile.protocol === 'anthropic') {
        const cleanBase = url.replace(/\/$/, '');
        url = `${cleanBase}/v1/messages`;
        if (profile.apiKey) {
          headers['x-api-key'] = profile.apiKey;
          headers['anthropic-version'] = '2023-06-01';
        }
        body = JSON.stringify({
          model: profile.modelId,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1
        });
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 45000); // 45秒超时（本地大模型冷启动需要较长时间）

      const response = await fetch(url, {
        method,
        headers,
        body,
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      const delay = Date.now() - startTime;

      // 必须状态码为 200 OK，代表鉴权通过且模型服务确实可用
      if (response.status === 200) {
        setConnectionStatus(prev => ({ 
          ...prev, 
          [id]: { status: 'success', delay } 
        }));
      } else {
        setConnectionStatus(prev => ({ 
          ...prev, 
          [id]: { status: 'failed' } 
        }));
      }
    } catch (error: any) {
      const errMsg = error?.name === 'AbortError'
        ? '连接超时（>45s），Ollama 模型可能正在冷启动，请稍后重试'
        : (error?.message || String(error));
      console.error('Connection test failed:', errMsg);
      setConnectionStatus(prev => ({ 
        ...prev, 
        [id]: { status: 'failed', error: errMsg } 
      }));
    }
  };

  const handleFetchModels = async () => {
    setIsFetchingModels(true);
    setFetchModelsError(null);
    setFetchedModels([]);
    try {
      let url = formBaseUrl || '';
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };

      if (formType === 'custom_script' && formAuthScript) {
        try {
          const runScript = new Function(`
            return (async () => {
              ${formAuthScript}
              if (typeof getAuthHeaders === 'function') {
                return await getAuthHeaders();
              }
              return {};
            })();
          `);
          const customHeaders = await runScript();
          if (customHeaders && typeof customHeaders === 'object') {
            Object.assign(headers, customHeaders);
          }
        } catch (scriptErr) {
          console.error('Failed to execute auth script during fetch:', scriptErr);
        }
      }

      const cleanBase = url.replace(/\/$/, '');
      let fetchUrl = `${cleanBase}/models`;

      if (formProtocol === 'openai') {
        if (formApiKey && !headers['Authorization']) {
          headers['Authorization'] = `Bearer ${formApiKey}`;
        }
      } else if (formProtocol === 'anthropic') {
        fetchUrl = `${cleanBase}/v1/models`;
        if (formApiKey) {
          headers['x-api-key'] = formApiKey;
          headers['anthropic-version'] = '2023-06-01';
        }
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);

      const response = await fetch(fetchUrl, {
        method: 'GET',
        headers,
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} - ${response.statusText}`);
      }

      const data = await response.json();
      let modelsList: string[] = [];
      if (data && Array.isArray(data.data)) {
        modelsList = data.data.map((m: any) => m.id);
      } else if (data && Array.isArray(data.models)) {
        modelsList = data.models.map((m: any) => m.name || m.id);
      } else if (data && Array.isArray(data)) {
        modelsList = data.map((m: any) => typeof m === 'string' ? m : (m.id || m.name));
      } else if (data && typeof data === 'object') {
        const possibleArray = Object.values(data).find(v => Array.isArray(v));
        if (possibleArray) {
          modelsList = possibleArray.map((m: any) => typeof m === 'string' ? m : (m.id || m.name || m.model));
        }
      }

      modelsList = modelsList.filter(Boolean).map(String);
      if (modelsList.length === 0) {
        throw new Error(lang === 'zh' ? '未在响应中探测到任何模型，请确认地址与密钥是否正确。' : 'No models detected in the response.');
      }
      setFetchedModels(modelsList);
    } catch (err: any) {
      console.error('Failed to fetch models:', err);
      setFetchModelsError(err.message || String(err));
    } finally {
      setIsFetchingModels(false);
    }
  };

  const handleSaveProfile = () => {
    if (!formName.trim()) {
      alert(lang === 'zh' ? '请填写配置名称' : 'Please fill config name');
      return;
    }
    
    const profileId = editingProfileId === 'new' ? `profile-${Date.now()}` : editingProfileId!;
    const profileData: ModelProfile = {
      id: profileId,
      name: formName,
      type: formType,
      protocol: formProtocol,
      provider: formProvider,
      baseUrl: formType === 'official' 
        ? (OFFICIAL_VENDORS.find(v => v.key === formProvider)?.baseUrl || 'https://api.openai.com/v1') 
        : formBaseUrl,
      apiKey: formApiKey,
      modelId: formModelId,
      authScript: formType === 'custom_script' ? formAuthScript : undefined,
      temperature: formTemperature,
      topP: formTopP,
      maxTokens: formMaxTokens,
      autoTruncate: formAutoTruncate
    };

    setProfiles(prev => {
      if (editingProfileId === 'new') {
        return [...prev, profileData];
      } else {
        return prev.map(p => p.id === editingProfileId ? profileData : p);
      }
    });

    setEditingProfileId(null);
    alert(lang === 'zh' ? '配置已成功保存！' : 'Saved!');
  };

  const handleStartEdit = (profile: ModelProfile) => {
    setFetchedModels([]);
    setFetchModelsError(null);
    setEditingProfileId(profile.id);
    setFormName(profile.name);
    setFormType(profile.type);
    setFormProtocol(profile.protocol);
    setFormProvider(profile.provider);
    setFormBaseUrl(profile.baseUrl);
    setFormApiKey(profile.apiKey);
    setFormModelId(profile.modelId);
    setFormAuthScript(profile.authScript || `// Node.js Execution Context\nasync function getAuthHeaders() {\n  return {\n    "Authorization": "Bearer YOUR_TOKEN"\n  };\n}`);
    setFormTemperature(profile.temperature);
    setFormTopP(profile.topP);
    setFormMaxTokens(profile.maxTokens);
    setFormAutoTruncate(profile.autoTruncate || false);
  };

  const handleStartNew = () => {
    setFetchedModels([]);
    setFetchModelsError(null);
    setEditingProfileId('new');
    setFormName('');
    setFormType('official');
    setFormProtocol('openai');
    setFormProvider('OpenAI');
    setFormBaseUrl('https://api.openai.com/v1');
    setFormApiKey('');
    setFormModelId('gpt-4o');
    setFormAuthScript(`// Node.js Execution Context\nasync function getAuthHeaders() {\n  return {\n    "Authorization": "Bearer YOUR_TOKEN"\n  };\n}`);
    setFormTemperature(0.2);
    setFormTopP(1.0);
    setFormMaxTokens(4096);
    setFormAutoTruncate(true);
  };

  const handleDeleteProfile = (id: string) => {
    if (confirm(lang === 'zh' ? '确定要删除此模型配置吗？' : 'Are you sure you want to delete this profile?')) {
      setProfiles(prev => prev.filter(p => p.id !== id));
      if (activeProfileId === id) {
        setActiveProfileId('');
      }
    }
  };

  return (
    <div className="app-container">
      {/* 侧边栏导航 */}
      <aside className="sidebar">
        <div className="sidebar-header drag-region">
          <div className="logo-container">
            <div className="logo-icon">F1</div>
            <div>
              <h1 className="logo-text">{t.brandName}</h1>
              <div className="logo-version">{t.brandSub}</div>
            </div>
          </div>
        </div>

        <div className="sidebar-cta">
          <button 
            className="btn-new-agent"
            onClick={() => {
              setActiveTab('chat');
              setMessages([]);
              setSelectedConversationId(null);
              setSelectedSessionId(null);
            }}
          >
            <Icon name="add" className="text-[18px]" style={{ marginRight: '4px' }} />
            {t.newAgentBtn}
          </button>
        </div>

        <nav className="sidebar-content custom-scrollbar">
          
          <div 
            className={`nav-item ${activeTab === 'chat' ? 'active' : ''}`}
            onClick={() => setActiveTab('chat')}
          >
            <Icon name="chat" className="icon" style={{ marginRight: '8px' }} />
            <span>{t.tabChat}</span>
          </div>

          <div 
            className={`nav-item ${activeTab === 'agent' ? 'active' : ''}`}
            onClick={() => setActiveTab('agent')}
          >
            <Icon name="agent" className="icon" style={{ marginRight: '8px' }} />
            <span>{t.tabAgent}</span>
          </div>

          <div 
            className={`nav-item ${activeTab === 'project' ? 'active' : ''}`}
            onClick={() => setActiveTab('project')}
          >
            <Icon name="folder_open" className="icon" style={{ marginRight: '8px' }} />
            <span>{t.tabProject}</span>
          </div>


          <div 
            className={`nav-item ${activeTab === 'model' ? 'active' : ''}`}
            onClick={() => setActiveTab('model')}
          >
            <Icon name="smart_toy" className="icon" style={{ marginRight: '8px' }} />
            <span>{t.tabModel}</span>
          </div>

          <div 
            className={`nav-item ${activeTab === 'mcp' ? 'active' : ''}`}
            onClick={() => setActiveTab('mcp')}
          >
            <Icon name="extension" className="icon" style={{ marginRight: '8px' }} />
            <span>{t.tabMcp}</span>
          </div>

          <div 
            className={`nav-item ${activeTab === 'skill' ? 'active' : ''}`}
            onClick={() => setActiveTab('skill')}
          >
            <Icon name="construction" className="icon" style={{ marginRight: '8px' }} />
            <span>{t.tabSkill}</span>
          </div>

          <div 
            className={`nav-item ${activeTab === 'policy' ? 'active' : ''}`}
            onClick={() => setActiveTab('policy')}
          >
            <Icon name="policy" className="icon" style={{ marginRight: '8px' }} />
            <span>{t.tabPolicy}</span>
          </div>

          <div 
            className={`nav-item ${activeTab === 'trace' ? 'active' : ''}`}
            onClick={() => setActiveTab('trace')}
          >
            <Icon name="analytics" className="icon" style={{ marginRight: '8px' }} />
            <span>{t.tabTrace}</span>
          </div>
        </nav>

        <div className="sidebar-footer">
          <div 
            className="nav-item"
            onClick={() => setShowSettingsModal(true)}
          >
            <Icon name="settings" className="icon" style={{ marginRight: '8px' }} />
            <span>{t.tabSettings}</span>
          </div>
          <div className="nav-item">
            <Icon name="help" className="icon" style={{ marginRight: '8px' }} />
            <span>{t.tabSupport}</span>
          </div>
        </div>
      </aside>

      {/* 主内容区域 */}
      <main className="main-content">
        {/* 自定义窗口头部 */}
        <header className="window-titlebar drag-region">
          <div className="top-app-bar">
            <div className="titlebar-runtime-badge">
              <span className="titlebar-runtime-dot" />
              <span>Desktop Harness</span>
            </div>
            <div className="top-bar-search no-drag">
              <Icon name="search" className="search-icon" />
              <input type="text" placeholder={t.searchPlaceholder} />
            </div>
          </div>
          <div className="top-bar-actions no-drag">
            <button 
              className="top-btn" 
              title={theme === 'dark' ? (lang === 'zh' ? '切换为亮色模式' : 'Switch to Light Mode') : (lang === 'zh' ? '切换为暗色模式' : 'Switch to Dark Mode')}
              onClick={() => setTheme(prev => prev === 'dark' ? 'light' : 'dark')}
            >
              <Icon name={theme === 'dark' ? 'light_mode' : 'dark_mode'} />
            </button>
            <button className="top-btn" title={lang === 'zh' ? '通知消息' : 'Notifications'}>
              <Icon name="notifications" />
            </button>
            <button className="top-btn" title={t.runningOnline}>
              <Icon name="cloud_done" />
            </button>
            <button className="top-btn top-btn-user" title={lang === 'zh' ? '账户设置' : 'Account Settings'}>
              <Icon name="account_circle" />
            </button>
          </div>
          <div className="window-controls no-drag">
            <button
              className="window-control-btn"
              title={lang === 'zh' ? '最小化' : 'Minimize'}
              onClick={() => forgeoneDesktop?.minimizeWindow?.()}
            >
              <Icon name="minimize" />
            </button>
            <button
              className="window-control-btn"
              title={windowState.isMaximized ? (lang === 'zh' ? '还原' : 'Restore') : (lang === 'zh' ? '最大化' : 'Maximize')}
              onClick={() => forgeoneDesktop?.toggleMaximizeWindow?.()}
            >
              <Icon name={windowState.isMaximized ? 'restore' : 'maximize'} />
            </button>
            <button
              className="window-control-btn close"
              title={lang === 'zh' ? '关闭' : 'Close'}
              onClick={() => forgeoneDesktop?.closeWindow?.()}
            >
              <Icon name="close" />
            </button>
          </div>
        </header>

        {/* 聊天面板（多栏交互布局） */}
        {activeTab === 'chat' && (
          <div className="chat-page-layout">
            {/* 二级历史会话边栏 */}
            <div className="chat-history-sidebar">
              <div className="chat-history-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                <span>{t.historyListTitle}</span>
                <button 
                  className="top-btn" 
                  title={`${t.historyClearTitle} (/clear)`}
                  style={{ padding: '4px', display: 'inline-flex', borderRadius: '4px', color: 'var(--error)', cursor: 'pointer' }}
                  onClick={handleClearHistory}
                >
                  <Icon name="delete" style={{ fontSize: '16px' }} />
                </button>
              </div>
              <div className="chat-history-list custom-scrollbar">
                {conversationSummaries.length === 0 ? (
                  <div style={{ padding: '16px', textAlign: 'center', color: 'var(--on-surface-variant)', fontSize: '12px' }}>
                    {t.traceEmptyList}
                  </div>
                ) : (
                  conversationSummaries.map((item) => (
                    <div
                      key={item.conversation_id}
                      className={`chat-history-item ${selectedConversationId === item.conversation_id ? 'active' : ''}`}
                      onClick={() => handleSelectConversation(item.conversation_id, item.latestSessionId)}
                    >
                      <div className="chat-history-item-top">
                        <span className="task-title">{item.title}</span>
                        <button
                          className="chat-history-delete-btn"
                          title={t.historyDeleteTitle}
                          onClick={(event) => {
                            event.stopPropagation();
                            handleDeleteHistoryItem(item.conversation_id);
                          }}
                        >
                          <Icon name="delete" style={{ fontSize: '14px' }} />
                        </button>
                      </div>
                      <div className="task-meta">
                        <span style={{ fontFamily: 'var(--font-mono)' }}>{item.turnCount} turns</span>
                        <span style={{ color: item.latestStatus === 'completed' ? 'var(--success)' : 'var(--warning)' }}>
                          {item.status === 'completed' ? (lang === 'zh' ? '完成' : 'Done') : (lang === 'zh' ? '挂起' : 'Pending')}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* 聊天消息流 */}
            <div className="chat-main-area">
              <div className="chat-messages-container custom-scrollbar">
                {messages.length === 0 ? (
                  <div className="welcome-screen">
                    <div className="welcome-logo">{t.welcomeTitle}</div>
                    <p className="welcome-text">{t.welcomeText}</p>
                  </div>
                ) : (
                  <div className="chat-messages-inner">
                    <div className="date-separator">
                      <span className="date-badge">{t.todayBadge}</span>
                    </div>

                    {messages.map((msg) => (
                      <div key={msg.id} className={`message-block ${msg.sender}`}>
                        {(() => {
                          const agentInfo = msg.agentId ? allAgents.find((a: any) => a.id === msg.agentId) : null;
                          if (msg.sender === 'agent' && agentInfo) {
                            return (
                              <div className="message-avatar-circle" style={{ backgroundColor: agentInfo.color + '30', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <span style={{ fontSize: '16px' }}>{agentInfo.icon}</span>
                              </div>
                            );
                          } else if (msg.sender === 'agent') {
                            return (
                              <div className="message-avatar-circle">
                                <Icon name="smart_toy" style={{ color: 'var(--on-primary)' }} />
                              </div>
                            );
                          } else {
                            return (
                              <div className="message-avatar-circle user-avatar">
                                <Icon name="account_circle" style={{ color: 'var(--on-surface)' }} />
                              </div>
                            );
                          }
                        })()}
                        <div className="message-content-wrapper">
                          <div className="message-sender-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span className="message-sender-label">
                                {msg.agentId ? (allAgents.find((a: any) => a.id === msg.agentId)?.name || t.agentLabel) : (msg.sender === 'user' ? t.userLabel : t.agentLabel)}
                              </span>
                              {msg.sender === 'agent' && msg.status && (
                                <span className="badge-tag">
                                  {msg.status === 'running' ? t.statusRunning : msg.status === 'completed' ? t.statusCompleted : t.statusSuspended}
                                </span>
                              )}
                            </div>
                            <button
                              type="button"
                              className="message-copy-btn"
                              title={lang === 'zh' ? '复制内容' : 'Copy Content'}
                              style={{
                                background: 'transparent',
                                border: 'none',
                                color: 'var(--on-surface-variant)',
                                opacity: 0.6,
                                cursor: 'pointer',
                                padding: '2px 6px',
                                borderRadius: '4px',
                                fontSize: '11px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px',
                                transition: 'all 0.2s'
                              }}
                              onClick={async () => {
                                try {
                                  await navigator.clipboard.writeText(msg.content);
                                  setCopiedMessageId(msg.id);
                                  setTimeout(() => setCopiedMessageId(null), 1500);
                                } catch (e) {
                                  console.error('Failed to copy message content', e);
                                }
                              }}
                              onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.background = 'var(--surface-container-highest)'; }}
                              onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.6'; e.currentTarget.style.background = 'transparent'; }}
                            >
                              {copiedMessageId === msg.id ? (lang === 'zh' ? '已复制' : 'Copied!') : (lang === 'zh' ? '复制' : 'Copy')}
                            </button>
                          </div>

                          <div className="message-bubble-body">
                            {/* 消息内容渲染：支持 <think> 折叠块 + 流式光标 */}
                            <MessageContent msg={msg} lang={lang} />

                            <MessageRuntimeMeta
                              msg={msg}
                              nowMs={runtimeNowMs}
                              lang={lang}
                              t={t}
                            />

                            {/* 嵌在 Agent 回答内部的流式 Trace 执行日志 */}
                            {msg.sender === 'agent' && msg.trace && msg.trace.length > 0 && (
                              <div className="nested-trace-wrapper">
                                <button className="trace-expand-btn" onClick={() => toggleTrace(msg.id)}>
                                  {traceExpanded[msg.id] ? t.collapseTrace : t.expandTrace}
                                </button>
                                {traceExpanded[msg.id] && (
                                  <div className="trace-logs-list custom-scrollbar">
                                    {msg.trace.map((evt, idx) => (
                                      <div key={idx} className="trace-item-row">
                                        <span className="trace-time">
                                          {new Date(evt.timestamp_ms).toLocaleTimeString()}
                                        </span>
                                        <span className={`trace-tag ${evt.kind.toLowerCase()}`}>
                                          {evt.kind}
                                        </span>
                                        <span className="trace-msg-text">{evt.message}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                            {/* 气泡结束 */}
                          </div>
                        </div>
                      </div>
                    ))}
                    <div ref={messagesEndRef} />
                  </div>
                )}
              </div>

              {/* 底部输入框区 */}
              <div className="chat-input-sticky-bottom">
                <div className="chat-input-width-limiter">
                  {/* 权限审批弹出位置：输入框的上面，和 Antigravity 对齐 */}
                  {(() => {
                    const activeApprovalMsg = [...messages].reverse().find(m => m.sender === 'agent' && m.pendingApproval);
                    if (!activeApprovalMsg || !activeApprovalMsg.pendingApproval) return null;
                    const pending = activeApprovalMsg.pendingApproval;
                    return (
                      <div className="compact-approval-card" style={{ marginBottom: '16px' }}>
                        {/* 第一行：摘要与折叠按钮 */}
                        <div className="approval-top-row">
                          <div className="approval-top-left">
                            <Icon name="notifications" style={{ color: 'var(--on-surface-variant)', marginRight: '6px' }} />
                            <span>{lang === 'zh' ? '1 步需要输入' : '1 Step Requires Input'}</span>
                          </div>
                          <button 
                            type="button" 
                            className="approval-collapse-btn" 
                            onClick={() => setIsApprovalCollapsed(!isApprovalCollapsed)}
                          >
                            <span>{lang === 'zh' ? '折叠' : 'Collapse'}</span>
                            <span style={{ transform: isApprovalCollapsed ? 'rotate(180deg)' : 'none', display: 'inline-block', transition: 'transform 0.15s', fontSize: '10px', marginLeft: '4px' }}>
                              ∨
                            </span>
                          </button>
                        </div>

                        {/* 折叠区域 */}
                        {!isApprovalCollapsed && (
                          <>
                            {/* 第二行：行为动作 + 旋转加载标 + 信息图标 */}
                            <div className="approval-body-row" style={{ marginTop: '8px' }}>
                              <div className="approval-body-left">
                                <Icon 
                                  name={
                                    pending.tool_name === 'shell' ? 'terminal' :
                                    pending.tool_name === 'read_file' ? 'article' :
                                    pending.tool_name === 'write_file' ? 'edit' :
                                    pending.tool_name === 'search_content' || pending.tool_name === 'search_files' ? 'search' : 'build'
                                  } 
                                  style={{ marginRight: '6px', color: 'var(--on-surface-variant)', opacity: 0.8 }} 
                                />
                                <span>
                                  {pending.tool_name === 'shell' 
                                    ? (lang === 'zh' ? '正在运行终端命令' : 'Running Command in Terminal')
                                    : pending.tool_name === 'read_file'
                                    ? (lang === 'zh' ? '正在读取文件' : 'Reading File')
                                    : pending.tool_name === 'write_file'
                                    ? (lang === 'zh' ? '正在修改/写入文件' : 'Writing/Modifying File')
                                    : (pending.tool_name === 'search_content' || pending.tool_name === 'search_files')
                                    ? (lang === 'zh' ? '正在搜索/检索项目文件' : 'Searching Project Files')
                                    : (lang === 'zh' ? `正在调用工具 ${pending.tool_name}` : `Executing Tool ${pending.tool_name}`)}
                                </span>
                                <Icon name="sync" className="animate-spin" style={{ fontSize: '12px', color: 'var(--on-surface-variant)', opacity: 0.6, animation: 'spin 2s linear infinite', marginLeft: '6px' }} />
                                <button 
                                  type="button" 
                                  className="top-btn" 
                                  style={{ padding: '2px', marginLeft: '6px', display: 'inline-flex', alignItems: 'center' }}
                                  title={pending.reason}
                                  onClick={() => alert(`${lang === 'zh' ? '申请原因：' : 'Reason: '}${pending.reason}`)}
                                >
                                  <Icon name="info" style={{ fontSize: '14px', color: 'var(--on-surface-variant)', opacity: 0.8 }} />
                                </button>
                              </div>
                            </div>

                            {/* 第三行：说明文字 */}
                            <div className="approval-detail-text-row" style={{ fontSize: '13px', color: 'var(--on-surface-variant)', paddingLeft: '22px', marginTop: '4px' }}>
                              {lang === 'zh' ? 'Agent 需要权限以在' : 'Agent needs permission to act on'} [{pending.argument_summary}]
                            </div>

                            {/* 第四行：操作按钮 */}
                            <div className="approval-action-row" style={{ marginTop: '12px' }}>
                              <button 
                                type="button" 
                                className="btn-link-action" 
                                style={{ padding: '4px 0', fontSize: '13px' }}
                                onClick={() => setActiveTab('policy')}
                              >
                                {lang === 'zh' ? '配置' : 'Configure'}
                              </button>
                              <div className="approval-action-right">
                                <button 
                                  type="button" 
                                  className="btn-link-action" 
                                  style={{ color: 'var(--on-surface-variant)', marginRight: '12px', fontSize: '13px' }} 
                                  onClick={() => handleReject(activeApprovalMsg.id, selectedSessionId || '')}
                                >
                                  {lang === 'zh' ? '拒绝' : 'Deny'}
                                </button>
                                <button
                                  type="button"
                                  className="btn-primary-blue"
                                  onClick={() => handleApprove(activeApprovalMsg.id, selectedSessionId || '')}
                                >
                                  {lang === 'zh' ? '允许一次' : 'Allow Once'} <span style={{ marginLeft: '4px', fontSize: '8px' }}>▲</span>
                                </button>
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })()}

                  <form onSubmit={handleSend} className="chat-input-box-container">
                    <div className="conversation-context-bar">
                      <div className="conversation-context-bar-title">{t.contextBarTitle}</div>
                      {currentConversationSummary ? (
                        <div className="conversation-context-bar-items">
                          <span className="conversation-context-chip">
                            {t.contextBarUsage}: {formatTokenCount(currentContextTokens)}/{formatTokenCount(activeContextWindow)} ({currentContextRatio.toFixed(currentContextRatio >= 10 ? 0 : 1)}%)
                          </span>
                          <span className="conversation-context-chip">
                            {t.contextBarTurns}: {currentConversationSummary.turnCount}
                          </span>
                        </div>
                      ) : (
                        <div className="conversation-context-bar-empty">{t.contextBarNoContext}</div>
                      )}
                    </div>
                    <textarea
                      ref={inputTextareaRef}
                      className="chat-input-textarea"
                      placeholder={t.inputPlaceholder}
                      value={inputText}
                      onChange={(e) => {
                        const nextValue = e.target.value;
                        setInputText(nextValue);
                        if (inputHistoryIndex !== null) {
                          setInputHistoryIndex(null);
                        }
                        setInputDraft(nextValue);
                      }}
                      onKeyDown={(e) => {
                        if (
                          e.key === 'ArrowUp' &&
                          !e.shiftKey &&
                          !e.altKey &&
                          !e.ctrlKey &&
                          !e.metaKey
                        ) {
                          const textarea = e.currentTarget;
                          const caret = textarea.selectionStart;
                          const selectionCollapsed = textarea.selectionStart === textarea.selectionEnd;
                          const atFirstLine = !textarea.value.slice(0, caret).includes('\n');
                          if (selectionCollapsed && atFirstLine) {
                            e.preventDefault();
                            recallInputHistory('older');
                            return;
                          }
                        }

                        if (
                          e.key === 'ArrowDown' &&
                          !e.shiftKey &&
                          !e.altKey &&
                          !e.ctrlKey &&
                          !e.metaKey
                        ) {
                          const textarea = e.currentTarget;
                          const caret = textarea.selectionEnd;
                          const selectionCollapsed = textarea.selectionStart === textarea.selectionEnd;
                          const atLastLine = !textarea.value.slice(caret).includes('\n');
                          if (selectionCollapsed && atLastLine && inputHistoryIndex !== null) {
                            e.preventDefault();
                            recallInputHistory('newer');
                            return;
                          }
                        }

                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSend(e);
                        }
                      }}
                      rows={1}
                    />
                    <div className="chat-input-toolbar-row">
                      <div className="chat-toolbar-left">
                        <button className="toolbar-action-btn" type="button" title={lang === 'zh' ? '附带文件上下文' : 'Attach File context'}>
                          <Icon name="attach_file" />
                        </button>
                        <button className="toolbar-action-btn" type="button" title={lang === 'zh' ? '插入代码段' : 'Insert Code Object'}>
                          <Icon name="data_object" />
                        </button>
                        <div className="toolbar-divider"></div>
                        {/* 极简模型切换浮层 */}
                        <div style={{ position: 'relative' }}>
                          <div 
                            className="mini-model-selector" 
                            style={{ 
                              backgroundColor: showMiniSelector ? 'var(--surface-container-high)' : 'transparent',
                              border: '1px solid var(--border-color)',
                              padding: '4px 10px',
                              borderRadius: '6px',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px'
                            }}
                            onClick={() => setShowMiniSelector(!showMiniSelector)}
                          >
                            <Icon name="smart_toy" className="icon" style={{ fontSize: '15px' }} />
                            <span>{activeProfile ? activeProfile.name : (lang === 'zh' ? '选择模型' : 'Select Model')}</span>
                            <span style={{ fontSize: '9px', opacity: 0.7, transform: showMiniSelector ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>▼</span>
                          </div>

                          {showMiniSelector && (
                            <>
                              {/* 点击遮罩，用于关闭下拉框 */}
                              <div 
                                style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 998 }} 
                                onClick={() => setShowMiniSelector(false)}
                              />
                              {/* 弹出卡片 */}
                              <div 
                                className="card-bento"
                                style={{ 
                                  position: 'absolute', 
                                  bottom: 'calc(100% + 8px)', 
                                  left: 0, 
                                  minWidth: '260px',
                                  maxWidth: '320px',
                                  padding: '8px', 
                                  zIndex: 999, 
                                  display: 'flex', 
                                  flexDirection: 'column', 
                                  gap: '4px',
                                  boxShadow: 'var(--shadow-lg)',
                                  backgroundColor: 'var(--surface-lowest)',
                                  border: '1px solid var(--border-color)'
                                }}
                              >
                                <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--on-surface-variant)', padding: '6px 8px 4px', borderBottom: '1px solid var(--border-color)', marginBottom: '4px' }}>
                                  {lang === 'zh' ? '快捷切换当前模型' : 'Switch Active Model'}
                                </div>
                                <div style={{ maxHeight: '200px', overflowY: 'auto' }} className="custom-scrollbar">
                                  {profiles.map((profile) => {
                                    const isSel = profile.id === activeProfileId;
                                    return (
                                      <div 
                                        key={profile.id}
                                        style={{ 
                                          display: 'flex', 
                                          alignItems: 'center', 
                                          justifyContent: 'space-between',
                                          padding: '8px 10px', 
                                          borderRadius: '6px', 
                                          cursor: 'pointer',
                                          backgroundColor: isSel ? 'var(--surface-container-high)' : 'transparent',
                                          transition: 'all 0.15s'
                                        }}
                                        onClick={() => {
                                          setActiveProfileId(profile.id);
                                          setShowMiniSelector(false);
                                        }}
                                        className="mini-model-item"
                                      >
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', textAlign: 'left' }}>
                                          <span style={{ fontSize: '13px', fontWeight: isSel ? 600 : 500, color: isSel ? 'var(--accent-color)' : 'var(--on-surface)' }}>
                                            {profile.name}
                                          </span>
                                          <span style={{ fontSize: '10px', color: 'var(--on-surface-variant)', opacity: 0.8 }}>
                                            {profile.modelId} ({profile.protocol.toUpperCase()})
                                          </span>
                                        </div>
                                        {isSel && (
                                          <Icon name="check" style={{ color: 'var(--accent-color)', fontSize: '16px' }} />
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            </>
                          )}
                        </div>

                        {/* Agent 选择器 */}
                        <div style={{ position: 'relative' }}>
                          <div 
                            style={{ 
                              backgroundColor: showChatAgentSelector ? 'var(--surface-container-high)' : 'transparent',
                              border: selectedChatAgentId ? '1px solid var(--primary)' : '1px solid var(--border-color)',
                              padding: '4px 10px',
                              borderRadius: '6px',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px',
                              cursor: 'pointer',
                              fontSize: '11px',
                              fontWeight: selectedChatAgentId ? 600 : 400,
                              color: selectedChatAgentId ? 'var(--primary)' : 'var(--on-surface-variant)',
                            }}
                            onClick={() => setShowChatAgentSelector(!showChatAgentSelector)}
                          >
                            <Icon name="agent" style={{ fontSize: '14px' }} />
                            <span>{selectedChatAgentId ? (allAgents.find(a => a.id === selectedChatAgentId)?.name || (lang === 'zh' ? 'Agent' : 'Agent')) : (lang === 'zh' ? 'Agent' : 'Agent')}</span>
                            {selectedChatAgentId && (
                              <span style={{ fontSize: '9px', cursor: 'pointer', padding: '2px', borderRadius: '3px' }}
                                onClick={(e) => { e.stopPropagation(); setSelectedChatAgentId(null); }}
                              >✕</span>
                            )}
                            <span style={{ fontSize: '8px', opacity: 0.7, transform: showChatAgentSelector ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>▼</span>
                          </div>

                          {showChatAgentSelector && (
                            <>
                              <div 
                                style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 998 }} 
                                onClick={() => setShowChatAgentSelector(false)}
                              />
                              <div 
                                className="card-bento"
                                style={{ 
                                  position: 'absolute', 
                                  bottom: 'calc(100% + 8px)', 
                                  left: 0, 
                                  minWidth: '220px',
                                  padding: '6px', 
                                  zIndex: 999, 
                                  display: 'flex', 
                                  flexDirection: 'column', 
                                  gap: '2px',
                                  boxShadow: 'var(--shadow-lg)',
                                  backgroundColor: 'var(--surface-lowest)',
                                  border: '1px solid var(--border-color)',
                                }}
                              >
                                <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--on-surface-variant)', padding: '6px 8px 4px', borderBottom: '1px solid var(--border-color)', marginBottom: '4px' }}>
                                  {lang === 'zh' ? '选择 Agent (可选)' : 'Select Agent (Optional)'}
                                </div>
                                <div
                                  style={{ padding: '6px 10px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', color: 'var(--on-surface-variant)', fontStyle: 'italic' }}
                                  onClick={() => { setSelectedChatAgentId(null); setShowChatAgentSelector(false); }}
                                >
                                  {lang === 'zh' ? '不使用 Agent' : 'No Agent'}
                                </div>
                                <div style={{ maxHeight: '200px', overflowY: 'auto' }} className="custom-scrollbar">
                                  {allAgents.map((agent: any) => (
                                    <div
                                      key={agent.id}
                                      style={{ 
                                        display: 'flex', alignItems: 'center', gap: '8px',
                                        padding: '6px 10px', borderRadius: '6px', cursor: 'pointer',
                                        backgroundColor: selectedChatAgentId === agent.id ? 'var(--surface-container-high)' : 'transparent',
                                      }}
                                      onClick={() => { setSelectedChatAgentId(agent.id); setShowChatAgentSelector(false); }}
                                    >
                                      <span style={{ fontSize: '14px' }}>{agent.icon}</span>
                                      <span style={{ fontSize: '12px', fontWeight: selectedChatAgentId === agent.id ? 600 : 400, color: 'var(--on-surface)' }}>{agent.name}</span>
                                      {selectedChatAgentId === agent.id && <Icon name="check" style={{ color: 'var(--accent-color)', fontSize: '14px', marginLeft: 'auto' }} />}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </>
                          )}
                        </div>

                        {/* 审批/危险模式切换 */}
                        <div 
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            padding: '2px',
                            borderRadius: '6px',
                            backgroundColor: 'var(--surface-container-high)',
                            border: '1px solid var(--border-color)',
                            cursor: 'pointer',
                            fontSize: '11px',
                            fontWeight: 600,
                          }}
                          onClick={() => setApprovalMode(approvalMode === 'approval' ? 'danger' : 'approval')}
                          title={approvalMode === 'approval' ? (lang === 'zh' ? '切换到危险模式，自动批准操作' : 'Switch to Danger Mode, auto-approve all actions') : (lang === 'zh' ? '切换到审批模式，每次操作需确认' : 'Switch to Approval Mode, confirm each action')}
                        >
                          <span
                            style={{
                              padding: '3px 8px',
                              borderRadius: '4px',
                              backgroundColor: approvalMode === 'approval' ? 'var(--accent-color)' : 'transparent',
                              color: approvalMode === 'approval' ? '#fff' : 'var(--on-surface-variant)',
                              transition: 'all 0.15s',
                            }}
                          >
                            {lang === 'zh' ? '审批' : 'Safe'}
                          </span>
                          <span
                            style={{
                              padding: '3px 8px',
                              borderRadius: '4px',
                              backgroundColor: approvalMode === 'danger' ? '#e74c3c' : 'transparent',
                              color: approvalMode === 'danger' ? '#fff' : 'var(--on-surface-variant)',
                              transition: 'all 0.15s',
                            }}
                          >
                            {lang === 'zh' ? '危险' : 'Danger'}
                          </span>
                        </div>
                      </div>

                      <div className="chat-toolbar-right">
                        <button type="submit" className="btn-send-message" disabled={isRunning || !inputText.trim()}>
                          {isRunning ? (
                            <Icon name="sync" style={{ animation: 'spin 1s linear infinite' }} />
                          ) : (
                            <Icon name="arrow_upward" />
                          )}
                        </button>
                      </div>
                    </div>
                  </form>
                  <div className="chat-disclaimer">
                    {t.inputDisclaimer}
                  </div>
                </div>
              </div>

            </div>
          </div>
        )}

        {/* Agent 管理面板 */}
        {activeTab === 'agent' && (
          <div className="agent-page-layout" style={{ display: 'flex', height: '100%', width: '100%', overflow: 'hidden' }}>
            {/* 左栏: Agent 列表 */}
            <div className="agent-list-panel" style={{ width: '280px', borderRight: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--surface)' }}>
              <div style={{ padding: '16px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--on-surface)' }}>
                  {lang === 'zh' ? 'Agent 列表' : 'Agents'}
                </span>
                <span style={{ fontSize: '11px', color: 'var(--on-surface-variant)' }}>
                  {lang === 'zh' ? '多 Agent 协作基础' : 'Multi-Agent Foundation'}
                </span>
              </div>
              <div className="agent-list-scroll" style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
                {allAgents.map((agent) => {
                  const isCustom = customAgents.some(ca => ca.id === agent.id);
                  return (
                    <div
                      key={agent.id}
                      className={`agent-list-item ${selectedAgentId === agent.id ? 'active' : ''}`}
                      onClick={() => setSelectedAgentId(agent.id)}
                      style={{
                        padding: '12px 12px 12px 12px',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        marginBottom: '4px',
                        backgroundColor: selectedAgentId === agent.id ? 'var(--primary-container)' : 'transparent',
                        border: selectedAgentId === agent.id ? '1px solid var(--primary)' : '1px solid transparent',
                        transition: 'all 0.15s ease',
                        position: 'relative',
                      }}
                      onMouseEnter={(e) => {
                        if (selectedAgentId !== agent.id) {
                          e.currentTarget.style.backgroundColor = 'var(--surface-container-high)';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (selectedAgentId !== agent.id) {
                          e.currentTarget.style.backgroundColor = 'transparent';
                        }
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div style={{
                          width: '36px', height: '36px', borderRadius: '8px',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: '16px', fontWeight: 700,
                          backgroundColor: agent.color + '20',
                          color: agent.color,
                          flexShrink: 0,
                        }}>
                          {agent.icon}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--on-surface)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {agent.name}
                            {isCustom && <span style={{ fontSize: '9px', marginLeft: '4px', padding: '1px 4px', borderRadius: '3px', backgroundColor: 'var(--accent-color)', color: '#fff', verticalAlign: 'middle' }}>自定义</span>}
                          </div>
                          <div style={{ fontSize: '11px', color: 'var(--on-surface-variant)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {agent.role}
                          </div>
                        </div>
                        {isCustom && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (confirm(lang === 'zh' ? '确定删除这个 Agent 吗？' : 'Delete this agent?')) {
                                setCustomAgents(prev => prev.filter(ca => ca.id !== agent.id));
                                if (selectedAgentId === agent.id) {
                                  setSelectedAgentId('general-assistant');
                                }
                              }
                            }}
                            style={{
                              background: 'none', border: 'none', cursor: 'pointer',
                              color: 'var(--on-surface-variant)', padding: '4px',
                              borderRadius: '4px', opacity: 0.5,
                              fontSize: '14px', lineHeight: 1,
                            }}
                            onMouseEnter={e => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = 'var(--error)'; }}
                            onMouseLeave={e => { e.currentTarget.style.opacity = '0.5'; e.currentTarget.style.color = 'var(--on-surface-variant)'; }}
                            title={lang === 'zh' ? '删除' : 'Delete'}
                          >
                            <Icon name="close" style={{ fontSize: '14px' }} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ padding: '12px', borderTop: '1px solid var(--border-color)' }}>
                <button
                  className="btn-new-agent"
                  style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px dashed var(--outline)', background: 'transparent', color: 'var(--primary)', cursor: 'pointer', fontSize: '12px', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                  onClick={() => {
                    setAgentForm({ ...initialFormState });
                    setShowCreateAgentModal(true);
                  }}
                  title={lang === 'zh' ? '创建自定义 Agent' : 'Create Custom Agent'}
                >
                  <Icon name="add" style={{ fontSize: '14px' }} />
                  {lang === 'zh' ? '创建 Agent' : 'Create Agent'}
                </button>
              </div>
            </div>

            {/* 右栏: Agent 详情/编辑 */}
            <div className="agent-detail-panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', backgroundColor: 'var(--surface-lowest)', padding: '24px', overflowY: 'auto' }}>
              {selectedAgentId ? (
                (() => {
                  const agent = allAgents.find(a => a.id === selectedAgentId)!;
                  const isCustom = customAgents.some(ca => ca.id === agent.id);
                  return (
                    <div style={{ maxWidth: '600px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px' }}>
                        <div style={{
                          width: '56px', height: '56px', borderRadius: '14px',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: '24px', fontWeight: 700,
                          backgroundColor: agent.color + '20',
                          color: agent.color,
                        }}>
                          {agent.icon}
                        </div>
                        <div>
                          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: 'var(--on-surface)' }}>{agent.name}</h2>
                          <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--on-surface-variant)' }}>{agent.role}</p>
                        </div>
                        {isCustom && (
                          <button
                            onClick={() => {
                              setAgentForm({
                                name: agent.name,
                                avatar: agent.icon,
                                systemPrompt: agent.systemPrompt,
                                temperature: agent.temperature ?? 0.5,
                                modelId: agent.modelId ?? '',
                                tools: [...agent.tools],
                                maxIterations: agent.maxIterations ?? 5,
                                editingId: agent.id,
                              });
                              setShowCreateAgentModal(true);
                            }}
                            style={{
                              marginLeft: 'auto', padding: '6px 12px',
                              borderRadius: '6px', border: '1px solid var(--outline)',
                              background: 'transparent', color: 'var(--on-surface-variant)',
                              cursor: 'pointer', fontSize: '11px', fontWeight: 500,
                              display: 'flex', alignItems: 'center', gap: '4px',
                            }}
                          >
                            <Icon name="settings" style={{ fontSize: '12px' }} />
                            {lang === 'zh' ? '编辑' : 'Edit'}
                          </button>
                        )}
                      </div>

                      <div style={{ marginBottom: '24px' }}>
                        <h3 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--on-surface)', marginBottom: '8px' }}>
                          {lang === 'zh' ? '角色描述' : 'System Prompt'}
                        </h3>
                        <div style={{
                          padding: '16px', borderRadius: '8px',
                          backgroundColor: 'var(--surface-container)',
                          fontSize: '13px', lineHeight: 1.6,
                          color: 'var(--on-surface)',
                          whiteSpace: 'pre-wrap',
                        }}>
                          {agent.systemPrompt}
                        </div>
                      </div>

                      <div style={{ marginBottom: '24px' }}>
                        <h3 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--on-surface)', marginBottom: '8px' }}>
                          {lang === 'zh' ? '可用工具' : 'Available Tools'}
                        </h3>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                          {(agent.tools || []).map((tool: string) => (
                            <span key={tool} style={{
                              padding: '4px 10px', borderRadius: '12px',
                              fontSize: '11px', fontWeight: 500,
                              backgroundColor: 'var(--secondary-container)',
                              color: 'var(--on-secondary-container)',
                            }}>
                              {tool}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })()
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--on-surface-variant)' }}>
                  <Icon name="agent" style={{ fontSize: '48px', opacity: 0.3, marginBottom: '16px' }} />
                  <p style={{ fontSize: '14px', fontWeight: 500 }}>
                    {lang === 'zh' ? '选择一个 Agent 查看详情' : 'Select an Agent to view details'}
                  </p>
                  <p style={{ fontSize: '12px', marginTop: '4px' }}>
                    {lang === 'zh' ? '或点击左下角创建自定义 Agent' : 'Or create a custom Agent below'}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        
        
        {/* 项目面板 (STITCH 3-column layout) */}
        {activeTab === 'project' && (
          <div className="stitch-project-layout" style={{ display: 'flex', height: '100%', width: '100%', overflow: 'hidden' }}>
            
            {/* 左栏: 项目文件树 */}
            <div className="stitch-left-panel" style={{ width: '260px', borderRight: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--surface)' }}>
              <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-color)', position: 'relative' }}>
                <div
                  style={{ fontSize: '12px', fontWeight: 600, color: 'var(--on-surface)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                  onClick={() => setShowProjectList(!showProjectList)}
                >
                  <span>
                    <Icon name="folder_open" style={{ fontSize: '14px', marginRight: '6px' }} />
                    {currentProjectName || (lang === 'zh' ? '选择项目' : 'Select Project')}
                  </span>
                  <span style={{ fontSize: '9px', opacity: 0.6, transform: showProjectList ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>▼</span>
                </div>

                {showProjectList && (
                  <>
                    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 998 }} onClick={() => setShowProjectList(false)} />
                    <div className="card-bento" style={{
                      position: 'absolute', top: 'calc(100% + 4px)', left: '8px', right: '8px',
                      zIndex: 999, padding: '6px', display: 'flex', flexDirection: 'column', gap: '2px',
                      boxShadow: 'var(--shadow-lg)', backgroundColor: 'var(--surface-lowest)',
                      border: '1px solid var(--border-color)', borderRadius: '8px',
                    }}>
                      {projectsList.length === 0 ? (
                        <div style={{ padding: '8px 10px', fontSize: '11px', color: 'var(--on-surface-variant)', textAlign: 'center' }}>
                          {lang === 'zh' ? '暂无保存的项目' : 'No saved projects'}
                        </div>
                      ) : (
                        projectsList.map((proj: any, idx: number) => (
                          <div
                            key={idx}
                            style={{
                              padding: '8px 10px', borderRadius: '6px', cursor: 'pointer',
                              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                              backgroundColor: proj.path === currentProjectPath ? 'var(--surface-container-high)' : 'transparent',
                            }}
                            onClick={() => handleSwitchProject(proj.path, proj.name)}
                          >
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                              <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--on-surface)' }}>{proj.name}</span>
                              <span style={{ fontSize: '10px', color: 'var(--on-surface-variant)' }}>{proj.path}</span>
                            </div>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleRemoveProject(idx); }}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--on-surface-variant)', padding: '2px', opacity: 0.4, fontSize: '12px' }}
                            >
                              <Icon name="close" />
                            </button>
                          </div>
                        ))
                      )}
                      <div style={{ borderTop: '1px solid var(--border-color)', marginTop: '4px', paddingTop: '4px' }}>
                        <div
                          style={{ padding: '8px 10px', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--primary)' }}
                          onClick={handleAddProject}
                        >
                          <Icon name="add" style={{ fontSize: '14px' }} />
                          {lang === 'zh' ? '添加项目目录' : 'Add Project Directory'}
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>
              <div style={{ padding: '12px', flex: 1, display: 'flex', flexDirection: 'column' }}>
                {explorerTree.length === 0 ? (
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="folder_open" style={{ fontSize: '36px', opacity: 0.3, marginBottom: '12px' }} />
                    <div style={{ fontSize: '12px', color: 'var(--on-surface-variant)', marginBottom: '12px', textAlign: 'center' }}>
                      {lang === 'zh' ? '尚未关联本地目录' : 'No directory linked'}
                    </div>
                    <button 
                      className="btn-secondary"
                      style={{ fontSize: '12px', padding: '6px 12px', borderRadius: '4px' }}
                      onClick={async () => {
                        const dirPath = await (window as any).forgeone.selectDir();
                        if (dirPath) {
                          try {
                            const tree = await (window as any).forgeone.readDir(dirPath);
                            setExplorerTree(tree);
                          } catch (e) {
                            console.error(e);
                          }
                        }
                      }}
                    >
                      {lang === 'zh' ? '关联本地目录' : 'Link Directory'}
                    </button>
                  </div>
                ) : (
                  <div className="file-tree-nodes custom-scrollbar" style={{ flex: 1, overflowY: 'auto' }}>
                    {renderTreeItems(explorerTree, '', 0)}
                  </div>
                )}
              </div>
            </div>

            {/* 右栏: 项目 Agent 助手 (参考聊天页重设计) */}
            <div className="chat-main-area" style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', backgroundColor: 'var(--surface-lowest)', position: 'relative' }}>
              {/* 消息流 */}
              <div className="chat-messages-container custom-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: '24px 0' }}>
                <div className="chat-messages-inner" style={{ maxWidth: '1000px', margin: '0 auto', padding: '0 24px 32px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
                  {projectMessages.length === 0 ? (
                    <div className="welcome-screen" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', textAlign: 'center', paddingTop: '80px' }}>
                      <div className="welcome-logo" style={{ fontSize: '40px', fontWeight: 800, color: 'var(--on-surface)', marginBottom: '12px' }}>
                        {lang === 'zh' ? '项目助手' : 'Project Assistant'}
                      </div>
                      <div className="welcome-text" style={{ fontSize: '14px', color: 'var(--on-surface-variant)', maxWidth: '480px' }}>
                        {lang === 'zh'
                          ? '点击左侧文件树中的文件查看内容，或直接输入您的问题。'
                          : 'Click a file in the tree to read its content, or type your question below.'}
                      </div>
                    </div>
                  ) : (
                    projectMessages.map(msg => (
                    <div key={msg.id} className={`message-block ${msg.sender === 'user' ? 'user' : ''}`} style={{ display: 'flex', gap: '12px', flexDirection: msg.sender === 'user' ? 'row-reverse' : 'row' }}>
                      {/* 头像 */}
                      <div className="message-avatar-circle" style={{
                        width: '32px', height: '32px', borderRadius: '8px',
                        backgroundColor: msg.sender === 'user' ? 'var(--primary)' : 'var(--accent-color)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '12px', fontWeight: 700, color: '#fff',
                        flexShrink: 0,
                      }}>
                        {msg.sender === 'user' ? 'U' : 'F1'}
                      </div>
                      {/* 内容 */}
                      <div className="message-content-wrapper" style={{ maxWidth: '80%', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexDirection: msg.sender === 'user' ? 'row-reverse' : 'row' }}>
                          <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--on-surface-variant)' }}>
                            {msg.agentId ? (allAgents.find((a: any) => a.id === msg.agentId)?.name || 'Agent') : (msg.sender === 'user' ? t.userLabel : (lang === 'zh' ? '项目助手' : 'Project Assistant'))}
                          </span>
                          <span style={{ fontSize: '10px', color: 'var(--on-surface-variant)', opacity: 0.6 }}>
                            {new Date(msg.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                        <div className="message-bubble-body" style={{
                          backgroundColor: msg.sender === 'user' ? 'var(--primary-container)' : 'var(--surface-lowest)',
                          border: msg.sender === 'user' ? 'none' : '1px solid var(--border-color)',
                          borderRadius: '8px', padding: '12px 16px',
                          fontSize: '13px', lineHeight: 1.6, color: 'var(--on-surface)',
                          whiteSpace: 'pre-wrap',
                        }}>
                          {msg.content}
                        </div>
                      </div>
                    </div>
                  )))}
                  <div ref={projectMessagesEndRef} />
                </div>
              </div>

              {/* 底部输入区 */}
              <div className="chat-input-sticky-bottom" style={{
                flexShrink: 0,
                background: 'linear-gradient(180deg, transparent 0%, var(--surface-lowest) 30%)',
                padding: '16px 24px 24px',
              }}>
                <div className="chat-input-width-limiter" style={{ maxWidth: '1000px', margin: '0 auto' }}>
                  <div className="chat-input-box-container" style={{
                    backgroundColor: 'var(--surface-low)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '8px',
                    display: 'flex',
                    flexDirection: 'column',
                    transition: 'border-color 0.15s ease',
                  }}>
                    <div className="conversation-context-bar" style={{ padding: '8px 16px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '12px', fontSize: '11px' }}>
                      <div className="conversation-context-bar-title" style={{ fontWeight: 600, color: 'var(--on-surface-variant)' }}>{t.contextBarTitle}</div>
                      {projectMessages.length > 0 ? (
                        <div className="conversation-context-bar-items" style={{ display: 'flex', gap: '8px' }}>
                          <span className="conversation-context-chip" style={{ padding: '2px 8px', borderRadius: '10px', backgroundColor: 'var(--surface-container)', color: 'var(--on-surface-variant)', fontSize: '11px' }}>
                            {t.contextBarTurns}: {Math.ceil(projectMessages.length / 2)}
                          </span>
                          <span className="conversation-context-chip" style={{ padding: '2px 8px', borderRadius: '10px', backgroundColor: 'var(--surface-container)', color: 'var(--on-surface-variant)', fontSize: '11px' }}>
                            {explorerTree.length > 0 ? (lang === 'zh' ? `已加载 ${explorerTree.length} 个文件` : `${explorerTree.length} files loaded`) : (lang === 'zh' ? '未加载文件' : 'No files')}
                          </span>
                        </div>
                      ) : (
                        <div className="conversation-context-bar-empty" style={{ color: 'var(--on-surface-variant)', opacity: 0.6 }}>
                          {lang === 'zh' ? '新会话' : 'New conversation'}
                        </div>
                      )}
                    </div>
                    <textarea
                      className="chat-input-textarea custom-scrollbar"
                      placeholder={lang === 'zh' ? '询问关于此项目的问题...' : 'Ask about this project...'}
                      value={projectInput}
                      onChange={e => setProjectInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleProjectSend();
                        }
                      }}
                      rows={2}
                      style={{
                        width: '100%',
                        padding: '14px 16px',
                        border: 'none',
                        borderRadius: '8px 8px 0 0',
                        backgroundColor: 'transparent',
                        color: 'var(--on-surface)',
                        fontSize: '14px',
                        resize: 'none',
                        outline: 'none',
                        fontFamily: 'var(--font-sans)',
                        minHeight: '54px',
                        maxHeight: '200px',
                        boxSizing: 'border-box',
                      }}
                    />
                    <div className="chat-input-toolbar-row" style={{
                      display: 'flex', justifyContent: 'space-between',
                      alignItems: 'center', padding: '4px 12px 12px',
                    }}>
                      <div className="chat-toolbar-left" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {/* 极简模型切换 */}
                        <div style={{ position: 'relative' }}>
                          <div 
                            style={{ 
                              backgroundColor: showMiniSelector ? 'var(--surface-container-high)' : 'transparent',
                              border: '1px solid var(--border-color)',
                              padding: '4px 10px',
                              borderRadius: '6px',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px',
                              cursor: 'pointer',
                              fontSize: '11px',
                            }}
                            onClick={() => setShowMiniSelector(!showMiniSelector)}
                          >
                            <Icon name="smart_toy" style={{ fontSize: '13px' }} />
                            <span>{activeProfile ? activeProfile.name : (lang === 'zh' ? '选择模型' : 'Select Model')}</span>
                            <span style={{ fontSize: '8px', opacity: 0.7, transform: showMiniSelector ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>▼</span>
                          </div>

                          {showMiniSelector && (
                            <>
                              <div 
                                style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 998 }} 
                                onClick={() => setShowMiniSelector(false)}
                              />
                              <div 
                                className="card-bento"
                                style={{ 
                                  position: 'absolute', 
                                  bottom: 'calc(100% + 8px)', 
                                  left: 0, 
                                  minWidth: '240px',
                                  padding: '8px', 
                                  zIndex: 999, 
                                  display: 'flex', 
                                  flexDirection: 'column', 
                                  gap: '4px',
                                  boxShadow: 'var(--shadow-lg)',
                                  backgroundColor: 'var(--surface-lowest)',
                                  border: '1px solid var(--border-color)'
                                }}
                              >
                                <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--on-surface-variant)', padding: '6px 8px 4px', borderBottom: '1px solid var(--border-color)', marginBottom: '4px' }}>
                                  {lang === 'zh' ? '切换模型' : 'Switch Model'}
                                </div>
                                <div style={{ maxHeight: '200px', overflowY: 'auto' }} className="custom-scrollbar">
                                  {profiles.map((profile) => {
                                    const isSel = profile.id === activeProfileId;
                                    return (
                                      <div 
                                        key={profile.id}
                                        style={{ 
                                          display: 'flex', 
                                          alignItems: 'center', 
                                          justifyContent: 'space-between',
                                          padding: '8px 10px', 
                                          borderRadius: '6px', 
                                          cursor: 'pointer',
                                          backgroundColor: isSel ? 'var(--surface-container-high)' : 'transparent',
                                        }}
                                        onClick={() => {
                                          setActiveProfileId(profile.id);
                                          setShowMiniSelector(false);
                                        }}
                                      >
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', textAlign: 'left' }}>
                                          <span style={{ fontSize: '12px', fontWeight: isSel ? 600 : 500, color: isSel ? 'var(--accent-color)' : 'var(--on-surface)' }}>
                                            {profile.name}
                                          </span>
                                          <span style={{ fontSize: '10px', color: 'var(--on-surface-variant)' }}>
                                            {profile.modelId}
                                          </span>
                                        </div>
                                        {isSel && <Icon name="check" style={{ color: 'var(--accent-color)', fontSize: '14px' }} />}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            </>
                          )}
                        </div>

                        {/* Agent 选择器 */}
                        <div style={{ position: 'relative' }}>
                          <div 
                            style={{ 
                              backgroundColor: showChatAgentSelector ? 'var(--surface-container-high)' : 'transparent',
                              border: selectedChatAgentId ? '1px solid var(--primary)' : '1px solid var(--border-color)',
                              padding: '4px 8px',
                              borderRadius: '6px',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px',
                              cursor: 'pointer',
                              fontSize: '10px',
                              fontWeight: selectedChatAgentId ? 600 : 400,
                              color: selectedChatAgentId ? 'var(--primary)' : 'var(--on-surface-variant)',
                            }}
                            onClick={() => setShowChatAgentSelector(!showChatAgentSelector)}
                          >
                            <Icon name="agent" style={{ fontSize: '12px' }} />
                            <span>{selectedChatAgentId ? (allAgents.find((a: any) => a.id === selectedChatAgentId)?.name || 'Agent') : 'Agent'}</span>
                            {selectedChatAgentId && (
                              <span style={{ fontSize: '8px', cursor: 'pointer', padding: '1px', borderRadius: '2px' }}
                                onClick={(e) => { e.stopPropagation(); setSelectedChatAgentId(null); }}
                              >✕</span>
                            )}
                            <span style={{ fontSize: '7px', opacity: 0.7, transform: showChatAgentSelector ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>▼</span>
                          </div>

                          {showChatAgentSelector && (
                            <>
                              <div 
                                style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 998 }} 
                                onClick={() => setShowChatAgentSelector(false)}
                              />
                              <div 
                                className="card-bento"
                                style={{ 
                                  position: 'absolute', 
                                  bottom: 'calc(100% + 8px)', 
                                  left: 0, 
                                  minWidth: '200px',
                                  padding: '6px', 
                                  zIndex: 999, 
                                  display: 'flex', 
                                  flexDirection: 'column', 
                                  gap: '2px',
                                  boxShadow: 'var(--shadow-lg)',
                                  backgroundColor: 'var(--surface-lowest)',
                                  border: '1px solid var(--border-color)',
                                }}
                              >
                                <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--on-surface-variant)', padding: '5px 8px 3px', borderBottom: '1px solid var(--border-color)', marginBottom: '3px' }}>
                                  {lang === 'zh' ? '选择 Agent (可选)' : 'Agent (Optional)'}
                                </div>
                                <div
                                  style={{ padding: '5px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', color: 'var(--on-surface-variant)', fontStyle: 'italic' }}
                                  onClick={() => { setSelectedChatAgentId(null); setShowChatAgentSelector(false); }}
                                >
                                  {lang === 'zh' ? '不使用 Agent' : 'No Agent'}
                                </div>
                                <div style={{ maxHeight: '180px', overflowY: 'auto' }} className="custom-scrollbar">
                                  {allAgents.map((agent: any) => (
                                    <div
                                      key={agent.id}
                                      style={{ 
                                        display: 'flex', alignItems: 'center', gap: '6px',
                                        padding: '5px 8px', borderRadius: '4px', cursor: 'pointer',
                                        backgroundColor: selectedChatAgentId === agent.id ? 'var(--surface-container-high)' : 'transparent',
                                      }}
                                      onClick={() => { setSelectedChatAgentId(agent.id); setShowChatAgentSelector(false); }}
                                    >
                                      <span style={{ fontSize: '12px' }}>{agent.icon}</span>
                                      <span style={{ fontSize: '11px', fontWeight: selectedChatAgentId === agent.id ? 600 : 400, color: 'var(--on-surface)' }}>{agent.name}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </>
                          )}
                        </div>

                        {/* 审批/危险模式切换 */}
                        <div 
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '3px',
                            padding: '2px',
                            borderRadius: '6px',
                            backgroundColor: 'var(--surface-container-high)',
                            border: '1px solid var(--border-color)',
                            cursor: 'pointer',
                            fontSize: '10px',
                            fontWeight: 600,
                          }}
                          onClick={() => setApprovalMode(approvalMode === 'approval' ? 'danger' : 'approval')}
                          title={approvalMode === 'approval' ? (lang === 'zh' ? '切换到危险模式' : 'Switch to Danger Mode') : (lang === 'zh' ? '切换到审批模式' : 'Switch to Approval Mode')}
                        >
                          <span style={{
                            padding: '2px 6px',
                            borderRadius: '4px',
                            backgroundColor: approvalMode === 'approval' ? 'var(--accent-color)' : 'transparent',
                            color: approvalMode === 'approval' ? '#fff' : 'var(--on-surface-variant)',
                            transition: 'all 0.15s',
                          }}>
                            {lang === 'zh' ? '审批' : 'Safe'}
                          </span>
                          <span style={{
                            padding: '2px 6px',
                            borderRadius: '4px',
                            backgroundColor: approvalMode === 'danger' ? '#e74c3c' : 'transparent',
                            color: approvalMode === 'danger' ? '#fff' : 'var(--on-surface-variant)',
                            transition: 'all 0.15s',
                          }}>
                            {lang === 'zh' ? '危险' : 'Danger'}
                          </span>
                        </div>
                      </div>

                      <button
                        onClick={handleProjectSend}
                        style={{
                          width: '32px', height: '32px', borderRadius: '6px',
                          border: 'none',
                          backgroundColor: isProjectSending ? 'var(--on-surface-variant)' : 'var(--on-surface)',
                          color: 'var(--surface-lowest)',
                          cursor: 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          transition: 'all 0.15s',
                        }}
                      >
                        <Icon name="arrow_upward" style={{ fontSize: '16px' }} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* 文件预览侧栏 */}
              {previewFile && (() => {
                const ext = previewFile.name.split('.').pop()?.toLowerCase() || '';
                const binaryExts = ['exe','dll','so','dylib','png','jpg','jpeg','gif','bmp','ico','svg','pdf','zip','gz','tar','7z','rar','mp3','mp4','avi','mov','wav','flac','ogg','woff','woff2','ttf','eot','o','obj','lib','a','class','pyc','pyd','whl'];
                const isBinary = binaryExts.includes(ext) || /[\x00-\x08\x0E-\x1F]/.test(previewFile.content.slice(0, 4096));

                const langMap: Record<string, string> = {
                  'js': 'javascript','ts': 'typescript','tsx': 'typescript','jsx': 'javascript',
                  'rs': 'rust','py': 'python','rb': 'ruby','go': 'go','java': 'java',
                  'kt': 'kotlin','swift': 'swift','c': 'c','cpp': 'cpp','h': 'c','hpp': 'cpp',
                  'cs': 'csharp','fs': 'fsharp','sh': 'bash','bash': 'bash','zsh': 'bash',
                  'yaml': 'yaml','yml': 'yaml','toml': 'ini','json': 'json','xml': 'xml',
                  'html': 'xml','css': 'css','scss': 'css','less': 'css',
                  'md': 'markdown','sql': 'sql','graphql': 'graphql',
                  'dockerfile': 'dockerfile','diff': 'diff','ini': 'ini','cfg': 'ini',
                  'env': 'ini','gitignore': 'ini','conf': 'ini',
                };
                const hljsLang = langMap[ext] || 'plaintext';

                const lines = isBinary ? [] : previewFile.content.split('\n');
                const lineCount = lines.length;

                return (
                <div style={{
                  position: 'absolute', top: 0, right: 0, bottom: 0, width: `${previewWidth}%`,
                  backgroundColor: 'var(--surface-lowest)',
                  borderLeft: '1px solid var(--border-color)',
                  display: 'flex', flexDirection: 'column',
                  zIndex: 50,
                  animation: 'slideIn 0.2s ease',
                  boxShadow: '-4px 0 12px rgba(0,0,0,0.08)',
                }}>
                  {/* 拖拽手柄 */}
                  <div
                    onMouseDown={handlePreviewMouseDown}
                    style={{
                      position: 'absolute', left: 0, top: 0, bottom: 0, width: '4px',
                      cursor: 'col-resize', zIndex: 51,
                      backgroundColor: isDraggingPreview ? 'var(--primary)' : 'transparent',
                      transition: 'background-color 0.1s',
                    }}
                    onMouseEnter={e => { if (!isDraggingPreview) e.currentTarget.style.backgroundColor = 'var(--outline)'; }}
                    onMouseLeave={e => { if (!isDraggingPreview) e.currentTarget.style.backgroundColor = 'transparent'; }}
                  />
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '10px 16px', borderBottom: '1px solid var(--border-color)',
                    backgroundColor: 'var(--surface)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Icon name="description" style={{ fontSize: '16px', color: 'var(--on-surface-variant)' }} />
                      <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--on-surface)' }}>{previewFile.name}</span>
                      <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '4px', backgroundColor: 'var(--surface-container)', color: 'var(--on-surface-variant)' }}>{ext}</span>
                      {isBinary && <span style={{ fontSize: '10px', padding: '1px 6px', borderRadius: '4px', backgroundColor: '#fee2e2', color: '#dc2626' }}>BINARY</span>}
                    </div>
                    <button
                      onClick={() => setPreviewFile(null)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--on-surface-variant)', padding: '4px', borderRadius: '4px' }}
                    >
                      <Icon name="close" style={{ fontSize: '16px' }} />
                    </button>
                  </div>
                  <div className="custom-scrollbar" style={{ flex: 1, overflow: 'auto' }}>
                    {isBinary ? (
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--on-surface-variant)', gap: '12px' }}>
                        <Icon name="warning" style={{ fontSize: '40px', opacity: 0.4 }} />
                        <div style={{ fontSize: '14px', fontWeight: 600 }}>{lang === 'zh' ? '二进制文件' : 'Binary File'}</div>
                        <div style={{ fontSize: '12px', opacity: 0.7 }}>{previewFile.name}</div>
                        <div style={{ fontSize: '11px', opacity: 0.5 }}>{lang === 'zh' ? '无法预览此文件内容' : 'Cannot preview this file'}</div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', fontFamily: 'var(--font-mono)', fontSize: '13px', lineHeight: '1.6', minHeight: '100%', padding: '8px 0' }}>
                        {lines.map((lineContent, i) => {
                          let lineHtml = '';
                          try {
                            const escaped = lineContent
                              .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                            const result = hljs.highlight(escaped, { language: hljsLang, ignoreIllegals: true });
                            lineHtml = result.value;
                          } catch {
                            lineHtml = lineContent
                              .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                          }
                          return (
                            <div key={i} style={{ display: 'flex', minHeight: '20.8px' }}>
                              <div style={{
                                padding: '0 12px 0 12px', textAlign: 'right', userSelect: 'none',
                                color: 'var(--on-surface-variant)', opacity: 0.35,
                                minWidth: `${String(lineCount).length * 10 + 16}px`,
                                flexShrink: 0, fontSize: '12px', lineHeight: '1.6',
                                borderRight: '1px solid var(--border-color)',
                              }}>{i + 1}</div>
                              <div style={{
                                padding: '0 16px', flex: 1, overflow: 'hidden',
                                whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                                fontSize: '13px', lineHeight: '1.6',
                              }}>
                                <code className={`hljs language-${hljsLang}`}
                                  style={{ background: 'transparent', padding: 0, fontSize: 'inherit', lineHeight: 'inherit' }}
                                  dangerouslySetInnerHTML={{ __html: lineHtml || '&nbsp;' }} />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
                );
              })()}
            </div>
            
          </div>
        )}

{/* 模型面板 */}
        {activeTab === 'model' && (
          <div className="canvas">
            <div className="canvas-container">
              
              {/* 1. 主页/列表视图 */}
              {editingProfileId === null && (
                <div>
                  <div className="page-header">
                    <div>
                      <h2 className="page-header-title">{lang === 'zh' ? '模型管理' : 'Model Management'}</h2>
                      <p className="page-header-subtitle">
                        {lang === 'zh' ? '配置、测试和管理与 Agent Runtime 连接的大语言模型通道。' : 'Configure, test, and manage the language model channels connected to the Agent Runtime.'}
                      </p>
                    </div>
                    <button className="btn-primary" onClick={handleStartNew}>
                      <Icon name="add" style={{ marginRight: '6px' }} />
                      {lang === 'zh' ? '添加模型' : 'Add Model'}
                    </button>
                  </div>

                  <div className="list-rows-container" style={{ display: 'flex', flexDirection: 'column', gap: '12px', background: 'none' }}>
                    {profiles.map((profile) => {
                      const isActive = profile.id === activeProfileId;
                      const conn = connectionStatus[profile.id];
                      
                      return (
                        <div 
                          key={profile.id} 
                          className="card-bento" 
                          style={{ 
                            flexDirection: 'row', 
                            justifyContent: 'space-between', 
                            alignItems: 'center', 
                            padding: '20px',
                            borderLeft: isActive ? '4px solid var(--accent-color)' : '1px solid var(--border-color)',
                            backgroundColor: isActive ? 'rgba(99, 102, 241, 0.03)' : 'var(--surface-lowest)'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                            {/* 默认启用单选按钮 */}
                            <div 
                              style={{ 
                                width: '20px', 
                                height: '20px', 
                                borderRadius: '50%', 
                                border: `2px solid ${isActive ? 'var(--accent-color)' : 'var(--on-surface-variant)'}`, 
                                display: 'flex', 
                                alignItems: 'center', 
                                justifyContent: 'center',
                                cursor: 'pointer',
                                transition: 'all 0.2s'
                              }}
                              onClick={() => {
                                setActiveProfileId(profile.id);
                              }}
                              title={lang === 'zh' ? '设为默认模型' : 'Set as default model'}
                            >
                              {isActive && (
                                <div style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: 'var(--accent-color)' }} />
                              )}
                            </div>

                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ fontWeight: 600, fontSize: '16px', color: 'var(--on-surface)' }}>{profile.name}</span>
                                {isActive && (
                                  <span className="status-pill success" style={{ fontSize: '9px', padding: '1px 6px' }}>
                                    {lang === 'zh' ? '当前启用' : 'ACTIVE'}
                                  </span>
                                )}
                                <span className="badge-tag" style={{ margin: 0, padding: '2px 6px', opacity: 0.8 }}>
                                  {profile.type === 'official' && (lang === 'zh' ? '官方渠道' : 'Official')}
                                  {profile.type === 'custom_simple' && (lang === 'zh' ? '简单自定义' : 'Simple Custom')}
                                  {profile.type === 'custom_script' && (lang === 'zh' ? '脚本复杂鉴权' : 'Script Auth')}
                                </span>
                              </div>
                              <div style={{ fontSize: '12.5px', color: 'var(--on-surface-variant)', marginTop: '4px', display: 'flex', gap: '12px' }}>
                                <span>{lang === 'zh' ? '模型 ID:' : 'Model ID:'} <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--primary)', background: 'var(--surface-low)', padding: '1px 4px', borderRadius: '3px' }}>{profile.modelId}</code></span>
                                <span>{lang === 'zh' ? '协议:' : 'Protocol:'} <span style={{ textTransform: 'uppercase' }}>{profile.protocol}</span></span>
                                <span>{lang === 'zh' ? '地址:' : 'Endpoint:'} <span style={{ opacity: 0.7 }}>{profile.baseUrl}</span></span>
                              </div>
                            </div>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            {/* 连接检测按钮与状态 */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginRight: '8px' }}>
                              {/* 延迟/状态展示 */}
                              {conn?.status === 'success' && (
                                <span className="status-pill success" style={{ display: 'flex', alignItems: 'center', gap: '4px', textTransform: 'none', padding: '4px 8px' }} title={lang === 'zh' ? '连接正常' : 'Connected'}>
                                  ✔ {conn.delay}ms
                                </span>
                              )}
                              {conn?.status === 'failed' && (
                                <span className="status-pill danger" style={{ display: 'flex', alignItems: 'center', gap: '4px', textTransform: 'none', padding: '4px 8px', cursor: 'help', maxWidth: '220px' }} title={conn.error || (lang === 'zh' ? '连接失败' : 'Failed')}>
                                  ✗ {lang === 'zh' ? '失败' : 'Failed'}
                                  {conn.error && <span style={{ fontSize: '10px', opacity: 0.8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '140px' }}>: {conn.error}</span>}
                                </span>
                              )}

                              <button 
                                className="btn-secondary" 
                                style={{ padding: '4px 10px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}
                                onClick={() => handleTestConnection(profile.id)}
                                disabled={conn?.status === 'testing'}
                              >
                                {conn?.status === 'testing' ? (
                                  <>
                                    <Icon name="sync" style={{ animation: 'spin 2s linear infinite', fontSize: '14px' }} />
                                    <span>{lang === 'zh' ? '测试中' : 'Testing'}</span>
                                  </>
                                ) : (
                                  <>
                                    <Icon name="link" style={{ fontSize: '14px' }} />
                                    <span>{lang === 'zh' ? '测试连接' : 'Test Connection'}</span>
                                  </>
                                )}
                              </button>
                            </div>

                            <button className="btn-secondary" style={{ padding: '6px 12px' }} onClick={() => setSelectedProfileId(profile.id)}>
                              <Icon name="visibility" style={{ marginRight: '4px' }} />
                              {lang === 'zh' ? '查看' : 'View'}
                            </button>
                            
                            <button className="btn-secondary" style={{ padding: '6px 12px' }} onClick={() => handleStartEdit(profile)}>
                              <Icon name="tune" style={{ marginRight: '4px' }} />
                              {lang === 'zh' ? '编辑' : 'Edit'}
                            </button>

                            <button 
                              className="row-action-btn btn-delete" 
                              style={{ padding: '8px', borderRadius: '6px' }} 
                              onClick={() => handleDeleteProfile(profile.id)}
                            >
                              <Icon name="delete" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 2. 添加/编辑表单视图 */}
              {editingProfileId !== null && (
                <div>
                  <div className="page-header">
                    <div>
                      <h2 className="page-header-title">
                        {editingProfileId === 'new' ? (lang === 'zh' ? '添加模型配置' : 'Add Model Configuration') : (lang === 'zh' ? '编辑模型配置' : 'Edit Model Configuration')}
                      </h2>
                      <p className="page-header-subtitle">
                        {lang === 'zh' ? '配置大语言模型集成参数、代理设置与超参数。' : 'Configure LLM integration parameters, proxy settings, and hyperparameters.'}
                      </p>
                    </div>
                    <div style={{ display: 'flex', gap: '12px' }}>
                      <button className="btn-secondary" onClick={() => setEditingProfileId(null)}>
                        {lang === 'zh' ? '取消' : 'Cancel'}
                      </button>
                      <button className="btn-primary" onClick={handleSaveProfile}>
                        <Icon name="save" style={{ marginRight: '4px' }} />
                        {lang === 'zh' ? '保存配置' : 'Save Config'}
                      </button>
                    </div>
                  </div>

                  <div className="grid-bento">
                    {/* 左侧连接参数 */}
                    <div className="card-bento bento-span-2">
                      <div className="card-title-row">
                        <Icon name="api" className="card-title-icon" style={{ marginRight: '6px' }} />
                        <span className="card-title-text">{lang === 'zh' ? '通道授权参数' : 'Channel Authorization'}</span>
                      </div>

                      {/* 模型类型单选卡片 */}
                      <div className="form-group">
                        <label className="form-label">{lang === 'zh' ? '选择模型接入模式' : 'Select Integration Mode'}</label>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '16px' }}>
                          <div 
                            className={`provider-option-card ${formType === 'official' ? 'active' : ''}`}
                            onClick={() => {
                              setFormType('official');
                              setFormProvider('OpenAI');
                              setFormProtocol('openai');
                              setFormBaseUrl('https://api.openai.com/v1');
                              setFormModelId('gpt-4o');
                            }}
                            style={{ padding: '16px 8px', borderRadius: '8px', borderLeft: formType === 'official' ? '3px solid var(--accent-color)' : '1px solid var(--border-color)' }}
                          >
                            <div style={{ fontWeight: 600 }}>{lang === 'zh' ? '官方托管渠道' : 'Official Vendor'}</div>
                            <div style={{ fontSize: '11px', color: 'var(--on-surface-variant)', marginTop: '4px' }}>OpenAI / Anthropic 直连</div>
                          </div>

                          <div 
                            className={`provider-option-card ${formType === 'custom_simple' ? 'active' : ''}`}
                            onClick={() => {
                              setFormType('custom_simple');
                              setFormProtocol('openai');
                              setFormBaseUrl('http://localhost:11434/v1');
                              setFormModelId('llama3');
                            }}
                            style={{ padding: '16px 8px', borderRadius: '8px', borderLeft: formType === 'custom_simple' ? '3px solid var(--accent-color)' : '1px solid var(--border-color)' }}
                          >
                            <div style={{ fontWeight: 600 }}>{lang === 'zh' ? '自定义协议(简单)' : 'Custom (Simple)'}</div>
                            <div style={{ fontSize: '11px', color: 'var(--on-surface-variant)', marginTop: '4px' }}>兼容中转 / Ollama 私有化</div>
                          </div>

                          <div 
                            className={`provider-option-card ${formType === 'custom_script' ? 'active' : ''}`}
                            onClick={() => {
                              setFormType('custom_script');
                              setFormProtocol('openai');
                              setFormBaseUrl('https://gateway.internal/v1');
                              setFormModelId('custom-model');
                            }}
                            style={{ padding: '16px 8px', borderRadius: '8px', borderLeft: formType === 'custom_script' ? '3px solid var(--accent-color)' : '1px solid var(--border-color)' }}
                          >
                            <div style={{ fontWeight: 600 }}>{lang === 'zh' ? '复杂脚本鉴权' : 'Script Auth'}</div>
                            <div style={{ fontSize: '11px', color: 'var(--on-surface-variant)', marginTop: '4px' }}>企业安全网关 JS 签名</div>
                          </div>
                        </div>
                      </div>

                      {/* 配置名称 */}
                      <div className="form-group">
                        <label className="form-label">{lang === 'zh' ? '配置显示别名' : 'Configuration Alias'}</label>
                        <input 
                          type="text" 
                          className="form-input-text"
                          placeholder={lang === 'zh' ? '如: 生产环境 GPT-4o' : 'e.g. Production GPT-4o'}
                          value={formName}
                          onChange={(e) => setFormName(e.target.value)}
                        />
                      </div>

                      {/* 1. 官方模式专属字段 */}
                      {formType === 'official' && (
                        <div>
                          <div className="form-group">
                            <label className="form-label">{lang === 'zh' ? '官方渠道厂商' : 'Vendor'}</label>
                            <select 
                              className="form-select" 
                              value={formProvider}
                              onChange={(e) => {
                                const prov = e.target.value;
                                setFormProvider(prov);
                                const vendor = OFFICIAL_VENDORS.find(v => v.key === prov);
                                if (vendor) {
                                  setFormProtocol(vendor.protocol);
                                  setFormBaseUrl(vendor.baseUrl);
                                  setFormModelId(vendor.defaultModelId);
                                }
                              }}
                            >
                              {OFFICIAL_VENDORS.map(v => (
                                <option key={v.key} value={v.key}>{v.name}</option>
                              ))}
                            </select>
                          </div>

                          <div className="form-group">
                            <label className="form-label">{lang === 'zh' ? '接口密钥 (API Key)' : 'API Key'}</label>
                            <div style={{ position: 'relative' }}>
                              <input 
                                type={showFormApiKey ? 'text' : 'password'} 
                                className="form-input-text"
                                placeholder={OFFICIAL_VENDORS.find(v => v.key === formProvider)?.placeholderKey || 'API Key'}
                                value={formApiKey}
                                onChange={(e) => setFormApiKey(e.target.value)}
                              />
                              <button 
                                type="button"
                                style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--on-surface-variant)' }}
                                onClick={() => setShowFormApiKey(!showFormApiKey)}
                              >
                                <Icon name={showFormApiKey ? 'visibility_off' : 'visibility'} />
                              </button>
                            </div>
                          </div>

                          <div className="form-group">
                            <label className="form-label">{lang === 'zh' ? '模型标识 ID (Model ID)' : 'Model ID'}</label>
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                              <input 
                                type="text" 
                                className="form-input-text"
                                style={{ flex: 1 }}
                                placeholder="gpt-4o, claude-3-5-sonnet"
                                value={formModelId}
                                onChange={(e) => setFormModelId(e.target.value)}
                              />
                              <button
                                type="button"
                                className="btn-secondary"
                                style={{ padding: '8px 12px', fontSize: '12.5px', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                                onClick={handleFetchModels}
                                disabled={isFetchingModels}
                              >
                                <Icon name={isFetchingModels ? 'sync' : 'search'} style={{ animation: isFetchingModels ? 'spin 1.5s linear infinite' : 'none' }} />
                                <span>{lang === 'zh' ? '获取列表' : 'Fetch List'}</span>
                              </button>
                            </div>

                            {/* 自动检测到的模型列表 */}
                            {fetchedModels.length > 0 && (
                              <div style={{ marginTop: '8px' }}>
                                <label className="form-label" style={{ fontSize: '11px', color: 'var(--accent-color)' }}>
                                  {lang === 'zh' ? '🔍 检测到以下可用模型 (点击可快速选择并同步限制):' : '🔍 Detected models (click to select and sync limits):'}
                                </label>
                                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '4px' }}>
                                  {fetchedModels.map(m => (
                                    <span 
                                      key={m} 
                                      className="badge-tag" 
                                      style={{ cursor: 'pointer', margin: 0, border: formModelId === m ? '1px solid var(--accent-color)' : '1px solid var(--border-color)', backgroundColor: formModelId === m ? 'rgba(99, 102, 241, 0.1)' : 'transparent' }}
                                      onClick={() => {
                                        setFormModelId(m);
                                        setFormMaxTokens(inferSuggestedOutputTokens(m));
                                      }}
                                    >
                                      {m}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}

                            {fetchModelsError && (
                              <div style={{ fontSize: '11px', color: 'var(--error-color)', marginTop: '6px' }}>
                                ⚠️ {lang === 'zh' ? '自动检测失败: ' : 'Detection failed: '} {fetchModelsError}
                              </div>
                            )}

                            {/* 默认推荐模型标签 */}
                            {fetchedModels.length === 0 && (
                              <div style={{ marginTop: '8px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                {(OFFICIAL_VENDORS.find(v => v.key === formProvider)?.models || ['gpt-4o']).map(lbl => (
                                  <span 
                                    key={lbl} 
                                    className="badge-tag" 
                                    style={{ cursor: 'pointer', margin: 0, border: formModelId === lbl ? '1px solid var(--accent-color)' : '1px solid var(--border-color)', backgroundColor: formModelId === lbl ? 'rgba(99, 102, 241, 0.1)' : 'transparent' }}
                                    onClick={() => {
                                      setFormModelId(lbl);
                                      setFormMaxTokens(inferSuggestedOutputTokens(lbl));
                                    }}
                                  >
                                    {lbl}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* 2. 自定义简单模式专属字段 */}
                      {formType === 'custom_simple' && (
                        <div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }} className="form-group">
                            <div>
                              <label className="form-label">{lang === 'zh' ? '兼容标准协议' : 'Compatible Protocol'}</label>
                              <select 
                                className="form-select"
                                value={formProtocol}
                                onChange={(e) => setFormProtocol(e.target.value as 'openai' | 'anthropic')}
                              >
                                <option value="openai">OpenAI 协议</option>
                                <option value="anthropic">Anthropic (Claude) 协议</option>
                              </select>
                            </div>
                            <div>
                              <label className="form-label">{lang === 'zh' ? '提供商名称' : 'Provider Name'}</label>
                              <input 
                                type="text" 
                                className="form-input-text"
                                placeholder="如: DeepSeek, Ollama"
                                value={formProvider}
                                onChange={(e) => setFormProvider(e.target.value)}
                              />
                            </div>
                          </div>

                          <div className="form-group">
                            <label className="form-label">{lang === 'zh' ? '代理地址 (Base URL)' : 'Base URL'}</label>
                            <input 
                              type="text" 
                              className="form-input-text"
                              placeholder="http://localhost:11434/v1"
                              value={formBaseUrl}
                              onChange={(e) => setFormBaseUrl(e.target.value)}
                            />
                          </div>

                          <div className="form-group">
                            <label className="form-label">{lang === 'zh' ? '接口密钥 (API Key)' : 'API Key'}</label>
                            <input 
                              type="password" 
                              className="form-input-text"
                              placeholder={lang === 'zh' ? '如果不需要认证密钥，请留空' : 'Leave empty if no auth key required'}
                              value={formApiKey}
                              onChange={(e) => setFormApiKey(e.target.value)}
                            />
                          </div>

                          <div className="form-group">
                            <label className="form-label">{lang === 'zh' ? '默认模型标识 ID (Model ID)' : 'Model ID'}</label>
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                              <input 
                                type="text" 
                                className="form-input-text"
                                style={{ flex: 1 }}
                                placeholder="llama3, deepseek-coder"
                                value={formModelId}
                                onChange={(e) => setFormModelId(e.target.value)}
                              />
                              <button
                                type="button"
                                className="btn-secondary"
                                style={{ padding: '8px 12px', fontSize: '12.5px', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                                onClick={handleFetchModels}
                                disabled={isFetchingModels}
                              >
                                <Icon name={isFetchingModels ? 'sync' : 'search'} style={{ animation: isFetchingModels ? 'spin 1.5s linear infinite' : 'none' }} />
                                <span>{lang === 'zh' ? '探测模型' : 'Detect Models'}</span>
                              </button>
                            </div>

                            {/* 自动检测到的模型列表 */}
                            {fetchedModels.length > 0 && (
                              <div style={{ marginTop: '8px' }}>
                                <label className="form-label" style={{ fontSize: '11px', color: 'var(--accent-color)' }}>
                                  {lang === 'zh' ? '🔍 检测到以下可用模型 (点击可快速选择并同步限制):' : '🔍 Detected models (click to select and sync limits):'}
                                </label>
                                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '4px' }}>
                                  {fetchedModels.map(m => (
                                    <span 
                                      key={m} 
                                      className="badge-tag" 
                                      style={{ cursor: 'pointer', margin: 0, border: formModelId === m ? '1px solid var(--accent-color)' : '1px solid var(--border-color)', backgroundColor: formModelId === m ? 'rgba(99, 102, 241, 0.1)' : 'transparent' }}
                                      onClick={() => {
                                        setFormModelId(m);
                                        setFormMaxTokens(inferSuggestedOutputTokens(m));
                                      }}
                                    >
                                      {m}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}

                            {fetchModelsError && (
                              <div style={{ fontSize: '11px', color: 'var(--error-color)', marginTop: '6px' }}>
                                ⚠️ {lang === 'zh' ? '自动检测失败: ' : 'Detection failed: '} {fetchModelsError}
                              </div>
                            )}

                            {/* 快速填入推荐标签 */}
                            {fetchedModels.length === 0 && (
                              <div style={{ marginTop: '8px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                {['llama3', 'qwen2.5-coder:7b', 'deepseek-chat', 'mistral'].map(lbl => (
                                  <span 
                                    key={lbl} 
                                    className="badge-tag" 
                                    style={{ cursor: 'pointer', margin: 0, border: formModelId === lbl ? '1px solid var(--accent-color)' : '1px solid var(--border-color)', backgroundColor: formModelId === lbl ? 'rgba(99, 102, 241, 0.1)' : 'transparent' }}
                                    onClick={() => {
                                      setFormModelId(lbl);
                                      setFormMaxTokens(inferSuggestedOutputTokens(lbl));
                                    }}
                                  >
                                    {lbl}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* 3. 复杂脚本鉴权专属字段 */}
                      {formType === 'custom_script' && (
                        <div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }} className="form-group">
                            <div>
                              <label className="form-label">{lang === 'zh' ? '代理协议' : 'Protocol'}</label>
                              <select 
                                className="form-select"
                                value={formProtocol}
                                onChange={(e) => setFormProtocol(e.target.value as 'openai' | 'anthropic')}
                              >
                                <option value="openai">OpenAI 协议</option>
                                <option value="anthropic">Anthropic (Claude) 协议</option>
                              </select>
                            </div>
                            <div>
                              <label className="form-label">{lang === 'zh' ? '提供商名称' : 'Provider Name'}</label>
                              <input 
                                type="text" 
                                className="form-input-text"
                                placeholder="Enterprise Gateway"
                                value={formProvider}
                                onChange={(e) => setFormProvider(e.target.value)}
                              />
                            </div>
                          </div>

                          <div className="form-group">
                            <label className="form-label">{lang === 'zh' ? '代理地址 (Base URL)' : 'Base URL'}</label>
                            <input 
                              type="text" 
                              className="form-input-text"
                              placeholder="https://gateway.company.com/v1"
                              value={formBaseUrl}
                              onChange={(e) => setFormBaseUrl(e.target.value)}
                            />
                          </div>

                          <div className="form-group">
                            <label className="form-label">{lang === 'zh' ? 'Node.js 动态鉴权脚本' : 'Node.js Auth Code'}</label>
                            <textarea
                              className="form-input-text"
                              style={{ fontFamily: 'var(--font-mono)', fontSize: '12.5px', height: '140px', resize: 'vertical', backgroundColor: 'var(--surface-lowest)', border: '1px solid var(--border-color)', lineHeight: '1.5' }}
                              value={formAuthScript}
                              onChange={(e) => setFormAuthScript(e.target.value)}
                            />
                          </div>

                          <div className="form-group">
                            <label className="form-label">{lang === 'zh' ? '模型标识 ID (Model ID)' : 'Model ID'}</label>
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                              <input 
                                type="text" 
                                className="form-input-text"
                                style={{ flex: 1 }}
                                placeholder="internal-gpt-4o"
                                value={formModelId}
                                onChange={(e) => setFormModelId(e.target.value)}
                              />
                              <button
                                type="button"
                                className="btn-secondary"
                                style={{ padding: '8px 12px', fontSize: '12.5px', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                                onClick={handleFetchModels}
                                disabled={isFetchingModels}
                              >
                                <Icon name={isFetchingModels ? 'sync' : 'search'} style={{ animation: isFetchingModels ? 'spin 1.5s linear infinite' : 'none' }} />
                                <span>{lang === 'zh' ? '探测模型' : 'Detect Models'}</span>
                              </button>
                            </div>

                            {/* 自动检测到的模型列表 */}
                            {fetchedModels.length > 0 && (
                              <div style={{ marginTop: '8px' }}>
                                <label className="form-label" style={{ fontSize: '11px', color: 'var(--accent-color)' }}>
                                  {lang === 'zh' ? '🔍 检测到以下可用模型 (点击可快速选择并同步限制):' : '🔍 Detected models (click to select and sync limits):'}
                                </label>
                                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '4px' }}>
                                  {fetchedModels.map(m => (
                                    <span 
                                      key={m} 
                                      className="badge-tag" 
                                      style={{ cursor: 'pointer', margin: 0, border: formModelId === m ? '1px solid var(--accent-color)' : '1px solid var(--border-color)', backgroundColor: formModelId === m ? 'rgba(99, 102, 241, 0.1)' : 'transparent' }}
                                      onClick={() => {
                                        setFormModelId(m);
                                        setFormMaxTokens(inferSuggestedOutputTokens(m));
                                      }}
                                    >
                                      {m}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}

                            {fetchModelsError && (
                              <div style={{ fontSize: '11px', color: 'var(--error-color)', marginTop: '6px' }}>
                                ⚠️ {lang === 'zh' ? '自动检测失败: ' : 'Detection failed: '} {fetchModelsError}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* 右侧独立超参数 */}
                    <div className="card-bento" style={{ gap: '20px' }}>
                      <div className="card-title-row">
                        <Icon name="tune" className="card-title-icon" style={{ marginRight: '6px' }} />
                        <span className="card-title-text">{lang === 'zh' ? '模型独立推理参数' : 'Inference Settings'}</span>
                      </div>

                      <div>
                        <div className="slider-group-header">
                          <label className="form-label" style={{ marginBottom: 0 }}>{t.modelTempLabel}</label>
                          <span className="slider-value-display">{formTemperature}</span>
                        </div>
                        <input 
                          type="range" 
                          className="range-slider-input" 
                          min="0" 
                          max="2" 
                          step="0.1" 
                          value={formTemperature}
                          onChange={(e) => setFormTemperature(parseFloat(e.target.value))}
                        />
                        <div className="slider-labels-row">
                          <span>{t.modelPrecise}</span>
                          <span>{t.modelCreative}</span>
                        </div>
                      </div>

                      <div>
                        <div className="slider-group-header">
                          <label className="form-label" style={{ marginBottom: 0 }}>{t.modelTopPLabel}</label>
                          <span className="slider-value-display">{formTopP}</span>
                        </div>
                        <input 
                          type="range" 
                          className="range-slider-input" 
                          min="0" 
                          max="1" 
                          step="0.05" 
                          value={formTopP}
                          onChange={(e) => setFormTopP(parseFloat(e.target.value))}
                        />
                      </div>

                      <div className="form-group">
                        <label className="form-label">{lang === 'zh' ? '单次最大输出 TOKEN 数 (MAX OUTPUT TOKENS)' : 'Max Output Tokens'}</label>
                        <input 
                          type="number" 
                          className="form-input-text" 
                          value={formMaxTokens}
                          onChange={(e) => setFormMaxTokens(parseInt(e.target.value) || 4096)}
                        />
                        <div className="form-helper-text">
                          {lang === 'zh'
                            ? `这个字段限制单次回复的输出长度，不是上下文窗口。当前 Runtime 推断上下文窗口约为 ${formatTokenCount(inferredContextWindow)} tokens。`
                            : `This field caps a single response output, not the model context window. Runtime currently infers about ${formatTokenCount(inferredContextWindow)} tokens of context.`}
                        </div>
                      </div>

                      <div className="switch-row" style={{ marginTop: '8px' }}>
                        <div>
                          <span className="switch-label-title">{t.modelTruncateTitle}</span>
                          <div className="switch-label-desc">{t.modelTruncateDesc}</div>
                        </div>
                        <div 
                          className={`switch-toggle-bg ${formAutoTruncate ? 'active' : ''}`}
                          onClick={() => setFormAutoTruncate(!formAutoTruncate)}
                        >
                          <div className="switch-toggle-dot" />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

            </div>

            {/* 查看详情只读弹窗 */}
            {selectedProfileId !== null && (() => {
              const profile = profiles.find(p => p.id === selectedProfileId);
              if (!profile) return null;
              
              return (
                <div className="modal-overlay">
                  <div className="modal-card">
                    <div className="modal-header">
                      <span className="modal-title">{lang === 'zh' ? '模型配置详情' : 'Model Profile Info'}</span>
                      <button className="modal-close-btn" onClick={() => setSelectedProfileId(null)}>
                        <Icon name="close" />
                      </button>
                    </div>
                    <div className="modal-body custom-scrollbar" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                      
                      <div className="form-group">
                        <label className="form-label">{lang === 'zh' ? '配置别名' : 'Alias Name'}</label>
                        <input type="text" className="form-input-text" readOnly value={profile.name} />
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }} className="form-group">
                        <div>
                          <label className="form-label">{lang === 'zh' ? '接入类型' : 'Integration Type'}</label>
                          <input type="text" className="form-input-text" readOnly value={profile.type} style={{ textTransform: 'capitalize' }} />
                        </div>
                        <div>
                          <label className="form-label">{lang === 'zh' ? '兼容协议' : 'Protocol'}</label>
                          <input type="text" className="form-input-text" readOnly value={profile.protocol.toUpperCase()} />
                        </div>
                      </div>

                      <div className="form-group">
                        <label className="form-label">{lang === 'zh' ? '接口代理地址 (Base URL)' : 'Base URL'}</label>
                        <input type="text" className="form-input-text" readOnly value={profile.baseUrl} />
                      </div>

                      <div className="form-group">
                        <label className="form-label">{lang === 'zh' ? '官方厂商 / 协议别名' : 'Vendor'}</label>
                        <input type="text" className="form-input-text" readOnly value={profile.provider} />
                      </div>

                      <div className="form-group">
                        <label className="form-label">{lang === 'zh' ? '授权密钥 (API Key)' : 'API Key'}</label>
                        <input type="text" className="form-input-text" readOnly value={profile.apiKey ? '••••••••' : 'No Key'} />
                      </div>

                      {profile.type === 'custom_script' && (
                        <div className="form-group">
                          <label className="form-label">Node.js Auth Script</label>
                          <textarea className="form-input-text" readOnly style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', height: '100px', resize: 'none' }} value={profile.authScript} />
                        </div>
                      )}

                      <div className="form-group">
                        <label className="form-label">{lang === 'zh' ? '模型标识 ID (Model ID)' : 'Model ID'}</label>
                        <input type="text" className="form-input-text" readOnly value={profile.modelId} />
                      </div>

                      <div className="card-bento" style={{ padding: '16px', gap: '12px' }}>
                        <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--on-surface)' }}>{lang === 'zh' ? '模型超参数' : 'Hyperparameters'}</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', fontSize: '12px', textAlign: 'center' }}>
                          <div style={{ backgroundColor: 'var(--surface-low)', padding: '6px', borderRadius: '4px' }}>
                            <div style={{ color: 'var(--on-surface-variant)', fontSize: '10px' }}>Temperature</div>
                            <div style={{ fontWeight: 600, marginTop: '2px' }}>{profile.temperature}</div>
                          </div>
                          <div style={{ backgroundColor: 'var(--surface-low)', padding: '6px', borderRadius: '4px' }}>
                            <div style={{ color: 'var(--on-surface-variant)', fontSize: '10px' }}>Top P</div>
                            <div style={{ fontWeight: 600, marginTop: '2px' }}>{profile.topP}</div>
                          </div>
                          <div style={{ backgroundColor: 'var(--surface-low)', padding: '6px', borderRadius: '4px' }}>
                            <div style={{ color: 'var(--on-surface-variant)', fontSize: '10px' }}>{lang === 'zh' ? '输出上限' : 'Output Cap'}</div>
                            <div style={{ fontWeight: 600, marginTop: '2px' }}>{profile.maxTokens}</div>
                          </div>
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--on-surface-variant)' }}>
                          {lang === 'zh'
                            ? `当前 Runtime 推断上下文窗口约为 ${formatTokenCount(inferRuntimeContextWindow(profile.modelId, profile.protocol))} tokens。上方 Max Tokens 为单次输出上限。`
                            : `Runtime currently infers about ${formatTokenCount(inferRuntimeContextWindow(profile.modelId, profile.protocol))} tokens of context. Max Tokens above is the single-response output cap.`}
                        </div>
                      </div>

                    </div>
                    <div className="modal-footer">
                      <button className="btn-primary" onClick={() => setSelectedProfileId(null)}>
                        {lang === 'zh' ? '确定' : 'OK'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })()}

          </div>
        )}

        {/* MCP 面板 */}
        {activeTab === 'mcp' && mcpView === 'list' && (
          <div className="canvas">
            <div className="canvas-container">
              <div className="page-header">
                <div>
                  <h2 className="page-header-title">{t.mcpTitle}</h2>
                  <p className="page-header-subtitle">{t.mcpSub}</p>
                </div>
                <button className="btn-primary" onClick={handleGoToCreate}>
                  <Icon name="add_link" />
                  {t.mcpAddBtn}
                </button>
              </div>

              {/* Bento Dashboard Grid */}
              <div className="mcp-stats-grid">
                <div className="mcp-stat-card">
                  <span className="mcp-stat-label">{t.mcpActiveConn}</span>
                  <Icon name="cable" className="stat-icon" />
                  <div className="mcp-stat-value">
                    {mcpConnectedCount} <span className="stat-total">/ {mcpServers.length}</span>
                  </div>
                  <div className="mcp-stat-meta">{t.mcpActiveDesc}</div>
                </div>

                <div className="mcp-stat-card">
                  <span className="mcp-stat-label">{lang === 'zh' ? '已挂载到 Runtime' : 'Mounted Into Runtime'}</span>
                  <Icon name="link" className="stat-icon" />
                  <div className="mcp-stat-value">{mcpMountedCount}</div>
                  <div className="mcp-stat-meta">{lang === 'zh' ? '当前被 Runtime 注入的 Server 数量' : 'Servers currently mounted into the runtime'}</div>
                </div>

                <div className="mcp-stat-card">
                  <span className="mcp-stat-label">{t.mcpThroughput}</span>
                  <Icon name="extension" className="stat-icon" />
                  <div className="mcp-stat-value">{mcpCapabilityTotals.tools + mcpCapabilityTotals.resources + mcpCapabilityTotals.prompts}</div>
                  <div className="mcp-stat-meta">{mcpCapabilityTotals.tools} tools / {mcpCapabilityTotals.resources} resources / {mcpCapabilityTotals.prompts} prompts</div>
                </div>

                <div className="mcp-stat-card">
                  <span className="mcp-stat-label">{t.mcpHealth}</span>
                  <Icon name={mcpIssueCount > 0 ? 'warning' : 'cloud_done'} className="stat-icon" style={{ color: mcpIssueCount > 0 ? 'var(--warning-text)' : 'var(--success)' }} />
                  <div className="mcp-stat-value" style={{ color: mcpIssueCount > 0 ? 'var(--warning-text)' : 'var(--success)' }}>{mcpIssueCount}</div>
                  <div className="mcp-stat-meta">{t.mcpHealthDesc}</div>
                </div>
              </div>

              {mcpServers.length === 0 ? (
                <div className="card-bento mcp-empty-text" style={{ padding: '24px' }}>
                  {lang === 'zh' ? '当前没有已配置的 MCP 服务器。请点击右上角按钮添加。' : 'No MCP servers yet. Add a new server from the top-right action.'}
                </div>
              ) : (
                <div className="mcp-server-list-container">
                  <div className="mcp-server-list-header">
                    <span className="mcp-server-list-header-title">{t.mcpSourceCardTitle}</span>
                  </div>
                  {mcpServers.map(server => (
                    <div
                      key={server.id}
                      className={`mcp-server-list-row ${selectedMcpServerId === server.id ? 'selected' : ''}`}
                      style={{ borderLeft: selectedMcpServerId === server.id ? '4px solid var(--accent-color)' : 'none', cursor: 'pointer' }}
                      onClick={() => setSelectedMcpServerId(server.id)}
                    >
                      <div className="mcp-server-list-row-left">
                        <Icon
                          name={server.transport === 'stdio' ? 'terminal' : server.capabilities.resources > server.capabilities.tools ? 'description' : 'api'}
                          className="mcp-server-list-row-icon"
                        />
                        <div>
                          <div className="mcp-server-title-bar">
                            <span className="mcp-server-title-text">{server.name}</span>
                            <span className={`status-pill ${getMcpStatusTone(server.status)}`}>
                              {getMcpStatusLabel(server.status)}
                            </span>
                          </div>
                          <p className="mcp-server-desc-text">{server.description}</p>
                          <div className="mcp-server-row-meta-strip">
                            <span className="mcp-server-meta-chip">{getMcpTransportLabel(server.transport)}</span>
                            <span className="mcp-server-meta-chip">{getMcpMountScopeLabel(server.mountScope)}</span>
                            <span className="mcp-server-meta-chip">{server.permission}</span>
                            <span className="mcp-server-meta-chip">{server.startupMode}</span>
                          </div>
                        </div>
                      </div>
                      
                      <div className="mcp-server-row-actions-right">
                        <button
                          className="row-action-btn"
                          style={{ padding: '6px', marginRight: '4px' }}
                          title={lang === 'zh' ? '详情' : 'Details'}
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelectedMcpServerId(server.id);
                          }}
                        >
                          <Icon name="visibility" style={{ fontSize: '18px' }} />
                        </button>
                        <button
                          className="btn-secondary"
                          style={{ padding: '6px 12px', fontSize: '12px' }}
                          onClick={(event) => {
                            event.stopPropagation();
                            handleGoToEdit(server.id);
                          }}
                        >
                          {lang === 'zh' ? '编辑' : 'Edit'}
                        </button>
                        <label className="mcp-custom-switch" onClick={(e) => e.stopPropagation()}>
                          <input 
                            type="checkbox" 
                            checked={server.status === 'connected'} 
                            onChange={() => handleToggleMcpServer(server.id)}
                          />
                          <span className="mcp-custom-switch-slider"></span>
                        </label>
                        <button
                          className="row-action-btn btn-delete"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleRemoveMcpServer(server.id);
                          }}
                        >
                          <Icon name="delete" style={{ fontSize: '18px' }} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* MCP 详情弹窗 */}
            {selectedMcpServerId !== '' && (() => {
              const server = mcpServers.find(s => s.id === selectedMcpServerId);
              if (!server) return null;
              
              return (
                <div className="modal-overlay" onClick={() => setSelectedMcpServerId('')}>
                  <div className="modal-card" style={{ maxWidth: '680px', width: '90%' }} onClick={(e) => e.stopPropagation()}>
                    <div className="modal-header">
                      <span className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Icon name="settings" />
                        <span>{lang === 'zh' ? 'Server 详情' : 'Server Details'}: {server.name}</span>
                      </span>
                      <button className="modal-close-btn" onClick={() => setSelectedMcpServerId('')}>
                        <Icon name="close" />
                      </button>
                    </div>
                    <div className="modal-body custom-scrollbar" style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxHeight: '70vh' }}>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                        <span className={`status-pill ${getMcpStatusTone(server.status)}`}>
                          {getMcpStatusLabel(server.status)}
                        </span>
                        <span className="mcp-server-meta-chip">{getMcpTransportLabel(server.transport)}</span>
                        <span className="mcp-server-meta-chip">{getMcpMountScopeLabel(server.mountScope)}</span>
                        <span className="mcp-server-meta-chip">{server.authMode}</span>
                      </div>

                      <div className="mcp-detail-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '12px' }}>
                        <div className="mcp-detail-item">
                          <span className="mcp-detail-label">{lang === 'zh' ? '传输方式' : 'Transport'}</span>
                          <strong>{getMcpTransportLabel(server.transport)}</strong>
                        </div>
                        <div className="mcp-detail-item">
                          <span className="mcp-detail-label">{lang === 'zh' ? '连接端点' : 'Endpoint'}</span>
                          <strong style={{ wordBreak: 'break-all' }}>{server.endpoint}</strong>
                        </div>
                        <div className="mcp-detail-item">
                          <span className="mcp-detail-label">{lang === 'zh' ? '鉴权模式' : 'Auth Mode'}</span>
                          <strong>{server.authMode}</strong>
                        </div>
                        <div className="mcp-detail-item">
                          <span className="mcp-detail-label">{lang === 'zh' ? '启动策略' : 'Startup Mode'}</span>
                          <strong>{server.startupMode}</strong>
                        </div>
                        <div className="mcp-detail-item">
                          <span className="mcp-detail-label">{lang === 'zh' ? '权限策略' : 'Permission'}</span>
                          <strong>{server.permission}</strong>
                        </div>
                        <div className="mcp-detail-item">
                          <span className="mcp-detail-label">{lang === 'zh' ? '挂载范围' : 'Mount Scope'}</span>
                          <strong>{getMcpMountScopeLabel(server.mountScope)}</strong>
                        </div>
                        <div className="mcp-detail-item" style={{ gridColumn: 'span 2' }}>
                          <span className="mcp-detail-label">{lang === 'zh' ? '挂载目标' : 'Mount Target'}</span>
                          <strong>{server.mountTarget}</strong>
                        </div>
                      </div>

                      <div className="info-banner" style={{ marginTop: '8px' }}>
                        <Icon name="info" className="card-title-icon" />
                        <div>
                          <div style={{ fontWeight: 600, marginBottom: '4px' }}>
                            {lang === 'zh' ? '这个 Server 如何接入 Runtime' : 'How this server is mounted into the runtime'}
                          </div>
                          <div style={{ fontSize: '12px', color: 'var(--on-surface-variant)' }}>{server.description}</div>
                          {server.lastError ? (
                            <div className="mcp-error-box">
                              <strong>{lang === 'zh' ? '最后一次错误' : 'Latest Error'}:</strong> {server.lastError}
                            </div>
                          ) : (
                            <div className="mcp-success-box">
                              {lang === 'zh' ? '最后一次初始化与功能发现已顺利完成。' : 'Latest initialize and capability discovery completed successfully.'}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="grid-bento" style={{ marginTop: '8px', display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px' }}>
                        <div className="card-bento" style={{ padding: '16px' }}>
                          <div className="card-title-row" style={{ marginBottom: '12px', paddingBottom: '8px' }}>
                            <Icon name="extension" className="card-title-icon" style={{ marginRight: '6px', fontSize: '18px' }} />
                            <span className="card-title-text" style={{ fontSize: '14px' }}>Capabilities</span>
                          </div>
                          <div className="mcp-capability-strip" style={{ marginBottom: '14px' }}>
                            <span className="mcp-capability-pill" style={{ fontSize: '11px', padding: '2px 8px' }}>Tools {server.capabilities.tools}</span>
                            <span className="mcp-capability-pill" style={{ fontSize: '11px', padding: '2px 8px' }}>Resources {server.capabilities.resources}</span>
                            <span className="mcp-capability-pill" style={{ fontSize: '11px', padding: '2px 8px' }}>Prompts {server.capabilities.prompts}</span>
                          </div>
                          <div className="mcp-capability-groups">
                            {selectedMcpSections.map(section => (
                              <div key={section.label} className="mcp-capability-group">
                                <div className="mcp-capability-group-title" style={{ fontSize: '11px' }}>{section.label}</div>
                                {section.items.length > 0 ? (
                                  <div className="mcp-capability-list">
                                    {section.items.map(item => (
                                      <span key={item} className="mcp-server-meta-chip" style={{ fontSize: '9px', padding: '1px 6px' }}>{item}</span>
                                    ))}
                                  </div>
                                ) : (
                                  <div className="mcp-empty-text" style={{ fontSize: '11px' }}>{lang === 'zh' ? '未暴露任何能力' : 'No capabilities exposed'}</div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="card-bento" style={{ padding: '16px' }}>
                          <div className="card-title-row" style={{ marginBottom: '12px', paddingBottom: '8px' }}>
                            <Icon name="analytics" className="card-title-icon" style={{ marginRight: '6px', fontSize: '18px' }} />
                            <span className="card-title-text" style={{ fontSize: '14px' }}>Lifecycle / Trace</span>
                          </div>
                          <div className="mcp-health-stack">
                            <div className="mcp-health-line">
                              <strong>{lang === 'zh' ? '最后握手时间' : 'Last Handshake'}:</strong> {server.lastHandshake}
                            </div>
                            <div className="mcp-health-line">
                              <strong>{lang === 'zh' ? '最近 Trace' : 'Last Trace'}:</strong> {server.lastTrace}
                            </div>
                            <div className="mcp-health-line">
                              <strong>{lang === 'zh' ? '挂载目标' : 'Mount Target'}:</strong> {server.mountTarget}
                            </div>
                            <div className="mcp-health-line">
                              <strong>{lang === 'zh' ? '当前状态' : 'Current Status'}:</strong> {getMcpStatusLabel(server.status)}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="modal-footer">
                      <button className="btn-secondary" onClick={() => handleReconnectMcpServer(server.id)}>
                        {lang === 'zh' ? '重新连接' : 'Reconnect'}
                      </button>
                      <button className="btn-secondary" onClick={() => handleToggleMcpServer(server.id)}>
                        {server.status === 'connected'
                          ? (lang === 'zh' ? '禁用 Server' : 'Disable Server')
                          : (lang === 'zh' ? '启动 Server' : 'Start Server')}
                      </button>
                      <button className="btn-primary" onClick={() => setSelectedMcpServerId('')}>
                        {lang === 'zh' ? '确定' : 'OK'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        )}
        {activeTab === 'mcp' && mcpView === 'form' && (
          <div className="canvas">
            <div className="canvas-container" style={{ paddingBottom: '100px' }}>
              <div className="mb-md" style={{ marginBottom: '16px' }}>
                <button 
                  className="btn-secondary" 
                  style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 12px' }}
                  onClick={handleCancelMcpForm}
                >
                  <Icon name="arrow_back" />
                  <span>{lang === 'zh' ? '返回服务列表' : 'Back to Server List'}</span>
                </button>
              </div>

              <div className="page-header" style={{ marginBottom: '24px' }}>
                <div>
                  <h2 className="page-header-title">
                    {mcpFormMode === 'create' 
                      ? (lang === 'zh' ? '创建 MCP 配置' : 'Create MCP Configuration') 
                      : (lang === 'zh' ? '编辑 MCP 配置' : 'Edit MCP Configuration')}
                  </h2>
                  <p className="page-header-subtitle">
                    {lang === 'zh' 
                      ? '定义 Model Context Protocol 服务参数，连接您的 LLM 环境与外部能力。'
    : 'Define Model Context Protocol server parameters to hook up external capabilities.'}
                  </p>
                </div>
              </div>

              <div className="space-y-6" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                <div className="card-bento" style={{ padding: '20px' }}>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label className="form-label">{lang === 'zh' ? 'Server 名称 *' : 'Server Name *'}</label>
                    <input 
                      type="text" 
                      className="form-input-text" 
                      placeholder="e.g. filesystem-server" 
                      value={mcpFormName} 
                      onChange={(e) => setMcpFormName(e.target.value)}
                    />
                  </div>
                </div>

                <div className="p-1 bg-surface-container rounded-lg inline-flex w-full md:w-auto" style={{ padding: '4px', backgroundColor: 'var(--surface-container)', borderRadius: '8px', display: 'flex', gap: '4px', alignSelf: 'flex-start' }}>
                  <button 
                    className={`px-8 py-2 rounded-md transition-all ${mcpFormType === 'local' ? 'tab-active bg-white text-primary shadow-sm font-semibold' : 'text-on-surface-variant hover:text-primary'}`} 
                    onClick={() => setMcpFormType('local')}
                    style={{ border: 'none', cursor: 'pointer', padding: '8px 24px', borderRadius: '6px' }}
                  >
                    {lang === 'zh' ? '本地 MCP 配置 (Stdio)' : 'Local MCP Config (Stdio)'}
                  </button>
                  <button 
                    className={`px-8 py-2 rounded-md transition-all ${mcpFormType === 'remote' ? 'tab-active bg-white text-primary shadow-sm font-semibold' : 'text-on-surface-variant hover:text-primary'}`} 
                    onClick={() => setMcpFormType('remote')}
                    style={{ border: 'none', cursor: 'pointer', padding: '8px 24px', borderRadius: '6px' }}
                  >
                    {lang === 'zh' ? '远程 MCP 服务器' : 'Remote MCP Server'}
                  </button>
                </div>

                {mcpFormType === 'local' && (
                  <div className="space-y-6" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                    <div className="card-bento" style={{ padding: '24px' }}>
                      <h3 className="card-title-text" style={{ marginBottom: '16px', fontSize: '16px' }}>{lang === 'zh' ? '执行环境' : 'Execution Environment'}</h3>
                      <div className="form-group" style={{ marginBottom: '16px' }}>
                        <label className="form-label">Command *</label>
                        <input 
                          type="text" 
                          className="form-input-text" 
                          placeholder="e.g. node, python3, or direct binary path" 
                          value={mcpFormCommand} 
                          onChange={(e) => setMcpFormCommand(e.target.value)}
                        />
                      </div>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label">Arguments (Args)</label>
                        <textarea 
                          className="form-input-text font-mono text-sm" 
                          placeholder={lang === 'zh' ? '--path /users/tools\n--verbose' : '--path /users/tools\n--verbose'}
                          rows={3} 
                          style={{ width: '100%', resize: 'vertical' }}
                          value={mcpFormArgs} 
                          onChange={(e) => setMcpFormArgs(e.target.value)}
                        />
                        <p className="form-helper-text" style={{ marginTop: '8px' }}>{lang === 'zh' ? '为该服务器提供启动参数。' : 'Provide start arguments for this server.'}</p>
                      </div>
                    </div>

                    <div className="card-bento" style={{ padding: '24px' }}>
                      <div style={{ display: 'flex', justifyContent: 'between', alignItems: 'center', marginBottom: '16px' }}>
                        <h3 className="card-title-text" style={{ fontSize: '16px', margin: 0 }}>{lang === 'zh' ? '环境变量 (ENV)' : 'Environment Variables (ENV)'}</h3>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {mcpFormEnv.map((item, index) => (
                          <div key={index} className="kv-row" style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                            <input 
                              type="text" 
                              placeholder="KEY" 
                              className="form-input-text font-mono" 
                              style={{ flex: 1 }}
                              value={item.key} 
                              onChange={(e) => {
                                const val = e.target.value;
                                setMcpFormEnv(prev => prev.map((x, i) => i === index ? { ...x, key: val } : x));
                              }}
                            />
                            <input 
                              type="text" 
                              placeholder="VALUE" 
                              className="form-input-text font-mono" 
                              style={{ flex: 1 }}
                              value={item.value} 
                              onChange={(e) => {
                                const val = e.target.value;
                                setMcpFormEnv(prev => prev.map((x, i) => i === index ? { ...x, value: val } : x));
                              }}
                            />
                            <button 
                              type="button" 
                              className="row-action-btn btn-delete"
                              style={{ border: 'none', background: 'none', cursor: 'pointer' }}
                              onClick={() => {
                                setMcpFormEnv(prev => prev.filter((_, i) => i !== index));
                              }}
                            >
                              <Icon name="delete" style={{ fontSize: '18px' }} />
                            </button>
                          </div>
                        ))}
                        <button 
                          type="button" 
                          className="btn-secondary" 
                          style={{ alignSelf: 'flex-start', padding: '6px 12px', fontSize: '12px' }}
                          onClick={() => setMcpFormEnv(prev => [...prev, { key: '', value: '' }])}
                        >
                          {lang === 'zh' ? '+ 添加变量' : '+ Add Variable'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {mcpFormType === 'remote' && (
                  <div className="space-y-6" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                    <div className="card-bento" style={{ padding: '24px' }}>
                      <h3 className="card-title-text" style={{ marginBottom: '16px', fontSize: '16px' }}>{lang === 'zh' ? '连接设置' : 'Connection Settings'}</h3>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '16px' }}>
                        <div className="form-group" style={{ margin: 0 }}>
                          <label className="form-label">{lang === 'zh' ? '传输协议 *' : 'Transport Protocol *'}</label>
                          <select 
                            className="form-select"
                            value={mcpFormRemoteTransport}
                            onChange={(e) => setMcpFormRemoteTransport(e.target.value as 'SSE' | 'WebSocket')}
                          >
                            <option value="SSE">SSE (Server-Sent Events)</option>
                            <option value="WebSocket">WebSocket</option>
                          </select>
                        </div>
                        <div className="form-group" style={{ margin: 0 }}>
                          <label className="form-label">Timeout (ms)</label>
                          <input 
                            type="number" 
                            className="form-input-text" 
                            value={mcpFormTimeout} 
                            onChange={(e) => setMcpFormTimeout(parseInt(e.target.value) || 30000)}
                          />
                        </div>
                        <div className="form-group" style={{ gridColumn: 'span 2', margin: 0 }}>
                          <label className="form-label">Server URL *</label>
                          <input 
                            type="text" 
                            className="form-input-text" 
                            placeholder="e.g. https://api.mcp-service.com/v1/connect" 
                            value={mcpFormUrl} 
                            onChange={(e) => setMcpFormUrl(e.target.value)}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="card-bento" style={{ padding: '24px' }}>
                      <div style={{ display: 'flex', justifyContent: 'between', alignItems: 'center', marginBottom: '16px' }}>
                        <h3 className="card-title-text" style={{ fontSize: '16px', margin: 0 }}>{lang === 'zh' ? '请求头 (Headers)' : 'Headers'}</h3>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {mcpFormHeaders.map((item, index) => (
                          <div key={index} className="kv-row" style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                            <input 
                              type="text" 
                              placeholder="Header Name" 
                              className="form-input-text font-mono" 
                              style={{ flex: 1 }}
                              value={item.key} 
                              onChange={(e) => {
                                const val = e.target.value;
                                setMcpFormHeaders(prev => prev.map((x, i) => i === index ? { ...x, key: val } : x));
                              }}
                            />
                            <input 
                              type="text" 
                              placeholder="Value" 
                              className="form-input-text font-mono" 
                              style={{ flex: 1 }}
                              value={item.value} 
                              onChange={(e) => {
                                const val = e.target.value;
                                setMcpFormHeaders(prev => prev.map((x, i) => i === index ? { ...x, value: val } : x));
                              }}
                            />
                            <button 
                              type="button" 
                              className="row-action-btn btn-delete"
                              style={{ border: 'none', background: 'none', cursor: 'pointer' }}
                              onClick={() => {
                                setMcpFormHeaders(prev => prev.filter((_, i) => i !== index));
                              }}
                            >
                              <Icon name="delete" style={{ fontSize: '18px' }} />
                            </button>
                          </div>
                        ))}
                        <button 
                          type="button" 
                          className="btn-secondary" 
                          style={{ alignSelf: 'flex-start', padding: '6px 12px', fontSize: '12px' }}
                          onClick={() => setMcpFormHeaders(prev => [...prev, { key: '', value: '' }])}
                        >
                          {lang === 'zh' ? '+ 添加 Header' : '+ Add Header'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                <div className="card-bento" style={{ padding: '24px' }}>
                  <h3 className="card-title-text" style={{ marginBottom: '16px', fontSize: '16px' }}>{lang === 'zh' ? '高级配置' : 'Advanced Configuration'}</h3>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px', padding: '16px', backgroundColor: 'var(--surface-low)', borderRadius: '8px', border: '1px dashed var(--border-color)' }}>
                    <div style={{ marginTop: '2px' }}><Icon name="info" /></div>
                    <div style={{ flex: 1 }}>
                      <p style={{ fontWeight: 600, margin: '0 0 4px 0' }}>{lang === 'zh' ? '权限沙箱模式' : 'Permissions Sandbox Mode'}</p>
                      <p style={{ fontSize: '12px', color: 'var(--on-surface-variant)', margin: 0 }}>
                        {lang === 'zh' 
                          ? '开启后，MCP 服务将 run 在隔离的环境中，无法访问宿主机的敏感资源。推荐对不受信任的第三方服务开启此选项。' 
                          : 'When enabled, the MCP service runs in an isolated environment and cannot access sensitive host resources.'}
                      </p>
                    </div>
                    <div>
                      <input 
                        type="checkbox" 
                        style={{ cursor: 'pointer', width: '18px', height: '18px', accentColor: 'var(--primary)' }}
                        checked={mcpFormSandbox}
                        onChange={(e) => setMcpFormSandbox(e.target.checked)}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <footer style={{
              position: 'fixed',
              bottom: 0,
              right: 0,
              width: 'calc(100% - var(--sidebar-width))',
              height: '72px',
              backgroundColor: 'var(--surface-lowest)',
              borderTop: '1px solid var(--border-color)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              padding: '0 24px',
              gap: '12px',
              zIndex: 40
            }}>
              <button 
                className="btn-secondary" 
                style={{ padding: '10px 24px' }}
                onClick={handleCancelMcpForm}
              >
                {lang === 'zh' ? '取消' : 'Cancel'}
              </button>
              <button 
                className="btn-primary" 
                style={{ padding: '10px 32px' }}
                onClick={handleSaveMcpForm}
              >
                {lang === 'zh' ? '保存并连接' : 'Save & Connect'}
              </button>
            </footer>
          </div>
        )}
        {activeTab === 'skill' && (
          <div className="canvas">
            <div className="canvas-container">
              <div className="page-header">
                <div>
                  <h2 className="page-header-title">{t.skillTitle}</h2>
                  <p className="page-header-subtitle">{t.skillSub}</p>
                </div>
                <button className="btn-primary" onClick={() => alert(lang === 'zh' ? '加载技能包' : 'Load Skills package')}>
                  <Icon name="publish" />
                  {t.skillImportBtn}
                </button>
              </div>

              <div className="card-bento">
                <div className="card-title-row">
                  <Icon name="construction" className="card-title-icon" style={{ marginRight: '6px' }} />
                  <span className="card-title-text">{t.skillCardTitle}</span>
                </div>

                <div className="list-rows-container">
                  {skills.map(skill => (
                    <div key={skill.id} className="list-row-item">
                      <div className="list-row-item-left" style={{ flex: 1 }}>
                        <Icon 
                          name={skill.id === 'file_indexer' ? 'search' : 'api'} 
                          className="list-row-icon" 
                        />
                        <div style={{ maxWidth: '80%' }}>
                          <span className="list-row-title">{skill.name}</span>
                          <span className="list-row-subtitle" style={{ display: 'block' }}>{skill.desc}</span>
                        </div>
                      </div>
                      <div className="list-row-actions" style={{ gap: '16px' }}>
                        <span style={{ fontSize: '12px', color: skill.enabled ? 'var(--success-text)' : 'var(--on-surface-variant)' }}>
                          {skill.enabled ? t.skillEnabled : t.skillDisabled}
                        </span>
                        <div 
                          className={`switch-toggle-bg ${skill.enabled ? 'active' : ''}`}
                          onClick={() => toggleSkill(skill.id)}
                        >
                          <div className="switch-toggle-dot" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 策略面板 */}
        {activeTab === 'policy' && (
          <div className="canvas">
            <div className="canvas-container">
              <div className="page-header">
                <div>
                  <h2 className="page-header-title">{t.policyTitle}</h2>
                  <p className="page-header-subtitle">{t.policySub}</p>
                </div>
                <button className="btn-primary" onClick={() => alert(lang === 'zh' ? '安全策略已成功保存！' : 'Saved!')}>
                  <Icon name="save" />
                  {t.policySaveBtn}
                </button>
              </div>

              <div className="grid-bento">
                {/* 预算策略 */}
                <div className="card-bento">
                  <div className="card-title-row">
                    <Icon name="monetization_on" className="card-title-icon" style={{ marginRight: '6px' }} />
                    <span className="card-title-text">{t.policyCostCard}</span>
                  </div>

                  <div className="form-group">
                    <label className="form-label">{t.policyLimitLabel}</label>
                    <input 
                      type="number" 
                      className="form-input-text" 
                      value={maxCostBudget}
                      onChange={(e) => setMaxCostBudget(parseFloat(e.target.value) || 1.00)}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">{t.policyWarnLabel}</label>
                    <input 
                      type="number" 
                      className="form-input-text" 
                      value={warningThreshold}
                      onChange={(e) => setWarningThreshold(parseFloat(e.target.value) || 0.50)}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">{t.policyLoopsLabel}</label>
                    <input 
                      type="number" 
                      className="form-input-text" 
                      value={maxLoops}
                      onChange={(e) => setMaxLoops(parseInt(e.target.value) || 5)}
                    />
                    <span style={{ fontSize: '11px', color: 'var(--on-surface-variant)', display: 'block', marginTop: '4px' }}>
                      {t.policyLoopsDesc}
                    </span>
                  </div>
                </div>

                {/* 权限策略 */}
                <div className="card-bento bento-span-2">
                  <div className="card-title-row">
                    <Icon name="shield_lock" className="card-title-icon" style={{ marginRight: '6px' }} />
                    <span className="card-title-text">{t.policyRulesCard}</span>
                  </div>

                  <div className="switch-row" style={{ padding: '12px', border: '1px solid var(--border-color)', borderRadius: '4px', marginBottom: '16px' }}>
                    <div>
                      <span className="switch-label-title">{t.policyShellToggle}</span>
                      <div className="switch-label-desc">{t.policyShellDesc}</div>
                    </div>
                    <div 
                      className={`switch-toggle-bg ${requireApprovalForShell ? 'active' : ''}`}
                      onClick={() => setRequireApprovalForShell(!requireApprovalForShell)}
                    >
                      <div className="switch-toggle-dot" />
                    </div>
                  </div>

                  <div className="form-group">
                    <label className="form-label">{t.policyAllowedLabel}</label>
                    <input 
                      type="text" 
                      className="form-input-text" 
                      value={allowedTools}
                      onChange={(e) => setAllowedTools(e.target.value)}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">{t.policyBlacklistLabel}</label>
                    <div className="code-snippet-box">
                      <div className="code-snippet-header">
                        <span className="code-snippet-title">{lang === 'zh' ? '黑名单匹配词条' : 'Blacklist Regex Pattern'}</span>
                      </div>
                      <div className="code-snippet-body">
                        /(rm\s+-rf|format|mkfs|shutdown|curl\s+.*\|\s*sh)/gi
                      </div>
                    </div>
                    <span style={{ fontSize: '11px', color: 'var(--on-surface-variant)', display: 'block', marginTop: '4px' }}>
                      {t.policyBlacklistDesc}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 追踪面板 */}
        {activeTab === 'trace' && (
          <div className="canvas">
            <div className="canvas-container">
              <div className="page-header">
                <div>
                  <h2 className="page-header-title">{t.traceTitle}</h2>
                  <p className="page-header-subtitle">{t.traceSub}</p>
                </div>
                <button className="btn-secondary" onClick={() => loadTraces()}>
                  <Icon name="refresh" />
                  {t.traceRefreshBtn}
                </button>
              </div>

              <div className="grid-bento">
                {/* 左边：Trace 会话列表 */}
                <div className="card-bento">
                  <div className="card-title-row">
                    <Icon name="terminal" className="card-title-icon" style={{ marginRight: '6px' }} />
                    <span className="card-title-text">{t.traceListCard}</span>
                  </div>

                  <div className="list-rows-container" style={{ maxHeight: '500px', overflowY: 'auto' }}>
                    {conversationSummaries.map(item => (
                      <div 
                        key={item.conversation_id} 
                        className={`list-row-item ${selectedConversationId === item.conversation_id ? 'bg-surface-low' : ''}`}
                        style={{ cursor: 'pointer', flexDirection: 'column', alignItems: 'stretch' }}
                        onClick={() => handleSelectConversation(item.conversation_id, item.latestSessionId)}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span className="list-row-title" style={{ maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</span>
                          <span className={`status-pill ${item.latestStatus === 'completed' ? 'success' : 'warning'}`}>
                            {item.status === 'completed' ? (lang === 'zh' ? '完成' : 'Done') : (lang === 'zh' ? '挂起' : 'Pending')}
                          </span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--on-surface-variant)', marginTop: '6px' }}>
                          <span>ID: {item.conversation_id.substring(0, 12)}...</span>
                          <span>{lang === 'zh' ? '循环步数' : 'Loops'}: {item.loop_index}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 右边：Trace 深度详细日志树 */}
                <div className="card-bento bento-span-2">
                  <div className="card-title-row">
                    <Icon name="terminal" className="card-title-icon" style={{ marginRight: '6px' }} />
                    <span className="card-title-text">{t.traceDetailCard} {selectedSessionId ? selectedSessionId.substring(0, 16) : (lang === 'zh' ? '未选择' : 'Unselected')}</span>
                  </div>

                  {conversationTraceEvents.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      <div className="info-banner">
                        <Icon name="info" className="info-banner-icon" />
                        <div className="info-banner-text">{t.traceBannerText}</div>
                      </div>

                      <div className="trace-logs-list custom-scrollbar" style={{ maxHeight: '450px', backgroundColor: '#fdfdfd' }}>
                        {conversationTraceEvents.map((evt, idx) => (
                          <div key={idx} className="trace-item-row" style={{ padding: '4px 0', borderBottom: '1px solid #f3f3f3' }}>
                            <span className="trace-time">{new Date(evt.timestamp_ms).toLocaleTimeString()}</span>
                            <span className={`trace-tag ${evt.kind.toLowerCase()}`}>{evt.kind}</span>
                            <span className="trace-msg-text" style={{ whiteSpace: 'pre-wrap' }}>{evt.message}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div style={{ padding: '64px 20px', textAlign: 'center', color: 'var(--on-surface-variant)' }}>
                      {t.traceEmptyDetail}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* 偏好设置 Modal */}
      {showSettingsModal && (
        <div className="modal-overlay">
          <div className="modal-card">
            <div className="modal-header">
              <span className="modal-title">{t.setModalTitle}</span>
              <button className="modal-close-btn" onClick={() => setShowSettingsModal(false)}>
                <Icon name="close" style={{ fontSize: '18px' }} />
              </button>
            </div>

            <div className="modal-body">
              {/* 国际化语言设置选项 */}
              <div className="form-group">
                <label className="form-label">{t.setLanguageLabel}</label>
                <select 
                  className="form-select"
                  value={lang}
                  onChange={(e) => setLang(e.target.value as 'zh' | 'en')}
                >
                  <option value="zh">简体中文 (Simplified Chinese)</option>
                  <option value="en">English (US)</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">{t.setHttpLabel}</label>
                <input 
                  type="text" 
                  className="form-input-text" 
                  value={httpProxy}
                  onChange={(e) => setHttpProxy(e.target.value)}
                  placeholder="例如 http://127.0.0.1:7890"
                />
              </div>

              <div className="form-group">
                <label className="form-label">{t.setSocksLabel}</label>
                <input 
                  type="text" 
                  className="form-input-text" 
                  value={socksProxy}
                  onChange={(e) => setSocksProxy(e.target.value)}
                  placeholder="例如 socks5://127.0.0.1:7890"
                />
              </div>

              <div className="form-group" style={{ marginTop: '20px' }}>
                <div className="switch-row">
                  <div>
                    <span className="switch-label-title">{t.setCacheToggle}</span>
                    <div className="switch-label-desc">{t.setCacheDesc}</div>
                  </div>
                  <div 
                    className={`switch-toggle-bg ${clearCacheOnExit ? 'active' : ''}`}
                    onClick={() => setClearCacheOnExit(!clearCacheOnExit)}
                  >
                    <div className="switch-toggle-dot" />
                  </div>
                </div>
              </div>

              <div className="form-group" style={{ marginTop: '20px' }}>
                <label className="form-label">{t.setStatusLabel}</label>
                <div className="info-banner" style={{ background: '#ecfdf5', borderColor: '#a7f3d0' }}>
                  <Icon name="check_circle" style={{ color: '#065f46' }} />
                  <div className="info-banner-text" style={{ color: '#065f46', marginLeft: '6px' }}>
                    {t.setStatusActiveText}
                  </div>
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowSettingsModal(false)}>{t.setCancelBtn}</button>
              <button 
                className="btn-primary" 
                onClick={() => {
                  setShowSettingsModal(false);
                  alert(lang === 'zh' ? '软件设置保存成功！已更新全局网络上下文。' : 'Settings saved successfully!');
                }}
              >
                {t.setSaveBtn}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Agent 创建/编辑 Modal */}
      {showCreateAgentModal && (
        <div className="modal-overlay" onClick={() => setShowCreateAgentModal(false)}>
          <div className="modal-card" style={{ maxWidth: '640px', width: '90%' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">
                {agentForm.editingId ? (lang === 'zh' ? '编辑 Agent' : 'Edit Agent') : (lang === 'zh' ? '创建 Agent' : 'Create Agent')}
              </span>
              <button className="modal-close-btn" onClick={() => setShowCreateAgentModal(false)}>
                <Icon name="close" style={{ fontSize: '18px' }} />
              </button>
            </div>

            <div className="modal-body" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
              {/* Section 1: 身份与人设 */}
              <div style={{ marginBottom: '28px' }}>
                <h3 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--on-surface)', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ width: '4px', height: '14px', borderRadius: '2px', backgroundColor: 'var(--primary)', display: 'inline-block' }}></span>
                  {lang === 'zh' ? '身份与人设' : 'Identity & Persona'}
                </h3>
                <p style={{ fontSize: '11px', color: 'var(--on-surface-variant)', marginBottom: '16px', marginLeft: '10px' }}>
                  {lang === 'zh' ? '定义 Agent 的身份标识、行为风格与核心指令。' : 'Define the agent\'s identity, behavior style, and core instructions.'}
                </p>

                {/* Agent 名称 */}
                <div className="form-group" style={{ marginBottom: '16px' }}>
                  <label className="form-label" style={{ display: 'block', marginBottom: '6px', fontSize: '12px', fontWeight: 600, color: 'var(--on-surface)' }}>
                    {lang === 'zh' ? 'Agent 名称' : 'Agent Name'} <span style={{ color: 'var(--error)' }}>*</span>
                  </label>
                  <input
                    className="form-input-text"
                    type="text"
                    placeholder={lang === 'zh' ? '给 Agent 起个名字...' : 'Name your agent...'}
                    value={agentForm.name}
                    onChange={e => setAgentForm(prev => ({ ...prev, name: e.target.value }))}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--surface)', color: 'var(--on-surface)', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }}
                  />
                </div>

                {/* Agent 头像 */}
                <div className="form-group" style={{ marginBottom: '16px' }}>
                  <label className="form-label" style={{ display: 'block', marginBottom: '6px', fontSize: '12px', fontWeight: 600, color: 'var(--on-surface)' }}>
                    {lang === 'zh' ? 'Agent 头像' : 'Avatar'}
                  </label>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {AVAILABLE_AVATARS.map(emoji => (
                      <div
                        key={emoji}
                        onClick={() => setAgentForm(prev => ({ ...prev, avatar: emoji }))}
                        style={{
                          width: '40px', height: '40px', borderRadius: '8px',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: '20px', cursor: 'pointer',
                          backgroundColor: agentForm.avatar === emoji ? 'var(--primary-container)' : 'var(--surface-container)',
                          border: agentForm.avatar === emoji ? '2px solid var(--primary)' : '2px solid transparent',
                          transition: 'all 0.1s ease',
                        }}
                      >
                        {emoji}
                      </div>
                    ))}
                  </div>
                </div>

                {/* System Prompt */}
                <div className="form-group" style={{ marginBottom: '16px' }}>
                  <label className="form-label" style={{ display: 'block', marginBottom: '6px', fontSize: '12px', fontWeight: 600, color: 'var(--on-surface)' }}>
                    {lang === 'zh' ? '角色描述 / 系统提示词' : 'System Prompt'} <span style={{ color: 'var(--error)' }}>*</span>
                  </label>
                  <textarea
                    className="form-input-text"
                    placeholder={lang === 'zh' ? '描述 Agent 的角色、行为准则和限制...' : 'Describe the agent\'s role, behavior, and constraints...'}
                    value={agentForm.systemPrompt}
                    onChange={e => setAgentForm(prev => ({ ...prev, systemPrompt: e.target.value }))}
                    rows={6}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--surface)', color: 'var(--on-surface)', fontSize: '13px', outline: 'none', resize: 'vertical', fontFamily: 'var(--font-mono)', boxSizing: 'border-box' }}
                  />
                </div>

                {/* Temperature 滑块 */}
                <div className="form-group" style={{ marginBottom: '8px' }}>
                  <label className="form-label" style={{ display: 'block', marginBottom: '6px', fontSize: '12px', fontWeight: 600, color: 'var(--on-surface)' }}>
                    {lang === 'zh' ? '对话风格 / Temperature' : 'Tone / Temperature'}
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <input
                      type="range"
                      min="0"
                      max="0.9"
                      step="0.1"
                      value={agentForm.temperature}
                      onChange={e => setAgentForm(prev => ({ ...prev, temperature: parseFloat(e.target.value) }))}
                      style={{ flex: 1, accentColor: 'var(--primary)' }}
                    />
                    <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--on-surface)', minWidth: '32px', textAlign: 'center', fontFamily: 'var(--font-mono)' }}>
                      {agentForm.temperature.toFixed(1)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--on-surface-variant)', marginTop: '2px' }}>
                    <span>{lang === 'zh' ? '严谨 (0.0)' : 'Precise (0.0)'}</span>
                    <span>{lang === 'zh' ? '折中 (0.5)' : 'Balanced (0.5)'}</span>
                    <span>{lang === 'zh' ? '创造性 (0.9)' : 'Creative (0.9)'}</span>
                  </div>
                </div>
              </div>

              {/* Section 2: 能力与运行时 */}
              <div style={{ marginBottom: '16px' }}>
                <h3 style={{ fontSize: '14px', fontWeight: 700, color: 'var(--on-surface)', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ width: '4px', height: '14px', borderRadius: '2px', backgroundColor: 'var(--primary)', display: 'inline-block' }}></span>
                  {lang === 'zh' ? '能力与运行时' : 'Capabilities & Runtime'}
                </h3>
                <p style={{ fontSize: '11px', color: 'var(--on-surface-variant)', marginBottom: '16px', marginLeft: '10px' }}>
                  {lang === 'zh' ? '绑定模型、工具与执行参数。' : 'Bind model, tools, and execution parameters.'}
                </p>

                {/* 绑定模型 */}
                <div className="form-group" style={{ marginBottom: '16px' }}>
                  <label className="form-label" style={{ display: 'block', marginBottom: '6px', fontSize: '12px', fontWeight: 600, color: 'var(--on-surface)' }}>
                    {lang === 'zh' ? '绑定模型' : 'LLM Model'} <span style={{ color: 'var(--error)' }}>*</span>
                  </label>
                  <select
                    className="form-select"
                    value={agentForm.modelId}
                    onChange={e => setAgentForm(prev => ({ ...prev, modelId: e.target.value }))}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--surface)', color: 'var(--on-surface)', fontSize: '13px', outline: 'none' }}
                  >
                    <option value="">{lang === 'zh' ? '-- 选择模型 --' : '-- Select Model --'}</option>
                    {profiles.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.modelId})
                      </option>
                    ))}
                  </select>
                </div>

                {/* 可用工具 */}
                <div className="form-group" style={{ marginBottom: '16px' }}>
                  <label className="form-label" style={{ display: 'block', marginBottom: '6px', fontSize: '12px', fontWeight: 600, color: 'var(--on-surface)' }}>
                    {lang === 'zh' ? '可用工具' : 'Available Tools'}
                  </label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {allowedTools.split(',').map(t => t.trim()).filter(Boolean).map(tool => {
                      const checked = agentForm.tools.includes(tool);
                      return (
                        <div
                          key={tool}
                          onClick={() => setAgentForm(prev => ({
                            ...prev,
                            tools: checked
                              ? prev.tools.filter(t => t !== tool)
                              : [...prev.tools, tool]
                          }))}
                          style={{
                            padding: '6px 12px', borderRadius: '16px', cursor: 'pointer',
                            fontSize: '12px', fontWeight: 500, userSelect: 'none',
                            backgroundColor: checked ? 'var(--primary-container)' : 'var(--surface-container)',
                            color: checked ? 'var(--primary)' : 'var(--on-surface-variant)',
                            border: checked ? '1px solid var(--primary)' : '1px solid var(--border-color)',
                            transition: 'all 0.1s ease',
                          }}
                        >
                          {tool}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 最大思考步数 */}
                <div className="form-group" style={{ marginBottom: '8px' }}>
                  <label className="form-label" style={{ display: 'block', marginBottom: '6px', fontSize: '12px', fontWeight: 600, color: 'var(--on-surface)' }}>
                    {lang === 'zh' ? '最大思考步数' : 'Max Iterations'}
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={agentForm.maxIterations}
                      onChange={e => setAgentForm(prev => ({ ...prev, maxIterations: Math.max(1, parseInt(e.target.value) || 1) }))}
                      style={{ width: '80px', padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border-color)', backgroundColor: 'var(--surface)', color: 'var(--on-surface)', fontSize: '13px', outline: 'none', fontFamily: 'var(--font-mono)' }}
                    />
                    <span style={{ fontSize: '11px', color: 'var(--on-surface-variant)' }}>
                      {lang === 'zh' ? '防止 Agent 工具调用死循环' : 'Prevent infinite tool call loops'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowCreateAgentModal(false)}>
                {t.setCancelBtn}
              </button>
              <button
                className="btn-primary"
                onClick={() => {
                  if (!agentForm.name.trim() || !agentForm.systemPrompt.trim()) {
                    alert(lang === 'zh' ? '请填写 Agent 名称和系统提示词' : 'Please fill in Agent name and system prompt');
                    return;
                  }
                  const isEditing = !!agentForm.editingId;
                  const newAgent = {
                    id: isEditing ? agentForm.editingId : 'custom_' + Date.now(),
                    name: agentForm.name.trim(),
                    role: agentForm.systemPrompt.trim().slice(0, 40) + '...',
                    icon: agentForm.avatar,
                    color: '#6366f1',
                    temperature: agentForm.temperature,
                    modelId: agentForm.modelId,
                    maxIterations: agentForm.maxIterations,
                    systemPrompt: agentForm.systemPrompt.trim(),
                    tools: [...agentForm.tools],
                    isCustom: true,
                  };
                  if (isEditing) {
                    setCustomAgents(prev => prev.map(a => a.id === agentForm.editingId ? newAgent : a));
                  } else {
                    setCustomAgents(prev => [...prev, newAgent]);
                  }
                  setShowCreateAgentModal(false);
                  setSelectedAgentId(newAgent.id);
                }}
              >
                {agentForm.editingId ? (lang === 'zh' ? '保存更改' : 'Save Changes') : (lang === 'zh' ? '创建' : 'Create')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
