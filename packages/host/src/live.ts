/**
 * 变更通知：宿主把发生了什么推给在线的看板页（D18）。
 *
 * 一条通知带一个全局修订号与改动本身：卡片状态与数据就地合并，布局就地换掉，只有卡片增删与
 * 组件库变化才让页面重取快照。接上时先补一条「重取快照」，页面因此不必在订阅与取快照之间选先后。
 */
import type { BoardEvent, BoardEventFrame, HostResponse } from '@dsh-widget-board/contracts'
import type { DocumentAssets } from './document'

/** 在线客户端共享的一份：当前资产、当前修订号，以及订阅它们的响应。 */
export interface Live {
  readonly assets: DocumentAssets
  readonly revision: number
  /** 现在有几个看板页接着这条通知（D6 的刷新调度按它启停）。 */
  readonly viewers: number
  /**
   * 观众人数变化时调一次。
   *
   * @param listener - 收到当前人数。
   * @returns 取消订阅的函数。
   */
  onViewers(listener: (viewers: number) => void): () => void
  /** 接一个 SSE 连接：先补一条重取快照的通知，之后跟着变化推。 */
  subscribe(response: HostResponse): void
  /** 换一份资产，修订号加一并让页面重取快照。 */
  publish(assets: DocumentAssets): void
  /** 推一条改动。 */
  notify(event: BoardEvent): void
  /** 收掉心跳，结束全部长连接。 */
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
  const watchers = new Set<(viewers: number) => void>()
  /** 人数变了就告诉等它的人；一个监听器抛错不影响别人（D11）。 */
  const announceViewers = (): void => {
    for (const listener of watchers) {
      try {
        listener(audience.size)
      } catch {
        watchers.delete(listener)
      }
    }
  }
  const heartbeat = setInterval(() => {
    for (const response of audience) response.write?.(': ping\n\n')
  }, HEARTBEAT_MS)
  heartbeat.unref()
  const announce = (event: BoardEvent): void => {
    revision += 1
    const frame: BoardEventFrame = { revision, event }
    const payload = `data: ${JSON.stringify(frame)}\n\n`
    for (const response of audience) {
      try {
        response.write?.(payload)
      } catch {
        // 观众断在半条消息上：摘掉它，其余观众照常收（D11）。
        audience.delete(response)
        announceViewers()
      }
    }
  }
  return {
    get assets() { return current },
    get revision() { return revision },
    get viewers() { return audience.size },
    onViewers(listener) {
      watchers.add(listener)
      listener(audience.size)
      return () => { watchers.delete(listener) }
    },
    subscribe(response) {
      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        connection: 'keep-alive',
      })
      audience.add(response)
      announceViewers()
      // 长连接没有响应体结束的那一刻，观众离开只有这一个信号。
      response.on?.('close', () => {
        audience.delete(response)
        announceViewers()
      })
      const frame: BoardEventFrame = { revision, event: { type: 'board' } }
      response.write?.(`data: ${JSON.stringify(frame)}\n\n`)
    },
    publish(next) {
      current = next
      announce({ type: 'board' })
    },
    notify(event) {
      announce(event)
    },
    close() {
      clearInterval(heartbeat)
      for (const response of audience) {
        // 拆除时观众可能已经断开，结束它失败不必处理：这里做的正是释放（D11）。
        try {
          response.end()
        } catch {
          audience.delete(response)
        }
      }
      audience.clear()
      watchers.clear()
    },
  }
}
