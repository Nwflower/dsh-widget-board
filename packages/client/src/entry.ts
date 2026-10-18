import type { Context } from '@deepseek-ai/cordis'
import { PACKAGE_NAME, WIDGET_BOARD_SERVICE_NAME } from '@dsh-widget-board/contracts'
import { createClientService } from './native'
import { installFrameHost } from './page-frames'
import { registerPanel } from './panel'
import { registerToolViews } from './tool-views'
import { mountStyle } from './style'

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
  // 握手中心整页共用：看板、会话里的工具视图与自检都经它握手（D3）。
  ctx.effect(() => installFrameHost(), 'widget-board: page frame host')
  ctx.effect(() => registerPanel(ctx), 'widget-board: sidebar row and board page')
  ctx.effect(() => registerToolViews(ctx), 'widget-board: tool views')
  // 原生组件的登记处先于面板提供：提供方在启动早期就能注册，登记项随插件卸载撤下。
  const provide = (ctx as { provide?: (name: string, value: unknown) => void }).provide
  if (typeof provide === 'function') provide.call(ctx, WIDGET_BOARD_SERVICE_NAME, createClientService())
}
