/**
 * 整页共用的握手中心（D3）：看板、会话里的工具视图与自检的画廊都经它握手。
 *
 * 每张卡片自己挂一个 `message` 监听器时，消息要按 `event.source` 逐个比较，一页几十张卡就是几十个
 * 监听器；这个中心只挂一个。它比看板页活得久：看板没打开时，会话里的工具视图仍然要能画出组件。
 */
import { createFrameHost } from './frame-host'
import type { FrameHost } from './frame-host'

/** 整页的握手中心；插件启动时装，卸载时摘掉。 */
let shared: FrameHost | null = null

/**
 * 装好整页的握手中心。
 *
 * @returns 已经装好时不换新的；卸载函数只摘掉这一次装上的那一个。
 */
export function installFrameHost(): () => void {
  const host = createFrameHost()
  shared = host
  return () => {
    if (shared === host) shared = null
    host.dispose()
  }
}

/**
 * 当前的握手中心；插件启动之前被调用时临时建一个（不该发生，但不让调用方崩）。
 *
 * @returns 握手中心。
 */
export function frameHostOf(): FrameHost {
  if (shared === null) shared = createFrameHost()
  return shared
}
