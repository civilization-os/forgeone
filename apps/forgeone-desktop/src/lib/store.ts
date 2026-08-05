/**
 * 标准桌面存储层：优先 Tauri app_config_dir 文件（Windows: %APPDATA%/com.forgeone.desktop），
 * 无 Tauri 环境（纯浏览器）时降级 localStorage。
 *
 * 数据与 WebView origin 解耦：打包版与 dev 模式共享同一份文件数据。
 * 启动时调用 load() 把文件数据载入内存缓存；旧 localStorage 数据在
 * load() 时自动迁移到文件（一次性）。
 */

const STORE_KEYS = [
  'forgeone_custom_projects_v2',
  'forgeone_sessions_v1',
  'forgeone_model_providers_v5',
] as const

let cache = new Map<string, string | null>()
let loadPromise: Promise<void> | null = null

function hasTauri(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!(window as any).__TAURI_INTERNALS__?.invoke
  )
}

async function tauriGet(key: string): Promise<string | null> {
  const value = await (window as any).__TAURI_INTERNALS__.invoke('store_read', { key })
  return value as string | null
}

async function tauriSet(key: string, value: string): Promise<void> {
  await (window as any).__TAURI_INTERNALS__.invoke('store_write', { key, value })
}

async function tauriRemove(key: string): Promise<void> {
  await (window as any).__TAURI_INTERNALS__.invoke('store_remove', { key })
}

/** 载入全部已知 key 到内存缓存。
 *
 * 迁移规则：localStorage 中若存在旧数据（同 origin 的 v4/v5 时代遗留），
 * 一次性迁移覆盖到文件存储并清理 localStorage——确保旧版打包用户的数据
 * 能救回，且此后 dev/打包版共享同一份文件数据。
 */
export function load(): Promise<void> {
  if (loadPromise) return loadPromise
  loadPromise = (async () => {
    for (const key of STORE_KEYS) {
      let value: string | null = null
      if (hasTauri()) {
        try {
          value = await tauriGet(key)
        } catch (e) {
          console.warn(`[store] 读取 ${key} 失败:`, e)
          value = null
        }
      }
      // localStorage 旧数据 → 迁移覆盖文件（一次性，随后清理，避免反复覆盖新数据）。
      // 顺序保证：先成功写入文件/降级存储，再清理 localStorage，避免写失败丢数据。
      const legacy = localStorage.getItem(key)
      if (legacy !== null) {
        let written = false
        if (hasTauri()) {
          try {
            await tauriSet(key, legacy)
            written = true
          } catch (e) {
            console.warn(`[store] 迁移 ${key} 到文件失败:`, e)
          }
        } else {
          try {
            localStorage.setItem(key, legacy)
            written = true
          } catch {
            /* ignore */
          }
        }
        if (written) {
          try {
            localStorage.removeItem(key)
          } catch {
            /* ignore */
          }
          value = legacy
        }
      }
      cache.set(key, value)
    }
  })()
  return loadPromise
}

/** 同步读取（缓存优先；缓存未就绪时回退 localStorage） */
export function getSync<T = unknown>(key: string): T | null {
  if (cache.has(key)) {
    const raw = cache.get(key)
    if (raw === null || raw === undefined) return null
    try {
      return JSON.parse(raw) as T
    } catch {
      return null
    }
  }
  const legacy = localStorage.getItem(key)
  if (legacy === null) return null
  try {
    return JSON.parse(legacy) as T
  } catch {
    return null
  }
}

/** 同步写缓存 + 异步持久化到文件（无 Tauri 时写 localStorage） */
export function setSync(key: string, value: unknown): void {
  const raw = JSON.stringify(value)
  cache.set(key, raw)
  if (hasTauri()) {
    tauriSet(key, raw).catch((e) => console.warn(`[store] 写入 ${key} 失败:`, e))
  } else {
    try {
      localStorage.setItem(key, raw)
    } catch (e) {
      console.warn(`[store] localStorage 写入 ${key} 失败:`, e)
    }
  }
}

/** 删除：清缓存 + 文件/localStorage */
export function removeSync(key: string): void {
  cache.delete(key)
  if (hasTauri()) {
    tauriRemove(key).catch((e) => console.warn(`[store] 删除 ${key} 失败:`, e))
  }
  try {
    localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}
