/**
 * 最近 Token 用量卡的纯视图逻辑：数字换算、分项占比、走势路径与状态判定。
 *
 * `view.js` 同时以经典脚本内联进组件文档；这里按副作用模块载入同一份文件，读到的是卡片真正在用的
 * 实现，不是另写一份样例。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import '../../widgets/session-usage/view.js'

interface Compact {
  value: string
  unit: string
  text: string
}

interface Trend {
  count: number
  line: string
  area: string
  last: { x: number, y: number }
  highFull: string
  latestFull: string
}

interface ViewApi {
  LIMIT: number
  PARTS: string[]
  formatCount(value: unknown, lang: string): string
  compactOf(value: unknown, lang: string): Compact
  shareOf(value: unknown, total: unknown): number
  timeOf(at: unknown, lang: string): string
  sessionOf(value: unknown): { ok: boolean, session: string | null }
  sourceOf(history: unknown): string
  historyOf(value: unknown): { ok: boolean, history: unknown }
  stateOf(data: unknown): string
  trendOf(list: unknown, lang: string): Trend | null
  viewOf(data: unknown, lang: string): Record<string, unknown>
}

const view = (globalThis as unknown as { SessionUsageView: ViewApi }).SessionUsageView

/** 一份完整的读数：会话范围、三项分项都带数、走势三个点。 */
const DATA = {
  available: true,
  reason: null,
  startedAt: 1773907200000,
  scope: 'session',
  date: '2026-03-19',
  session: 'a41f7c02',
  empty: null,
  totals: {
    input: 412880,
    output: 96840,
    cacheRead: 1531200,
    cacheWrite: 74200,
    total: 2115120,
    calls: 216,
    estimated: false,
  },
  recent: {
    at: 1773907200000 + 300000,
    session: 'a41f7c02',
    input: 3120,
    output: 780,
    total: 12940,
    estimated: false,
  },
  trend: [
    { at: 1773907200000 + 60000, value: 62000 },
    { at: 1773907200000 + 120000, value: 145800 },
    { at: 1773907200000 + 300000, value: 12940 },
  ],
}

/** 会话服务缺席：只有这一种情况让 available 为假，其余读数一律 null。 */
const UNAVAILABLE = {
  available: false,
  reason: 'sessions-unavailable',
  startedAt: 1773907200000,
  scope: 'session',
  date: '2026-03-19',
  session: null,
  empty: null,
  totals: null,
  recent: null,
  trend: [],
}

/** 有会话但没有一次带用量的调用。 */
const NO_USAGE = { ...UNAVAILABLE, available: true, reason: null, empty: 'no-usage' }

/** 一份可用的 dsh-usage 历史：今天窗口的总量是历史与实时的合计。 */
const HISTORY = {
  source: 'dsh-usage',
  available: true,
  reason: null,
  capturedAt: 1773907200000,
  from: '2026-01-01',
  to: '2026-03-19',
}

/** 今天窗口的混合场景：历史撑着总量，最近一次调用与走势来自实时事件，recent 就是走势的最新点。 */
const TODAY = { ...DATA, scope: 'today', session: null, history: HISTORY }

/** 今天窗口只有历史：实时事件一次都没取到，最近一次调用与走势都空。 */
const HISTORY_ONLY = { ...TODAY, recent: null, trend: [] }

/** 真实样例：尺寸矩阵与组件库读的就是这一份文件。 */
interface SampleData {
  history?: { available: boolean }
  recent: { at: number, total: number } | null
  trend: { at: number, value: number }[]
}
const SAMPLES = JSON.parse(
  readFileSync(new URL('../../widgets/session-usage/samples.json', import.meta.url), 'utf8'),
) as Record<string, { data?: SampleData }>

