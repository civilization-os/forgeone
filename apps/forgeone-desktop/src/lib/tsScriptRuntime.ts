/**
 * TS 脚本驱动运行时：浏览器内转译 TS → JS 并执行（sucrase）。
 * 脚本契约：导出 async function runModel(params)，见 tsScriptDemos.ts 注释。
 *
 * 模块加载：脚本内的 `import ... from '包名'`（静态或动态）都会被 sucrase 转成
 * CommonJS require。执行前先扫描源码收集 import 的包名，通过 esm.sh CDN
 * 预加载为 ESM 模块，再以同步 require 映射供脚本使用 —— 因此支持任意 npm 包
 * （由用户自行负责包的正确性；需要网络，离线/包不存在/加载失败会抛错提示）。
 */
import { transform } from 'sucrase'

export interface TsScriptRunParams {
  model: string
  baseUrl: string
  messages: { role: string; content: string }[]
  onDelta: (text: string, reasoning?: string) => void
  signal?: AbortSignal
  /** npm 包加载地址模板（{pkg} 占位），默认 https://esm.sh/{pkg} */
  npmUrlTemplate?: string
}

/** esm.sh CDN 前缀：把任意 npm 包名映射为可在浏览器加载的 ESM URL */
const DEFAULT_NPM_URL_TEMPLATE = 'https://esm.sh/{pkg}'

/** 模块级缓存：同一包只从 CDN 加载一次 */
const moduleCache = new Map<string, Promise<any>>()

/** 把模块命名空间整理成「命名导出 + default」都可用，且带 __esModule 标记的对象 */
function buildInteropModule(ns: any): any {
  if (!ns || typeof ns !== 'object') return { __esModule: true, default: ns }
  const d = ns.default !== undefined ? ns.default : ns
  const hasNamed = Object.keys(ns).length > 1
  const named = hasNamed ? ns : typeof d === 'object' && d !== null ? d : {}
  return { ...named, __esModule: true, default: d ?? named }
}

/** 从源码收集所有被 import 的模块说明符（支持静态/动态 import、import()、require()） */
export function collectModuleSpecifiers(source: string): string[] {
  const found = new Set<string>()
  // 1) 静态 import ... from 'x'  /  import 'x'  /  export ... from 'x'
  const staticRe = /\b(?:import|export)\s+(?:[\w*{}\s,]+?\s+from\s+)?['"]([^'"]+)['"]/g
  let m: RegExpExecArray | null
  while ((m = staticRe.exec(source))) {
    if (m[1]) found.add(m[1])
  }
  // 2) 动态 import('x')
  const dynamicRe = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  while ((m = dynamicRe.exec(source))) {
    if (m[1]) found.add(m[1])
  }
  // 3) 显式 require('x')
  const requireRe = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  while ((m = requireRe.exec(source))) {
    if (m[1]) found.add(m[1])
  }
  return [...found]
}

/**
 * 根据 URL 模板生成包加载地址：模板中的 {pkg} 会被替换为包名。
 * 支持用户自定义源（esm.sh / jsdelivr / unpkg / 自建代理等）。
 */
export function resolveNpmUrl(template: string | undefined, pkg: string): string {
  const tpl = (template && template.trim()) || DEFAULT_NPM_URL_TEMPLATE
  if (!tpl.includes('{pkg}')) {
    throw new Error(`npm 加载地址模板无效："${tpl}"（模板需包含 {pkg} 占位符，例如 https://esm.sh/{pkg}）`)
  }
  return tpl.replaceAll('{pkg}', pkg)
}

/** 校验并加载一个模块说明符；相对路径/内置模块不支持 */
async function loadModule(specifier: string, urlTemplate?: string): Promise<any> {
  const s = specifier.trim()
  if (!s) throw new Error('TS 脚本 import 了空模块名')
  if (s.startsWith('./') || s.startsWith('../') || s.startsWith('/')) {
    throw new Error(`TS 脚本不支持相对路径 import "${s}"（脚本为单文件运行，请使用 npm 包名）`)
  }
  if (s.startsWith('node:') || s.startsWith('http://') || s.startsWith('https://')) {
    throw new Error(`TS 脚本不支持 import "${s}"（请使用 npm 包名，例如 import axios from 'axios'）`)
  }
  const url = resolveNpmUrl(urlTemplate, s)
  let cached = moduleCache.get(url)
  if (!cached) {
    cached = import(/* @vite-ignore */ url).catch((e: any) => {
      moduleCache.delete(url)
      throw new Error(`加载 npm 包 "${s}" 失败: ${e?.message || e}（请检查包名是否正确、网络是否可用）`)
    })
    moduleCache.set(url, cached)
  }
  const ns = await cached
  return buildInteropModule(ns)
}

/** 预加载源码中所有 import 的包，返回同步 require 映射 */
async function buildRequireMap(source: string, urlTemplate?: string): Promise<(id: string) => any> {
  const specifiers = collectModuleSpecifiers(source)
  const entries = await Promise.all(specifiers.map(async (s) => [s, await loadModule(s, urlTemplate)] as const))
  const map = new Map(entries)
  return (id: string) => {
    const mod = map.get(id)
    if (mod === undefined) {
      // 代码执行路径里出现了扫描时未收集到的 require（理论上被覆盖）
      throw new Error(`TS 脚本加载 "${id}" 失败：未在 import 语句中声明`)
    }
    return mod
  }
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
  const requireFn = await buildRequireMap(source, params.npmUrlTemplate)
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
    runModel = factory(moduleObj, exportsObj, requireFn)
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
  baseUrl: string,
  npmUrlTemplate?: string
): Promise<{ id: string; name: string }[]> {
  // import 加载失败不吞错：让调用方看到真实原因（包不存在 / 网络不可用等）
  const requireFn = await buildRequireMap(source, npmUrlTemplate)
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
    listModels = factory(moduleObj, exportsObj, requireFn)
  } catch {
    return []
  }
  if (typeof listModels !== 'function') return []
  const result = await listModels({ baseUrl })
  return Array.isArray(result) ? result : []
}
