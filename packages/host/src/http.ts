/**
 * 宿主代发的 HTTP 数据源（D6、D28）。
 *
 * 组件在沙箱里拿不到网络，地址写在组件的 manifest 里，由这里请求；返回的 JSON 原样交给卡片，怎么
 * 映射成界面由组件自己的脚本决定。这里做五件事：把 `{名字}` 换成卡片 props（或 props schema 的
 * 默认值）、只访问 `permissions.hosts` 里列出的主机、按 `auth` 把一项凭据拼进请求头、给响应加超时
 * 与大小上限、把每次请求记进这张卡的日志。
 *
 * 地址与主机都来自不可信的组件，所以回环、内网与 IP 字面量一律拒绝；跟随重定向会让检查过的主机
 * 失效，这里也直接拒绝重定向。凭据的值只在这一处被读出、拼进请求，既不进返回值也不进日志。
 */
import { isIP } from 'node:net'
import { HTTP_DATA_SOURCE } from '@dsh-widget-board/contracts'
import type {
  DataSourceRegistration,
  HostCredentials,
  InstanceFace,
  RequestLogEntry,
  WidgetManifest,
  WidgetRequest,
} from '@dsh-widget-board/contracts'
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
 * 取一个占位符在这一次请求里的值：卡片 props 优先，其次 props schema 的默认值。
 *
 * @param manifest - 组件的 manifest。
 * @param props - 这张卡的 props。
 * @param name - 占位符的名字。
 * @returns 字符串、数或布尔值。
 * @throws {Error} 两处都没有这个属性，或它的类型不适合拼进请求。
 */
function placeholderValue(manifest: WidgetManifest, props: Record<string, unknown>, name: string): string | number | boolean {
  const properties = (manifest.props as { properties?: Record<string, { default?: unknown }> } | undefined)?.properties ?? {}
  const value = props[name] ?? properties[name]?.default
  if (value === undefined || value === null) {
    throw new Error(`组件 ${manifest.id} 的请求里 {${name}} 在 props 与 props schema 的默认值里都没有`)
  }
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
    throw new Error(`组件 ${manifest.id} 的请求里 {${name}} 要是字符串、数或布尔值`)
  }
  return value
}

/**
 * 把地址模板换成这一次请求的地址。
 *
 * @param template - manifest 里的地址。
 * @param manifest - 组件的 manifest。
 * @param props - 这张卡的 props。
 * @returns 每个占位符都换好的地址。
 */
function fillUrl(template: string, manifest: WidgetManifest, props: Record<string, unknown>): string {
  return template.replace(PLACEHOLDER, (_match, name: string) => encodeURIComponent(String(placeholderValue(manifest, props, name))))
}

/**
 * 把请求体模板换成这一次请求的正文。
 *
 * 占位符按 JSON 文本替换：字符串带上转义，数与原样写，所以 `{"q":"{query}"}` 这种写法拼出来仍是
 * 合法的 JSON。
 *
 * @param template - manifest 里的请求体。
 * @param manifest - 组件的 manifest。
 * @param props - 这张卡的 props。
 * @returns 填好的请求体。
 */
function fillBody(template: string, manifest: WidgetManifest, props: Record<string, unknown>): string {
  return template.replace(PLACEHOLDER, (_match, name: string) => {
    const value = placeholderValue(manifest, props, name)
    return typeof value === 'string' ? JSON.stringify(value).slice(1, -1) : String(value)
  })
}

/**
 * 把 manifest 里的地址换好并检查协议、主机许可与内网限制。
 *
 * @param manifest - 组件的 manifest。
 * @param props - 这张卡的 props。
 * @returns 可以交给 fetch 的地址。
 * @throws {Error} 没有声明地址、占位符取不到值、地址不合法、主机没获准或指向内网。
 */
