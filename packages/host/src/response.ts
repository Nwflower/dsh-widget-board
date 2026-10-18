/**
 * 路由的 JSON 响应：状态码、内容类型与禁止缓存只在这里写一次。
 */
import type { HostResponse } from '@dsh-widget-board/contracts'

/**
 * 回一条 JSON。
 *
 * @param response - 宿主的响应。
 * @param status - HTTP 状态码。
 * @param body - 要序列化的值。
 */
export function json(response: HostResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  response.end(JSON.stringify(body))
}
