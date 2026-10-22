/**
 * 组件对外请求的日志（D28）：按卡片记最近几十条，只记方法、主机与路径、状态与耗时。
 *
 * 日志活在宿主进程里，不写盘：它用来说明「刚才这张卡去了哪里」，不是审计留存；凭据永远不进这里。
 */
import type { RequestLogEntry } from '@dsh-widget-board/contracts'
import { REQUEST_LOG_LIMIT } from '@dsh-widget-board/contracts'

/** 按卡片存请求日志的表。 */
export interface RequestLog {
  /** 记一条；超过上限时挤掉最早的那条。 */
  add: (id: string, entry: RequestLogEntry) => void
  /** 一张卡的日志，按发生的先后。 */
  of: (id: string) => RequestLogEntry[]
  /** 卡片被移除时把它的日志一起收掉。 */
  drop: (id: string) => void
}

/**
 * 建一张日志表。
 *
 * @returns 日志表。
 */
export function createRequestLog(): RequestLog {
  const byCard = new Map<string, RequestLogEntry[]>()
  return {
    add(id, entry) {
      const entries = byCard.get(id)
      if (entries === undefined) {
        byCard.set(id, [entry])
        return
      }
      entries.push(entry)
      if (entries.length > REQUEST_LOG_LIMIT) entries.splice(0, entries.length - REQUEST_LOG_LIMIT)
    },
    of(id) {
      return byCard.get(id) ?? []
    },
    drop(id) {
      byCard.delete(id)
    },
  }
}
