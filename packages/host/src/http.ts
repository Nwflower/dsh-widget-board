/**
 * 宿主代发的 HTTP 数据源（D6）。
 *
 * 组件在沙箱里拿不到网络，地址写在组件的 manifest 里，由这里请求；返回的 JSON 原样交给卡片，怎么
 * 映射成界面由组件自己的脚本决定。这里只做四件事：把 `{名字}` 换成卡片 props（或 props schema 的
 * 默认值）、只访问 `permissions.hosts` 里列出的主机、给响应加超时与大小上限、按 `request.cacheMs`
 * 缓存同一个地址的响应。
 *
 * 地址与主机都来自不可信的组件，所以回环、内网与 IP 字面量一律拒绝；跟随重定向会让检查过的主机
 * 失效，这里也直接拒绝重定向。
 */
import { isIP } from 'node:net'
import { HTTP_DATA_SOURCE } from '@dsh-widget-board/contracts'
import type { DataSourceRegistration, InstanceFace, WidgetManifest } from '@dsh-widget-board/contracts'
import type { WidgetRecord } from './library'

/** 一次请求最多等多久。 */
export const HTTP_TIMEOUT_MS = 10_000

/** 响应正文的上限：天气、行情这类数据远小于它，再大就是拿宿主的连接换组件的显示。 */
export const HTTP_BODY_LIMIT = 1_000_000

/** URL 里的属性占位符。 */
const PLACEHOLDER = /\{([a-zA-Z_][\w-]*)\}/g

/** 一份缓存下来的响应：解析出来的值与它存下来的时刻。 */
export interface HttpCacheEntry {
  value: unknown
  at: number
}

/** 按解析后的地址索引的响应缓存；一份宿主进程共用一张。 */
export type HttpCache = Map<string, HttpCacheEntry>

/** 缓存里最多留多少条：地址由组件给出，不能任它无限长。 */
export const HTTP_CACHE_ENTRIES = 64

/** 请求函数；测试里换成替身。 */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

/**
 * 主机是不是只在本机或内网可达。
 *
 * @param hostname - URL 的主机名。
 * @returns 是回环、内网名或 IP 字面量时为真。
 */
function privateHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.home.arpa')) return true
  return isIP(host) !== 0
}

/**
 * 把 manifest 里的地址模板换成这一次请求的地址。
 *
 * 占位符按卡片 props 取值；props 里没有时用 props schema 给这个属性写的默认值。换完之后再核对
 * 协议、主机许可与内网限制。
 *
 * @param manifest - 组件的 manifest。
 * @param props - 这张卡的 props。
 * @returns 可以交给 fetch 的地址。
 * @throws {Error} 没有声明地址、占位符取不到值、地址不合法、主机没获准或指向内网。
 */
export function requestUrlOf(manifest: WidgetManifest, props: Record<string, unknown>): string {
  const template = manifest.request?.url
  if (template === undefined) throw new Error(`组件 ${manifest.id} 没有声明 request.url，http 数据源不知道要请求哪里`)
  const properties = (manifest.props as { properties?: Record<string, { default?: unknown }> } | undefined)?.properties ?? {}
  const url = template.replace(PLACEHOLDER, (_match, name: string) => {
    const value = props[name] ?? properties[name]?.default
    if (value === undefined || value === null) {
      throw new Error(`组件 ${manifest.id} 的 request.url 里 {${name}} 在 props 与 props schema 的默认值里都没有`)
    }
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      throw new Error(`组件 ${manifest.id} 的 request.url 里 {${name}} 要是字符串、数或布尔值`)
    }
    return encodeURIComponent(String(value))
  })
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`组件 ${manifest.id} 的 request.url 不是合法的地址：${url}`)
  }
  if (parsed.protocol !== 'https:') throw new Error(`组件 ${manifest.id} 的 request.url 只能是 https 地址：${url}`)
  const hosts = manifest.permissions?.hosts ?? []
  if (!hosts.some((host) => host.toLowerCase() === parsed.hostname.toLowerCase())) {
    throw new Error(`组件 ${manifest.id} 要请求 ${parsed.hostname}，这个主机没有写在 permissions.hosts 里`)
  }
  if (privateHost(parsed.hostname)) throw new Error(`组件 ${manifest.id} 要请求的主机 ${parsed.hostname} 只在本机或内网可达`)
  return url
}