describe('数字换算', () => {
  it('按 K、M、B 换算，数越小留的小数位越多', () => {
    expect(view.compactOf(0, 'en-US')).toEqual({ value: '0', unit: '', text: '0' })
    expect(view.compactOf(999, 'en-US')).toEqual({ value: '999', unit: '', text: '999' })
    expect(view.compactOf(1000, 'en-US')).toEqual({ value: '1', unit: 'K', text: '1K' })
    expect(view.compactOf(12345, 'en-US')).toEqual({ value: '12.3', unit: 'K', text: '12.3K' })
    expect(view.compactOf(2115120, 'en-US')).toEqual({ value: '2.12', unit: 'M', text: '2.12M' })
    expect(view.compactOf(1617820, 'zh-CN').text).toBe('1.62M')
    expect(view.compactOf(2500000000, 'en-US')).toEqual({ value: '2.5', unit: 'B', text: '2.5B' })
  })

  it('不是数字时给占位，不编造读数', () => {
    for (const value of [undefined, null, -1, Number.NaN, '12']) {
      expect(view.compactOf(value, 'zh-CN')).toEqual({ value: '—', unit: '', text: '—' })
      expect(view.formatCount(value, 'en-US')).toBe('—')
    }
  })

  it('完整数字按当前语言分组', () => {
    expect(view.formatCount(2115120, 'en-US')).toBe('2,115,120')
    expect(view.formatCount(12940, 'zh-CN')).toBe('12,940')
    expect(view.formatCount(216, 'en-US')).toBe('216')
  })

  it('占比是一位小数的百分比，总量为零时是 0', () => {
    expect(view.shareOf(412880, 2115120)).toBe(19.5)
    expect(view.shareOf(1531200, 2115120)).toBe(72.4)
    expect(view.shareOf(50, 200)).toBe(25)
    expect(view.shareOf(5, 0)).toBe(0)
    expect(view.shareOf(5, undefined)).toBe(0)
  })

  it('时间写成两位时分，读不出来时是空串', () => {
    expect(view.timeOf(DATA.recent.at, 'zh-CN')).toMatch(new RegExp('^[0-9]{2}:[0-9]{2}$'))
    expect(view.timeOf(undefined, 'zh-CN')).toBe('')
    expect(view.timeOf(-1, 'zh-CN')).toBe('')
  })
})

describe('会话 id', () => {
  it('空值是合法的「不指会话」', () => {
    expect(view.sessionOf(null)).toEqual({ ok: true, session: null })
    expect(view.sessionOf('')).toEqual({ ok: true, session: null })
  })

  it('前 8 位以内照收，更长的说明提供方漏了截断', () => {
    expect(view.sessionOf('a41f7c02')).toEqual({ ok: true, session: 'a41f7c02' })
    expect(view.sessionOf('a41f7c02-9b3e-4d21-8f10-55c1a2d3e4f5').ok).toBe(false)
    expect(view.sessionOf(12).ok).toBe(false)
  })
})

describe('状态判定', () => {
  it('还没读到数据时是加载中', () => {
    expect(view.stateOf(null)).toBe('loading')
    expect(view.stateOf(undefined)).toBe('loading')
  })

  it('形状不对时是数据不完整，不拿缺失字段当 0', () => {
    expect(view.stateOf('x')).toBe('invalid')
    expect(view.stateOf({})).toBe('invalid')
    expect(view.stateOf({ ...DATA, trend: null })).toBe('invalid')
    expect(view.stateOf({ ...DATA, date: '2026/03/19' })).toBe('invalid')
    expect(view.stateOf({ ...DATA, scope: 'week' })).toBe('invalid')
    expect(view.stateOf({ ...DATA, session: 'a41f7c02-9b3e' })).toBe('invalid')
    expect(view.stateOf({ ...DATA, totals: null })).toBe('invalid')
    expect(view.stateOf({ ...DATA, totals: { ...DATA.totals, calls: undefined } })).toBe('invalid')
    expect(view.stateOf({ ...DATA, totals: { ...DATA.totals, estimated: 'no' } })).toBe('invalid')
  })

  it('会话服务缺席是单独一种状态', () => {
    expect(view.stateOf(UNAVAILABLE)).toBe('unavailable')
    expect(view.stateOf({ ...UNAVAILABLE, reason: null })).toBe('invalid')
    expect(view.stateOf({ ...UNAVAILABLE, totals: DATA.totals })).toBe('invalid')
  })

  it('两种空态各自成立，带着读数就不算空', () => {
    expect(view.stateOf({ ...UNAVAILABLE, available: true, reason: null, empty: 'no-sessions' })).toBe('no-sessions')
    expect(view.stateOf(NO_USAGE)).toBe('no-usage')
    expect(view.stateOf({ ...NO_USAGE, totals: DATA.totals })).toBe('invalid')
    expect(view.stateOf({ ...NO_USAGE, empty: 'later' })).toBe('invalid')
  })

  it('读数完整时是 ready', () => {
    expect(view.stateOf(DATA)).toBe('ready')
  })
})

