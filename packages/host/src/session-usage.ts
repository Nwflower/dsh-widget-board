/**
 * 会话用量的实时聚合（issue #6）：订阅一次 `session/event`，把带用量的 `assistant/message` 记进内存，
 * 数据源按卡片 props 的窗口取一份快照交给组件。
 *
 * 只从注册这一刻开始累计：订阅之前的那段由 dsh-usage 的 overview 在注册之前取一次（`dsh-usage.ts`），
 * today 与 all 把那份合计并进来，session 窗口只用这里的实时数字。启动时宿主可能还没绑上端口，那一次
 * 读会失败：today 与 all 的读最多再补两次，补上时重定起点并清空这之间的实时累计，两段因此不重复。
 * 事件按会话 id 与 `event.seq` 去重——序号在会话内单调，重复投递的同一条事件只记一次。
 *
 * 卡片上的数据由它自己的订阅推（D32）：订上先给一份当下的快照，之后每进一条带用量的事件再给一份，
 * 另有一条 10 秒的节奏取代原来那条看板定时刷新——today 与 all 的那一拍顺手补读一次 dsh-usage 的历史
 * （那段在宿主之外自己会变），所选会话的那一拍只重取快照。看板的定时链不再管这张卡。
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
import { historyOf, historyTallyOf, hostOriginOf, readUsageHistory } from './dsh-usage'
import type { SessionUsageHistory, UsageHistoryDeps, UsageHistoryProjection, UsageHistoryTally } from './dsh-usage'
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

/** 历史最多尝试几次，含注册时那一次：启动竞态只给这么多次机会。 */
export const SESSION_USAGE_HISTORY_ATTEMPTS = 3

/** 订阅里补读历史的间隔，毫秒：today 与 all 合并的那段在宿主之外自己会变。 */
export const SESSION_USAGE_SUBSCRIBE_MS = 10_000

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
  /** 启动前那段历史的状态：`session` 窗口是 null，today 与 all 总是对象。 */
  history: SessionUsageHistory | null
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
  /** 启动时取到的历史投影：订阅之前的那段用量只从这里来。 */
  history: UsageHistoryProjection | null
  /** 已经发起过几次历史读取，含注册时那一次；到上限就不再重读。 */
  attempts: number
  /** 在途的那一次重读；同一个 `loadHistory` 同时只跑一次。 */
  loading: Promise<void> | null
  sessions: Map<string, SessionTally>
  /** 全部会话的最近调用，供 `all` 窗口取趋势。 */
  recent: Call[]
  /** 每个本地自然日一份窗口；跨零点由读取时按当天取，写入按事件的本地日期分桶。 */
  days: Map<string, Window>
  /** 已经收下的调用数，用作到达次序：同一毫秒里的两次调用靠它定新旧。 */
  order: number
  /** 有新事件进账时要通知的卡片订阅；退订只把这一条从集合里移走，全局事件订阅不随它停。 */
  listeners: Set<() => void>
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
  // 这一条已经落进全部合计，订阅着的卡这时候推出去的才是一份完整的读数。
  for (const notify of ledger.listeners) notify()
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
 * 实时合计与历史合计相加；`estimated` 仍表示实时这一边有没有推算，历史那一份总是精确的。
 *
 * @param realtime - 所选窗口里实时记下的合计。
 * @param past - 同一窗口的历史合计；没有时是 `null`。
 * @returns 交给卡片的合计。
 */
function mergedTotals(realtime: Tally, past: UsageHistoryTally | null): SessionUsageTotals {
  const totals: SessionUsageTotals = { ...realtime }
  if (past === null) return totals
  totals.input += past.input
  totals.output += past.output
  totals.cacheRead += past.cacheRead
  totals.cacheWrite += past.cacheWrite
  totals.total += past.total
  totals.calls += past.calls
  return totals
}

