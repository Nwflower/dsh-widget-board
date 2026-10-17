/**
 * 宿主半边（D5）：组件库、看板存储、组件文档路由与热重载。
 *
 * `lib/` 一改就重读组件库与运行时，把新修订号推给在线的看板页；数据源、动作、批准与模型工具按
 * PLAN 的步骤 8、9 加进来。
 */
import { join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { PACKAGE_NAME, PLUGIN_ROUTE, connectionOf, webServerOf } from '@dsh-widget-board/contracts'
import { loadAssets } from './assets'
import { loadLibrary } from './library'
import type { WidgetRecord } from './library'
import { createLive } from './live'
import type { RouteContext } from './routes'
import { createHandler } from './routes'
import { loadBoard } from './state'
import { watchTree } from './watch'
import { dshHome } from './home'

/** 插件名：宿主的加载器按它登记这一行。 */
export const name = PACKAGE_NAME

/** 宿主半边要注册路由，所以等 web 服务出现才启动（D1）。 */
export const inject = ['webServer']

/** 出现过的组件版本在内存里留几份。 */
const VERSION_LIMIT = 32

/**
 * 启动：读组件库与看板，注册路由，开工件库与运行时的监视；拆除时按注册的反序释放（D11）。
 *
 * @param ctx - 宿主的上下文。
 */
export async function apply(ctx: Context): Promise<void> {
  const lib = resolve(import.meta.dirname, '..')
  const widgets = join(lib, 'widgets')
  const runtime = join(lib, 'runtime')
  const library = await loadLibrary(widgets)
  const board = await loadBoard(join(dshHome(), 'widget-board', 'board.json'), library)
  const live = createLive(await loadAssets(runtime))
  // 出现过的版本：热重载时把新版本记进来，旧的留着，页面里指向旧哈希的 iframe 才不会变成 404。
  const versions = new Map<string, WidgetRecord>()
  const remember = (records: Map<string, WidgetRecord>): void => {
    for (const record of records.values()) versions.set(record.hash, record)
    // 内存里只留最近的若干份，够热重载与刚关掉的页面用。
    for (const hash of [...versions.keys()].slice(0, Math.max(0, versions.size - VERSION_LIMIT))) versions.delete(hash)
  }
  remember(library)
  const context: RouteContext = { library, versions, board, live, connection: connectionOf(ctx) }
  const disposeRoute = webServerOf(ctx).register({
    kind: 'prefix',
    path: PLUGIN_ROUTE,
    handler: createHandler(context),
  })
  const stopWatching = watchTree(lib, async () => {
    // 组件库或运行时变了：先读新的，读不出来的话保留旧的并报出原因（D11）。
    try {
      const next = await loadLibrary(widgets)
      remember(next)
      context.library = next
      live.publish(await loadAssets(runtime))
    } catch (error) {
      console.error(`widget-board: 重读 ${lib} 失败，继续用上一份：${(error as Error).message}`)
    }
  })
  ctx.effect(() => () => {
    stopWatching()
    disposeRoute()
    live.close()
  }, 'widget-board: routes and library watch')
}