describe('走势', () => {
  it('少于两个点不画折线', () => {
    expect(view.trendOf([], 'en-US')).toBeNull()
    expect(view.trendOf([{ at: 1, value: 10 }], 'en-US')).toBeNull()
    expect(view.trendOf(null, 'en-US')).toBeNull()
  })

  it('两点连成折线，面积闭合到基线', () => {
    const trend = view.trendOf([
      { at: 1, value: 100 },
      { at: 2, value: 200 },
    ], 'en-US')
    expect(trend).not.toBeNull()
    expect(trend?.count).toBe(2)
    expect(trend?.line).toBe('M0 29 L100 3')
    expect(trend?.area).toBe('M0 29 L100 3 L100 29 L0 29 Z')
    expect(trend?.last).toEqual({ x: 100, y: 3 })
    expect(trend?.highFull).toBe('200')
    expect(trend?.latestFull).toBe('200')
  })

  it('读数完全相同时走中线，不画成贴边的直线', () => {
    const trend = view.trendOf([
      { at: 1, value: 100 },
      { at: 2, value: 100 },
    ], 'en-US')
    expect(trend?.line).toBe('M0 16 L100 16')
  })

  it('超过 30 个点时只画最近 30 个', () => {
    const many = Array.from({ length: 40 }, (_, index) => ({ at: index, value: (index + 1) * 100 }))
    const trend = view.trendOf(many, 'en-US')
    expect(trend?.count).toBe(30)
    expect(trend?.line.startsWith('M0 ')).toBe(true)
    expect(trend?.line.endsWith(' L100 3')).toBe(true)
    expect(trend?.latestFull).toBe('4,000')
  })

  it('形状不对的点被跳过，剩下的不足两个就不画', () => {
    const list = [{ at: 1, value: 10 }, null, { at: 2 }, { value: 20 }, { at: 3, value: 'x' }]
    expect(view.trendOf(list, 'en-US')).toBeNull()
  })
})

