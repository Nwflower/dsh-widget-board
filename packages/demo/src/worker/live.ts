/**
 * 变更通知（D18）：演示宿主把发生了什么推给开着的看板页。
 *
 * 帧的形状与真实宿主一致：`{ revision, event }`，接上时先补一条「重取快照」。连接由页面的
 * `EventSource` 发起，响应是一条不结束的 `text/event-stream`；Service Worker 被浏览器回收时
 * 连接断开，页面的 `EventSource` 自己重连，重连时补的那条通知让页面重取快照。
 */
import type { BoardEvent, BoardEventFrame } from '@dsh-widget-board/contracts'

/** 心跳间隔：中间的代理会掐掉长时间没有字节的连接。 */
const HEARTBEAT_MS = 20_000

/** 变更通知的发布者。 */
export interface Live {
  /** 接一个 SSE 连接，返回要给页面的响应。 */
  subscribe(): Response
  /** 推一条改动。 */
  notify(event: BoardEvent): void
}

/**
 * 建一个变更通知。
 *
 * @returns 发布者。
 */
export function createLive(): Live {
  const encoder = new TextEncoder()
  const audience = new Set<ReadableStreamDefaultController<Uint8Array>>()
  let revision = 0
  const frameOf = (event: BoardEvent): Uint8Array => {
    const frame: BoardEventFrame = { revision, event }
    return encoder.encode(`data: ${JSON.stringify(frame)}\n\n`)
  }
  setInterval(() => {
    for (const controller of audience) controller.enqueue(encoder.encode(': ping\n\n'))
  }, HEARTBEAT_MS)
  return {
    subscribe() {
      let connection: ReadableStreamDefaultController<Uint8Array> | undefined
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          connection = controller
          audience.add(controller)
          controller.enqueue(frameOf({ type: 'board' }))
        },
        cancel() {
          if (connection !== undefined) audience.delete(connection)
        },
      })
      return new Response(body, {
        headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store' },
      })
    },
    notify(event) {
      revision += 1
      const payload = frameOf(event)
      for (const controller of audience) {
        try {
          controller.enqueue(payload)
        } catch {
          // 页面已经离开、流已经关闭：把这个观众摘掉，其余观众照常收（D11）。
          audience.delete(controller)
        }
      }
    },
  }
}
