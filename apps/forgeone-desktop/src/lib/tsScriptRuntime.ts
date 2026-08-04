/**
 * TS 脚本驱动运行时：浏览器内转译 TS → JS 并执行（sucrase）。
 * 脚本契约：导出 async function runModel(params)，见 tsScriptDemos.ts 注释。
 */
import { transform } from 'sucrase'

export interface TsScriptRunParams {
  model: string
  baseUrl: string
  messages: { role: string; content: string }[]
  onDelta: (text: string, reasoning?: string) => void
  signal?: AbortSignal
}

/** 转译 TS 源码为 JS（sucrase：剥离类型 + 转换 ESM export/import 为 CommonJS） */
export function transpileTs(source: string): string {
  return transform(source, {
    transforms: ['typescript', 'imports'],
    production: true,
  }).code
}

/** 执行 TS 脚本并调用其 runModel（或 default）导出 */
export async function runTsScript(source: string, params: TsScriptRunParams): Promise<void> {
  const js = transpileTs(source)
  const exportsObj: Record<string, any> = {}
  const moduleObj = { exports: exportsObj }
  // sucrase 会把 `export async function runModel` 转成 `exports.runModel = ...`
  const factory = new Function(
    'module',
    'exports',
    'require',
    js +
      '\n;return (exports.runModel || exports.default || module.exports.runModel || module.exports.default);'
  )
  let runModel: any
  try {
    runModel = factory(moduleObj, exportsObj, undefined)
  } catch (e: any) {
    throw new Error(`TS 脚本编译/加载失败: ${e?.message || e}`)
  }
  if (typeof runModel !== 'function') {
    throw new Error('TS 脚本必须导出 runModel 或 default 异步函数')
  }
  await runModel(params)
}

/** 执行 TS 脚本的可选 listModels 导出，获取可用模型列表（脚本未导出时返回空数组） */
export async function listModelsFromTsScript(
  source: string,
  baseUrl: string
): Promise<{ id: string; name: string }[]> {
  const js = transpileTs(source)
  const exportsObj: Record<string, any> = {}
  const moduleObj = { exports: exportsObj }
  const factory = new Function(
    'module',
    'exports',
    'require',
    js + '\n;return (exports.listModels || module.exports.listModels);'
  )
  let listModels: any
  try {
    listModels = factory(moduleObj, exportsObj, undefined)
  } catch {
    return []
  }
  if (typeof listModels !== 'function') return []
  const result = await listModels({ baseUrl })
  return Array.isArray(result) ? result : []
}
