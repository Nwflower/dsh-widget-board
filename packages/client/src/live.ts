/**
 * 变更通知：订阅宿主推来的事件（D18）。
 *
 * 地址是文档相对的：桌面外壳的页面来源是自定义协议，根相对地址会跑到应用协议上去（D1）。
 * 断线由浏览器自己重连；重连之后宿主先补一条「重取快照」，中间错过的改动因此补齐。
 */
import type { BoardEventFrame } from '@dsh-widget-board/contracts'
import { CLIENT_EVENTS_PATH, isBoardEventFrame } from '@dsh-widget-board/contracts'

/**
 * 订阅变更通知。
 *
 * @param onEvent - 每收到一条通知调一次。
 * @returns 断开订阅的函数。
 */
export function subscribeLive(onEvent: (frame: BoardEventFrame) => void): () => void {
  const source = new EventSource(CLIENT_EVENTS_PATH)
  source.onmessage = (event: MessageEvent<string>) => {
    const frame: unknown = JSON.parse(event.data)
    if (!isBoardEventFrame(frame)) {
      // 消息由本插件的宿主发出，形状不对只可能是两边版本不一致；报出来，别把页面搞死。
      console.error(`widget-board: 变更通知的形状不对：${event.data}`)
      return
    }
    onEvent(frame)
  }
  // 断线由浏览器自己重连；这里只在一次连接失败时留一条记录，免得每次重试都刷一条。
  let reported = false
  source.onerror = () => {
    if (reported) return
    reported = true
    console.warn('widget-board: 变更通知断开，浏览器会自动重连')
  }
  source.onopen = () => { reported = false }
  return () => source.close()
}
