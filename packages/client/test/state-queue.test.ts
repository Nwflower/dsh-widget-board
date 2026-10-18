/**
 * 状态待写队列（D5、D23）：同一个窗口里的补丁只发一次，失败放回队首重试，暂停与卸载时立即发送。
 *
 * 定时器换成手动推进的那一个，发送换成记录用的替身；队列自己不认识看板与网络。
 */
import { describe, expect, it } from 'vitest'
import { createStateQueue } from '../src/state-queue'

/** 等一轮微任务，让队列里的 async 发送落定。 */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * 一套替身。
 *
 * @param send - 真正发送时的行为；默认记录成功。
 * @returns 队列、待推进的定时器、发出去的补丁与失败原因。
 */
function harness(send: (patch: unknown) => Promise<void> = async () => undefined) {
  const timers: Array<() => void> = []
  const sent: unknown[] = []
  const errors: Error[] = []
  let saved = 0
  const queue = createStateQueue({
    send: async (patch) => {
      sent.push(patch)
      await send(patch)
    },
    onError: (error) => { errors.push(error) },
    onSaved: () => { saved += 1 },
    setTimer: (callback) => {
      timers.push(callback)
      return {
        cancel: () => {
          const at = timers.indexOf(callback)
          if (at >= 0) timers.splice(at, 1)
        },
      }
    },
  })
  return { queue, timers, sent, errors, get saved() { return saved }, tick: () => { timers.shift()?.() } }
}

describe('状态待写队列', () => {
  it('窗口里的几条补丁合成一次发送', async () => {
    const test = harness()
    test.queue.push({ a: 1 })
    test.queue.push({ b: 2 })
    test.queue.push({ a: 3 })
    expect(test.sent).toEqual([])
    test.tick()
    await settle()
    expect(test.sent).toEqual([{ a: 3, b: 2 }])
  })

  it('补丁不是对象时整体替换', async () => {
    const test = harness()
    test.queue.push({ a: 1 })
    test.queue.push(['x'])
    test.tick()
    await settle()
    expect(test.sent).toEqual([['x']])
  })

  it('合并后的补丁超过上限时提前发送', async () => {
    const test = harness()
    test.queue.push('x'.repeat(13 * 1024))
    await settle()
    expect(test.sent).toEqual(['x'.repeat(13 * 1024)])
    expect(test.timers).toEqual([])
  })

  it('发送失败时把补丁放回队首，按退避重试', async () => {
    let attempt = 0
    const test = harness(async () => {
      attempt += 1
      if (attempt === 1) throw new Error('宿主没接')
    })
    test.queue.push({ a: 1 })
    test.tick()
    await settle()
    expect(test.errors).toHaveLength(1)
    expect(test.sent).toEqual([{ a: 1 }])
    expect(test.timers).toHaveLength(1)
    test.queue.push({ b: 2 })
    test.tick()
    await settle()
    expect(test.sent).toEqual([{ a: 1 }, { a: 1, b: 2 }])
    expect(test.saved).toBe(1)
    expect(test.errors).toHaveLength(1)
  })

  it('请求在途时新来的补丁等它结束再发', async () => {
    let release: (() => void) | undefined
    const test = harness(async () => {
      await new Promise<void>((resolve) => { release = resolve })
    })
    test.queue.push({ a: 1 })
    test.tick()
    await settle()
    test.queue.push({ b: 2 })
    release?.()
    await settle()
    test.tick()
    await settle()
    expect(test.sent).toEqual([{ a: 1 }, { b: 2 }])
  })

  it('dispose 把最后一份补丁送出去', async () => {
    const test = harness()
    test.queue.push({ a: 1 })
    test.queue.dispose()
    await settle()
    expect(test.sent).toEqual([{ a: 1 }])
  })

  it('连续失败超过上限后停掉自动重试，新的 push 重新开始', async () => {
    const test = harness(async () => { throw new Error('一直失败') })
    test.queue.push({ a: 1 })
    test.tick()
    await settle()
    for (let attempt = 0; attempt < 5; attempt += 1) {
      test.tick()
      await settle()
    }
    expect(test.timers).toHaveLength(0)
    test.queue.push({ b: 2 })
    expect(test.timers).toHaveLength(1)
  })
})
