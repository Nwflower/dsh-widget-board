/**
 * 会话用量的实时聚合（issue #6）：订阅一次 `session/event`，把带用量的 `assistant/message` 记进内存，
 * 数据源按卡片 props 的窗口取一份快照交给组件。
 *
 * 只从注册这一刻开始累计：历史那段由用量能力按天折好（D24），这里的数字是「从插件启动起」。
 * 事件按会话 id 与 `event.seq` 去重——序号在会话内单调，重复投递的同一条事件只记一次。
 *
 * 内存里只有聚合与每个窗口最近的 30 个点，不落盘：这份数据只描述本次运行，宿主重启之后重新开始。
 * 卡片的数据按通用链路写入与推送，这里不碰状态、不发通知。
 */
import type {
  DataSourceRegistration,
  HostSessionEvent,
  HostSessionRef,
  HostSessions,
  HostTokenUsage,
  InstanceFace,
} from '@dsh-widget-board/contracts'
import { WIDGET_BOARD_API_VERSION, onSessionEvent, sessionsOf } from '@dsh-widget-board/contracts'
import { isRecord } from './guards'
import { localDate } from './local-date'
import type { Registries } from './sources'

/** 数据源的 id 与提供方：组件 manifest 里写成 `widget-board:session.usage`。 */
export const SESSION_USAGE_PROVIDER = 'widget-board'
export const SESSION_USAGE_SOURCE = 'session.usage'

/** 组件 manifest 里点名这个数据源时写的全名。 */
export const SESSION_USAGE_NAME = `${SESSION_USAGE_PROVIDER}:${SESSION_USAGE_SOURCE}`

/** 趋势的上限：所选窗口最近的这么多次调用。 */
export const SESSION_USAGE_TREND_POINTS = 30

/** 数据源回答的窗口。 */
export type SessionUsageScope = 'session' | 'today' | 'all'

/** 空态的两种原因。 */
export type SessionUsageEmpty = 'no-sessions' | 'no-usage'

/** 一个窗口里的合计。 */
export interface SessionUsageTotals {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  total: number
  calls: number
  /** 窗口里有没有调用缺了宿主的 `totalTokens`，按输入加输出推算。 */
  estimated: boolean
}

/** 窗口里最新的一次调用；会话是 id 的前 8 位。 */
export interface SessionUsageCall {
  at: number
  session: string | null
  input: number
  output: number
  total: number
  estimated: boolean
}

/** 趋势上的一个点：那一刻的规范化总量。 */
export interface SessionUsagePoint {
  at: number
  value: number
}

/** 数据源交给组件的一份快照；字段与值都是纯数据。 */
export interface SessionUsageSnapshot {
  available: boolean
  reason: string | null
  /** 本次注册实时订阅的时刻，Unix 毫秒。 */
  startedAt: number
  scope: SessionUsageScope
  /** 宿主本地时区的当天，YYYY-MM-DD。 */
  date: string
  /** 所选会话 id 的前 8 位；别的窗口与空态是 null。 */
  session: string | null
  empty: SessionUsageEmpty | null
  totals: SessionUsageTotals | null
  recent: SessionUsageCall | null
  trend: SessionUsagePoint[]
}

/** 一次调用记下来的那一行；会话保存完整 id，输出快照时才截短。 */
interface Call {
  at: number
  /** 这次调用是第几个收到的：同一毫秒里的两次调用靠它定新旧。 */
  order: number
  session: string
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  total: number
  estimated: boolean
}

/** 一份合计，读的时候复制进快照。 */
interface Tally {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  total: number
  calls: number
  estimated: boolean
}

/** 一个窗口：合计与它最近的调用，按时间从旧到新。 */
interface Window {
  tally: Tally
  recent: Call[]
}

/** 一个会话的窗口与去重水位。 */
interface SessionTally extends Window {
  /** 已经计过的最大序号；同一会话里更小的序号是重复投递。 */
  lastSeq: number
}