/**
 * 请求一次并读回 JSON；`request.cacheMs` 大于零时先看缓存。
 *
 * @param manifest - 组件的 manifest。
 * @param props - 这张卡的 props。
 * @param options - 请求、缓存与时钟的替身，测试用。
 * @returns 响应解析出来的值。
 * @throws {Error} 地址不合格、请求失败、状态不是 2xx、正文超出上限或不是 JSON。
 */
export async function readHttpSource(
  manifest: WidgetManifest,
  props: Record<string, unknown>,
  options: { fetch?: FetchLike, cache?: HttpCache, now?: () => number } = {},
): Promise<unknown> {
  const url = requestUrlOf(manifest, props)
  const host = new URL(url).hostname
  const cacheMs = manifest.request?.cacheMs ?? 0
  const cache = options.cache
  const now = options.now ?? Date.now
  if (cacheMs > 0 && cache !== undefined) {
    const hit = cache.get(url)
    if (hit !== undefined && now() - hit.at < cacheMs) return hit.value
  }
  const run = options.fetch ?? fetch
  let response: Response
  try {
    response = await run(url, {
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    })
  } catch (error) {
    throw new Error(`请求 ${host} 失败：${error instanceof Error ? error.message : String(error)}`)
  }
  if (!response.ok) throw new Error(`请求 ${host} 返回 ${String(response.status)}`)
  const body = response.body
  if (body === null) throw new Error(`请求 ${host} 没有响应正文`)
  // 边读边数：不先整份读进内存再判断，来自外部的响应可能比上限大得多。
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  let bytes = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > HTTP_BODY_LIMIT) {
        await reader.cancel()
        throw new Error(`请求 ${host} 的响应超过 ${String(HTTP_BODY_LIMIT)} 字节`)
      }
      text += decoder.decode(value, { stream: true })
    }
  } finally {
    reader.releaseLock()
  }
  text += decoder.decode()
  let value: unknown
  try {
    value = JSON.parse(text) as unknown
  } catch {
    throw new Error(`请求 ${host} 返回的不是 JSON`)
  }
  if (cacheMs > 0 && cache !== undefined) {
    cache.set(url, { value, at: now() })
    if (cache.size > HTTP_CACHE_ENTRIES) {
      const oldest = cache.keys().next().value
      if (oldest !== undefined) cache.delete(oldest)
    }
  }
  return value
}

/**
 * 建 `http` 数据源的注册项（D6）：按组件的 manifest 请求，结果原样交给卡片。
 *
 * @param records - 当前的组件库；热重载会换掉整张表，所以按函数取。
 * @param provider - 提供方包名。
 * @param apiVersion - 服务的版本。
 * @returns 可以交给数据源注册表的那一条。
 */
export function createHttpSource(
  records: () => ReadonlyMap<string, WidgetRecord>,
  provider: string,
  apiVersion: number,
): DataSourceRegistration {
  // 这份缓存跟着数据源活：同一个地址在 cacheMs 内被多张卡、多次打开读到，只请求一次。
  const cache: HttpCache = new Map()
  return {
    apiVersion,
    provider,
    id: HTTP_DATA_SOURCE,
    async read(instance: InstanceFace): Promise<unknown> {
      const record = records().get(instance.widget)
      if (record === undefined) throw new Error(`组件 ${instance.widget} 不在组件库里，读不了 http 数据源`)
      return await readHttpSource(record.manifest, instance.props, { cache })
    },
  }
}
