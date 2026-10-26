/**
 * 启动前的历史用量投影：把 dsh-usage 的 `/api/dsh-usage/overview` 读成 today 与 all 两个历史窗口。
 *
 * 实时订阅之前发生的调用不在本插件的账本里，这里只取两份合计与它们的边界，供 today 与 all 并进读数。
 * 历史不提供会话 id、最近调用与逐点趋势：后两项只来自实时事件，快照里也因此不出现完整的会话 id。
 *
 * 读失败只让历史这一层退出（D11）：实时订阅照旧建立，来源状态写进读数的 `history`，卡片据此区分
 * 没装、读不到与形状不合格这三种情形。
 */
import type { HostWebServer } from '@dsh-widget-board/contracts'
import { webServerOf } from '@dsh-widget-board/contracts'
import { isRecord } from './guards'
import type { SessionUsageScope } from './session-usage'

/** 历史上游的名字；读数里 `history.source` 写的就是它。 */
export const USAGE_HISTORY_SOURCE = 'dsh-usage'

/** dsh-usage 的 overview 路由；完整地址由宿主根地址拼出。 */
export const USAGE_HISTORY_PATH = '/api/dsh-usage/overview'

/** 启动时等这次请求的上限：等不到就按不可用记，不让启动停在一次网络请求上。 */
export const USAGE_HISTORY_TIMEOUT_MS = 2_000

/** 历史窗口的日期边界，与宿主本地日期同一种写法。 */
const HISTORY_DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/

/** 历史读不到的原因：没装这个插件、装了但读不到、答出来的形状不合格。 */
export type UsageHistoryReason = 'not-installed' | 'unavailable' | 'invalid'

/** 一个历史窗口的合计，四个分桶互不重叠。 */
export interface UsageHistoryTally {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  total: number
  calls: number
}

/** 一个历史窗口：边界与合计。`today` 的两端都是同一天。 */
export interface UsageHistoryWindow {
  from: string | null
  to: string | null
  tally: UsageHistoryTally
}

/**
 * 启动时取到的历史投影：来源状态加两份窗口。
 *
 * 两份合计留在这里；输出的 `history` 只保留来源元数据，卡片按窗口各取一份，不重复携带另一份。
 */
export interface UsageHistoryProjection {
  available: boolean
  reason: UsageHistoryReason | null
  capturedAt: number | null
  today: UsageHistoryWindow | null
  all: UsageHistoryWindow | null
}

/** 输出给卡片的来源元数据；字段与共享契约逐字一致，没有两个窗口的合计。 */
export interface SessionUsageHistory {
  source: 'dsh-usage'
  available: boolean
  reason: UsageHistoryReason | null
  capturedAt: number | null
  from: string | null
  to: string | null
}

/** 取回来的响应只需要状态码与正文：其余头与字段都用不到。 */
export interface UsageHistoryResponse {
  status: number
  ok: boolean
  json(): Promise<unknown>
}

/** 发一次探询请求；测试替身照这个形状写。 */
export type UsageHistoryFetch = (url: string, init: { signal: AbortSignal }) => Promise<UsageHistoryResponse>

/** 读历史要的两件事：宿主根地址，以及可替换的请求。 */
export interface UsageHistoryDeps {
  /** 宿主自己的根地址，例如 `http://127.0.0.1:3080`；拿不到时是 `undefined`。 */
  origin: () => string | undefined
  /** 发一次请求；省略时用全局 `fetch`。 */
  fetch?: UsageHistoryFetch
  /** 等这次请求的上限，毫秒；省略时是 {@link USAGE_HISTORY_TIMEOUT_MS}。 */
  timeoutMs?: number
}

/** 全局 `fetch`：在调用时取，测试替换全局时生效。 */
const defaultFetch: UsageHistoryFetch = (url, init) =>
  (globalThis as unknown as { fetch: UsageHistoryFetch }).fetch(url, init)

