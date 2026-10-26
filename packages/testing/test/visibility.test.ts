/**
 * 可见性上报器（D6）：什么时候真的发、什么算被宿主记下、发失败之后还能不能重报。
 *
 * 上报器只在浏览器里跑，所以 `document` 与 `fetch` 用替身。这一层要判定的是「算不算发成功」与
 * 去重：宿主在观众没有在线连接时用 HTTP 200 加 `accepted: false` 表示没记下，把它当成成功会让
 * 这一页重连之后不再重报，严格刷新悄悄退回旧的页级行为。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VisibilityReporting } from '../../client/src/visibility'
import { createVisibilityReporting } from '../../client/src/visibility'

/** 一次上报的回应。 */
type Reply =
  /** 宿主收到了：`accepted` 是真记下，假是这位观众没有在线连接。 */
  | { kind: 'accepted', accepted: boolean }
  /** 别的状态码。 */
  | { kind: 'status', status: number, body?: unknown }
  /** 200 但回的不是 JSON。 */
  | { kind: 'malformed' }
  /** 请求发不出去。 */
  | { kind: 'network' }

/** 一次上报请求记下来的那点东西。 */
interface Posted {
  url: string
  body: string
}

/** 假的 `document`：只留显隐状态与显隐监听。 */
function fakeDocument() {
  const listeners = new Set<() => void>()
  return {
    visibilityState: 'visible' as Document['visibilityState'],
    addEventListener(type: string, listener: () => void): void {
      if (type === 'visibilitychange') listeners.add(listener)
    },
    removeEventListener(type: string, listener: () => void): void {
      if (type === 'visibilitychange') listeners.delete(listener)
    },
    /** 触发一次显隐变化。 */
    fire(): void {
      for (const listener of [...listeners]) listener()
    },
    /** 现在挂着几个显隐监听。 */
    get listening(): number { return listeners.size },
  }
}

/** 原来的全局变量：每个用例之后放回去。 */
const originals = {
  fetch: globalThis.fetch,
  document: (globalThis as { document?: unknown }).document,
}

/** 这一轮装了什么；用例结束收掉。 */
let restore: (() => void) | undefined

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  restore?.()
  restore = undefined
  vi.restoreAllMocks()
})

/** 让这条异步链跑完：一次上报要几个微任务才落定。 */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * 盯着未处理的 Promise 拒绝。
 *
 * @returns 收到的原因，以及停止监听的办法。
 */
function watchRejections() {
  const seen: unknown[] = []
  const listener = (reason: unknown): void => { seen.push(reason) }
  process.on('unhandledRejection', listener)
  return {
    seen,
    stop(): void { process.off('unhandledRejection', listener) },
  }
}

/**
 * 装一套替身。
 *
 * @param replies - 依次给每次上报用的回应。
 * @returns 记下来的请求、假 `document`、建上报器的办法，以及补回应用的办法。
 */
function harness(replies: Reply[]) {
  const calls: Posted[] = []
  const pending = [...replies]
  const doc = fakeDocument()
  globalThis.document = doc as unknown as Document
  globalThis.fetch = (async (url: string, init?: { body?: string }) => {
    calls.push({ url, body: init?.body ?? '' })
    const reply = pending.shift()
    if (reply === undefined) throw new Error(`第 ${String(calls.length)} 次上报没有安排回应`)
    if (reply.kind === 'network') throw new Error('网络断了')
    if (reply.kind === 'status') {
      return { ok: false, status: reply.status, json: async () => reply.body ?? { error: '被拒绝' } }
    }
    if (reply.kind === 'malformed') {
      return {
        ok: true,
        status: 200,
        json: async (): Promise<unknown> => { throw new Error('不是 JSON') },
      }
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, accepted: reply.accepted }) }
  }) as unknown as typeof fetch
  restore = () => {
    if (originals.fetch === undefined) delete (globalThis as { fetch?: unknown }).fetch
    else globalThis.fetch = originals.fetch
    if (originals.document === undefined) delete (globalThis as { document?: unknown }).document
    else (globalThis as { document?: unknown }).document = originals.document
  }
  return {
    calls,
    doc,
    /** 再安排几次回应。 */
    reply(...more: Reply[]): void { pending.push(...more) },
    /** 建一个上报器。 */
    create(): VisibilityReporting { return createVisibilityReporting() },
  }
}

