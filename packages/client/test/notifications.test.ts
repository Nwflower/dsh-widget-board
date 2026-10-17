/**
 * 看板栏的通知登记（D7）：每来一条未读数加一，看过之后清零；标题省略时用组件标题。
 */
import { describe, expect, it, vi } from 'vitest'
import { createNotificationStore, noticeOf } from '../src/notifications'

/** 一条通知。 */
function notice(title = '完成') {
  return {
    instanceId: 'card-1',
    widgetId: 'pomodoro',
    widgetTitle: '番茄钟',
    title,
  }
}

describe('通知登记', () => {
  it('每来一条未读数加一，新的排在前面', () => {
    const store = createNotificationStore()
    store.push(notice('一'))
    store.push(notice('二'))
    expect(store.unread()).toBe(2)
    expect(store.entries().map((entry) => entry.title)).toEqual(['二', '一'])
  })

  it('标成已读之后未读数清零，通知还留着', () => {
    const store = createNotificationStore()
    store.push(notice())
    store.markAllRead()
    expect(store.unread()).toBe(0)
    expect(store.entries()).toHaveLength(1)
    store.markAllRead()
    expect(store.unread()).toBe(0)
  })

  it('变化时通知订阅者，退订之后不再通知', () => {
    const store = createNotificationStore()
    const listener = vi.fn()
    const off = store.subscribe(listener)
    store.push(notice())
    store.markAllRead()
    expect(listener).toHaveBeenCalledTimes(2)
    off()
    store.push(notice())
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('保留最近五十条，未读数封顶', () => {
    const store = createNotificationStore()
    for (let index = 0; index < 1200; index += 1) store.push(notice(String(index)))
    expect(store.entries()).toHaveLength(50)
    expect(store.entries()[0]?.title).toBe('1199')
    expect(store.unread()).toBe(999)
  })
})

describe('通知文案', () => {
  it('去掉首尾空白，空标题退回组件标题', () => {
    expect(noticeOf({ title: '  完成  ', body: '  休息一下  ' }, '番茄钟')).toEqual({ title: '完成', body: '休息一下' })
    expect(noticeOf({ title: '   ' }, '番茄钟')).toEqual({ title: '番茄钟' })
    expect(noticeOf({}, '番茄钟')).toEqual({ title: '番茄钟' })
  })
})
