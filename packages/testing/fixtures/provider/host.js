/**
 * 冒烟用的提供方（宿主半边）：经旧入口注册一个组件目录，并在它名下挂上数据源与动作（D31、D17）。
 *
 * 这个名字与客户端一致；`inject` 让 cordis 等到看板发布服务之后才调用 `apply`。注册的那一次拿到一个
 * 把手，数据源与动作挂在它名下：提供方卸载或这次注册被撤下时，它们一并撤下。
 *
 * 版本固定写 2：旧入口接受 2 与 3，这条场景要证明的正是「按 v2 写的提供方在 v3 的宿主上照常可用」，所以
 * 它不跟随 `service.apiVersion`，也不跟着服务升级（D31）。注册用的版本随数据一起交出去，冒烟据此核对。
 */
import { join } from 'node:path'

export const name = 'dsh-widget-board-test-provider'

export const inject = ['widgetBoard']

/** 这条提供方写定的注册版本：旧入口接受它。 */
const API_VERSION = 2

/** 旧入口不接受的那一个：核对版本对不上时能被可见地拒绝。 */
const UNSUPPORTED_API_VERSION = 4

/**
 * 注册组件目录，并在它名下挂数据源与动作。
 *
 * @param ctx - 宿主上下文。
 */
export async function apply(ctx) {
  const service = ctx.widgetBoard
  // 版本对不上时服务要可见地拒绝：这里按一个旧入口不接受的版本注册一次，核对它抛出来（D31）。
  let refused = false
  try {
    service.registerDataSource({ apiVersion: UNSUPPORTED_API_VERSION, provider: name, id: 'never', read: () => null })
  } catch {
    refused = true
  }
  if (!refused) throw new Error('widgetBoard 服务没有拒绝版本对不上的注册')
  const handle = await service.registerWidgetType({
    apiVersion: API_VERSION,
    provider: name,
    directory: join(import.meta.dirname, 'widgets'),
  })
  // 子注册的 provider 必须与把手相同：不同名字的注册要被拒绝，撤下时才不会清错授权。
  let refusedProvider = false
  try {
    handle.register({
      dataSources: [{ apiVersion: API_VERSION, provider: 'someone-else', id: 'test.wrong', read: () => null }],
    })
  } catch {
    refusedProvider = true
  }
  if (!refusedProvider) throw new Error('widgetBoard 没有拒绝 provider 与把手不一致的子注册')
  // 每读一次加一：冒烟据此核对定时刷新真的在跑（D6）。
  let count = 7
  // 数据源与动作挂在这次注册名下：组件目录撤下时它们跟着走（D17）。
  const release = handle.register({
    dataSources: [
      {
        apiVersion: API_VERSION,
        provider: name,
        id: 'test.count',
        // 只读插件自己的状态，不必问人。注册用的版本一起交出去，冒烟据此核对它写的是 2。
        read: () => ({ count: count++, apiVersion: API_VERSION }),
      },
      {
        apiVersion: API_VERSION,
        provider: name,
        id: 'test.gated',
        // 要动外部世界的数据源：读之前要有授权（D6）。
        permission: { commands: ['echo'] },
        read: () => ({ count: -1 }),
      },
    ],
    actions: [
      {
        apiVersion: API_VERSION,
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
