import type { Context } from '@deepseek-ai/cordis'
import { PACKAGE_NAME } from '@dsh-widget-board/contracts'
import { registerPanel } from './panel'
import { mountStyle } from './style'

/** 加载器按这个 id 把这份导出交给宿主的浏览器半边。 */
export const name = PACKAGE_NAME

/**
 * 插件读的宿主服务。cordis 只允许读声明过的服务，未声明时读属性会直接抛出；声明之后它等到
 * 服务出现才调用 `apply`，服务一直不出现时插件停在 pending，宿主启动时的检查会报出在等哪一项。
 */
export const inject = ['slots']

/**
 * 浏览器半边。卡片看板在 PLAN 步骤 6 接入；眼下它注册的地方是一处侧栏入口与一页空看板。
 *
 * @param ctx - 浏览器半边的根上下文。
 */
export function apply(ctx: Context): void {
  ctx.effect(() => mountStyle(), 'widget-board: stylesheet')
  ctx.effect(() => registerPanel(ctx), 'widget-board: sidebar row and board page')
}