/** 这次运行的全部累计。 */
interface Ledger {
  startedAt: number
  sessions: Map<string, SessionTally>
  /** 全部会话的最近调用，供 `all` 窗口取趋势。 */
  recent: Call[]
  /** 每个本地自然日一份窗口；跨零点由读取时按当天取，写入按事件的本地日期分桶。 */
  days: Map<string, Window>
  /** 已经收下的调用数，用作到达次序：同一毫秒里的两次调用靠它定新旧。 */
  order: number
}

/** 一份空合计。 */
function emptyTally(): Tally {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, calls: 0, estimated: false }
}

/** 一个空窗口。 */
function emptyWindow(): Window {
  return { tally: emptyTally(), recent: [] }
}

/** 两个点的新旧：正数表示左边更新，时间相同才比到达次序。 */
function ordered(left: Call, right: Call): number {
  return left.at === right.at ? left.order - right.order : left.at - right.at
}

/**
 * 把一次调用按 (at, 到达次序) 插进最近点，超过上限时丢最旧的。
 *
 * 用插入而不是追加：事件按会话日志的次序到达，时间可能比已经收下的更早，而趋势要按 at 从旧到新。
 */
function pushPoint(points: Call[], point: Call): void {
  let index = points.length
  while (index > 0 && ordered(points[index - 1] as Call, point) > 0) index -= 1
  points.splice(index, 0, point)
  if (points.length > SESSION_USAGE_TREND_POINTS) points.shift()
}

/** 一个数字字段；缺的、不是有限数或负数的按 0 算。 */
function countOf(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0
  return value
}

/**
 * 一次调用的规范化总量：宿主给了 `totalTokens` 就用它，缺了按输入加输出推算并记下推算。
 *
 * @param usage - 事件里的用量样本。
 * @param input - 已经取出的输入分桶。
 * @param output - 已经取出的输出分桶。
 * @returns 总量与它是不是推算出来的。
 */
function normalizedTotal(usage: HostTokenUsage, input: number, output: number): { total: number, estimated: boolean } {
  const declared = usage.totalTokens
  if (typeof declared === 'number' && Number.isFinite(declared) && declared >= 0) return { total: declared, estimated: false }
  return { total: input + output, estimated: true }
}

/** 会话 id 的前 8 位：快照里只出现这一段，完整 id 只用来匹配。 */
function prefixOf(id: string): string {
  return id.slice(0, 8)
}

/** 事件交回的那一个会话 id；形状对不上时是 null。 */
function idOf(session: unknown): string | null {
  if (!isRecord(session) || typeof session.id !== 'string' || session.id === '') return null
  return session.id
}

/**
 * 一条事件里的用量结算；只认带 `usage` 的 `assistant/message`。
 *
 * 读的字段就是 contracts 里登记的那几个：消息正文、工具结果与会话标题一概不碰。
 *
 * @param event - 宿主广播的那条事件。
 * @returns 序号、时刻与用量样本；别的事件是 null。
 */
function settlementOf(event: unknown): { seq: number, time: number, usage: HostTokenUsage } | null {
  if (!isRecord(event) || event.type !== 'assistant/message') return null
  if (typeof event.seq !== 'number' || !Number.isFinite(event.seq)) return null
  if (typeof event.time !== 'number' || !Number.isFinite(event.time)) return null
  const data = event.data
  if (!isRecord(data) || !isRecord(data.usage)) return null
  return { seq: event.seq, time: event.time, usage: data.usage as unknown as HostTokenUsage }
}

/** 把一次调用加进一份合计。 */
function addTo(tally: Tally, point: Call): void {
  tally.input += point.input
  tally.output += point.output
  tally.cacheRead += point.cacheRead
  tally.cacheWrite += point.cacheWrite
  tally.total += point.total
  tally.calls += 1
  tally.estimated = tally.estimated || point.estimated
}

/** 只留最近的两天：读取时只按当天取，更早的日子不再用到。 */
function trimDays(ledger: Ledger): void {
  if (ledger.days.size <= 2) return
  const days = [...ledger.days.keys()].sort()
  for (const stale of days.slice(0, days.length - 2)) ledger.days.delete(stale)
}

/**
 * 记一条会话事件。
 *
 * @param ledger - 这次运行的累计。
 * @param session - 事件所属的会话。
 * @param event - 宿主广播的那条事件。
 */