describe('可见性上报', () => {
  it('宿主收下之后，同一份集合不再发', async () => {
    const test = harness([{ kind: 'accepted', accepted: true }])
    const reporting = test.create()
    reporting.report(['b', 'a'])
    await settle()
    expect(test.calls).toHaveLength(1)
    const body = JSON.parse(test.calls[0]?.body ?? '{}') as { viewer?: string, visible?: string[] }
    expect(test.calls[0]?.url).toBe('api/widget-board/visibility')
    // 观众 id 是 12 字节的十六进制：页面级一个，重连沿用同一个。
    expect(body.viewer).toMatch(/^[0-9a-f]{24}$/)
    expect(body.visible).toEqual(['b', 'a'])
    // 顺序不同也算同一份：去重按排好序的集合比。
    reporting.report(['a', 'b'])
    await settle()
    expect(test.calls).toHaveLength(1)
  })

  it('accepted: false 被当成没发出去，重连之后会重报', async () => {
    const test = harness([{ kind: 'accepted', accepted: false }, { kind: 'accepted', accepted: true }])
    const reporting = test.create()
    reporting.report(['a'])
    await settle()
    expect(test.calls).toHaveLength(1)
    // 断线重连：宿主那边这一份已经清掉了。
    reporting.resend()
    await settle()
    expect(test.calls).toHaveLength(2)
  })

  it('accepted: false 之后，同一份集合的下一次上报也会再发', async () => {
    const test = harness([{ kind: 'accepted', accepted: false }, { kind: 'accepted', accepted: true }])
    const reporting = test.create()
    reporting.report(['a'])
    await settle()
    reporting.report(['a'])
    await settle()
    expect(test.calls).toHaveLength(2)
  })

  it('被拒绝的状态码不留下未处理的拒绝，之后还能重报', async () => {
    const rejections = watchRejections()
    try {
      const test = harness([{ kind: 'status', status: 500 }, { kind: 'accepted', accepted: true }])
      const reporting = test.create()
      reporting.report(['a'])
      await settle()
      expect(rejections.seen).toEqual([])
      reporting.resend()
      await settle()
      expect(test.calls).toHaveLength(2)
      expect(rejections.seen).toEqual([])
    } finally {
      rejections.stop()
    }
  })

  it('回的不是 JSON 时按没发出去算，不留下未处理的拒绝', async () => {
    const rejections = watchRejections()
    try {
      const test = harness([{ kind: 'malformed' }, { kind: 'accepted', accepted: true }])
      const reporting = test.create()
      reporting.report(['a'])
      await settle()
      expect(rejections.seen).toEqual([])
      reporting.resend()
      await settle()
      expect(test.calls).toHaveLength(2)
      expect(rejections.seen).toEqual([])
    } finally {
      rejections.stop()
    }
  })

  it('请求发不出去时同样不留下未处理的拒绝，之后还能重报', async () => {
    const rejections = watchRejections()
    try {
      const test = harness([{ kind: 'network' }, { kind: 'accepted', accepted: true }])
      const reporting = test.create()
      reporting.report(['a'])
      await settle()
      expect(rejections.seen).toEqual([])
      reporting.resend()
      await settle()
      expect(test.calls).toHaveLength(2)
      expect(rejections.seen).toEqual([])
    } finally {
      rejections.stop()
    }
  })

  it('页面藏起来报空集合，恢复时报回观察到的那些卡', async () => {
    const test = harness([
      { kind: 'accepted', accepted: true },
      { kind: 'accepted', accepted: true },
      { kind: 'accepted', accepted: true },
    ])
    const reporting = test.create()
    reporting.report(['a', 'b'])
    await settle()
    expect(test.calls).toHaveLength(1)
    test.doc.visibilityState = 'hidden'
    test.doc.fire()
    await settle()
    expect(JSON.parse(test.calls[1]?.body ?? '{}')).toMatchObject({ visible: [] })
    test.doc.visibilityState = 'visible'
    test.doc.fire()
    await settle()
    expect(JSON.parse(test.calls[2]?.body ?? '{}')).toMatchObject({ visible: ['a', 'b'] })
  })

  it('卸下时报一次空集合并摘掉显隐监听', async () => {
    const test = harness([{ kind: 'accepted', accepted: true }, { kind: 'accepted', accepted: true }])
    const reporting = test.create()
    expect(test.doc.listening).toBe(1)
    reporting.report(['a'])
    await settle()
    reporting.dispose()
    expect(test.doc.listening).toBe(0)
    await settle()
    expect(test.calls).toHaveLength(2)
    expect(JSON.parse(test.calls[1]?.body ?? '{}')).toMatchObject({ visible: [] })
  })
})
