/**
 * 宿主半边（D5）：组件库、看板存储与组件文档路由。
 *
 * 数据源、动作、批准与模型工具按 PLAN 的步骤 8、9 加进来；眼下它提供看板快照与按内容哈希取
 * 组件文档这两条路由。
 */
import { join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { PACKAGE_NAME, PLUGIN_ROUTE, connectionOf, webServerOf } from '@dsh-widget-board/contracts'
import { loadAssets } from './assets'
import { loadLibrary } from './library'
import { createHandler } from './routes'
import { loadBoard } from './state'
import { dshHome } from './home'

/** 插件名：宿主的加载器按它登记这一行。 */
export const name = PACKAGE_NAME

/** 宿主半边要注册路由，所以等 web 服务出现才启动（D1）。 */
export const inject = ['webServer']

/**
 * 启动：读组件库与看板，注册路由；拆除时按注册的反序释放（D11）。
 *
 * @param ctx - 宿主的上下文。
 */
export async function apply(ctx: Context): Promise<void> {
  const lib = resolve(import.meta.dirname, '..')
  const library = await loadLibrary(join(lib, 'widgets'))
  const board = await loadBoard(join(dshHome(), 'widget-board', 'board.json'), library)
  const assets = await loadAssets(join(lib, 'runtime'))
  const dispose = webServerOf(ctx).register({
    kind: 'prefix',
    path: PLUGIN_ROUTE,
    handler: createHandler({ library, board, assets, connection: connectionOf(ctx) }),
  })
  ctx.effect(() => dispose, 'widget-board: routes')
}
