/**
 * 可见性登记（D6）：谁看得见哪些卡、几页怎么取并集、断线与重连怎么清。
 *
 * 观众是一条长连接，替身因此只需要「被写过什么」与「能手动断开」；调度器读的并集直接问 `Live`。
 */
import { describe, expect, it } from 'vitest'
import type { BoardEventFrame, HostResponse } from '@dsh-widget-board/contracts'
import type { DocumentAssets } from '../src/document'
import type { VisibleCards } from '../src/live'
import { createLive } from '../src/live'

const ASSETS: DocumentAssets = { tokensCss: '', suiteCss: '', runtimeJs: '', libs: {} }

/** 一条接上的长连接。 */
class Audience implements HostResponse {
  body = ''
  ended = false
  /** 这条连接现在写不出去了：模拟半条消息上断开的观众。 */
  broken = false
  private closes: (() => void)[] = []

  writeHead(): this { return this }

  end(): this {
    this.ended = true
    return this
  }

  write(chunk: string): this {
    if (this.broken) throw new Error('这条连接已经断了')
    this.body += chunk
    return this
  }

  on(event: 'close', listener: () => void): this {
    if (event === 'close') this.closes.push(listener)
    return this
  }

  /** 模拟这条连接断开。 */
  disconnect(): void {
    for (const listener of this.closes.splice(0)) listener()
  }
}

/**
 * 一套替身：一个通知器，以及记下来的可见集合变化次数。
 *
 * @returns 通知器与打开连接、收尾的办法。
 */
function harness() {
  const live = createLive(ASSETS)
  /** 可见集合变化的次数。 */
  const changes = { count: 0 }
  const stop = live.onVisible(() => { changes.count += 1 })
  return {
    live,
    changes,
    dispose(): void {
      stop()
      live.close()
    },
    /**
     * 接一个观众。
     *
     * @param viewer - 观众身份；省略时模拟不带 id 的老页面。
     * @returns 这条连接。
     */
    open(viewer?: string): Audience {
      const response = new Audience()
      live.subscribe(response, viewer)
      return response
    },
  }
}

/** 把并集读成排好序的数组，断言里好比对。 */
function ids(live: { readonly visible: VisibleCards }): string[] {
  const visible = live.visible
  return visible === 'all' ? ['all'] : [...visible].sort()
}

describe('可见性登记', () => {
  it('有人连上却还没上报时按旧的页级行为算全部可见', () => {
    const test = harness()
    test.open('one')
    expect(test.live.visible).toBe('all')
    test.dispose()
  })

  it('上报之后按上报的算，空集合就是这一页没有卡片', () => {
    const test = harness()
    test.open('one')
    expect(test.live.reportVisible('one', ['a', 'b'])).toBe(true)
    expect(ids(test.live)).toEqual(['a', 'b'])
    test.live.reportVisible('one', [])
    expect(ids(test.live)).toEqual([])
    test.dispose()
  })

  it('两页的可见集合取并集', () => {
    const test = harness()
    test.open('one')
    test.open('two')
    test.live.reportVisible('one', ['a', 'b'])
    test.live.reportVisible('two', ['b', 'c'])
    expect(ids(test.live)).toEqual(['a', 'b', 'c'])
    test.dispose()
  })

  it('有一位观众还没上报时整体回到全部可见', () => {
    const test = harness()
    test.open('one')
    test.open('two')
    test.live.reportVisible('one', ['a'])
    expect(test.live.visible).toBe('all')
    test.live.reportVisible('two', ['b'])
    expect(ids(test.live)).toEqual(['a', 'b'])
    test.dispose()
  })

  it('不带观众身份的老页面同样让整体回到全部可见', () => {
    const test = harness()
    test.open('one')
    test.live.reportVisible('one', ['a'])
    expect(ids(test.live)).toEqual(['a'])
    test.open()
    expect(test.live.visible).toBe('all')
    test.dispose()
  })

  it('可见集合没变时不再通知', () => {
    const test = harness()
    test.open('one')
    const before = test.changes.count
    test.live.reportVisible('one', ['a'])
    expect(test.changes.count).toBe(before + 1)
    test.live.reportVisible('one', ['a'])
    expect(test.changes.count).toBe(before + 1)
    test.dispose()
  })

  it('一条连接断开就清掉这位观众的可见集合', () => {
    const test = harness()
    const first = test.open('one')
    const second = test.open('two')
    test.live.reportVisible('one', ['a'])
    test.live.reportVisible('two', ['b'])
    expect(test.live.viewers).toBe(2)
    second.disconnect()
    expect(test.live.viewers).toBe(1)
    expect(ids(test.live)).toEqual(['a'])
    first.disconnect()
    expect(test.live.viewers).toBe(0)
    expect(ids(test.live)).toEqual([])
    test.dispose()
  })

  it('重连沿用同一个观众 id：旧连接断开不清掉新的那一份', () => {
    const test = harness()
    const stale = test.open('one')
    test.live.reportVisible('one', ['a'])
    const fresh = test.open('one')
    test.live.reportVisible('one', ['a', 'b'])
    stale.disconnect()
    expect(test.live.viewers).toBe(1)
    expect(ids(test.live)).toEqual(['a', 'b'])
    fresh.disconnect()
    expect(test.live.viewers).toBe(0)
    test.dispose()
  })

  it('同一页的两条连接：一条关掉不清掉这页上报的那一份', () => {
    const test = harness()
    // 看板页与设置页各订阅一次，用的是同一个观众 id。
    test.open('one')
    const settings = test.open('one')
    test.live.reportVisible('one', ['a'])
    expect(ids(test.live)).toEqual(['a'])
    settings.disconnect()
    expect(test.live.viewers).toBe(1)
    expect(test.live.reportVisible('one', ['a', 'b'])).toBe(true)
    expect(ids(test.live)).toEqual(['a', 'b'])
    test.dispose()
  })

  it('没有接上的观众上报不记', () => {
    const test = harness()
    expect(test.live.reportVisible('ghost', ['a'])).toBe(false)
    expect(ids(test.live)).toEqual([])
    const gone = test.open('one')
    gone.disconnect()
    expect(test.live.reportVisible('one', ['a'])).toBe(false)
    expect(ids(test.live)).toEqual([])
    test.dispose()
  })

  it('写不出去的那条连接被摘掉，其余连接照常收通知', () => {
    const test = harness()
    const healthy = test.open('one')
    const broken = test.open('two')
    broken.broken = true
    test.live.notify({ type: 'board' })
    expect(test.live.viewers).toBe(1)
    expect(healthy.body).toContain('"type":"board"')
    test.dispose()
  })

  it('接上时先补一条重取快照的通知', () => {
    const test = harness()
    const response = test.open('one')
    const frames = response.body.split('\n\n').filter((line) => line.startsWith('data: ')).map((line) => JSON.parse(line.slice(6)) as BoardEventFrame)
    expect(frames).toHaveLength(1)
    expect(frames[0]?.event).toEqual({ type: 'board' })
    expect(frames[0]?.revision).toBe(0)
    test.dispose()
  })

  it('收掉之后不再有观众', () => {
    const test = harness()
    const response = test.open('one')
    test.live.reportVisible('one', ['a'])
    test.dispose()
    expect(test.live.viewers).toBe(0)
    expect(response.ended).toBe(true)
    expect(ids(test.live)).toEqual([])
  })
})
