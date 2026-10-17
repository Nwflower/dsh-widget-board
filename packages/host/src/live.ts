/**
 * 变更通知：组件库或运行时变了，就把新的修订号推给在线的看板页（D7 的热重载）。
 *
 * 下载文档的路由不带缓存，客户端收到修订号后重新取一次快照；哈希变了，卡片换一个 iframe，用户
 * 不用刷新页面。
 */
import type { HostResponse } from '@dsh-widget-board/contracts'
import type { DocumentAssets } from './document'

/** 在线客户端共享的一份：当前资产、当前修订号，以及订阅它们的响应。 */
export interface Live {
  readonly assets: DocumentAssets
  readonly revision: number
  /** 接一个 SSE 连接：先补一份当前修订号，之后跟着变化推。 */
  subscribe(response: HostResponse): void
  /** 换一份资产，修订号加一并推给所有观众。 */
  publish(assets: DocumentAssets): void
  /** 收掉心跳与全部观众。 */
  close(): void
}

/** 心跳的间隔：反向代理与桌面外壳都会掐掉长时间没有字节的连接。 */
const HEARTBEAT_MS = 20_000

/**
 * 建一个变更通知。
 *
 * @param assets - 启动时读到的运行时资产。
 * @returns 通知器。
 */
export function createLive(assets: DocumentAssets): Live {
  let current = assets
  let revision = 0
  const audience = new Set<HostResponse>()
  const heartbeat = setInterval(() => {
    for (const response of audience) response.write?.(': ping\n\n')
  }, HEARTBEAT_MS)
  heartbeat.unref()
  const announce = (): void => {
    const frame = `data: ${JSON.stringify({ revision })}\n\n`
    for (const response of audience) response.write?.(frame)
  }
  return {
    get assets() { return current },
    get revision() { return revision },
    subscribe(response) {
      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        connection: 'keep-alive',
      })
      audience.add(response)
      announce()
      // 长连接没有响应体结束的那一刻，观众离开只有这一个信号。
      response.on?.('close', () => { audience.delete(response) })
    },
    publish(next) {
      current = next
      revision += 1
      announce()
    },
    close() {
      clearInterval(heartbeat)
      audience.clear()
    },
  }
}
