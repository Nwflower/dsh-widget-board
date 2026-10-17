/**
 * 冒烟用的提供方（宿主半边）：注册一个组件目录与一个数据源，验证 `widgetBoard` 服务面（D17）。
 *
 * 这个名字与客户端一致；`inject` 让 cordis 等到看板发布服务之后才调用 `apply`。
 */
import { join } from 'node:path'

export const name = 'dsh-widget-board-test-provider'

export const inject = ['widgetBoard']

/**
 * 注册组件目录与数据源。
 *
 * @param ctx - 宿主上下文。
 */
export async function apply(ctx) {
  const service = ctx.widgetBoard
  // 服务的版本由提供方带回来：对不上时注册会抛出，而不是悄悄不生效。
  const disposeSource = service.registerDataSource({
    apiVersion: service.apiVersion,
    id: 'test.count',
    read: () => ({ count: 7 }),
  })
  const disposeWidgets = await service.registerWidgetType({
    apiVersion: service.apiVersion,
    provider: name,
    directory: join(import.meta.dirname, 'widgets'),
  })
  ctx.effect(() => () => {
    disposeSource()
    void disposeWidgets()
  })
}
