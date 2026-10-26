/**
 * 启动前的历史投影：overview 的字段映射、all 的回退次序，以及没装、读不到、形状不合格这三类失败。
 *
 * 请求由测试直接给出（`fetch` 是模块自己声明的依赖），不经过真实端口；分类只按状态码、网络与正文判定。
 */
import { describe, expect, it } from 'vitest'
import type { UsageHistoryFetch, UsageHistoryResponse } from '../src/dsh-usage'
import {
  USAGE_HISTORY_PATH,
  USAGE_HISTORY_SOURCE,
  historyFailure,
  historyOf,
  historyTallyOf,
  hostOriginOf,
  readUsageHistory,
} from '../src/dsh-usage'

const ORIGIN = 'http://127.0.0.1:3080'

/** overview 里的一份 totals，字段名沿用 dsh-usage 的叫法。 */
function totals(parts: { input?: number, output?: number, cacheRead?: number, cacheWrite?: number, calls?: number } = {}) {
  return {
    inputTokens: parts.input ?? 0,
    outputTokens: parts.output ?? 0,
    cacheReadTokens: parts.cacheRead ?? 0,
    cacheWriteTokens: parts.cacheWrite ?? 0,
    reasoningTokens: 0,
    calls: parts.calls ?? 0,
    cost: 0,
  }
}

/** 一份 dsh-usage 会答的 overview；两层 overrides 分别替换文档与 `usage` 里的字段。 */
function overview(
  document: Record<string, unknown> = {},
  usage: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    updatedAt: 1_760_000_000_000,
    current: { source: 'default' },
    providers: [],
    usage: {
      today: {
        date: '2026-10-25',
        totals: totals({ input: 10, output: 5, cacheRead: 100, cacheWrite: 2, calls: 3 }),
        providers: [],
      },
      days: [
        { date: '2026-10-24', totals: totals({ input: 1, output: 1, calls: 1 }) },
        { date: '2026-10-25', totals: totals({ input: 10, output: 5, cacheRead: 100, cacheWrite: 2, calls: 3 }) },
      ],
      range: { from: '2026-10-01', to: '2026-10-25', totals: totals({ input: 20, output: 8, calls: 5 }), providers: [] },
      all: {
        from: '2026-09-01',
        to: '2026-10-25',
        totals: totals({ input: 40, output: 20, cacheRead: 200, cacheWrite: 4, calls: 9 }),
        providers: [],
      },
      ...usage,
    },
    ...document,
  }
}

/** 一个 200 与给定正文的响应。 */
function answered(body: unknown, status = 200): UsageHistoryResponse {
  return { status, ok: status >= 200 && status < 300, json: async () => body }
}

/** 一个请求替身：答同一份响应，或抛出同一个错误，并记下被调用的地址。 */
function fetcher(answer: UsageHistoryResponse | Error): { fetch: UsageHistoryFetch, urls: string[] } {
  const urls: string[] = []
  const fetch: UsageHistoryFetch = async (url) => {
    urls.push(url)
    if (answer instanceof Error) throw answer
    return answer
  }
  return { fetch, urls }
}

