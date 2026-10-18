/**
 * 刷新调度（D6）：什么时候跑、跑多快、谁被读。
 *
 * 调度器不认识组件与数据源，所以它的规则可以用一个手动推进的定时器直接盯着：没有观众不跑、有观众
 * 按最短的间隔跑、只读到期的那几张、一张读不出来不影响别的。
 */
import { describe, expect, it, vi } from 'vitest'
import { createScheduler, intervalOf } from '../src/refresh'
import type { ScheduledCard } from '../src/refresh'

/** 一个手动推进的定时器。 */
function manualTimer() {
  let callback: (() => void) | undefined
  let cancelled = 0
  const setTimer = (next: () => void, _ms: number): { cancel: () => void } => {
    callback = next
    return { cancel: () => { cancelled += 1; callback = undefined } }
  }
  return {
    setTimer,
    /** 推一次定时器。 */
    tick: () => { callback?.() },
    /** 定时器被取消过几次。 */
    get cancelled() { return cancelled },
    get armed() { return callback !== undefined },
  }
}

/** 一套替身。 */
function harness(options: { cards?: ScheduledCard[], viewers?: number } = {}) {
  const timer = manualTimer()
  const read: string[] = []
  const errors: { id: string, error: unknown }[] = []
  const state = { cards: options.cards ?? [{ id: 'a', everyMs: 1000 }], viewers: options.viewers ?? 1 }
  const scheduler = createScheduler({
    cards: () => state.cards,
    viewers: () => state.viewers,
    read: async (id) => { read.push(id) },
    onError: (id, error) => { errors.push({ id, error }) },
    setTimer: timer.setTimer,
  })
  return { scheduler, timer, read, errors, state }
}

describe('调度器', () => {
  it('没有观众时不跑', () => {
    const test = harness({ viewers: 0 })
    test.scheduler.sync()
    expect(test.scheduler.running).toBe(false)
    expect(test.timer.armed).toBe(false)
  })

  it('有观众但没有声明定时刷新的卡片时不跑', () => {
    const test = harness({ cards: [] })
    test.scheduler.sync()
    expect(test.scheduler.running).toBe(false)
  })

  it('有观众又有定时卡片时跑起来，间隔取最短的那个', () => {
    const test = harness({ cards: [{ id: 'a', everyMs: 5000 }, { id: 'b', everyMs: 2000 }] })
    test.scheduler.sync()
    expect(test.scheduler.running).toBe(true)
  })

  it('开始观察时先读一次，之后只读到期的那几张', async () => {
    const test = harness({ cards: [{ id: 'a', everyMs: 1000 }, { id: 'b', everyMs: 10_000 }] })
    test.scheduler.sync()
    expect(test.read).toEqual(['a', 'b'])
    expect(test.scheduler.due.get('a')).toBeGreaterThan(Date.now())
    // 第一次读还没落定之前不重复发；等它回来，再推一次也不读（还没到期）。
    await new Promise((resolve) => setTimeout(resolve, 0))
    test.timer.tick()
    expect(test.read).toEqual(['a', 'b'])
    // 把 a 的到期时刻拨到过去，下一次推进就读它。
    ;(test.scheduler.due as Map<string, number>).set('a', Date.now() - 1)
    test.timer.tick()
    expect(test.read).toEqual(['a', 'b', 'a'])
    ;(test.scheduler.due as Map<string, number>).set('b', Date.now() - 1)
    test.timer.tick()
    expect(test.read).toEqual(['a', 'b', 'a', 'b'])
  })

  it('同一张卡上一次读还没回来时不重复发', () => {
    const timer = manualTimer()
    const read: string[] = []
    let release: (() => void) | undefined
    const scheduler = createScheduler({
      cards: () => [{ id: 'a', everyMs: 1000 }],
      viewers: () => 1,
      read: async (id) => {
        read.push(id)
        await new Promise<void>((resolve) => { release = resolve })
      },
      setTimer: timer.setTimer,
    })
    scheduler.sync()
    timer.tick()
    ;(scheduler.due as Map<string, number>).set('a', Date.now() - 1)
    timer.tick()
    expect(read).toEqual(['a'])
    release?.()
  })

  it('一张卡读不出来不影响别的卡', async () => {
    const timer = manualTimer()
    const errors: string[] = []
    const read: string[] = []
    const scheduler = createScheduler({
      cards: () => [{ id: 'bad', everyMs: 1000 }, { id: 'good', everyMs: 1000 }],
      viewers: () => 1,
      read: async (id) => {
        read.push(id)
        if (id === 'bad') throw new Error('读不出来')
      },
      onError: (id) => { errors.push(id) },
      setTimer: timer.setTimer,
    })
    scheduler.sync()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(read.sort()).toEqual(['bad', 'good'])
    expect(errors).toEqual(['bad'])
  })

  it('观众走光之后停掉', () => {
    const test = harness({ viewers: 1 })
    test.scheduler.sync()
    expect(test.scheduler.running).toBe(true)
    test.state.viewers = 0
    test.scheduler.sync()
    expect(test.scheduler.running).toBe(false)
    expect(test.scheduler.due.size).toBe(0)
  })

  it('卡片走了之后不再占着到期表', () => {
    const test = harness({ cards: [{ id: 'a', everyMs: 1000 }, { id: 'b', everyMs: 1000 }] })
    test.scheduler.sync()
    test.timer.tick()
    expect(test.scheduler.due.has('b')).toBe(true)
    test.state.cards = [{ id: 'a', everyMs: 1000 }]
    test.scheduler.sync()
    expect(test.scheduler.due.has('b')).toBe(false)
  })

  it('间隔没变时不重建定时器', () => {
    const test = harness()
    test.scheduler.sync()
    const before = test.timer.cancelled
    test.scheduler.sync()
    expect(test.timer.cancelled).toBe(before)
  })

  it('stop 之后不再跑', () => {
    const test = harness()
    test.scheduler.sync()
    test.scheduler.stop()
    expect(test.scheduler.running).toBe(false)
    expect(test.scheduler.due.size).toBe(0)
  })
})

describe('刷新策略', () => {
  it('省略或按需时不定时', () => {
    expect(intervalOf(undefined)).toBeUndefined()
    expect(intervalOf({ mode: 'onDemand' })).toBeUndefined()
  })

  it('间隔抬到下限', () => {
    expect(intervalOf({ mode: 'interval', everyMs: 10 })).toBe(1000)
    expect(intervalOf({ mode: 'interval', everyMs: 5000 })).toBe(5000)
  })

  it('没写间隔时用默认值', () => {
    expect(intervalOf({ mode: 'interval' })).toBe(30_000)
  })
})
