/**
 * 看板栏上的未读通知（D7）：组件经桥发来一条，这里记一条，侧栏入口的徽标读出条数。
 *
 * 通知只活在当前页面，整页重载时清空；组件只在看板页挂载时运行，离开面板不会再发新的。消息的
 * 形状由 `contracts` 判定，这里只收已经通过判定的那几段文字。
 */
import type { WidgetNotification } from '@dsh-widget-board/contracts'

/** 一条留在页面上的通知。 */
export interface BoardNotification {
  id: number
  instanceId: string
  widgetId: string
  /** 发通知的组件标题，按当前语言取。 */
  widgetTitle: string
  /** 通知自己的标题；组件没给时就是组件标题。 */
  title: string
  body?: string
  at: number
}

/** 保留的条数：徽标只数未读，最近一条留给悬停提示。 */
const KEEP = 50

/** 未读数的上限：防止一个每秒发通知的组件把数字撑出徽标。 */
const UNREAD_LIMIT = 999

/** 一个未读通知的登记处。 */
export interface NotificationStore {
  /** 记一条通知，未读数加一。 */
  push(notification: Omit<BoardNotification, 'id' | 'at'>): void
  /** 把全部通知标成已读；徽标随之收起。 */
  markAllRead(): void
  /** 订阅变化，返回退订函数。 */
  subscribe(listener: () => void): () => void
  /** 当前未读数。 */
  unread(): number
  /** 最近的通知，新的在前。 */
  entries(): readonly BoardNotification[]
}

/**
 * 建一个通知登记处。
 *
 * 单独建一份供测试用；浏览器半边共用下面那一个。
 *
 * @returns 空的通知登记处。
 */
export function createNotificationStore(): NotificationStore {
  let entries: BoardNotification[] = []
  let unread = 0
  let nextId = 1
  const listeners = new Set<() => void>()
  const emit = (): void => {
    for (const listener of listeners) listener()
  }
  return {
    push(notification) {
      entries = [{ ...notification, id: nextId, at: Date.now() }, ...entries].slice(0, KEEP)
      nextId += 1
      unread = Math.min(unread + 1, UNREAD_LIMIT)
      emit()
    },
    markAllRead() {
      if (unread === 0) return
      unread = 0
      emit()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    unread: () => unread,
    entries: () => entries,
  }
}

/** 浏览器半边共用的登记处：侧栏入口与看板页读同一份。 */
export const notificationStore = createNotificationStore()

/**
 * 把一条组件通知落成页面上的一条。
 *
 * @param notification - 组件发来的两段文字。
 * @param widgetTitle - 组件标题，标题省略时用它。
 * @returns 标题与正文都去掉首尾空白；空标题退回组件标题。
 */
export function noticeOf(
  notification: WidgetNotification,
  widgetTitle: string,
): Pick<BoardNotification, 'title' | 'body'> {
  const title = notification.title?.trim() ?? ''
  const body = notification.body?.trim() ?? ''
  return {
    title: title === '' ? widgetTitle : title,
    ...(body === '' ? {} : { body }),
  }
}
