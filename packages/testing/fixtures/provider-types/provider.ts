/**
 * 只做类型检查的提供方（D12）：服务契约经 `import type` 取到，运行时不需要导入本包。
 *
 * 这个文件不进临时宿主；它证明有类型检查的提供方可以按包名取到 `./service` 的类型。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { WidgetBoardClientService } from 'dsh-widget-board/service'

declare module '@deepseek-ai/cordis' {
  interface Context {
    widgetBoard: WidgetBoardClientService
  }
}

/**
 * 提供方的浏览器半边骨架：按服务实例上的版本注册一个原生组件。
 *
 * @param ctx - 浏览器半边的上下文。
 */
export function apply(ctx: Context): void {
  const service = ctx.widgetBoard
  ctx.effect(() => service.registerWidgetType({
    apiVersion: service.apiVersion,
    provider: 'dsh-widget-board-provider-types',
    id: 'test-native',
    component: () => null,
  }))
}