/**
 * 宿主自己的根地址；没有 web 服务、或宿主还没绑上端口时是 `undefined`。
 *
 * `getOrigin()` 在端口绑定之前抛出，这里捕获它只为了把这一类缺席说成「历史读不到」：拿不到根地址
 * 不是这次注册的失败，实时订阅照旧建立，卡片上会写清历史不可用（D11）。
 *
 * @param context - 宿主交给插件 `apply` 的上下文。
 * @returns 根地址，或 `undefined`。
 */
export function hostOriginOf(context: unknown): string | undefined {
  const server = webServerOf(context) as HostWebServer | undefined
  if (server === undefined || typeof server.getOrigin !== 'function') return undefined
  try {
    return server.getOrigin()
  } catch {
    return undefined
  }
}

/** 一份空合计。 */
function emptyTally(): UsageHistoryTally {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, calls: 0 }
}

/** 把一份合计加进另一份。 */
function addTally(target: UsageHistoryTally, source: UsageHistoryTally): void {
  target.input += source.input
  target.output += source.output
  target.cacheRead += source.cacheRead
  target.cacheWrite += source.cacheWrite
  target.total += source.total
  target.calls += source.calls
}

/** 读不到的历史：只有来源状态，两个窗口都没有。 */
export function historyFailure(reason: UsageHistoryReason): UsageHistoryProjection {
  return { available: false, reason, capturedAt: null, today: null, all: null }
}

/** 一个非负有限数字字段；不合格时是 `null`。 */
function bucket(value: Record<string, unknown>, key: string): number | null {
  const field = value[key]
  if (typeof field !== 'number' || !Number.isFinite(field) || field < 0) return null
  return field
}

/**
 * overview 里的一份 totals：四个分桶与调用次数都得是数字。
 *
 * 合计按 inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens 算，与实时账本同一口径；
 * 宿主自己折的 `cost` 不读。
 */
function tallyOf(value: unknown): UsageHistoryTally | null {
  if (!isRecord(value)) return null
  const input = bucket(value, 'inputTokens')
  const output = bucket(value, 'outputTokens')
  const cacheRead = bucket(value, 'cacheReadTokens')
  const cacheWrite = bucket(value, 'cacheWriteTokens')
  const calls = bucket(value, 'calls')
  if (input === null || output === null || cacheRead === null || cacheWrite === null || calls === null) return null
  return { input, output, cacheRead, cacheWrite, total: input + output + cacheRead + cacheWrite, calls }
}

/** 一个日期边界：`YYYY-MM-DD` 才留下，其它一律当作没有边界。 */
function dateOf(value: unknown): string | null {
  return typeof value === 'string' && HISTORY_DATE.test(value) ? value : null
}

/** 一个带边界与合计的窗口，例如 `usage.all` 与 `usage.range`。 */
function windowOf(value: unknown): UsageHistoryWindow | null {
  if (!isRecord(value)) return null
  const tally = tallyOf(value.totals)
  if (tally === null) return null
  return { from: dateOf(value.from), to: dateOf(value.to), tally }
}

/** 退回 `usage.days` 求和：边界取其中最早与最晚的那一天。 */
function daysWindow(value: unknown): UsageHistoryWindow | null {
  if (!Array.isArray(value)) return null
  const window: UsageHistoryWindow = { from: null, to: null, tally: emptyTally() }
  for (const item of value) {
    if (!isRecord(item)) return null
    const date = dateOf(item.date)
    const tally = tallyOf(item.totals)
    if (date === null || tally === null) return null
    addTally(window.tally, tally)
    if (window.from === null || date < window.from) window.from = date
    if (window.to === null || date > window.to) window.to = date
  }
  return window
}

/**
 * 把 overview 折成历史投影。
 *
 * `usage.today` 与 `updatedAt` 是关键形状：缺了它们整份文档都判不合格。`all` 按 all、range、
 * days 求和的次序退，三者都没有时才判不合格。
 *
 * @param body - 响应正文。
 * @returns 历史投影。
 */