function record(ledger: Ledger, session: unknown, event: unknown): void {
  const id = idOf(session)
  if (id === null) return
  const settlement = settlementOf(event)
  if (settlement === null) return
  // 日期算不出来（时刻超出 Date 的范围）就在写任何累计之前丢掉这一条：留下半份合计比丢掉更糟（D11）。
  const day = localDate(settlement.time)
  if (day === null) return
  const tally = ledger.sessions.get(id) ?? { tally: emptyTally(), recent: [], lastSeq: -1 }
  ledger.sessions.set(id, tally)
  if (settlement.seq <= tally.lastSeq) return
  tally.lastSeq = settlement.seq
  ledger.order += 1
  const input = countOf(settlement.usage.inputTokens)
  const output = countOf(settlement.usage.outputTokens)
  const { total, estimated } = normalizedTotal(settlement.usage, input, output)
  const point: Call = {
    at: settlement.time,
    order: ledger.order,
    session: id,
    input,
    output,
    cacheRead: countOf(settlement.usage.cacheReadTokens),
    cacheWrite: countOf(settlement.usage.cacheWriteTokens),
    total,
    estimated,
  }
  addTo(tally.tally, point)
  pushPoint(tally.recent, point)
  pushPoint(ledger.recent, point)
  const window = ledger.days.get(day) ?? emptyWindow()
  ledger.days.set(day, window)
  addTo(window.tally, point)
  pushPoint(window.recent, point)
  trimDays(ledger)
}

/** 全部会话的合计：也就是 `all` 窗口的总量。 */
function sumSessions(ledger: Ledger): Tally {
  const total = emptyTally()
  for (const session of ledger.sessions.values()) {
    total.input += session.tally.input
    total.output += session.tally.output
    total.cacheRead += session.tally.cacheRead
    total.cacheWrite += session.tally.cacheWrite
    total.total += session.tally.total
    total.calls += session.tally.calls
    total.estimated = total.estimated || session.tally.estimated
  }
  return total
}

/**
 * 最近有带用量调用的会话：比那个会话最近一次调用的 at，时间相同才比到达次序。
 *
 * 一个会话都没有调用时是 null。
 */
function latestSession(ledger: Ledger): string | null {
  let best: { id: string, at: number, order: number } | null = null
  for (const [id, tally] of ledger.sessions) {
    const last = tally.recent[tally.recent.length - 1]
    if (last === undefined) continue
    if (best === null || last.at > best.at || (last.at === best.at && last.order > best.order)) {
      best = { id, at: last.at, order: last.order }
    }
  }
  return best === null ? null : best.id
}

/** 卡片 props 里的窗口；没写或不认识时是 `session`。 */
function scopeOf(value: unknown): SessionUsageScope {
  return value === 'today' || value === 'all' ? value : 'session'
}

/**
 * 所选窗口；没有这个窗口时是 null。
 *
 * @param ledger - 这次运行的累计。
 * @param scope - 已经归一化的窗口。
 * @param date - 宿主本地时区的当天。
 * @param selected - `session` 窗口选中的会话，别的窗口是 null。
 * @returns 窗口，或 null。
 */
function windowOf(ledger: Ledger, scope: SessionUsageScope, date: string, selected: string | null): Window | null {
  if (scope === 'today') return ledger.days.get(date) ?? null
  if (scope === 'all') return { tally: sumSessions(ledger), recent: ledger.recent }
  if (selected === null) return null
  const tally = ledger.sessions.get(selected)
  return tally === undefined ? null : { tally: tally.tally, recent: tally.recent }
}

/**
 * 一份快照。
 *
 * 空态的次序固定：会话服务缺席先判，其次有没有活着的会话，最后才看所选窗口里有没有带用量的调用。
 *
 * @param ledger - 这次运行的累计。
 * @param props - 卡片的 props：`scope` 与可选的完整 `session`。
 * @param sessions - 宿主的会话服务；缺席时是 `undefined`。
 * @param now - 读取的时刻，决定「今天」与 `date`。
 * @returns 快照。
 */
