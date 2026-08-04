/**
 * TS 脚本驱动内置示例：Ollama 流式接入（Demo，不引用任何本地文件）
 *
 * 接口契约：
 * 1. 必须导出 async function runModel(params) —— 对话/流式生成
 *    - model: 目标模型名（如 qwen2.5-coder:14b）
 *    - baseUrl: 模型服务地址（如 http://localhost:11434）
 *    - messages: { role: string; content: string }[]
 *    - onDelta(text, reasoning?): 流式增量回调（text 为回复正文，reasoning 为推理链）
 *    - signal?: AbortSignal（支持前端「停止」按钮中断）
 * 2. 可选导出 async function listModels(params) —— 获取可用模型列表
 *    - params: { baseUrl: string }
 *    - 返回: { id: string; name: string }[]（id 为模型名）
 */
export const TS_OLLAMA_DEMO_SCRIPT = `/**
 * ForgeOne TS 驱动 Demo：Ollama 流式接入
 * 编辑此脚本即可自定义鉴权 / 转发 / 后处理逻辑。
 */

export async function runModel({ model, baseUrl, messages, onDelta, signal }: any) {
  // 兜底：baseUrl 非 http 地址（旧脚本路径/手误）时回退默认 Ollama 服务
  const base = /^https?:\\/\\//i.test(baseUrl || '') ? baseUrl : 'http://localhost:11434'
  const baseClean = base.replace(/\\/+$/, '')

  // 模型名必须是真实存在的（通过「获取模型列表」填充）
  if (!model || model === 'custom-ts-script-driver' || model === 'TS Custom Driver') {
    throw new Error('未配置有效模型。请先点击「获取模型列表」拉取本机模型后再测试')
  }

  const url = baseClean + '/api/chat'
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: true }),
    signal,
  })
  if (!res.ok || !res.body) {
    // CORS / 网络不通时 fetch 本身会抛 TypeError，这里处理 HTTP 错误
    const detail = await res.text().catch(() => '')
    throw new Error('Ollama 请求失败: HTTP ' + res.status + (detail ? ' - ' + detail.slice(0, 120) : ''))
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\\n')
    buf = lines.pop() || ''
    for (const line of lines) {
      const t = line.trim()
      if (!t) continue
      try {
        const j = JSON.parse(t)
        if (j.error) throw new Error(j.error)
        if (j.message?.content) onDelta(j.message.content)
      } catch (e: any) {
        if (e instanceof SyntaxError) continue
        throw e
      }
    }
  }
}

/** 获取模型列表（Ollama /api/tags），供「获取模型列表」按钮自动填充 */
export async function listModels({ baseUrl }: any) {
  const base = /^https?:\\/\\//i.test(baseUrl || '') ? baseUrl : 'http://localhost:11434'
  const res = await fetch(base.replace(/\\/+$/, '') + '/api/tags')
  if (!res.ok) throw new Error('获取模型列表失败: HTTP ' + res.status)
  const data = await res.json()
  return (data.models || []).map((m: any) => ({ id: m.name, name: m.name }))
}
`
