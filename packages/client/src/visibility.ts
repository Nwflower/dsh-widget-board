/**
 * 单卡可见性上报（D6）：这一页把自己看得见哪些卡片告诉宿主。
 *
 * 宿主按全部观众的并集决定读哪几张卡，所以只有集合真的变了才发一次；按动画帧或按秒发，这条链路
 * 自己就成了流量。发不出去时把去重那道闸门打开，等下一次变化或重连再发（D11）。
 */
import type { VisibilityReport } from '@dsh-widget-board/contracts'
import { CLIENT_VISIBILITY_PATH } from '@dsh-widget-board/contracts'
import { viewerId } from './live'
import { failureOf } from './snapshot'

/** 一页的可见性上报。 */
export interface VisibilityReporting {
  /**
   * 报一次现在看得见的卡片；与上一次发出去的一样时不发。
   *
   * @param ids - 现在看得见的卡片 id。
   */
  report(ids: readonly string[]): void
  /** 再发一次当前集合：宿主在连接断开时清掉了这一份，重连之后要重报。 */
  resend(): void
  /** 收掉：页面卸载前报一次空集合，然后不再听页面显隐。 */
  dispose(): void
}

/**
 * 建一个可见性上报。
 *
 * @returns 上报器。
 */
export function createVisibilityReporting(): VisibilityReporting {
  /** 上一次发出去、并且宿主确认记下的集合；`null` 表示那边没有可信的一份，下一次一定要发。 */
  let sent: string | null = null
  /** 观察器最后报来的那一批：页面藏起来时发空集合，恢复时发的仍是这一批。 */
  let observed: readonly string[] = []
  /** 一组 id 的比对键：顺序不影响可见性，排一下序再去重。 */
  const keyOf = (ids: readonly string[]): string => JSON.stringify([...ids].sort())
  /** 页面藏起来时这一页一张卡也看不见（D16 的暂停之外，调度那边也要知道）。 */
  const visibleNow = (): readonly string[] => (document.visibilityState === 'hidden' ? [] : observed)
  /**
   * 这一份到底被记下了没有。
   *
   * HTTP 200 不算数：观众没有在线连接时宿主照样回 200，但体里是 `accepted: false`，这一份根本没
   * 进可见集合。把它当成发成功，这一页重连之后就不会再报，严格刷新会悄悄退回旧的页级行为（D6）。
   */
  const acceptedOf = async (response: Response): Promise<boolean> => {
    if (!response.ok) {
      try {
        console.warn(`widget-board: ${(await failureOf(response, '可见性上报')).message}`)
      } catch {
        // 拒绝原因读不出来不影响判定：这一份没被收下（D11）。
        console.warn(`widget-board: 可见性上报被拒绝（HTTP ${String(response.status)}）`)
      }
      return false
    }
    try {
      const reply: unknown = await response.json()
      return (reply as { accepted?: unknown } | null)?.accepted === true
    } catch {
      // 回的不是 JSON：没被确认，按没发出去算。
      return false
    }
  }
  /**
   * 发一份；没被记下就把去重那道闸门打开，等下一次变化或重连再发。
   *
   * 每一步都在这里接住失败，因此这条异步链不会以拒绝结束，也不会有人漏掉它。
   */
  const post = async (ids: readonly string[]): Promise<void> => {
    const body: VisibilityReport = { viewer: viewerId, visible: [...ids] }
    try {
      const response = await fetch(CLIENT_VISIBILITY_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        // 卸载时的那一条要在页面没了之后才发得出去：keepalive 让浏览器替它把请求送完。
        keepalive: true,
      })
      if (await acceptedOf(response)) return
    } catch (error) {
      console.warn('widget-board: 可见性上报发不出去', error)
    }
    sent = null
  }
  const send = (ids: readonly string[]): void => {
    const key = keyOf(ids)
    if (key === sent) return
    sent = key
    void post(ids)
  }
  const onVisibilityChange = (): void => { send(visibleNow()) }
  document.addEventListener('visibilitychange', onVisibilityChange)
  return {
    report(ids) {
      observed = [...ids]
      send(visibleNow())
    },
    resend() {
      sent = null
      send(visibleNow())
    },
    dispose() {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      send([])
    },
  }
}