/**
 * 一份快照。
 *
 * 空态的次序固定：会话服务缺席先判，其次有没有活着的会话，最后才看所选窗口里有没有调用。today 与 all
 * 把历史合计并进来：只有历史没有实时调用时仍是一份有数字的读数，`recent` 与 `trend` 保持空的，因为
 * 那两项只来自实时事件。
 *
 * @param ledger - 这次运行的累计与启动时的历史投影。
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
  const base = { startedAt: ledger.startedAt, scope, date, history: historyOf(ledger.history, scope) }
  if (sessions === undefined) {
    return { ...base, available: false, reason: 'sessions-unavailable', session: null, empty: null, totals: null, recent: null, trend: [] }
  }
  const selected = scope === 'session' ? (pinned ?? latestSession(ledger)) : null
  const name = scope === 'session' && selected !== null ? prefixOf(selected) : null
  const window = windowOf(ledger, scope, date, selected)
  const realtime = window === null ? emptyTally() : window.tally
  const past = historyTallyOf(ledger.history, scope)
  const calls = realtime.calls + (past === null ? 0 : past.calls)
  // 没有活着的会话时，today 与 all 仍可以整份由历史撑着；session 窗口没有这一条退路。
  if (sessions.list().length === 0 && (scope === 'session' || calls === 0)) {
    return { ...base, available: true, reason: null, session: null, empty: 'no-sessions', totals: null, recent: null, trend: [] }
  }
  if (calls === 0) {
    return { ...base, available: true, reason: null, session: name, empty: 'no-usage', totals: null, recent: null, trend: [] }
  }
  const last = window === null ? undefined : window.recent[window.recent.length - 1]
  return {
    ...base,
    available: true,
    reason: null,
    session: name,
    empty: null,
    totals: mergedTotals(realtime, past),
    recent: last === undefined ? null : {
      at: last.at,
      session: prefixOf(last.session),
      input: last.input,
      output: last.output,
      total: last.total,
      estimated: last.estimated,
    },
    trend: window === null ? [] : window.recent.map((point) => ({ at: point.at, value: point.total })),
  }
}

/**
 * 还要不要读一次历史。
 *
 * 已经可用、或形状不合格（再读一次还是同一个结果）时不再试。注册时那一份算第一次尝试，所以上限是
 * 三次，其中最多两次是重读。
 *
 * @param ledger - 这次运行的累计。
 * @returns 还要重读时为真。
 */
function historyDue(ledger: Ledger): boolean {
  if (ledger.attempts >= SESSION_USAGE_HISTORY_ATTEMPTS) return false
  const history = ledger.history
  if (history === null) return true
  return !history.available && history.reason !== 'invalid'
}

/**
 * 重读成功之后重定起点：实时账本整份清空，之前收到的事件由这份历史覆盖。
 *
 * 起点先移到当下，再清空账本：这之后到达的事件才都算在新的一段里，序号水位也跟着归零。
 *
 * @param ledger - 这次运行的累计。
 * @param projection - 刚读到的历史投影。
 * @param at - 读完成之后的当下。
 */
function restart(ledger: Ledger, projection: UsageHistoryProjection, at: number): void {
  ledger.startedAt = at
  ledger.history = projection
  ledger.sessions.clear()
  ledger.recent = []
  ledger.days.clear()
  ledger.order = 0
}

/**
 * 该重读时读一次；同一个 `loadHistory` 同时只跑一次，后到的读等它回来。
 *
 * 只有 today 与 all 走到这里：session 窗口不合并历史，没有可补的东西。失败只换掉 `history`，
 * 起点与实时账本都不动——那一份仍然描述订阅以来的全部实时事件。
 *
 * @param ledger - 这次运行的累计。
 * @param load - 重读历史的路；注册时没给就不再试。
 * @param now - 现在是什么时候。
 * @param scope - 卡片的窗口。
 */
async function refreshHistory(
  ledger: Ledger,
  load: (() => Promise<UsageHistoryProjection>) | undefined,
  now: () => number,
  scope: SessionUsageScope,
): Promise<void> {
  if (load === undefined || scope === 'session') return
  if (ledger.loading === null) {
    if (!historyDue(ledger)) return
    ledger.attempts += 1
    const run = (async (): Promise<void> => {
      try {
        const projection = await load()
        if (projection.available) restart(ledger, projection, now())
        else ledger.history = projection
      } finally {
        ledger.loading = null
      }
    })()
    ledger.loading = run
    await run
    return
  }
  await ledger.loading
}

