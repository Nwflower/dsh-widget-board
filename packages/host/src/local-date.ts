/**
 * 本地时区的自然日（D24 的两次用量汇总共用）。
 *
 * 折会话日志与实时聚合都要把一个时刻归到本地的哪一天：规则写在这里一处，两处读同一份。
 */

/**
 * 一个时刻在本地时区的自然日。
 *
 * 跨零点不需要定时器：调用方每读一次按当时的时刻算，写入时按事件自己的时刻分桶。
 *
 * @param time - Unix 毫秒。
 * @returns YYYY-MM-DD；时刻无效（NaN、Infinity、超出 Date 的范围）时是 null，调用方据此跳过这条事件。
 */
export function localDate(time: number): string | null {
  const date = new Date(time)
  if (!Number.isFinite(date.getTime())) return null
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