export function requestUrlOf(manifest: WidgetManifest, props: Record<string, unknown>): string {
  const template = manifest.request?.url
  if (template === undefined) throw new Error(`组件 ${manifest.id} 没有声明 request.url，http 数据源不知道要请求哪里`)
  let parsed: URL
  try {
    parsed = new URL(fillUrl(template, manifest, props))
  } catch (error) {
    if (error instanceof TypeError) throw new Error(`组件 ${manifest.id} 的 request.url 不是合法的地址：${template}`)
    throw error
  }
  if (parsed.protocol !== 'https:') throw new Error(`组件 ${manifest.id} 的 request.url 只能是 https 地址：${parsed.href}`)
  const hosts = manifest.permissions?.hosts ?? []
  if (!hosts.some((host) => host.toLowerCase() === parsed.hostname.toLowerCase())) {
    throw new Error(`组件 ${manifest.id} 要请求 ${parsed.hostname}，这个主机没有写在 permissions.hosts 里`)
  }
  if (privateHost(parsed.hostname)) throw new Error(`组件 ${manifest.id} 要请求的主机 ${parsed.hostname} 只在本机或内网可达`)
  return parsed.href
}

/**
 * 按 `auth` 把一项凭据拼进请求头。
 *
 * @param manifest - 组件的 manifest。
 * @param request - 这次请求的声明。
 * @param credentials - 宿主的凭据服务；缺席时是 `undefined`。
 * @returns 要附加的请求头。
 * @throws {Error} 声明的凭据不在 manifest 里、没有凭据服务、这一项还没有配置，或用 `header` 方式却没写头名。
 */
export async function authHeadersOf(
  manifest: WidgetManifest,
  request: WidgetRequest,
  credentials: HostCredentials | undefined,
): Promise<Record<string, string>> {
  const auth = request.auth
  if (auth === undefined) return {}
  if (manifest.credentials?.some((entry) => entry.ref === auth.credential) !== true) {
    throw new Error(`组件 ${manifest.id} 要把 ${auth.credential} 附在请求上，但它没有在 credentials 里声明这一项`)
  }
  if (credentials === undefined) throw new Error(`组件 ${manifest.id} 要附上 ${auth.credential}，但宿主没有凭据服务`)
  const resolved = await credentials.resolve(auth.credential)
  if (resolved === undefined) throw new Error(`组件 ${manifest.id} 的凭据 ${auth.credential} 还没有配置`)
  const value = resolved.value
  if (auth.scheme === 'bearer') return { authorization: `Bearer ${value}` }
  if (auth.scheme === 'basic') return { authorization: `Basic ${Buffer.from(value, 'utf8').toString('base64')}` }
  if (auth.header === undefined) throw new Error(`组件 ${manifest.id} 用 header 方式附 ${auth.credential}，要写明写入哪个请求头`)
  return { [auth.header]: value }
}

/**
 * 请求一次并读回 JSON。
 *
 * 响应正文边读边数：来自外部的响应可能比上限大得多，不先整份读进内存再判断。
 *
 * @param response - 已经确认是 2xx 的响应。
 * @param host - 回应这条请求的主机，出错的说明里用它。
 * @returns 解析出来的值。
 * @throws {Error} 没有正文、正文超出上限或不是 JSON。
 */
export async function readJsonBody(response: Response, host: string): Promise<unknown> {
  const body = response.body
  if (body === null) throw new Error(`请求 ${host} 没有响应正文`)
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
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Error(`请求 ${host} 返回的不是 JSON`)
  }
}

/** 请求时能换掉的几样东西：网络、缓存、时钟、凭据与日志。 */
export interface HttpRequestOptions {
  fetch?: FetchLike
  cache?: HttpCache
  now?: () => number
  /** 取宿主的凭据服务；`auth` 用到时才调用。 */
  credentials?: () => HostCredentials | undefined
  /** 记一条请求日志；不传时不记。 */
  record?: (entry: RequestLogEntry) => void
}

/**
 * 请求一次并读回 JSON；`request.cacheMs` 大于零时先看缓存。
 *
 * @param manifest - 组件的 manifest。
 * @param props - 这张卡的 props。
 * @param options - 请求、缓存、时钟、凭据与日志的替身。
 * @returns 响应解析出来的值。
 * @throws {Error} 地址不合格、凭据没配好、请求失败、状态不是 2xx、正文超出上限或不是 JSON。
 */