/** 这个数据源要读的外界：会话服务、事件订阅、历史投影与时钟。 */
export interface SessionUsageDeps {
  /** 读宿主的会话服务；缺席时是 `undefined`。 */
  sessions: () => HostSessions | undefined
  /** 订阅一次全局 `session/event`；返回退订函数。 */
  subscribe: (listener: (session: HostSessionRef, event: HostSessionEvent) => void) => () => void
  /** 启动时已经取到的历史投影；省略时 today 与 all 的历史记为不可用。 */
  history?: UsageHistoryProjection | null
  /** 重读历史的路；省略时只认注册时取到的那一份，不再补读。 */
  loadHistory?: () => Promise<UsageHistoryProjection>
  /** 已经发起过几次历史读取，含注册时那一次；省略时是 1。 */
  historyAttempts?: number
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
 * 起点就是这一刻：订阅之前发生的事件一概不计，也不回头读日志——那段由调用方在订阅之前取到、
 * 经 `history` 交进来，两段因此不重叠。给了 `loadHistory` 时起点还会在补读成功那一刻后移、账本整份
 * 清空（见 `refreshHistory`）：那之前的实时事件已经落进补读回来的历史里。
 *
 * 这次会话事件订阅是全局的一份：卡片订阅只往账本上挂一个通知，退订一张卡不动它，改由 `dispose` 收。
 *
 * @param deps - 会话服务、事件订阅、历史投影、重读入口与时钟。
 * @returns 数据源与拆除这次注册的函数。
 */
export function createSessionUsage(deps: SessionUsageDeps): SessionUsage {
  const now = deps.now ?? Date.now
  const ledger: Ledger = {
    startedAt: now(),
    history: deps.history ?? null,
    attempts: deps.historyAttempts ?? 1,
    loading: null,
    sessions: new Map(),
    recent: [],
    days: new Map(),
    order: 0,
    listeners: new Set(),
  }
  const stop = deps.subscribe((session, event) => { record(ledger, session, event) })
  return {
    source: {
      apiVersion: WIDGET_BOARD_API_VERSION,
      provider: SESSION_USAGE_PROVIDER,
      id: SESSION_USAGE_SOURCE,
      async read(instance: InstanceFace): Promise<SessionUsageSnapshot> {
        const props = isRecord(instance.props) ? instance.props : {}
        await refreshHistory(ledger, deps.loadHistory, now, scopeOf(props.scope))
        return snapshotOf(ledger, props, deps.sessions(), now())
      },
      /**
       * 卡片可见期间持续推快照（D32）：订上先给一份当下的，之后每进一条带用量的会话事件再给一份。
       *
       * 窗口与所选会话取订阅成立那一刻的 props：props 一变宿主先退订再按最新的卡片面重订，实现因此
       * 不必自己盯着新的 props。
       *
       * @param instance - 订阅这张卡片。
       * @param emit - 推一份快照给宿主。
       * @returns 退订函数：同步停表、不再回调。全局的事件订阅归 `dispose`，退订一张卡不动它。
       */
      subscribe(instance: InstanceFace, emit: (data: unknown) => void): () => void {
        const props = isRecord(instance.props) ? instance.props : {}
        const scope = scopeOf(props.scope)
        let open = true
        /** 等待链：同一条订阅的几份快照按发出的顺序落定，也不会两轮同时补读历史。 */
        let queued: Promise<void> = Promise.resolve()
        const push = (): void => {
          queued = queued.then(async () => {
            // 退订之后还留在链上的那几轮空转：不再补读历史，也不再回调。
            if (!open) return
            await refreshHistory(ledger, deps.loadHistory, now, scope)
            if (!open) return
            emit(snapshotOf(ledger, props, deps.sessions(), now()))
          }).catch((error: unknown) => {
            // 一条推送失败不停这条订阅：回调没有调用方可以接住它（D11），报出来之后下一轮照常。
            console.error(`widget-board: 卡片 ${instance.id} 的用量快照没推出去：${error instanceof Error ? error.message : String(error)}`)
          })
        }
        // 自己的 10 秒节奏，取代这张卡原来那条看板定时刷新：today 与 all 合并的历史在宿主之外自己会变，
        // 这一拍补读一次再推；所选会话没有历史可补读，这一拍仍然推一份，好让「今天」与有没有会话这些
        // 不靠事件变化的部分跟上（跨零点就是这样翻过去的）。
        const timer = setInterval(push, SESSION_USAGE_SUBSCRIBE_MS)
        timer.unref()
        ledger.listeners.add(push)
        // 初值只在订阅里推：宿主不替订阅着的卡读一次（D32）。
        push()
        return () => {
          open = false
          ledger.listeners.delete(push)
          clearInterval(timer)
        }
      },
    },
    dispose() {
      stop()
    },
  }
}

/** 注册时要替换的两件事：历史怎么取回来，其余从宿主上下文中读。 */
export interface SessionUsageRegistration {
  /** 读历史用的取址与请求；省略时读宿主 web 服务的根地址与全局 `fetch`。 */
  history?: UsageHistoryDeps
}

/**
 * 把实时用量的数据源注册进看板的注册表。
 *
 * 先取历史快照，再建实时订阅：`startedAt` 因此落在历史快照之后，两段来源不重叠，同一段用量不会
 * 被两边各算一次。历史读不到时只让它那一层退出（D11），实时订阅照旧建立。
 *
 * 事件订阅与数据源一同建立、一同撤下：看板所有页面共用一个订阅，每一张卡只挂一个通知。
 *
 * @param sources - 看板的注册表。
 * @param context - 宿主上下文。
 * @param options - 可替换的历史读取；省略时用宿主根地址与全局 `fetch`。
 * @returns 撤下这次注册的函数。
 */
export async function registerSessionUsage(
  sources: Registries,
  context: unknown,
  options: SessionUsageRegistration = {},
): Promise<() => void> {
  const historyDeps = options.history ?? { origin: () => hostOriginOf(context) }
  const history = await readUsageHistory(historyDeps)
  const usage = createSessionUsage({
    sessions: () => sessionsOf(context),
    subscribe: (listener) => onSessionEvent(context, listener),
    history,
    // 每次重读都重新取一次根地址：宿主绑上端口之前那一次多半拿不到它。
    loadHistory: () => readUsageHistory(historyDeps),
    historyAttempts: 1,
  })
  const disposeSource = sources.registerDataSource(usage.source)
  return () => {
    disposeSource()
    usage.dispose()
  }
}
