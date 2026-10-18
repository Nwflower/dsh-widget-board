/**
 * 演示页扮演的 DSH 页面：给插件的浏览器半边一个宿主上下文（D25）。
 *
 * 浏览器半边只从宿主取三样东西：插槽注册表（把看板页挂到哪里）、`effect`（随插件卸载的清理）
 * 与可选的主题服务。这里各给一份：插槽注册表把中栏页面交给演示页的外壳去画，主题服务在页面
 * 切换浅色与深色时通知插件。
 */
import type { ComponentType } from 'react'
import { MAIN_SLOT } from '@dsh-widget-board/contracts'

/** 宿主页面的主题事件：与 DSH 的主题服务同名。 */
const THEME_EVENT = 'theme/change'

/** 演示页给插件的上下文，以及外壳要用的几个口子。 */
export interface DemoHost {
  /** 交给插件 `apply` 的上下文。 */
  context: unknown
  /** 插件注册到中栏的页面；注册之前是 `undefined`。 */
  page(): ComponentType | undefined
  /** 订阅页面的出现。 */
  onPage(listener: () => void): () => void
  /** 通知插件主题变了（浅色深色、语言）。 */
  themeChanged(): void
  /** 卸载插件：按注册的倒序释放它的清理。 */
  dispose(): void
}

/**
 * 建一个演示用的宿主上下文。
 *
 * @returns 上下文与外壳的口子。
 */
export function createHost(): DemoHost {
  const cleanups: Array<() => void> = []
  const listeners = new Set<() => void>()
  const themeListeners = new Set<() => void>()
  let page: ComponentType | undefined
  const slots = {
    // 宿主声明了的插槽才调用回调；演示页只有中栏页面一处，其余插槽（侧栏入口、设置节）不存在。
    inject(slot: string, callback: () => () => void): () => void {
      return slot === MAIN_SLOT ? callback() : () => {}
    },
    register(options: { name: string }, component: ComponentType): () => void {
      if (options.name !== MAIN_SLOT) return () => {}
      page = component
      for (const listener of listeners) listener()
      return () => {
        page = undefined
        for (const listener of listeners) listener()
      }
    },
  }
  const theme = {}
  const context = {
    slots,
    effect(callback: () => (() => void) | undefined): void {
      const cleanup = callback()
      if (cleanup !== undefined) cleanups.push(cleanup)
    },
    // 插件的 `widgetBoard` 服务是给别的插件用的；演示页上没有别的插件。
    provide(): void {},
    get(name: string): unknown {
      return name === 'theme' ? theme : undefined
    },
    on(event: string, listener: () => void): () => void {
      if (event !== THEME_EVENT) return () => {}
      themeListeners.add(listener)
      return () => { themeListeners.delete(listener) }
    },
  }
  return {
    context,
    page: () => page,
    onPage(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    themeChanged() {
      for (const listener of themeListeners) listener()
    },
    dispose() {
      for (const cleanup of cleanups.splice(0).reverse()) cleanup()
    },
  }
}
