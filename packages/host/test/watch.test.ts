/**
 * 按目录共享的监视（D17）：同一个目录只有一个底层监视，最后一个把手释放时才停掉。
 */
import { describe, expect, it } from 'vitest'
import { createWatchRegistry } from '../src/watch'

/**
 * 一份记下取用与停止的监视。
 *
 * @returns 监视与它记下的事件。
 */
function recorder(): { registry: ReturnType<typeof createWatchRegistry>, starts: string[], stops: string[] } {
  const starts: string[] = []
  const stops: string[] = []
  const registry = createWatchRegistry((dir) => {
    starts.push(dir)
    return () => { stops.push(dir) }
  })
  return { registry, starts, stops }
}

describe('按目录共享的监视', () => {
  it('同一个目录只挂一份监视，最后一个把手释放才停掉', () => {
    const { registry, starts, stops } = recorder()
    const first = registry.acquire('/shared')
    const second = registry.acquire('/shared')
    expect(starts).toEqual(['/shared'])
    first()
    expect(stops).toEqual([])
    expect(registry.size).toBe(1)
    second()
    expect(stops).toEqual(['/shared'])
    expect(registry.size).toBe(0)
  })

  it('重复释放同一份只算一次，不会顺手停掉别人的', () => {
    const { registry, stops } = recorder()
    const first = registry.acquire('/shared')
    registry.acquire('/shared')
    first()
    first()
    expect(stops).toEqual([])
  })

  it('全部释放之后再取一份会重新挂上', () => {
    const { registry, starts } = recorder()
    registry.acquire('/shared')()
    registry.acquire('/shared')
    expect(starts).toEqual(['/shared', '/shared'])
  })

  it('stopAll 停掉全部目录并清空', () => {
    const { registry, stops } = recorder()
    registry.acquire('/one')
    registry.acquire('/two')
    registry.acquire('/one')
    registry.stopAll()
    expect(stops.sort()).toEqual(['/one', '/two'])
    expect(registry.size).toBe(0)
  })
})