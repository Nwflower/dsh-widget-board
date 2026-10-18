/**
 * 读请求体（D1）：一条上限，一种读法。
 *
 * 文本与字节走同一条读取循环，上限之外一律 413；JSON 解析失败是 400。放在一处，路由与分享导入
 * 共用同一套判定。
 */
import type { HostRequest } from '@dsh-widget-board/contracts'
import { Refusal } from './refusal'

/**
 * 读一个请求体的全部字节，超过上限就拒绝。
 *
 * @param request - 宿主的请求。
 * @param limit - 允许的最大字节数。
 * @returns 字节。
 * @throws {Refusal} 超过上限（413）。
 */
export async function readBody(request: HostRequest, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
    size += buffer.length
    if (size > limit) throw new Refusal(413, `请求体超过 ${String(limit)} 字节`)
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

/**
 * 读一个 JSON 请求体，超过上限就拒绝。
 *
 * @param request - 宿主的请求。
 * @param limit - 允许的最大字节数。
 * @returns 解出来的 JSON；请求体是空的时是 `undefined`。
 * @throws {Refusal} 超过上限（413）或不是合法 JSON（400）。
 */
export async function readJson(request: HostRequest, limit: number): Promise<unknown> {
  const text = (await readBody(request, limit)).toString('utf8')
  if (text === '') return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Refusal(400, '请求体不是合法 JSON')
  }
}
