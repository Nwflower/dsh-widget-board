/**
 * 变更通知：订阅宿主推来的事件（D18）。
 *
 * 地址是文档相对的：桌面外壳的页面来源是自定义协议，根相对地址会跑到应用协议上去（D1）。
 * 断线由浏览器自己重连；重连之后宿主先补一条「重取快照」，中间错过的改动因此补齐。
 *
 * 每一页带一个观众身份接上：宿主按它记住这一页看得见哪些卡片（D6 的单卡可见性）。重连沿用同一
 * 个 id，宿主把这些连接归到同一位观众名下共用一份上报，最后一条断开才清掉。
 */
import type { BoardEventFrame } from '@dsh-widget-board/contracts'
import { eventsPath, isBoardEventFrame } from '@dsh-widget-board/contracts'

/**
 * 这个页面的观众身份。
 *
 * 用 `getRandomValues` 而不是 `randomUUID`：后者要求安全上下文，桌面外壳的自定义协议给不了。
 */
export const viewerId: string = Array.from(
  globalThis.crypto.getRandomValues(new Uint8Array(12)),
  (byte) => byte.toString(16).padStart(2, '0'),
).join('')

/**
 * 订阅变更通知。
 *
 * @param onEvent - 每收到一条通知调一次。
 * @param onOpen - 每接上一次调一次（含断线后的重连）：宿主在断开时清掉了这页的可见集合，要重报。
 * @returns 断开订阅的函数。
 */
export function subscribeLive(onEvent: (frame: BoardEventFrame) => void, onOpen?: () => void): () => void {
  const source = new EventSource(eventsPath(viewerId))
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
  source.onopen = () => {
    reported = false
    onOpen?.()
  }
  return () => source.close()
}
