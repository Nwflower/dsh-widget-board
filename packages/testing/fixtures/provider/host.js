/**
 * 冒烟用的提供方（宿主半边）：注册一个组件目录，并在它名下挂上数据源与动作（D12、D17）。
 *
 * 这个名字与客户端一致；`inject` 让 cordis 等到看板发布服务之后才调用 `apply`。注册的那一次拿到
 * 一个把手，数据源与动作挂在它名下：提供方卸载或这次注册被撤下时，它们一并撤下。
 */
import { join } from 'node:path'

export const name = 'dsh-widget-board-test-provider'

export const inject = ['widgetBoard']

/**
 * 注册组件目录，并在它名下挂数据源与动作。
 *
 * @param ctx - 宿主上下文。
 */
export async function apply(ctx) {
  const service = ctx.widgetBoard
  // 版本对不上时服务要可见地拒绝：这里先按一个不存在的版本注册一次，核对它抛出来（D12）。
  let refused = false
  try {
    service.registerDataSource({ apiVersion: service.apiVersion + 1, provider: name, id: 'never', read: () => null })
  } catch {
    refused = true
  }
  if (!refused) throw new Error('widgetBoard 服务没有拒绝版本对不上的注册')
  const handle = await service.registerWidgetType({
    apiVersion: service.apiVersion,
    provider: name,
    directory: join(import.meta.dirname, 'widgets'),
  })
  // 数据源与动作挂在这次注册名下：组件目录撤下时它们跟着走（D17）。
  const release = handle.register({
    dataSources: [
      {
        apiVersion: service.apiVersion,
        provider: name,
        id: 'test.count',
        read: () => ({ count: 7 }),
      },
    ],
    actions: [
      {
        apiVersion: service.apiVersion,
        provider: name,
        id: 'test.run',
        // 有权限要求的动作要先由人给出授权（D6）。
        permission: { hosts: ['example.invalid'] },
        run: () => ({ ran: true }),
      },
    ],
  })
  ctx.effect(() => () => {
    release()
    void handle.dispose()
  })
}
