import React, { useState, useEffect, useRef } from 'react';

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
  task_input: string;
  status: string;
  loop_index: number;
  stop_reason: string;
  approval_required: boolean;
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
}

// 国际化词典定义
const translations = {
  zh: {
    brandName: 'ForgeOne',
    brandSub: '开放智能代理运行时',
    newAgentBtn: '新建任务',
    tabChat: '聊天',
    tabProject: '项目',
    tabModel: '模型',
    tabMcp: 'MCP 数据源',
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
    mcpSub: '管理外部连接的数据源和工具服务，将它们在 Agent 运行时直接注入上下文。',
    mcpAddBtn: '添加数据源',
    mcpActiveConn: '已激活的 MCP 服务',
    mcpActiveDesc: '已成功建立连接 of 外部进程',
    mcpThroughput: '今日同步数据流量',
    mcpThroughputDesc: '实时上下文通信报文大小',
    mcpHealth: '协议健康指数',
    mcpHealthDesc: '所有连接健康且处于就绪状态',
    mcpSourceCardTitle: '配置的上下文数据源',
    mcpConfigureBtn: '配置',

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
    mcpSub: 'Inject external database schemas, APIs, and microservice contexts to agent loop.',
    mcpAddBtn: 'Add Source',
    mcpActiveConn: 'Active Connections',
    mcpActiveDesc: 'Connected external harness processes',
    mcpThroughput: 'Data Throughput',
    mcpThroughputDesc: 'Size of transferred serialization content',
    mcpHealth: 'Protocol Health',
    mcpHealthDesc: 'All data feeds are connected and nominal',
    mcpSourceCardTitle: 'Configured Data Feeds',
    mcpConfigureBtn: 'Configure',

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

export default function App() {
  // 核心板块切换状态：'chat' | 'project' | 'model' | 'mcp' | 'skill' | 'policy' | 'trace'
  const [activeTab, setActiveTab] = useState<'chat' | 'project' | 'model' | 'mcp' | 'skill' | 'policy' | 'trace'>('chat');
  
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
  
  // 语言选项状态（默认中文 'zh'，可在设置中切换为 'en'）
  const [lang, setLang] = useState<'zh' | 'en'>('zh');
  const t = translations[lang];

  // 全局偏好设置弹窗状态
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [httpProxy, setHttpProxy] = useState('http://127.0.0.1:7890');
  const [socksProxy, setSocksProxy] = useState('');
  const [clearCacheOnExit, setClearCacheOnExit] = useState(false);

  // 聊天交互相关状态
  const [inputText, setInputText] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [tracesList, setTracesList] = useState<HistoricalTrace[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [traceExpanded, setTraceExpanded] = useState<Record<string, boolean>>({});
  const [isApprovalCollapsed, setIsApprovalCollapsed] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 项目面板状态
  const [projectRoot, setProjectRoot] = useState('D:/project/forgeone');
  const [permissions, setPermissions] = useState({
    read: true,
    write: true,
    execute: true,
    delete: false
  });
  
  // 模型面板状态
  const [activeProvider, setActiveProvider] = useState<'OpenAI' | 'Anthropic' | 'Local'>('OpenAI');
  const [apiKey, setApiKey] = useState('sk-proj-••••••••••••••••••••••••••••••••');
  const [showApiKey, setShowApiKey] = useState(false);
  const [baseUrl, setBaseUrl] = useState('https://api.openai.com/v1');
  const [defaultModel, setDefaultModel] = useState('gpt-4o');
  const [temperature, setTemperature] = useState(0.7);
  const [topP, setTopP] = useState(1.0);
  const [maxTokens, setMaxTokens] = useState(4096);
  const [autoTruncate, setAutoTruncate] = useState(true);

  // MCP 面板状态
  const [mcpSources, setMcpSources] = useState([
    { id: 1, name: 'PostgreSQL 生产数据库', type: 'Database/JDBC', uri: 'postgresql://db.internal:5432/main', status: 'connected', permission: '只读' },
    { id: 2, name: 'Stripe 支付 API', type: 'OpenAPI/REST', uri: 'https://api.stripe.com/v1', status: 'connected', permission: '完全读写' },
    { id: 3, name: 'Redis 主缓存集群', type: 'Key-Value', uri: 'redis://cache-cluster-01:6379', status: 'degraded', permission: '键值读写' },
    { id: 4, name: ' Notion 技术开发文档库', type: 'Vector Search', uri: 'Workspace: Engineering', status: 'paused', permission: '向量查询' }
  ]);

  // 技能面板状态
  const [skills, setSkills] = useState([
    { id: 'file_indexer', name: '文件智能检索', desc: '利用向量数据库对当前工作目录下的文件内容进行语义化建索引与检索', enabled: true },
    { id: 'python_sandbox', name: 'Python 沙箱执行', desc: '在隔离的轻量容器环境中运行代理生成的 Python 代码脚本', enabled: true },
    { id: 'web_scraper', name: '网页数据爬取', desc: '支持抓取外部公开网页内容并将其清洗为 Markdown 文档格式', enabled: true },
    { id: 'database_writer', name: '数据库写入工具', desc: '根据批准直接对连接的 MCP 数据源执行增删改查 SQL 指令', enabled: false }
  ]);

  // 策略面板状态
  const [maxLoops, setMaxLoops] = useState(8);
  const [allowedTools, setAllowedTools] = useState('read_file,write_file,search_files,shell');
  const [maxCostBudget, setMaxCostBudget] = useState(5.00);
  const [warningThreshold, setWarningThreshold] = useState(3.00);
  const [requireApprovalForShell, setRequireApprovalForShell] = useState(true);

  // 加载会话历史
  useEffect(() => {
    loadTraces();
  }, []);

  // 聊天滚到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const loadTraces = async () => {
    try {
      const list = await (window as any).forgeone.listTraces();
      setTracesList(list || []);
    } catch (e) {
      console.error('Failed to load traces', e);
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || isRunning) return;

    const taskToSend = inputText;
    setInputText('');
    setIsRunning(true);

    const userMessageId = `user-${Date.now()}`;
    const agentMessageId = `agent-${Date.now()}`;

    setMessages(prev => [
      ...prev,
      {
        id: userMessageId,
        sender: 'user',
        content: taskToSend,
        timestamp: Date.now()
      },
      {
        id: agentMessageId,
        sender: 'agent',
        content: lang === 'zh' ? 'Agent 运行时核心已启动... 正在规划任务执行路径，分析所需的工具上下文。' : 'Agent Loop started... Planning execution steps and analyzing tool contexts.',
        timestamp: Date.now(),
        status: 'running',
        trace: []
      }
    ]);

    const toolsArr = allowedTools.split(',').map(t => t.trim()).filter(Boolean);

    try {
      const res: RunResult = await (window as any).forgeone.runTask({
        task: taskToSend,
        model_name: defaultModel,
        max_loops: maxLoops,
        token_budget: 32000,
        allowed_tools: toolsArr,
        read_roots: [projectRoot],
        approval_read_roots: ['secrets'],
      });

      setSelectedSessionId(res.state.session_id);
      
      setMessages(prev => prev.map(m => m.id === agentMessageId ? {
        ...m,
        content: res.final_response || (res.state.pending_approval ? (lang === 'zh' ? 'Agent 执行由于触发高危工具已被 Policy Engine 挂起，正在等待您的安全审批。' : 'Agent loop suspended by Policy Engine, awaiting developer authorization.') : (lang === 'zh' ? '任务已顺利执行完成。' : 'Task successfully executed.')),
        status: res.state.status,
        trace: res.trace,
        pendingApproval: res.state.pending_approval,
        budgetUsage: res.state.budget_usage
      } : m));

      loadTraces();
    } catch (err: any) {
      setMessages(prev => prev.map(m => m.id === agentMessageId ? {
        ...m,
        content: `${lang === 'zh' ? '执行出错' : 'Error'}: ${err.message || err}`,
        status: 'failed'
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
        setMessages([
          {
            id: `user-${record.session_id}`,
            sender: 'user',
            content: record.task_input,
            timestamp: Date.now() - 100000
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
            timestamp: Date.now() - 50000
          }
        ]);
      }
    } catch (e) {
      console.error('Failed to inspect trace', e);
    }
  };

  const handleApprove = async (agentMsgId: string, sessionId: string) => {
    setIsRunning(true);
    
    setMessages(prev => prev.map(m => m.id === agentMsgId ? {
      ...m,
      pendingApproval: null,
      status: 'running',
      content: lang === 'zh' ? '安全审批已批准。正在恢复 Agent 运行环境并恢复自治执行循环...' : 'Authorization granted. Restoring Agent Sandbox and resuming loop...'
    } : m));

    try {
      const res: RunResult = await (window as any).forgeone.approveSession(sessionId);
      setMessages(prev => prev.map(m => m.id === agentMsgId ? {
        ...m,
        content: res.final_response || (lang === 'zh' ? '任务已顺利执行完成。' : 'Task successfully executed.'),
        status: res.state.status,
        trace: res.trace,
        pendingApproval: res.state.pending_approval,
        budgetUsage: res.state.budget_usage
      } : m));
      loadTraces();
    } catch (err: any) {
      setMessages(prev => prev.map(m => m.id === agentMsgId ? {
        ...m,
        content: `${lang === 'zh' ? '恢复执行审批出错' : 'Error resuming loop'}: ${err.message || err}`,
        status: 'failed'
      } : m));
    } finally {
      setIsRunning(false);
    }
  };

  const handleReject = async (agentMsgId: string) => {
    try {
      await (window as any).forgeone.prunePending();
      setMessages(prev => prev.map(m => m.id === agentMsgId ? {
        ...m,
        pendingApproval: null,
        status: 'aborted',
        content: lang === 'zh' ? '执行已被用户拒绝并手动强行终止。' : 'Execution rejected and terminated by user.'
      } : m));
      loadTraces();
    } catch (err: any) {
      alert(`${lang === 'zh' ? '拒绝并清理会话失败' : 'Failed to prune session'}: ${err.message || err}`);
    }
  };

  const toggleTrace = (id: string) => {
    setTraceExpanded(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleSkill = (id: string) => {
    setSkills(prev => prev.map(s => s.id === id ? { ...s, enabled: !s.enabled } : s));
  };

  return (
    <div className="app-container">
      {/* 侧边栏导航 */}
      <aside className="sidebar">
        <div className="sidebar-header">
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
        {/* Top App Bar (通用搜索栏和状态) */}
        <header className="top-app-bar">
          <div className="top-bar-search">
            <Icon name="search" className="search-icon" />
            <input type="text" placeholder={t.searchPlaceholder} />
          </div>
          <div className="top-bar-actions">
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
        </header>

        {/* 聊天面板（多栏交互布局） */}
        {activeTab === 'chat' && (
          <div className="chat-page-layout">
            {/* 二级历史会话边栏 */}
            <div className="chat-history-sidebar">
              <div className="chat-history-header">{t.traceListCard}</div>
              <div className="chat-history-list custom-scrollbar">
                {tracesList.length === 0 ? (
                  <div style={{ padding: '16px', textAlign: 'center', color: 'var(--on-surface-variant)', fontSize: '12px' }}>
                    {t.traceEmptyList}
                  </div>
                ) : (
                  tracesList.map((item) => (
                    <div
                      key={item.session_id}
                      className={`chat-history-item ${selectedSessionId === item.session_id ? 'active' : ''}`}
                      onClick={() => handleSelectHistory(item.session_id)}
                    >
                      <span className="task-title">{item.task_input}</span>
                      <div className="task-meta">
                        <span style={{ fontFamily: 'var(--font-mono)' }}>{item.session_id.substring(0, 8)}</span>
                        <span style={{ color: item.status === 'completed' ? 'var(--success)' : 'var(--warning)' }}>
                          {item.status === 'completed' ? (lang === 'zh' ? '已完成' : 'Done') : (lang === 'zh' ? '挂起中' : 'Pending')}
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
                        {msg.sender === 'agent' ? (
                          <div className="message-avatar-circle">
                            <Icon name="smart_toy" style={{ color: 'var(--on-primary)' }} />
                          </div>
                        ) : (
                          <div className="message-avatar-circle user-avatar">
                            <Icon name="account_circle" style={{ color: 'var(--on-surface)' }} />
                          </div>
                        )}
                        <div className="message-content-wrapper">
                          <div className="message-sender-row">
                            <span className="message-sender-label">
                              {msg.sender === 'user' ? t.userLabel : t.agentLabel}
                            </span>
                            {msg.sender === 'agent' && msg.status && (
                              <span className="badge-tag">
                                {msg.status === 'running' ? t.statusRunning : msg.status === 'completed' ? t.statusCompleted : t.statusSuspended}
                              </span>
                            )}
                          </div>

                          <div className="message-bubble-body">
                            <div className="message-text">{msg.content}</div>

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
                                <Icon name="open_in_new" style={{ marginRight: '6px', color: 'var(--on-surface-variant)', opacity: 0.8 }} />
                                <span>
                                  {pending.tool_name === 'shell' 
                                    ? (lang === 'zh' ? '正在运行终端命令' : 'Running Command in Terminal')
                                    : (lang === 'zh' ? '正在浏览器中打开 URL' : 'Opening URL in Browser')}
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
                                  onClick={() => handleReject(activeApprovalMsg.id)}
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
                    <textarea
                      className="chat-input-textarea"
                      placeholder={t.inputPlaceholder}
                      value={inputText}
                      onChange={(e) => setInputText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSend(e);
                        }
                      }}
                      rows={1}
                    />
                    <div className="chat-input-toolbar-row">
                      <div className="chat-toolbar-left">
                        <button className="toolbar-action-btn" type="button" title={lang === 'zh' ? '添加文件上下文' : 'Attach File context'}>
                          <Icon name="attach_file" />
                        </button>
                        <button className="toolbar-action-btn" type="button" title={lang === 'zh' ? '插入代码块' : 'Insert Code Object'}>
                          <Icon name="data_object" />
                        </button>
                        <div className="toolbar-divider"></div>
                        {/* 极简模型切换浮层 */}
                        <div className="mini-model-selector" onClick={() => setActiveTab('model')}>
                          <Icon name="psychology" className="icon" style={{ marginRight: '4px' }} />
                          <span>{defaultModel}</span>
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

        {/* 项目面板 */}
        {activeTab === 'project' && (
          <div className="canvas">
            <div className="canvas-container">
              <div className="page-header">
                <div>
                  <h2 className="page-header-title">{t.projTitle}</h2>
                  <p className="page-header-subtitle">{t.projSub}</p>
                </div>
                <button className="btn-primary" onClick={() => alert(lang === 'zh' ? '已触发文件夹选择' : 'Browse folder...')}>
                  <Icon name="add_box" />
                  {t.projNewBtn}
                </button>
              </div>

              <div className="grid-bento">
                {/* 活跃工作区设置 */}
                <div className="card-bento bento-span-2">
                  <div className="card-title-row">
                    <Icon name="folder_managed" className="card-title-icon" style={{ marginRight: '6px' }} />
                    <span className="card-title-text">{t.projActiveCard}</span>
                  </div>

                  <div className="form-group">
                    <label className="form-label">{t.projPathLabel}</label>
                    <div style={{ display: 'flex', gap: '12px' }}>
                      <input 
                        type="text" 
                        className="form-input-text" 
                        value={projectRoot} 
                        onChange={(e) => setProjectRoot(e.target.value)}
                      />
                      <button className="btn-secondary" onClick={() => alert(lang === 'zh' ? '浏览本地路径' : 'Browse folder...')}>{t.projBrowseBtn}</button>
                    </div>
                  </div>

                  <div className="form-group">
                    <label className="form-label">{t.projPermissionLabel}</label>
                    <div className="permissions-grid">
                      <label className="permission-card">
                        <input 
                          type="checkbox" 
                          checked={permissions.read}
                          onChange={(e) => setPermissions({ ...permissions, read: e.target.checked })}
                        />
                        <div>
                          <span className="permission-title">{t.projReadTitle}</span>
                          <span className="permission-desc">{t.projReadDesc}</span>
                        </div>
                      </label>

                      <label className="permission-card">
                        <input 
                          type="checkbox" 
                          checked={permissions.write}
                          onChange={(e) => setPermissions({ ...permissions, write: e.target.checked })}
                        />
                        <div>
                          <span className="permission-title">{t.projWriteTitle}</span>
                          <span className="permission-desc">{t.projWriteDesc}</span>
                        </div>
                      </label>

                      <label className="permission-card">
                        <input 
                          type="checkbox" 
                          checked={permissions.execute}
                          onChange={(e) => setPermissions({ ...permissions, execute: e.target.checked })}
                        />
                        <div>
                          <span className="permission-title">{t.projExecuteTitle}</span>
                          <span className="permission-desc">{t.projExecuteDesc}</span>
                        </div>
                      </label>

                      <label className="permission-card disabled">
                        <input 
                          type="checkbox" 
                          disabled
                          checked={permissions.delete}
                          onChange={(e) => setPermissions({ ...permissions, delete: e.target.checked })}
                        />
                        <div>
                          <span className="permission-title">{t.projDeleteTitle}</span>
                          <span className="permission-desc">{t.projDeleteDesc}</span>
                        </div>
                      </label>
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '24px' }}>
                    <button className="btn-primary" onClick={() => alert(lang === 'zh' ? '配置已成功保存！' : 'Saved!')}>{t.projSaveBtn}</button>
                  </div>
                </div>

                {/* 最近工作区列表 */}
                <div className="card-bento">
                  <div className="card-title-row">
                    <Icon name="history" className="card-title-icon" style={{ marginRight: '6px' }} />
                    <span className="card-title-text">{t.projHistoryTitle}</span>
                  </div>

                  <div className="list-rows-container">
                    <div className="list-row-item">
                      <div className="list-row-item-left">
                        <Icon name="folder" className="list-row-icon" />
                        <div>
                          <span className="list-row-title">ForgeOne Core</span>
                          <span className="list-row-subtitle">~/projects/forgeone</span>
                        </div>
                      </div>
                      <span className="status-pill success">{t.projStatusActive}</span>
                    </div>

                    <div className="list-row-item" style={{ cursor: 'pointer' }} onClick={() => setProjectRoot('~/projects/etl-pipe')}>
                      <div className="list-row-item-left">
                        <Icon name="folder" className="list-row-icon" />
                        <div>
                          <span className="list-row-title">Data Pipeline</span>
                          <span className="list-row-subtitle">~/projects/etl-pipe</span>
                        </div>
                      </div>
                    </div>

                    <div className="list-row-item" style={{ cursor: 'pointer' }} onClick={() => setProjectRoot('~/workspace/frontend')}>
                      <div className="list-row-item-left">
                        <Icon name="folder" className="list-row-icon" />
                        <div>
                          <span className="list-row-title">React WebApp</span>
                          <span className="list-row-subtitle">~/workspace/frontend</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 模型面板 */}
        {activeTab === 'model' && (
          <div className="canvas">
            <div className="canvas-container">
              <div className="page-header">
                <div>
                  <h2 className="page-header-title">{t.modelTitle}</h2>
                  <p className="page-header-subtitle">{t.modelSub}</p>
                </div>
                <div style={{ display: 'flex', gap: '12px' }}>
                  <button className="btn-secondary" onClick={() => alert(lang === 'zh' ? '已撤销修改' : 'Discarded')}>{t.modelDiscardBtn}</button>
                  <button className="btn-primary" onClick={() => alert(lang === 'zh' ? '已成功保存配置！' : 'Saved!')}>{t.modelSaveBtn}</button>
                </div>
              </div>

              <div className="grid-bento">
                <div className="card-bento bento-span-2">
                  <div className="card-title-row">
                    <Icon name="api" className="card-title-icon" style={{ marginRight: '6px' }} />
                    <span className="card-title-text">{t.modelProviderCard}</span>
                  </div>

                  <div className="form-group">
                    <label className="form-label">{t.modelSelectLabel}</label>
                    <div className="provider-grid">
                      <div 
                        className={`provider-option-card ${activeProvider === 'OpenAI' ? 'active' : ''}`}
                        onClick={() => { setActiveProvider('OpenAI'); setBaseUrl('https://api.openai.com/v1'); setDefaultModel('gpt-4o'); }}
                      >
                        OpenAI
                      </div>
                      <div 
                        className={`provider-option-card ${activeProvider === 'Anthropic' ? 'active' : ''}`}
                        onClick={() => { setActiveProvider('Anthropic'); setBaseUrl('https://api.anthropic.com/v1'); setDefaultModel('claude-3-5-sonnet'); }}
                      >
                        Anthropic
                      </div>
                      <div 
                        className={`provider-option-card ${activeProvider === 'Local' ? 'active' : ''}`}
                        onClick={() => { setActiveProvider('Local'); setBaseUrl('http://localhost:11434/v1'); setDefaultModel('llama3'); }}
                      >
                        Local / Ollama
                      </div>
                    </div>
                  </div>

                  <div className="form-group">
                    <label className="form-label">{t.modelKeyLabel}</label>
                    <div style={{ position: 'relative' }}>
                      <input 
                        type={showApiKey ? 'text' : 'password'} 
                        className="form-input-text"
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                      />
                      <button 
                        type="button"
                        style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--on-surface-variant)', display: 'flex', alignItems: 'center' }}
                        onClick={() => setShowApiKey(!showApiKey)}
                      >
                        <Icon name={showApiKey ? 'visibility_off' : 'visibility'} style={{ fontSize: '18px' }} />
                      </button>
                    </div>
                  </div>

                  <div className="form-group">
                    <label className="form-label">{t.modelUrlLabel}</label>
                    <input 
                      type="text" 
                      className="form-input-text" 
                      value={baseUrl}
                      onChange={(e) => setBaseUrl(e.target.value)}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">{t.modelDefaultSelect}</label>
                    <select 
                      className="form-select"
                      value={defaultModel}
                      onChange={(e) => setDefaultModel(e.target.value)}
                    >
                      {activeProvider === 'OpenAI' && (
                        <>
                          <option value="gpt-4o">gpt-4o</option>
                          <option value="gpt-4-turbo">gpt-4-turbo</option>
                          <option value="gpt-3.5-turbo">gpt-3.5-turbo</option>
                        </>
                      )}
                      {activeProvider === 'Anthropic' && (
                        <>
                          <option value="claude-3-5-sonnet">claude-3-5-sonnet</option>
                          <option value="claude-3-opus">claude-3-opus</option>
                        </>
                      )}
                      {activeProvider === 'Local' && (
                        <>
                          <option value="llama3">llama3</option>
                          <option value="qwen2">qwen2</option>
                          <option value="mistral">mistral</option>
                        </>
                      )}
                    </select>
                  </div>
                </div>

                {/* 右侧超参数 */}
                <div className="card-bento" style={{ gap: '20px' }}>
                  <div className="card-title-row">
                    <Icon name="tune" className="card-title-icon" style={{ marginRight: '6px' }} />
                    <span className="card-title-text">{t.modelParamsCard}</span>
                  </div>

                  <div>
                    <div className="slider-group-header">
                      <label className="form-label" style={{ marginBottom: 0 }}>{t.modelTempLabel}</label>
                      <span className="slider-value-display">{temperature}</span>
                    </div>
                    <input 
                      type="range" 
                      className="range-slider-input" 
                      min="0" 
                      max="2" 
                      step="0.1" 
                      value={temperature}
                      onChange={(e) => setTemperature(parseFloat(e.target.value))}
                    />
                    <div className="slider-labels-row">
                      <span>{t.modelPrecise}</span>
                      <span>{t.modelCreative}</span>
                    </div>
                  </div>

                  <div>
                    <div className="slider-group-header">
                      <label className="form-label" style={{ marginBottom: 0 }}>{t.modelTopPLabel}</label>
                      <span className="slider-value-display">{topP}</span>
                    </div>
                    <input 
                      type="range" 
                      className="range-slider-input" 
                      min="0" 
                      max="1" 
                      step="0.05" 
                      value={topP}
                      onChange={(e) => setTopP(parseFloat(e.target.value))}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">{t.modelMaxTokensLabel}</label>
                    <input 
                      type="number" 
                      className="form-input-text" 
                      value={maxTokens}
                      onChange={(e) => setMaxTokens(parseInt(e.target.value) || 2048)}
                    />
                  </div>

                  <div className="switch-row" style={{ marginTop: '8px' }}>
                    <div>
                      <span className="switch-label-title">{t.modelTruncateTitle}</span>
                      <div className="switch-label-desc">{t.modelTruncateDesc}</div>
                    </div>
                    <div 
                      className={`switch-toggle-bg ${autoTruncate ? 'active' : ''}`}
                      onClick={() => setAutoTruncate(!autoTruncate)}
                    >
                      <div className="switch-toggle-dot" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* MCP 面板 */}
        {activeTab === 'mcp' && (
          <div className="canvas">
            <div className="canvas-container">
              <div className="page-header">
                <div>
                  <h2 className="page-header-title">{t.mcpTitle}</h2>
                  <p className="page-header-subtitle">{t.mcpSub}</p>
                </div>
                <button className="btn-primary" onClick={() => alert(lang === 'zh' ? '添加新数据源' : 'Add Source...')}>
                  <Icon name="add_link" />
                  {t.mcpAddBtn}
                </button>
              </div>

              {/* 看板 */}
              <div className="grid-bento mb-xl" style={{ marginBottom: '32px' }}>
                <div className="stat-box">
                  <div className="stat-header">
                    <span className="stat-label">{t.mcpActiveConn}</span>
                    <Icon name="cable" className="stat-icon" />
                  </div>
                  <div className="stat-value">{mcpSources.filter(s => s.status === 'connected').length} / {mcpSources.length}</div>
                  <div className="stat-meta">{t.mcpActiveDesc}</div>
                </div>

                <div className="stat-box">
                  <div className="stat-header">
                    <span className="stat-label">{t.mcpThroughput}</span>
                    <Icon name="swap_vert" className="stat-icon" />
                  </div>
                  <div className="stat-value">4.2 GB</div>
                  <div className="stat-meta">{t.mcpThroughputDesc}</div>
                </div>

                <div className="stat-box">
                  <div className="stat-header">
                    <span className="stat-label">{t.mcpHealth}</span>
                    <Icon name="check_circle" className="stat-icon" style={{ color: 'var(--success)' }} />
                  </div>
                  <div className="stat-value" style={{ color: 'var(--success)' }}>98.5%</div>
                  <div className="stat-meta">{t.mcpHealthDesc}</div>
                </div>
              </div>

              {/* 数据源列表 */}
              <div className="card-bento">
                <div className="card-title-row">
                  <Icon name="database" className="card-title-icon" style={{ marginRight: '6px' }} />
                  <span className="card-title-text">{t.mcpSourceCardTitle}</span>
                </div>

                <div className="list-rows-container">
                  {mcpSources.map(source => (
                    <div key={source.id} className="list-row-item">
                      <div className="list-row-item-left">
                        <Icon 
                          name={source.type.includes('Database') ? 'database' : source.type.includes('Vector') ? 'description' : 'api'} 
                          className="list-row-icon" 
                        />
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <span className="list-row-title">{source.name}</span>
                            <span className={`status-pill ${source.status === 'connected' ? 'success' : source.status === 'degraded' ? 'warning' : 'info'}`}>
                              {source.status === 'connected' ? (lang === 'zh' ? '已就绪' : 'Connected') : source.status === 'degraded' ? (lang === 'zh' ? '高延迟' : 'Degraded') : (lang === 'zh' ? '已暂停' : 'Paused')}
                            </span>
                          </div>
                          <span className="list-row-subtitle">{source.uri} • {lang === 'zh' ? '协议' : 'Type'}：{source.type} • {lang === 'zh' ? '权限' : 'Perms'}：{source.permission}</span>
                        </div>
                      </div>
                      <div className="list-row-actions">
                        <button className="btn-secondary" style={{ padding: '4px 10px', fontSize: '12px' }} onClick={() => alert(lang === 'zh' ? '打开配置' : 'Configuring...')}>{t.mcpConfigureBtn}</button>
                        <button 
                          className="row-action-btn btn-delete" 
                          onClick={() => setMcpSources(prev => prev.filter(s => s.id !== source.id))}
                        >
                          <Icon name="delete" style={{ fontSize: '18px' }} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 技能面板 */}
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
                    {tracesList.map(item => (
                      <div 
                        key={item.session_id} 
                        className={`list-row-item ${selectedSessionId === item.session_id ? 'bg-surface-low' : ''}`}
                        style={{ cursor: 'pointer', flexDirection: 'column', alignItems: 'stretch' }}
                        onClick={() => handleSelectHistory(item.session_id)}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span className="list-row-title" style={{ maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.task_input}</span>
                          <span className={`status-pill ${item.status === 'completed' ? 'success' : 'warning'}`}>
                            {item.status === 'completed' ? (lang === 'zh' ? '完成' : 'Done') : (lang === 'zh' ? '挂起' : 'Pending')}
                          </span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--on-surface-variant)', marginTop: '6px' }}>
                          <span>ID: {item.session_id.substring(0, 10)}...</span>
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

                  {messages.length > 0 && messages[1] && messages[1].trace && messages[1].trace.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      <div className="info-banner">
                        <Icon name="info" className="info-banner-icon" />
                        <div className="info-banner-text">{t.traceBannerText}</div>
                      </div>

                      <div className="trace-logs-list custom-scrollbar" style={{ maxHeight: '450px', backgroundColor: '#fdfdfd' }}>
                        {messages[1].trace.map((evt, idx) => (
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
    </div>
  );
}
