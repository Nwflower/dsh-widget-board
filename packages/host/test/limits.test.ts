/**
 * 写入预算（D23）：频率限制按滑动窗口计数，超出的调用不占下一次的额度。
 */
import { describe, expect, it } from 'vitest'
import { createRateLimiter } from '../src/limits'

describe('状态写入的频率限制', () => {
  it('窗口里放行到上限，超出拒绝', () => {
    const limiter = createRateLimiter(3)
    expect(limiter.allow('a')).toBe(true)
    expect(limiter.allow('a')).toBe(true)
    expect(limiter.allow('a')).toBe(true)
    expect(limiter.allow('a')).toBe(false)
  })

  it('不同键各算各的', () => {
    const limiter = createRateLimiter(1)
    expect(limiter.allow('a')).toBe(true)
    expect(limiter.allow('b')).toBe(true)
    expect(limiter.allow('a')).toBe(false)
  })

  it('窗口过去之后重新放行', async () => {
    const limiter = createRateLimiter(1, 20)
    expect(limiter.allow('a')).toBe(true)
    expect(limiter.allow('a')).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 25))
    expect(limiter.allow('a')).toBe(true)
  })
})