function snapshotOf(
  ledger: Ledger,
  props: Record<string, unknown>,
  sessions: HostSessions | undefined,
  now: number,
): SessionUsageSnapshot {
  const scope = scopeOf(props.scope)
  const date = localDate(now)
  if (date === null) throw new Error(`会话用量读不出本地日期：当前时刻 ${now} 不是有效的 Unix 毫秒`)
  const pinned = typeof props.session === 'string' && props.session.trim() !== '' ? props.session : null
  const base = { startedAt: ledger.startedAt, scope, date }
  if (sessions === undefined) {
    return { ...base, available: false, reason: 'sessions-unavailable', session: null, empty: null, totals: null, recent: null, trend: [] }
  }
  if (sessions.list().length === 0) {
    return { ...base, available: true, reason: null, session: null, empty: 'no-sessions', totals: null, recent: null, trend: [] }
  }
  const selected = scope === 'session' ? (pinned ?? latestSession(ledger)) : null
  const name = scope === 'session' && selected !== null ? prefixOf(selected) : null
  const window = windowOf(ledger, scope, date, selected)
  if (window === null || window.tally.calls === 0) {
    return { ...base, available: true, reason: null, session: name, empty: 'no-usage', totals: null, recent: null, trend: [] }
  }
  const last = window.recent[window.recent.length - 1] as Call
  return {
    ...base,
    available: true,
    reason: null,
    session: name,
    empty: null,
    totals: { ...window.tally },
    recent: {
      at: last.at,
      session: prefixOf(last.session),
      input: last.input,
      output: last.output,
      total: last.total,
      estimated: last.estimated,
    },
    trend: window.recent.map((point) => ({ at: point.at, value: point.total })),
  }
}

/** 这个数据源要读的外界：会话服务、事件订阅与时钟。 */
export interface SessionUsageDeps {
  /** 读宿主的会话服务；缺席时是 `undefined`。 */
  sessions: () => HostSessions | undefined
  /** 订阅一次全局 `session/event`；返回退订函数。 */
  subscribe: (listener: (session: HostSessionRef, event: HostSessionEvent) => void) => () => void
  /** 现在是什么时候；省略时是 `Date.now`。 */
  now?: () => number
}

/** 一次注册的产物：数据源与它的拆除。 */
export interface SessionUsage {
  source: DataSourceRegistration
  dispose(): void
}

/**
 * 建出实时用量的数据源，并立即订阅会话事件。
 *
 * 起点就是这一刻：订阅之前发生的事件一概不计，也不回头读日志。
 *
 * @param deps - 会话服务、事件订阅与时钟。
 * @returns 数据源与拆除这次注册的函数。
 */
export function createSessionUsage(deps: SessionUsageDeps): SessionUsage {
  const now = deps.now ?? Date.now
  const ledger: Ledger = { startedAt: now(), sessions: new Map(), recent: [], days: new Map(), order: 0 }
  const stop = deps.subscribe((session, event) => { record(ledger, session, event) })
  return {
    source: {
      apiVersion: WIDGET_BOARD_API_VERSION,
      provider: SESSION_USAGE_PROVIDER,
      id: SESSION_USAGE_SOURCE,
      read(instance: InstanceFace): SessionUsageSnapshot {
        const props = isRecord(instance.props) ? instance.props : {}
        return snapshotOf(ledger, props, deps.sessions(), now())
      },
    },
    dispose() {
      stop()
    },
  }
}

/**
 * 把实时用量的数据源注册进看板的注册表。
 *
 * 事件订阅与数据源一同建立、一同撤下：看板所有页面共用一个订阅，卡片只是读它。
 *
 * @param sources - 看板的注册表。
 * @param context - 宿主上下文。
 * @returns 撤下这次注册的函数。
 */
export function registerSessionUsage(sources: Registries, context: unknown): () => void {
  const usage = createSessionUsage({
    sessions: () => sessionsOf(context),
    subscribe: (listener) => onSessionEvent(context, listener),
  })
  const disposeSource = sources.registerDataSource(usage.source)
  return () => {
    disposeSource()
    usage.dispose()
  }
}
