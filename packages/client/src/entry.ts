import type { Context } from '@deepseek-ai/cordis'
import { PACKAGE_NAME, WIDGET_BOARD_SERVICE_NAME } from '@dsh-widget-board/contracts'
import { createClientService } from './native'
import { registerPanel } from './panel'
import { mountStyle } from './style'
import { registerToolView } from './toolview'

/** 加载器按这个 id 把这份导出交给宿主的浏览器半边。 */
export const name = PACKAGE_NAME

/**
 * 插件读的宿主服务。cordis 只允许读声明过的服务，未声明时读属性会直接抛出；声明之后它等到
 * 服务出现才调用 `apply`，服务一直不出现时插件停在 pending，宿主启动时的检查会报出在等哪一项。
 */
export const inject = ['slots']

/**
 * 浏览器半边：样式表、侧栏入口与看板页，以及给其他插件的 `widgetBoard` 服务（D17）。
 *
 * @param ctx - 浏览器半边的根上下文。
 */
export function apply(ctx: Context): void {
  ctx.effect(() => mountStyle(), 'widget-board: stylesheet')
  ctx.effect(() => registerPanel(ctx), 'widget-board: sidebar row and board page')
  // 会话里 `widget_show` 的结果画成一张组件（D9）。
  ctx.effect(() => registerToolView(ctx), 'widget-board: inline widget tool view')
  // 原生组件的登记处先于面板提供：提供方在启动早期就能注册，登记项随插件卸载撤下。
  const provide = (ctx as { provide?: (name: string, value: unknown) => void }).provide
  if (typeof provide === 'function') provide.call(ctx, WIDGET_BOARD_SERVICE_NAME, createClientService())
}