describe('一次读数的排版', () => {
  it('不是 ready 时只给状态，不带零值读数', () => {
    expect(view.viewOf(null, 'zh-CN')).toEqual({ state: 'loading' })
    expect(view.viewOf(UNAVAILABLE, 'zh-CN')).toEqual({ state: 'unavailable' })
    expect(view.viewOf(NO_USAGE, 'zh-CN')).toEqual({ state: 'no-usage' })
  })

  it('ready 时给出总量、分项、次读与走势', () => {
    const model = view.viewOf(DATA, 'en-US') as {
      state: string
      scope: string
      date: string
      session: string | null
      started: string
      total: { full: string, compact: Compact }
      calls: number
      callsText: string
      estimated: boolean
      parts: { key: string, full: string, compact: Compact, share: number }[]
      recent: { time: string, session: string | null, full: string, estimated: boolean }
      trend: Trend | null
    }
    expect(model.state).toBe('ready')
    expect(model.scope).toBe('session')
    expect(model.date).toBe('2026-03-19')
    expect(model.session).toBe('a41f7c02')
    expect(model.started).toMatch(new RegExp('^[0-9]{2}:[0-9]{2}$'))
    expect(model.total.full).toBe('2,115,120')
    expect(model.total.compact.text).toBe('2.12M')
    expect(model.calls).toBe(216)
    expect(model.callsText).toBe('216')
    expect(model.estimated).toBe(false)
    expect(model.parts.map((part) => part.key)).toEqual(['input', 'output', 'cacheRead', 'cacheWrite'])
    expect(model.parts[0]?.full).toBe('412,880')
    expect(model.parts[0]?.share).toBe(19.5)
    expect(model.parts[2]?.share).toBe(72.4)
    expect(model.recent.full).toBe('12,940')
    expect(model.recent.session).toBe('a41f7c02')
    expect(model.recent.estimated).toBe(false)
    expect(model.trend?.count).toBe(3)
  })

  it('推算过的窗口把标记带到总量与最近一次调用上', () => {
    const model = view.viewOf({
      ...DATA,
      totals: { ...DATA.totals, estimated: true },
      recent: { ...DATA.recent, estimated: true },
    }, 'zh-CN') as { estimated: boolean, recent: { estimated: boolean } }
    expect(model.estimated).toBe(true)
    expect(model.recent.estimated).toBe(true)
  })

  it('推算场景的占比以四项之和为分母，四项合计正好 100%', () => {
    // 宿主缺 totalTokens 时总量按输入与输出推算（100 + 50），缓存两项仍单独累计（200 + 50），
    // 所以分项占比的分母是四项之和 400，不是推算出来的总量 150。
    const estimated = {
      ...DATA,
      totals: { input: 100, output: 50, cacheRead: 200, cacheWrite: 50, total: 150, calls: 3, estimated: true },
    }
    const model = view.viewOf(estimated, 'en-US') as {
      total: { full: string }
      estimated: boolean
      parts: { key: string, share: number }[]
    }
    expect(model.estimated).toBe(true)
    expect(model.total.full).toBe('150')
    expect(model.parts.map((part) => part.share)).toEqual([25, 12.5, 50, 12.5])
    expect(model.parts.reduce((sum, part) => sum + part.share, 0)).toBe(100)
  })

  it('两点以上的走势给出路径，只有一个点时不给', () => {
    const single = view.viewOf({ ...DATA, trend: [DATA.trend[0]] }, 'en-US') as { trend: Trend | null }
    expect(single.trend).toBeNull()
    const ready = view.viewOf(DATA, 'zh-CN') as { trend: Trend | null }
    expect(ready.trend).not.toBeNull()
  })
})