describe('历史用量的读取', () => {
  it('today 的边界是当天，all 取宿主折好的全部窗口，合计按四个分桶相加', async () => {
    const { fetch, urls } = fetcher(answered(overview()))
    const history = await readUsageHistory({ origin: () => ORIGIN, fetch })
    expect(urls).toEqual([`${ORIGIN}${USAGE_HISTORY_PATH}`])
    expect(history).toEqual({
      available: true,
      reason: null,
      capturedAt: 1_760_000_000_000,
      today: {
        from: '2026-10-25',
        to: '2026-10-25',
        tally: { input: 10, output: 5, cacheRead: 100, cacheWrite: 2, total: 117, calls: 3 },
      },
      all: {
        from: '2026-09-01',
        to: '2026-10-25',
        tally: { input: 40, output: 20, cacheRead: 200, cacheWrite: 4, total: 264, calls: 9 },
      },
    })
  })

  it('没有 usage.all 时退回 usage.range 的边界与合计', async () => {
    const { fetch } = fetcher(answered(overview({}, { all: undefined })))
    const history = await readUsageHistory({ origin: () => ORIGIN, fetch })
    expect(history.all).toEqual({
      from: '2026-10-01',
      to: '2026-10-25',
      tally: { input: 20, output: 8, cacheRead: 0, cacheWrite: 0, total: 28, calls: 5 },
    })
  })

  it('两个窗口都没有时按 usage.days 求和，边界取最早与最晚的那一天', async () => {
    const { fetch } = fetcher(answered(overview({}, { all: undefined, range: undefined })))
    const history = await readUsageHistory({ origin: () => ORIGIN, fetch })
    expect(history.all).toEqual({
      from: '2026-10-24',
      to: '2026-10-25',
      tally: { input: 11, output: 6, cacheRead: 100, cacheWrite: 2, total: 119, calls: 4 },
    })
  })

  it('404 与 401 记成没装，403 等其它 HTTP 失败记成读不到', async () => {
    for (const status of [401, 404]) {
      const missing = await readUsageHistory({ origin: () => ORIGIN, fetch: fetcher(answered({ ok: false }, status)).fetch })
      expect(missing).toEqual(historyFailure('not-installed'))
    }
    for (const status of [403, 500, 502]) {
      const failed = await readUsageHistory({ origin: () => ORIGIN, fetch: fetcher(answered({ ok: false }, status)).fetch })
      expect(failed).toEqual(historyFailure('unavailable'))
    }
  })

  it('网络失败与拿不到根地址都记成读不到，且后者不发请求', async () => {
    const refused = await readUsageHistory({ origin: () => ORIGIN, fetch: fetcher(new Error('connect ECONNREFUSED')).fetch })
    expect(refused).toEqual(historyFailure('unavailable'))
    const blind = fetcher(answered(overview()))
    expect(await readUsageHistory({ origin: () => undefined, fetch: blind.fetch })).toEqual(historyFailure('unavailable'))
    expect(blind.urls).toEqual([])
  })

  it('正文不是 JSON、缺关键字段或分桶不是数字都记成形状不合格', async () => {
    const broken: UsageHistoryResponse = {
      status: 200,
      ok: true,
      json: async () => { throw new SyntaxError('Unexpected token < in JSON') },
    }
    expect(await readUsageHistory({ origin: () => ORIGIN, fetch: fetcher(broken).fetch })).toEqual(historyFailure('invalid'))
    const bodies = [
      overview({ updatedAt: undefined }),
      overview({ updatedAt: -1 }),
      overview({ usage: undefined }),
      overview({}, { today: undefined }),
      overview({}, { today: { date: '2026/10/25', totals: totals({ calls: 1 }) } }),
      overview({}, { today: { date: '2026-10-25', totals: totals({ calls: 1, input: -5 }) } }),
      overview({}, { today: { date: '2026-10-25' } }),
      overview({}, { all: undefined, range: undefined, days: undefined }),
      overview({}, { all: undefined, range: undefined, days: [{ date: '2026-10-24' }] }),
    ]
    for (const body of bodies) {
      expect(await readUsageHistory({ origin: () => ORIGIN, fetch: fetcher(answered(body)).fetch })).toEqual(historyFailure('invalid'))
    }
  })

  it('宿主根地址取自 web 服务的 getOrigin，缺席或端口还没绑上时是 undefined', () => {
    expect(hostOriginOf({ webServer: { register: () => () => {}, getOrigin: () => ORIGIN } })).toBe(ORIGIN)
    expect(hostOriginOf({ webServer: { register: () => () => {} } })).toBeUndefined()
    expect(hostOriginOf({})).toBeUndefined()
    expect(hostOriginOf({
      webServer: {
        register: () => () => {},
        getOrigin: () => { throw new Error('端口还没绑定') },
      },
    })).toBeUndefined()
  })
})

describe('交给卡片的来源元数据', () => {
  const projection = {
    available: true,
    reason: null,
    capturedAt: 1_760_000_000_000,
    today: { from: '2026-10-25', to: '2026-10-25', tally: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, total: 2, calls: 1 } },
    all: { from: '2026-09-01', to: '2026-10-25', tally: { input: 4, output: 2, cacheRead: 0, cacheWrite: 0, total: 6, calls: 3 } },
  } as const

  it('session 窗口不给历史，today 与 all 各给自己的边界', () => {
    expect(historyOf(projection, 'session')).toBeNull()
    expect(historyOf(projection, 'today')).toEqual({
      source: USAGE_HISTORY_SOURCE,
      available: true,
      reason: null,
      capturedAt: 1_760_000_000_000,
      from: '2026-10-25',
      to: '2026-10-25',
    })
    expect(historyOf(projection, 'all')).toMatchObject({ available: true, from: '2026-09-01', to: '2026-10-25' })
  })

  it('历史不可用时保留原因，边界与时刻都是 null', () => {
    for (const reason of ['not-installed', 'unavailable', 'invalid'] as const) {
      expect(historyOf(historyFailure(reason), 'today')).toEqual({
        source: USAGE_HISTORY_SOURCE,
        available: false,
        reason,
        capturedAt: null,
        from: null,
        to: null,
      })
    }
    expect(historyOf(null, 'all')).toMatchObject({ available: false, reason: 'unavailable', capturedAt: null })
    expect(historyOf(null, 'session')).toBeNull()
  })

  it('历史合计只在可用的窗口里给出来，session 永远没有', () => {
    expect(historyTallyOf(projection, 'today')?.total).toBe(2)
    expect(historyTallyOf(projection, 'all')?.calls).toBe(3)
    expect(historyTallyOf(projection, 'session')).toBeNull()
    expect(historyTallyOf(historyFailure('not-installed'), 'today')).toBeNull()
    expect(historyTallyOf(null, 'today')).toBeNull()
  })
})
