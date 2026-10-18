/**
 * 请求体与 JSON 值的小判定：路由、状态层与工具共用一份，免得同一个写法散在各处。
 */

/**
 * 普通的 JSON 对象。
 *
 * @param value - 任意值。
 * @returns 是非数组的对象时为真。
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