export async function readHttpSource(
  manifest: WidgetManifest,
  props: Record<string, unknown>,
  options: HttpRequestOptions = {},
): Promise<unknown> {
  const request = manifest.request
  if (request === undefined) throw new Error(`组件 ${manifest.id} 没有声明 request，http 数据源不知道要请求哪里`)
  const url = requestUrlOf(manifest, props)
  const parsed = new URL(url)
  const host = parsed.hostname
  const method = request.method ?? 'GET'
  const now = options.now ?? Date.now
  const cacheMs = request.cacheMs ?? 0
  const cache = options.cache
  if (cacheMs > 0 && cache !== undefined && method === 'GET') {
    const hit = cache.get(url)
    if (hit !== undefined && now() - hit.at < cacheMs) return hit.value
  }

  const headers: Record<string, string> = { accept: 'application/json', ...request.headers }
  Object.assign(headers, await authHeadersOf(manifest, request, options.credentials?.()))
  const body = request.body === undefined || method === 'GET' || method === 'DELETE'
    ? undefined
    : fillBody(request.body, manifest, props)
  if (body !== undefined && headers['content-type'] === undefined) headers['content-type'] = 'application/json'

  const run = options.fetch ?? fetch
  const started = now()
  let response: Response
  try {
    response = await run(url, {
      method,
      headers,
      ...(body === undefined ? {} : { body }),
      redirect: 'error',
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    options.record?.({
      at: started,
      method,
      host,
      path: `${parsed.pathname}${parsed.search}`,
      status: 0,
      ms: now() - started,
      error: message,
    })
    throw new Error(`请求 ${host} 失败：${message}`)
  }
  options.record?.({
    at: started,
    method,
    host,
    path: `${parsed.pathname}${parsed.search}`,
    status: response.status,
    ms: now() - started,
    ...(response.ok ? {} : { error: `HTTP ${String(response.status)}` }),
  })
  if (!response.ok) throw new Error(`请求 ${host} 返回 ${String(response.status)}`)
  const value = await readJsonBody(response, host)
  if (cacheMs > 0 && cache !== undefined && method === 'GET') {
    cache.set(url, { value, at: now() })
    if (cache.size > HTTP_CACHE_ENTRIES) {
      const oldest = cache.keys().next().value
      if (oldest !== undefined) cache.delete(oldest)
    }
  }
  return value
}

/**
 * 建 `http` 数据源的注册项（D6）：按组件的 manifest 请求，结果原样交给卡片，每次请求记进这张卡的日志。
 *
 * @param records - 当前的组件库；热重载会换掉整张表，所以按函数取。
 * @param provider - 提供方包名。
 * @param apiVersion - 服务的版本。
 * @param extras - 凭据服务与记日志的位置。
 * @returns 可以交给数据源注册表的那一条。
 */
export function createHttpSource(
  records: () => ReadonlyMap<string, WidgetRecord>,
  provider: string,
  apiVersion: number,
  extras: { credentials?: () => HostCredentials | undefined, record?: (id: string, entry: RequestLogEntry) => void } = {},
): DataSourceRegistration {
  // 这份缓存跟着数据源活：同一个地址在 cacheMs 内被多张卡、多次打开读到，只请求一次。
  const cache: HttpCache = new Map()
  const record = extras.record
  return {
    apiVersion,
    provider,
    id: HTTP_DATA_SOURCE,
    async read(instance: InstanceFace): Promise<unknown> {
      const widget = records().get(instance.widget)
      if (widget === undefined) throw new Error(`组件 ${instance.widget} 不在组件库里，读不了 http 数据源`)
      return await readHttpSource(widget.manifest, instance.props, {
        cache,
        ...(extras.credentials === undefined ? {} : { credentials: extras.credentials }),
        ...(record === undefined ? {} : { record: (entry) => { record(instance.id, entry) } }),
      })
    },
  }
}
