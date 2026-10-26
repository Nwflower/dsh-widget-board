/**
 * 实时用量的数据源（issue #6）：事件从注册那一刻开始累计，窗口按卡片的 props 选，快照里只出现会话 id 的前 8 位。
 *
 * 事件按宿主的真实形状送进来（`session` 带 `id`，`event` 带 `type`、`seq`、`time` 与 `data.usage`），
 * 不经过宿主的会话存储与持久化。
 */
import { describe, expect, it } from 'vitest'
import type { HostSessionEvent, HostSessions, InstanceFace } from '@dsh-widget-board/contracts'
import type { SessionUsage, SessionUsageSnapshot } from '../src/session-usage'
import {
  SESSION_USAGE_NAME,
  SESSION_USAGE_PROVIDER,
  SESSION_USAGE_SOURCE,
  SESSION_USAGE_TREND_POINTS,
  createSessionUsage,
} from '../src/session-usage'

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

/** 一台测量用的看板：一个可拨的时钟、一个事件入口、一个可缺席的会话服务。 */
function harness(startedAt: number, sessions: () => HostSessions | undefined = () => ({ list: () => [{ id: 'aaa11111-1' }] })) {
  let clock = startedAt
  let sink: ((session: { id: string }, event: HostSessionEvent) => void) | undefined
  let unsubscribed = 0
  const usage: SessionUsage = createSessionUsage({
    sessions,
    subscribe: (listener) => {
      sink = listener
      return () => { unsubscribed += 1 }
    },
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
