/**
 * 写入预算（D23）：不可信的组件决定不了宿主的写入量。
 *
 * 一张卡的状态有额度，写入有频率上限；看板这一层再有一道总频率上限。限额是拒绝，不是延后写：
 * 宿主的「每次写入同步落盘」不变（D5），超出的请求收到 413 或 429 并在卡片上写明原因。
 */

/** 一张卡存下的状态最多多少字节。 */
export const STATE_BYTES_LIMIT = 64 * 1024

/** 一块看板上全部卡片的状态合计最多多少字节。 */
export const BOARD_STATE_BYTES_LIMIT = 1024 * 1024

/** 一张卡一秒内最多写几次状态。 */
export const STATE_WRITES_PER_SECOND = 10

/** 一块看板一秒内最多写几次状态。 */
export const BOARD_STATE_WRITES_PER_SECOND = 20

/** 频率限制：每个键在一个滑动窗口里允许的次数。 */
export interface RateLimiter {
  /**
   * 记一次尝试。
   *
   * @param key - 卡片或看板的 id。
   * @returns 这一次在额度内时为真；超出的调用不计数。
   */
  allow(key: string): boolean
}

/** 频率限制表超过这么多键时顺手清一次过期记录。 */
const SWEEP_AT = 1024

/**
 * 建一张滑动窗口的频率限制表。
 *
 * @param limit - 窗口里允许的次数。
 * @param windowMs - 窗口长度，默认一秒。
 * @returns 限制表。
 */
export function createRateLimiter(limit: number, windowMs = 1000): RateLimiter {
  const hits = new Map<string, number[]>()
  return {
    allow(key) {
      const now = Date.now()
      const recent = (hits.get(key) ?? []).filter((at) => now - at < windowMs)
      if (recent.length >= limit) {
        hits.set(key, recent)
        return false
      }
      recent.push(now)
      hits.set(key, recent)
      if (hits.size > SWEEP_AT) {
        for (const [candidate, times] of hits) {
          if (times.every((at) => now - at >= windowMs)) hits.delete(candidate)
        }
      }
      return true
    },
  }
}
