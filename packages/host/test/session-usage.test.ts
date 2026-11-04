/**
 * 实时用量的数据源（issue #6）：事件从注册那一刻开始累计，窗口按卡片的 props 选，快照里只出现会话 id 的前 8 位；
 * 卡片可见期间由订阅推快照，事件来了推新的，today 与 all 还在自己的 10 秒里补读历史（D32）。
 *
 * 事件按宿主的真实形状送进来（`session` 带 `id`，`event` 带 `type`、`seq`、`time` 与 `data.usage`），
 * 不经过宿主的会话存储与持久化。历史那一段按启动时取到的一份投影交进来，合并的口径与启动竞态下的
 * 有界重读都在这里测。
 */
import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import type { HostSessionEvent, HostSessions, InstanceFace } from '@dsh-widget-board/contracts'
import type { UsageHistoryFetch, UsageHistoryProjection, UsageHistoryTally } from '../src/dsh-usage'
import { USAGE_HISTORY_SOURCE, historyFailure } from '../src/dsh-usage'
import type { SessionUsage, SessionUsageSnapshot } from '../src/session-usage'
import {
  SESSION_USAGE_NAME,
  SESSION_USAGE_PROVIDER,
  SESSION_USAGE_SOURCE,
  SESSION_USAGE_SUBSCRIBE_MS,
  SESSION_USAGE_TREND_POINTS,
  createSessionUsage,
  registerSessionUsage,
} from '../src/session-usage'
import { createRegistries } from '../src/sources'

const FACE: InstanceFace = { id: 'card', widget: 'session-usage', props: {} }

/** 一次用量样本；省略的字段就是不报那几项。 */
interface Sample {
  input: number
  output: number
  total?: number
  cacheRead?: number
  cacheWrite?: number
}

