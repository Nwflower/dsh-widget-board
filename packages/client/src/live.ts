/**
 * 变更通知：订阅宿主的修订号，组件库或运行时一变就回来（D7 的热重载）。
 *
 * 地址是文档相对的：桌面外壳的页面来源是自定义协议，根相对地址会跑到应用协议上去（D1）。
 */
import { CLIENT_ROUTE, EVENTS_PATH } from '@dsh-widget-board/contracts'

/**
 * 订阅修订号。
 *
 * @param onRevision - 每收到一个修订号调一次。
 * @returns 断开订阅的函数。
 */
export function subscribeLive(onRevision: (revision: number) => void): () => void {
  const source = new EventSource(`${CLIENT_ROUTE}${EVENTS_PATH}`)
  source.onmessage = (event: MessageEvent<string>) => {
    const revision = (JSON.parse(event.data) as { revision?: number }).revision
    if (typeof revision !== 'number') {
      // 消息由本插件的宿主发出，形状不对只可能是两边版本不一致；报出来，别把页面搞死。
      console.error(`widget-board: 变更通知的形状不对：${event.data}`)
      return
    }
    onRevision(revision)
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