describe('历史来源', () => {
  it('缺省与 null 都是「没有历史这一段」，旧数据因此仍然成立', () => {
    expect(view.historyOf(undefined)).toEqual({ ok: true, history: null })
    expect(view.historyOf(null)).toEqual({ ok: true, history: null })
    expect(view.stateOf(DATA)).toBe('ready')
  })

  it('历史对象要整份对：来源名、可用的布尔、原因枚举与两个日期', () => {
    expect(view.historyOf(HISTORY).ok).toBe(true)
    expect(view.historyOf({ ...HISTORY, available: false, reason: 'not-installed' }).ok).toBe(true)
    expect(view.historyOf({ ...HISTORY, source: 'dsh-sessions' }).ok).toBe(false)
    expect(view.historyOf({ ...HISTORY, available: 'yes' }).ok).toBe(false)
    expect(view.historyOf({ ...HISTORY, reason: 'later' }).ok).toBe(false)
    expect(view.historyOf({ ...HISTORY, capturedAt: -1 }).ok).toBe(false)
    expect(view.historyOf({ ...HISTORY, from: '2026/01/01' }).ok).toBe(false)
    expect(view.historyOf({ ...HISTORY, to: 20260319 }).ok).toBe(false)
    expect(view.historyOf([HISTORY]).ok).toBe(false)
  })

  it('说可用时必须带一个读得到的时间，不可用时没有时间也成立', () => {
    expect(view.historyOf({ ...HISTORY, capturedAt: null }).ok).toBe(false)
    expect(view.historyOf({ ...HISTORY, available: false, reason: 'invalid', capturedAt: null }).ok).toBe(true)
  })

  it('形状不对时整份数据算不完整，不拿实时读数顶替历史', () => {
    expect(view.stateOf({ ...TODAY, history: { ...HISTORY, source: 'x' } })).toBe('invalid')
    expect(view.stateOf({ ...TODAY, history: { ...HISTORY, capturedAt: null } })).toBe('invalid')
    expect(view.stateOf({ ...TODAY, history: { ...HISTORY, reason: 'later' } })).toBe('invalid')
  })

  it('来源分四类：历史、仅实时、未接入与不可用', () => {
    expect(view.sourceOf(undefined)).toBe('realtime')
    expect(view.sourceOf(null)).toBe('realtime')
    expect(view.sourceOf(HISTORY)).toBe('history')
    expect(view.sourceOf({ ...HISTORY, available: false, reason: 'not-installed' })).toBe('not-installed')
    expect(view.sourceOf({ ...HISTORY, available: false, reason: 'unavailable' })).toBe('unavailable')
    expect(view.sourceOf({ ...HISTORY, available: false, reason: 'invalid' })).toBe('unavailable')
  })

  it('没有历史的读数标成仅实时', () => {
    expect(view.viewOf(DATA, 'en-US')).toMatchObject({ source: 'realtime' })
  })
})

describe('只有历史没有最近调用', () => {
  it('recent 与走势都空时仍算 ready，总量与分项照画', () => {
    const model = view.viewOf(HISTORY_ONLY, 'en-US') as {
      state: string
      source: string
      total: { full: string }
      callsText: string
      recent: unknown
      parts: { key: string }[]
      trend: Trend | null
    }
    expect(view.stateOf(HISTORY_ONLY)).toBe('ready')
    expect(model.state).toBe('ready')
    expect(model.source).toBe('history')
    expect(model.recent).toBeNull()
    expect(model.trend).toBeNull()
    expect(model.total.full).toBe('2,115,120')
    expect(model.callsText).toBe('216')
    expect(model.parts.map((part) => part.key)).toEqual(['input', 'output', 'cacheRead', 'cacheWrite'])
  })

  it('recent 不是 null 时形状必须完整，缺字段仍是数据不完整', () => {
    expect(view.stateOf({ ...TODAY, recent: { at: 1, input: 2, output: 3 } })).toBe('invalid')
    expect(view.stateOf(TODAY)).toBe('ready')
  })
})

describe('混合场景的最近一次调用', () => {
  it('recent 就是走势的最新点，总量仍是历史与实时的合计', () => {
    const model = view.viewOf(TODAY, 'en-US') as {
      state: string
      source: string
      recent: { full: string, time: string, estimated: boolean } | null
      trend: Trend | null
    }
    expect(model.state).toBe('ready')
    expect(model.source).toBe('history')
    expect(model.recent).not.toBeNull()
    expect(model.recent?.full).toBe(model.trend?.latestFull)
    expect(model.recent?.full).toBe('12,940')
  })
})

describe('样例里的 recent 与走势', () => {
  it('格式对的两份样例都满足：recent 是走势的最新点，只有历史时两段都空', () => {
    let ready = 0
    for (const [key, sample] of Object.entries(SAMPLES)) {
      if (sample.data === undefined) continue
      ready += 1
      const { recent, trend } = sample.data
      if (recent === null) {
        expect(trend, key).toHaveLength(0)
        continue
      }
      expect(trend.length, key).toBeGreaterThan(0)
      expect(recent.at, key).toBe(trend[trend.length - 1]?.at)
      expect(recent.total, key).toBe(trend[trend.length - 1]?.value)
    }
    expect(ready).toBeGreaterThanOrEqual(2)
  })
})