/** 本地时区的日期，形如 2026-10-25；断言「今天」用。 */
function dateOf(time: number): string {
  const date = new Date(time)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 一份历史合计。 */
function tally(input: number, output: number, cacheRead: number, cacheWrite: number, calls: number): UsageHistoryTally {
  return { input, output, cacheRead, cacheWrite, total: input + output + cacheRead + cacheWrite, calls }
}

/** 一份可用的历史投影：today 与 all 各自一份合计，边界写成固定日期。 */
function projection(parts: { today?: UsageHistoryTally, all?: UsageHistoryTally, capturedAt?: number } = {}): UsageHistoryProjection {
  const today = parts.today ?? null
  const all = parts.all ?? null
  return {
    available: true,
    reason: null,
    capturedAt: parts.capturedAt ?? 500,
    today: today === null ? null : { from: '2026-10-25', to: '2026-10-25', tally: today },
    all: all === null ? null : { from: '2026-09-01', to: '2026-10-25', tally: all },
  }
}

/** 重读用的两件事：一条读历史的路，与注册时已经试过的次数。 */
interface Retry {
  loadHistory?: () => Promise<UsageHistoryProjection>
  historyAttempts?: number
}

/** 一台测量用的看板：一个可拨的时钟、一个事件入口、一个可缺席的会话服务、一份历史投影与重读入口。 */
function harness(
  startedAt: number,
  sessions: () => HostSessions | undefined = () => ({ list: () => [{ id: 'aaa11111-1' }] }),
  history?: UsageHistoryProjection,
  retry: Retry = {},
) {
  let clock = startedAt
  let sink: ((session: { id: string }, event: HostSessionEvent) => void) | undefined
  let unsubscribed = 0
  const usage: SessionUsage = createSessionUsage({
    sessions,
    subscribe: (listener) => {
      sink = listener
      return () => { unsubscribed += 1 }
    },
    history,
    loadHistory: retry.loadHistory,
    historyAttempts: retry.historyAttempts,
    now: () => clock,
  })
  const emit = (id: string, seq: number, sample?: Sample, at?: number, type = 'assistant/message'): void => {
    const event = {
      type,
      seq,
      time: at ?? clock,
      data: sample === undefined ? {} : {
        usage: {
          inputTokens: sample.input,
          outputTokens: sample.output,
          ...(sample.total === undefined ? {} : { totalTokens: sample.total }),
          ...(sample.cacheRead === undefined ? {} : { cacheReadTokens: sample.cacheRead }),
          ...(sample.cacheWrite === undefined ? {} : { cacheWriteTokens: sample.cacheWrite }),
        },
      },
    } as HostSessionEvent
    sink?.({ id }, event)
  }
  const read = async (props: Record<string, unknown> = {}): Promise<SessionUsageSnapshot> =>
    await usage.source.read({ ...FACE, props }) as SessionUsageSnapshot
  return {
    usage,
    emit,
    read,
    at: (time: number) => { clock = time },
    unsubscribed: () => unsubscribed,
  }
}

describe('实时用量的数据源', () => {
  it('注册时就订阅一次会话事件，起点是这一刻，名字与权限按约定', async () => {
    const board = harness(1_000)
    expect(board.usage.source.provider).toBe(SESSION_USAGE_PROVIDER)
    expect(board.usage.source.id).toBe(SESSION_USAGE_SOURCE)
    expect(SESSION_USAGE_NAME).toBe('widget-board:session.usage')
    expect(board.usage.source.permission).toBeUndefined()
    const snapshot = await board.read()
    expect(snapshot.available).toBe(true)
    expect(snapshot.reason).toBeNull()
    expect(snapshot.startedAt).toBe(1_000)
    expect(snapshot.empty).toBe('no-usage')
    expect(snapshot.totals).toBeNull()
    board.usage.dispose()
    expect(board.unsubscribed()).toBe(1)
  })

  it('默认窗口取最近有带用量调用的会话，读数里只有 id 的前 8 位', async () => {
    const board = harness(5_000)
    board.emit('aaa11111-1', 0, { input: 10, output: 5, total: 20 })
    board.emit('bbb22222-2', 9, { input: 7, output: 3, total: 12 })
    const snapshot = await board.read()
    expect(snapshot.scope).toBe('session')
    expect(snapshot.session).toBe('bbb22222')
    expect(snapshot.empty).toBeNull()
    expect(snapshot.totals).toEqual({ input: 7, output: 3, cacheRead: 0, cacheWrite: 0, total: 12, calls: 1, estimated: false })
    expect(snapshot.recent).toEqual({ at: 5_000, session: 'bbb22222', input: 7, output: 3, total: 12, estimated: false })
    expect(snapshot.trend).toEqual([{ at: 5_000, value: 12 }])
    expect(JSON.stringify(snapshot)).not.toContain('bbb22222-2')
  })

  it('props 里写完整会话 id 时固定那个会话', async () => {
    const board = harness(2_000)
    board.emit('aaa11111-1', 0, { input: 4, output: 1, total: 5 })
    board.emit('bbb22222-2', 0, { input: 8, output: 2, total: 10 })
    const pinned = await board.read({ scope: 'session', session: 'aaa11111-1' })
    expect(pinned.session).toBe('aaa11111')
    expect(pinned.totals?.calls).toBe(1)
    expect(pinned.totals?.total).toBe(5)
    expect(pinned.recent?.session).toBe('aaa11111')
    const missing = await board.read({ scope: 'session', session: 'ccc33333-3' })
    expect(missing.empty).toBe('no-usage')
    expect(missing.session).toBe('ccc33333')
    expect(missing.totals).toBeNull()
  })

  it('缺 totalTokens 时按输入加输出推算，并标出这一次是推算的', async () => {
    const board = harness(3_000)
    board.emit('aaa11111-1', 0, { input: 40, output: 2 })
    const first = await board.read()
    expect(first.totals).toEqual({ input: 40, output: 2, cacheRead: 0, cacheWrite: 0, total: 42, calls: 1, estimated: true })
    expect(first.recent?.estimated).toBe(true)
    board.emit('aaa11111-1', 1, { input: 1, output: 1, total: 2 })
    const second = await board.read()
    expect(second.totals).toMatchObject({ total: 44, calls: 2, estimated: true })
    expect(second.recent?.estimated).toBe(false)
  })

  it('缓存读写各记一个分桶，合计里按各自字段累加', async () => {
    const board = harness(4_000)
    board.emit('aaa11111-1', 0, { input: 10, output: 4, cacheRead: 100, cacheWrite: 7 })
    const snapshot = await board.read()
    expect(snapshot.totals).toEqual({ input: 10, output: 4, cacheRead: 100, cacheWrite: 7, total: 14, calls: 1, estimated: true })
  })

  it('today 只算本地当天，跨零点由读取时的窗口处理', async () => {
    const lateYesterday = new Date(2026, 9, 24, 23, 59, 30).getTime()
    const earlyToday = new Date(2026, 9, 25, 0, 0, 30).getTime()
    const noon = new Date(2026, 9, 25, 12, 0, 0).getTime()
    const board = harness(noon)
    board.emit('aaa11111-1', 0, { input: 1, output: 1 }, lateYesterday)
    board.emit('aaa11111-1', 1, { input: 2, output: 2 }, earlyToday)
    const today = await board.read({ scope: 'today' })
    expect(today.date).toBe('2026-10-25')
    expect(today.session).toBeNull()
    expect(today.totals).toMatchObject({ input: 2, output: 2, total: 4, calls: 1 })
    const all = await board.read({ scope: 'all' })
    expect(all.session).toBeNull()
    expect(all.totals).toMatchObject({ input: 3, output: 3, calls: 2 })
    expect(all.trend).toHaveLength(2)
    board.at(new Date(2026, 9, 26, 1, 0, 0).getTime())
    expect((await board.read({ scope: 'today' })).empty).toBe('no-usage')
    board.emit('aaa11111-1', 2, { input: 5, output: 5 }, new Date(2026, 9, 26, 0, 30, 0).getTime())
    const next = await board.read({ scope: 'today' })
    expect(next.date).toBe('2026-10-26')
    expect(next.totals).toMatchObject({ calls: 1, total: 10 })
    expect(next.recent?.at).toBe(new Date(2026, 9, 26, 0, 30, 0).getTime())
  })

  it('趋势最多 30 个点，按时间从旧到新，三个窗口各自截', async () => {
    const start = 7_000
    const board = harness(start)
    for (let index = 0; index < 40; index += 1) {
      board.emit('aaa11111-1', index, { input: index + 1, output: 0, total: index + 1 }, start + index)
    }
    const all = await board.read({ scope: 'all' })
    expect(all.trend).toHaveLength(SESSION_USAGE_TREND_POINTS)
    expect(all.totals?.calls).toBe(40)
    expect(all.trend[0]).toEqual({ at: start + 10, value: 11 })
    expect(all.trend[SESSION_USAGE_TREND_POINTS - 1]).toEqual({ at: start + 39, value: 40 })
    expect(all.recent?.total).toBe(40)
    const session = await board.read()
    expect(session.trend).toHaveLength(SESSION_USAGE_TREND_POINTS)
    expect(session.trend[session.trend.length - 1]).toEqual({ at: start + 39, value: 40 })
  })

  it('按会话 id 与序号去重，重复投递的同一条事件只记一次', async () => {
    const board = harness(8_000)
    board.emit('aaa11111-1', 3, { input: 1, output: 0, total: 1 })
    board.emit('aaa11111-1', 3, { input: 1, output: 0, total: 1 })
    board.emit('aaa11111-1', 2, { input: 9, output: 0, total: 9 })
    const one = await board.read()
    expect(one.totals).toEqual({ input: 1, output: 0, cacheRead: 0, cacheWrite: 0, total: 1, calls: 1, estimated: false })
    board.emit('bbb22222-2', 3, { input: 2, output: 0, total: 2 })
    const two = await board.read({ scope: 'all' })
    expect(two.totals?.calls).toBe(2)
    expect(two.totals?.total).toBe(3)
  })

  it('会话服务缺席时写出一份不可用的快照，数据源照旧注册着', async () => {
    const now = new Date(2026, 9, 25, 9, 0, 0).getTime()
    const board = harness(now, () => undefined)
    board.emit('aaa11111-1', 0, { input: 1, output: 1 })
    expect(board.usage.source.permission).toBeUndefined()
    expect(await board.read({ scope: 'today' })).toEqual({
      available: false,
      reason: 'sessions-unavailable',
      startedAt: now,
      scope: 'today',
      date: dateOf(now),
      session: null,
      empty: null,
      totals: null,
      recent: null,
      trend: [],
      history: { source: USAGE_HISTORY_SOURCE, available: false, reason: 'unavailable', capturedAt: null, from: null, to: null },
    })
  })

  it('有会话但没有带用量的调用时是 no-usage，没有活着的会话时是 no-sessions', async () => {
    const now = 9_000
    const quiet = harness(now)
    const empty = await quiet.read()
    expect(empty).toMatchObject({ available: true, reason: null, empty: 'no-usage', totals: null, recent: null, trend: [] })
    const gone = harness(now, () => ({ list: () => [] }))
    gone.emit('aaa11111-1', 0, { input: 1, output: 1 })
    expect(await gone.read()).toMatchObject({
      available: true,
      reason: null,
      session: null,
      empty: 'no-sessions',
      totals: null,
      recent: null,
      trend: [],
    })
  })

  it('只认带用量的 assistant/message，别的事件不计入', async () => {
    const board = harness(10_000)
    board.emit('aaa11111-1', 0, { input: 3, output: 1 }, undefined, 'assistant/attempt')
    board.emit('aaa11111-1', 1)
    board.emit('aaa11111-1', 2, { input: 3, output: 1 }, undefined, 'user/message')
    const snapshot = await board.read()
    expect(snapshot.empty).toBe('no-usage')
    expect(snapshot.totals).toBeNull()
  })

  it('后到达的事件带更早时间时，recent 取 at 最新者，trend 仍按 at 从旧到新', async () => {
    const board = harness(20_000)
    board.emit('aaa11111-1', 0, { input: 1, output: 0, total: 1 }, 40_000)
    board.emit('aaa11111-1', 1, { input: 2, output: 0, total: 2 }, 30_000)
    const snapshot = await board.read()
    expect(snapshot.totals).toMatchObject({ calls: 2, total: 3 })
    expect(snapshot.recent?.at).toBe(40_000)
    expect(snapshot.recent?.total).toBe(1)
    expect(snapshot.trend).toEqual([{ at: 30_000, value: 2 }, { at: 40_000, value: 1 }])
  })

  it('同一毫秒里的调用按到达次序定最近会话与 recent', async () => {
    const board = harness(21_000)
    board.emit('aaa11111-1', 0, { input: 1, output: 0, total: 1 }, 50_000)
    board.emit('bbb22222-2', 0, { input: 2, output: 0, total: 2 }, 50_000)
    const snapshot = await board.read()
    expect(snapshot.session).toBe('bbb22222')
    expect(snapshot.recent?.session).toBe('bbb22222')
    expect(snapshot.trend).toEqual([{ at: 50_000, value: 2 }])
    const all = await board.read({ scope: 'all' })
    expect(all.trend).toEqual([{ at: 50_000, value: 1 }, { at: 50_000, value: 2 }])
  })

  it('时刻算不出本地日期时跳过这条事件，不留下半份合计', async () => {
    const board = harness(22_000)
    board.emit('aaa11111-1', 0, { input: 5, output: 5, total: 10 }, 1e20)
    const empty = await board.read()
    expect(empty.empty).toBe('no-usage')
    expect(empty.totals).toBeNull()
    expect(Number.isFinite(empty.startedAt)).toBe(true)
    expect((await board.read({ scope: 'today' })).empty).toBe('no-usage')
    board.emit('aaa11111-1', 1, { input: 1, output: 1, total: 2 })
    const one = await board.read()
    expect(one.totals).toMatchObject({ calls: 1, total: 2 })
    expect(one.trend).toHaveLength(1)
  })

  it('不认识的 scope 按 session 处理，任何窗口都不带完整会话 id', async () => {
    const board = harness(11_000)
    board.emit('aaa11111-1', 0, { input: 2, output: 2, total: 4 })
    board.emit('bbb22222-2', 0, { input: 6, output: 1, total: 7 })
    expect((await board.read({ scope: 'week' })).scope).toBe('session')
    expect((await board.read({ scope: 'session', session: 42 })).scope).toBe('session')
    for (const scope of ['session', 'today', 'all']) {
      const snapshot = await board.read({ scope })
      const text = JSON.stringify(snapshot)
      expect(text).not.toContain('aaa11111-1')
      expect(text).not.toContain('bbb22222-2')
    }
  })
})

describe('历史与实时的合并', () => {
  it('today 与 all 把历史合计并进来，session 窗口只用实时数字', async () => {
    const now = new Date(2026, 9, 25, 12, 0, 0).getTime()
    const board = harness(now, undefined, projection({ today: tally(1, 1, 0, 0, 2), all: tally(5, 5, 10, 0, 7) }))
    board.emit('aaa11111-1', 0, { input: 10, output: 5, total: 15 })
    const today = await board.read({ scope: 'today' })
    expect(today.empty).toBeNull()
    expect(today.totals).toEqual({ input: 11, output: 6, cacheRead: 0, cacheWrite: 0, total: 17, calls: 3, estimated: false })
    expect(today.recent).toEqual({ at: now, session: 'aaa11111', input: 10, output: 5, total: 15, estimated: false })
    expect(today.trend).toEqual([{ at: now, value: 15 }])
    expect(today.history).toEqual({
      source: USAGE_HISTORY_SOURCE,
      available: true,
      reason: null,
      capturedAt: 500,
      from: '2026-10-25',
      to: '2026-10-25',
    })
    const all = await board.read({ scope: 'all' })
    expect(all.totals).toEqual({ input: 15, output: 10, cacheRead: 10, cacheWrite: 0, total: 35, calls: 8, estimated: false })
    const session = await board.read()
    expect(session.history).toBeNull()
    expect(session.totals).toEqual({ input: 10, output: 5, cacheRead: 0, cacheWrite: 0, total: 15, calls: 1, estimated: false })
  })

  it('合并后的 estimated 是实时这一边有没有推算，历史那一份总是精确的', async () => {
    const board = harness(30_000, undefined, projection({ today: tally(2, 2, 0, 0, 1) }))
    board.emit('aaa11111-1', 0, { input: 40, output: 2 })
    const snapshot = await board.read({ scope: 'today' })
    expect(snapshot.totals).toEqual({ input: 42, output: 4, cacheRead: 0, cacheWrite: 0, total: 46, calls: 2, estimated: true })
    expect(snapshot.recent?.estimated).toBe(true)
  })

  it('只有历史没有实时调用时合计非空，recent 是 null，trend 是空的，不算空态', async () => {
    const now = new Date(2026, 9, 25, 12, 0, 0).getTime()
    const board = harness(now, undefined, projection({ today: tally(2, 3, 0, 0, 1), all: tally(4, 4, 0, 0, 2) }))
    const today = await board.read({ scope: 'today' })
    expect(today.empty).toBeNull()
    expect(today.reason).toBeNull()
    expect(today.totals).toEqual({ input: 2, output: 3, cacheRead: 0, cacheWrite: 0, total: 5, calls: 1, estimated: false })
    expect(today.recent).toBeNull()
    expect(today.trend).toEqual([])
    expect(today.history).toMatchObject({ available: true, capturedAt: 500 })
    const all = await board.read({ scope: 'all' })
    expect(all.totals?.calls).toBe(2)
    expect(all.recent).toBeNull()
  })

  it('历史不可用时实时读数与空态照旧，原因写在 history 里', async () => {
    const board = harness(9_000, undefined, historyFailure('not-installed'))
    const empty = await board.read({ scope: 'today' })
    expect(empty.empty).toBe('no-usage')
    expect(empty.totals).toBeNull()
    expect(empty.recent).toBeNull()
    expect(empty.history).toEqual({
      source: USAGE_HISTORY_SOURCE,
      available: false,
      reason: 'not-installed',
      capturedAt: null,
      from: null,
      to: null,
    })
    board.emit('aaa11111-1', 0, { input: 1, output: 1, total: 2 })
    const busy = await board.read({ scope: 'today' })
    expect(busy.totals).toEqual({ input: 1, output: 1, cacheRead: 0, cacheWrite: 0, total: 2, calls: 1, estimated: false })
    expect(busy.history).toMatchObject({ available: false, reason: 'not-installed' })
  })

  it('没有活着的会话时，只有历史有调用的 today 与 all 仍显示出来', async () => {
    const now = new Date(2026, 9, 25, 12, 0, 0).getTime()
    const gone = () => ({ list: () => [] })
    const board = harness(now, gone, projection({ today: tally(1, 0, 0, 0, 1), all: tally(6, 2, 0, 0, 3) }))
    const today = await board.read({ scope: 'today' })
    expect(today.empty).toBeNull()
    expect(today.totals?.calls).toBe(1)
    expect(today.recent).toBeNull()
    expect((await board.read({ scope: 'all' })).totals?.calls).toBe(3)
    expect((await board.read()).empty).toBe('no-sessions')
    const bare = harness(now, gone, projection())
    expect((await bare.read({ scope: 'today' })).empty).toBe('no-sessions')
    expect((await bare.read({ scope: 'all' })).totals).toBeNull()
  })

  it('历史快照先于实时订阅，startedAt 落在快照之后', async () => {
    const order: string[] = []
    let resolvedAt = 0
    const today = dateOf(Date.now())
    const body = {
      updatedAt: 1_760_000_000_000,
      usage: {
        today: { date: today, totals: { inputTokens: 2, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, calls: 1 } },
        days: [{ date: today, totals: { inputTokens: 2, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, calls: 1 } }],
      },
    }
    const fetch: UsageHistoryFetch = async () => {
      resolvedAt = Date.now()
      order.push('history')
      return { status: 200, ok: true, json: async () => body }
    }
    const context = {
      get(name: string) { return name === 'sessions' ? { list: () => [{ id: 'aaa11111-1' }] } : undefined },
      on() { order.push('subscribe'); return () => {} },
    }
    const sources = createRegistries()
    const dispose = await registerSessionUsage(sources, context, {
      history: { origin: () => 'http://127.0.0.1:3080', fetch },
    })
    expect(order).toEqual(['history', 'subscribe'])
    const snapshot = await sources.readSource('session.usage', { ...FACE, props: { scope: 'today' } }) as SessionUsageSnapshot
    expect(snapshot.history).toMatchObject({ available: true, capturedAt: 1_760_000_000_000, from: today, to: today })
    expect(snapshot.totals).toEqual({ input: 2, output: 1, cacheRead: 0, cacheWrite: 0, total: 3, calls: 1, estimated: false })
    expect(snapshot.startedAt).toBeGreaterThanOrEqual(resolvedAt)
    dispose()
    expect(sources.hasDataSource('session.usage')).toBe(false)
  })

  it('输出的 history 与共享契约逐字一致，任何窗口都不带完整会话 id', async () => {
    const board = harness(1_000, undefined, projection({ today: tally(1, 0, 0, 0, 1), all: tally(1, 0, 0, 0, 1) }))
    board.emit('aaa11111-1', 0, { input: 1, output: 0, total: 1 })
    for (const scope of ['today', 'all']) {
      const snapshot = await board.read({ scope })
      expect(Object.keys(snapshot.history as object)).toEqual(['source', 'available', 'reason', 'capturedAt', 'from', 'to'])
      expect(JSON.stringify(snapshot)).not.toContain('aaa11111-1')
      expect(snapshot.history).toMatchObject({ source: 'dsh-usage' })
    }
    expect((await board.read()).history).toBeNull()
  })
})

describe('历史的有界重读', () => {
  it('首次读不到时，后续 today 读会补上一次并重定起点，首次之前的实时累计被清空', async () => {
    let calls = 0
    const load = async (): Promise<UsageHistoryProjection> => {
      calls += 1
      return projection({ today: tally(3, 0, 0, 0, 2), all: tally(3, 0, 0, 0, 2) })
    }
    const board = harness(40_000, undefined, historyFailure('unavailable'), { loadHistory: load })
    board.emit('aaa11111-1', 0, { input: 100, output: 0, total: 100 })
    const live = await board.read()
    expect(live.totals?.calls).toBe(1)
    expect(calls).toBe(0)
    board.at(50_000)
    const after = await board.read({ scope: 'today' })
    expect(calls).toBe(1)
    expect(after.startedAt).toBe(50_000)
    expect(after.history).toMatchObject({ available: true, capturedAt: 500 })
    expect(after.totals).toEqual({ input: 3, output: 0, cacheRead: 0, cacheWrite: 0, total: 3, calls: 2, estimated: false })
    expect(after.recent).toBeNull()
    expect(after.trend).toEqual([])
    board.emit('aaa11111-1', 1, { input: 4, output: 0, total: 4 }, 50_100)
    const next = await board.read({ scope: 'today' })
    expect(next.totals).toEqual({ input: 7, output: 0, cacheRead: 0, cacheWrite: 0, total: 7, calls: 3, estimated: false })
    expect(next.trend).toEqual([{ at: 50_100, value: 4 }])
    expect(next.recent?.total).toBe(4)
    expect(calls).toBe(1)
  })

  it('not-installed 会补读一次，invalid 不再试', async () => {
    let calls = 0
    const load = async (): Promise<UsageHistoryProjection> => {
      calls += 1
      return projection({ today: tally(1, 0, 0, 0, 1), all: tally(1, 0, 0, 0, 1) })
    }
    const missing = harness(60_000, undefined, historyFailure('not-installed'), { loadHistory: load })
    const recovered = await missing.read({ scope: 'all' })
    expect(calls).toBe(1)
    expect(recovered.history).toMatchObject({ available: true })
    expect(recovered.totals?.calls).toBe(1)
    const broken = harness(60_000, undefined, historyFailure('invalid'), { loadHistory: load })
    expect((await broken.read({ scope: 'today' })).history).toMatchObject({ available: false, reason: 'invalid' })
    expect(calls).toBe(1)
  })

  it('注册时那一次之外最多再试两次', async () => {
    let calls = 0
    const always = async (): Promise<UsageHistoryProjection> => {
      calls += 1
      return historyFailure('unavailable')
    }
    const board = harness(70_000, undefined, historyFailure('unavailable'), { loadHistory: always })
    for (let index = 0; index < 5; index += 1) await board.read({ scope: 'today' })
    expect(calls).toBe(2)
    expect((await board.read({ scope: 'all' })).history).toMatchObject({ available: false, reason: 'unavailable' })
    expect(calls).toBe(2)
  })

  it('补读失败只换 history，起点与实时账本都不动', async () => {
    let calls = 0
    const board = harness(80_000, undefined, historyFailure('unavailable'), {
      loadHistory: async () => { calls += 1; return historyFailure('invalid') },
    })
    board.emit('aaa11111-1', 0, { input: 5, output: 1, total: 6 })
    const snapshot = await board.read({ scope: 'today' })
    expect(calls).toBe(1)
    expect(snapshot.startedAt).toBe(80_000)
    expect(snapshot.totals).toEqual({ input: 5, output: 1, cacheRead: 0, cacheWrite: 0, total: 6, calls: 1, estimated: false })
    expect(snapshot.history).toMatchObject({ available: false, reason: 'invalid' })
    await board.read({ scope: 'today' })
    expect(calls).toBe(1)
  })

  it('并发的两次读只调用一次 loadHistory', async () => {
    let calls = 0
    let release: (projection: UsageHistoryProjection) => void = () => {}
    const pending = new Promise<UsageHistoryProjection>((resolve) => { release = resolve })
    const board = harness(90_000, undefined, historyFailure('unavailable'), {
      loadHistory: async () => { calls += 1; return await pending },
    })
    const first = board.read({ scope: 'today' })
    const second = board.read({ scope: 'all' })
    release(projection({ today: tally(2, 0, 0, 0, 1), all: tally(2, 0, 0, 0, 1) }))
    const [today, all] = await Promise.all([first, second])
    expect(calls).toBe(1)
    expect(today.history).toMatchObject({ available: true })
    expect(today.totals?.calls).toBe(1)
    expect(all.totals?.calls).toBe(1)
  })

  it('历史可用时一次也不补读，session 窗口从不补读', async () => {
    let calls = 0
    const board = harness(1_000, undefined, projection({ today: tally(1, 0, 0, 0, 1), all: tally(1, 0, 0, 0, 1) }), {
      loadHistory: async () => { calls += 1; return projection() },
    })
    await board.read({ scope: 'today' })
    await board.read({ scope: 'all' })
    await board.read()
    expect(calls).toBe(0)
    const live = harness(2_000, undefined, historyFailure('unavailable'), {
      loadHistory: async () => { calls += 1; return projection() },
    })
    expect((await live.read()).history).toBeNull()
    expect(calls).toBe(0)
  })
})
/** 轮询到条件成立；假的是定时器，等推送借真的 setTimeout，等不到就停在断言上。 */
async function until(ready: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (ready()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`等不到${what}`)
}

/** 一条卡片订阅：把推上来的快照按顺序记下来。 */
function cardSub(usage: SessionUsage, props: Record<string, unknown> = {}) {
  const subscribe = usage.source.subscribe
  if (subscribe === undefined) throw new Error('用量数据源应当声明 subscribe')
  const pushed: SessionUsageSnapshot[] = []
  const stop = subscribe({ ...FACE, props }, (data) => { pushed.push(data as SessionUsageSnapshot) })
  return { pushed, stop }
}

describe('组件 manifest', () => {
  it('不再声明定时刷新：推送由数据源自己的订阅给', async () => {
    const manifest = JSON.parse(
      await readFile(new URL('../../widgets/session-usage/widget.json', import.meta.url), 'utf8'),
    ) as { source: string, refresh?: unknown }
    expect(manifest.source).toBe(SESSION_USAGE_NAME)
    expect(manifest.refresh).toBeUndefined()
  })
})

describe('卡片上的订阅推送', () => {
  it('订阅时先给当下的快照，之后每进一条带用量的事件再给一份', async () => {
    const board = harness(5_000)
    const sub = cardSub(board.usage)
    await until(() => sub.pushed.length >= 1, '订阅时的第一份快照')
    expect(sub.pushed[0]).toMatchObject({ available: true, scope: 'session', startedAt: 5_000, empty: 'no-usage', totals: null })
    board.emit('aaa11111-1', 0, { input: 10, output: 5, total: 20 })
    await until(() => sub.pushed.length >= 2, '事件之后的第二份快照')
    expect(sub.pushed[1]?.totals).toEqual({ input: 10, output: 5, cacheRead: 0, cacheWrite: 0, total: 20, calls: 1, estimated: false })
    expect(sub.pushed[1]?.session).toBe('aaa11111')
    expect(JSON.stringify(sub.pushed)).not.toContain('aaa11111-1')
    sub.stop()
  })

  it('连着进来的几条事件各推一份，按落定顺序单调前进，最后一份含全部事件', async () => {
    const board = harness(5_000)
    const sub = cardSub(board.usage)
    board.emit('aaa11111-1', 0, { input: 1, output: 0, total: 1 })
    board.emit('aaa11111-1', 1, { input: 2, output: 0, total: 2 })
    await until(() => sub.pushed.length >= 3, '初值与两条事件的三份快照')
    // 每份快照都在轮到它落定时才取数，所以只保证后落定的不比先落定的少。
    const calls = sub.pushed.map((snapshot) => snapshot.totals?.calls ?? 0)
    expect(calls).toHaveLength(3)
    expect(calls[calls.length - 1]).toBe(2)
    for (let index = 1; index < calls.length; index += 1) {
      expect(calls[index]).toBeGreaterThanOrEqual(calls[index - 1] ?? 0)
    }
    expect(sub.pushed[2]?.totals?.total).toBe(3)
    sub.stop()
  })

  it('退订只移除这张卡的监听，别的卡与全局事件订阅都照旧', async () => {
    const board = harness(5_000)
    const first = cardSub(board.usage)
    const second = cardSub(board.usage)
    await until(() => first.pushed.length >= 1 && second.pushed.length >= 1, '两条订阅的初值')
    first.stop()
    board.emit('aaa11111-1', 0, { input: 4, output: 0, total: 4 })
    await until(() => second.pushed.length >= 2, '另一条订阅的推送')
    expect(first.pushed).toHaveLength(1)
    expect(board.unsubscribed()).toBe(0)
    board.usage.dispose()
    expect(board.unsubscribed()).toBe(1)
  })

  it('自己的 10 秒节奏取代看板定时刷新：今天与全部顺势补读历史，所选会话只重取快照', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    try {
      let calls = 0
      const board = harness(5_000, undefined, historyFailure('unavailable'), {
        loadHistory: async () => { calls += 1; return historyFailure('unavailable') },
      })
      const today = cardSub(board.usage, { scope: 'today' })
      await until(() => today.pushed.length >= 1, 'today 的初值')
      expect(calls).toBe(1)
      const live = cardSub(board.usage, { scope: 'session' })
      await until(() => live.pushed.length >= 1, 'session 的初值')
      expect(calls).toBe(1)
      vi.advanceTimersByTime(SESSION_USAGE_SUBSCRIBE_MS)
      await until(() => today.pushed.length >= 2 && live.pushed.length >= 2, '10 秒之后的两份快照')
      expect(calls).toBe(2)
      expect(live.pushed[1]?.history).toBeNull()
      today.stop()
      live.stop()
      vi.advanceTimersByTime(SESSION_USAGE_SUBSCRIBE_MS)
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(today.pushed).toHaveLength(2)
      expect(calls).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('等补读历史的那一轮没回来时，后面的快照不会各自再补读一次', async () => {
    let release = (): void => {}
    const gate = new Promise<UsageHistoryProjection>((resolve) => {
      release = () => { resolve(projection({ today: tally(2, 0, 0, 0, 1), all: tally(2, 0, 0, 0, 1) })) }
    })
    let calls = 0
    const board = harness(5_000, undefined, historyFailure('unavailable'), {
      loadHistory: async () => { calls += 1; return await gate },
    })
    const sub = cardSub(board.usage, { scope: 'today' })
    board.emit('aaa11111-1', 0, { input: 1, output: 0, total: 1 })
    board.emit('aaa11111-1', 1, { input: 2, output: 0, total: 2 })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(calls).toBe(1)
    expect(sub.pushed).toHaveLength(0)
    release()
    await until(() => sub.pushed.length >= 3, '放行之后的三份快照')
    expect(calls).toBe(1)
    expect(sub.pushed.every((snapshot) => snapshot.startedAt === 5_000)).toBe(true)
    sub.stop()
  })

  it('props 变了之后按新的卡片面重订，推的是新窗口的快照，旧订阅一条都不再收', async () => {
    const now = new Date(2026, 9, 25, 12, 0, 0).getTime()
    const board = harness(now)
    board.emit('aaa11111-1', 0, { input: 10, output: 5, total: 15 })
    const first = cardSub(board.usage, { scope: 'session' })
    await until(() => first.pushed.length >= 1, '旧 props 的初值')
    expect(first.pushed[0]?.scope).toBe('session')
    expect(first.pushed[0]?.totals?.calls).toBe(1)
    // 宿主在 props 变化时先退订旧的，再用最新的卡片面重订（D32）。
    first.stop()
    const second = cardSub(board.usage, { scope: 'all' })
    await until(() => second.pushed.length >= 1, '新 props 的初值')
    expect(second.pushed[0]?.scope).toBe('all')
    expect(second.pushed[0]?.session).toBeNull()
    expect(second.pushed[0]?.history).not.toBeNull()
    board.emit('aaa11111-1', 1, { input: 1, output: 1, total: 2 })
    await until(() => second.pushed.length >= 2, '新订阅的推送')
    expect(second.pushed[1]?.scope).toBe('all')
    expect(second.pushed[1]?.totals?.calls).toBe(2)
    expect(first.pushed).toHaveLength(1)
    second.stop()
  })

  it('props 里写完整会话 id 时订阅里的快照固定到那个会话', async () => {
    const board = harness(5_000)
    board.emit('aaa11111-1', 0, { input: 4, output: 1, total: 5 })
    board.emit('bbb22222-2', 0, { input: 8, output: 2, total: 10 })
    const sub = cardSub(board.usage, { scope: 'session', session: 'aaa11111-1' })
    await until(() => sub.pushed.length >= 1, '固定会话的初值')
    expect(sub.pushed[0]?.session).toBe('aaa11111')
    expect(sub.pushed[0]?.totals?.total).toBe(5)
    board.emit('bbb22222-3', 0, { input: 1, output: 1, total: 2 })
    await until(() => sub.pushed.length >= 2, '固定会话之后的推送')
    expect(sub.pushed[1]?.session).toBe('aaa11111')
    expect(sub.pushed[1]?.totals?.calls).toBe(1)
    sub.stop()
  })
})