function projectHistory(body: unknown): UsageHistoryProjection {
  if (!isRecord(body)) return historyFailure('invalid')
  const capturedAt = body.updatedAt
  if (typeof capturedAt !== 'number' || !Number.isFinite(capturedAt) || capturedAt < 0) return historyFailure('invalid')
  const usage = body.usage
  if (!isRecord(usage)) return historyFailure('invalid')
  const today = usage.today
  if (!isRecord(today)) return historyFailure('invalid')
  const date = dateOf(today.date)
  const todayTally = tallyOf(today.totals)
  if (date === null || todayTally === null) return historyFailure('invalid')
  const all = windowOf(usage.all) ?? windowOf(usage.range) ?? daysWindow(usage.days)
  if (all === null) return historyFailure('invalid')
  return {
    available: true,
    reason: null,
    capturedAt,
    today: { from: date, to: date, tally: todayTally },
    all,
  }
}

/**
 * 读一次历史投影；任何失败都折成一份带原因的不可用投影，不抛出。
 *
 * 401 与 404 都是「这个部署没装 dsh-usage」：它的 overview 对 loopback 请求一律放行，装上之后不会对
 * 这个地址答 401，没装时宿主自己的兜底鉴权先回 401、带页面 token 的路径回 404。其它 HTTP 失败与网络
 * 失败是「装了但读不到」（403 是被拒绝，同样归这一类）；正文不是 JSON 或缺关键字段是「形状不合格」。
 * 几种情形的区别只在卡片上的说法，都在这里定死。
 *
 * @param deps - 宿主根地址与请求。
 * @returns 历史投影。
 */
export async function readUsageHistory(deps: UsageHistoryDeps): Promise<UsageHistoryProjection> {
  const origin = deps.origin()
  if (origin === undefined) return historyFailure('unavailable')
  const fetcher = deps.fetch ?? defaultFetch
  const timeoutMs = deps.timeoutMs ?? USAGE_HISTORY_TIMEOUT_MS
  let response: UsageHistoryResponse
  try {
    response = await fetcher(origin + USAGE_HISTORY_PATH, { signal: AbortSignal.timeout(timeoutMs) })
  } catch {
    // 网络失败（宿主还没起、端口已经关掉、超时）只说明历史这一路读不到；实时订阅不依赖它，照旧建立（D11）。
    return historyFailure('unavailable')
  }
  if (response.status === 401 || response.status === 404) return historyFailure('not-installed')
  if (!response.ok) return historyFailure('unavailable')
  let body: unknown
  try {
    body = await response.json()
  } catch {
    // 正文不是 JSON：形状不合格，同样只隔离历史这一层（D11）。
    return historyFailure('invalid')
  }
  return projectHistory(body)
}

/**
 * 输出给卡片的来源元数据。
 *
 * `session` 窗口不合并历史，这里给 `null`；today 与 all 总是给一个对象，读数里因此始终能读出这份
 * 历史到底是可用、没装、读不到还是形状不合格。
 *
 * @param projection - 启动时取到的历史投影；没有取过时是 `null`。
 * @param scope - 卡片的窗口。
 * @returns 来源元数据，或 `null`。
 */
export function historyOf(
  projection: UsageHistoryProjection | null,
  scope: SessionUsageScope,
): SessionUsageHistory | null {
  if (scope === 'session') return null
  if (projection === null || !projection.available) {
    return {
      source: USAGE_HISTORY_SOURCE,
      available: false,
      reason: projection === null ? 'unavailable' : projection.reason,
      capturedAt: null,
      from: null,
      to: null,
    }
  }
  const window = scope === 'today' ? projection.today : projection.all
  return {
    source: USAGE_HISTORY_SOURCE,
    available: true,
    reason: null,
    capturedAt: projection.capturedAt,
    from: window === null ? null : window.from,
    to: window === null ? null : window.to,
  }
}

/**
 * 所选窗口的历史合计；历史不可用、或这个窗口没有历史时是 `null`。
 *
 * @param projection - 启动时取到的历史投影。
 * @param scope - 卡片的窗口；`session` 永远没有历史。
 * @returns 合计，或 `null`。
 */
export function historyTallyOf(
  projection: UsageHistoryProjection | null,
  scope: SessionUsageScope,
): UsageHistoryTally | null {
  if (projection === null || !projection.available || scope === 'session') return null
  const window = scope === 'today' ? projection.today : projection.all
  return window === null ? null : window.tally
}
