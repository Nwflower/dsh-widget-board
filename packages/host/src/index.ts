/**
 * 宿主半边（D5）：组件库、看板存储、组件文档路由、数据源注册表与热重载。
 *
 * 组件库有三个来源（D17）：包内的内置组件、`$DSH_HOME/widget-board/widgets/` 里的用户组件、
 * 插件经 `widgetBoard` 服务注册的目录。看板与实例只在这里写；浏览器半边是它的视图，事件把改动
 * 推给在线页面（D18）。
 */
import { join, resolve } from 'node:path'
import { mkdir, readFile } from 'node:fs/promises'
import type { Context, Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { WidgetMinBox, WidgetRoot, WidgetTypeHandle } from '@dsh-widget-board/contracts'
import {
  PACKAGE_NAME,
  PLUGIN_ROUTE,
  WIDGET_BOARD_API_VERSION,
  WIDGET_BOARD_SERVICE_NAME,
  connectionOf,
  versionMismatch,
  webServerOf,
} from '@dsh-widget-board/contracts'
import { createVersionStore } from './blobs'
import { loadAssets } from './assets'
import { openGrants } from './grants'
import type { GrantStore } from './grants'
import { loadLibrary } from './library'
import type { LibraryLoad } from './library'
import { createLive } from './live'
import type { RouteContext } from './routes'
import { createHandler, readInto } from './routes'
import { createRegistries } from './sources'
import { createProviderRegistry, widgetIdsIn } from './providers'
import { createScheduler, intervalOf } from './refresh'
import { createToolContext, registerTools } from './tools'
import type { ToolRegistration } from './tools'
import { StaleRevisionError, loadBoard, withLayouts, writeBoard } from './state'
import { watchTree } from './watch'
import { dshHome } from './home'

/** 插件名：宿主的加载器按它登记这一行。 */
export const name = PACKAGE_NAME

/** 宿主半边要注册路由，所以等 web 服务出现才启动（D1）。 */
export const inject = ['webServer']

/** 配置在配置文件里的样子：可热改的字段在这一层还是普通值。 */
export interface ConfigInput {
  /** 组件看板的总开关。 */
  enabled?: boolean
}

/** 这一行运行时的配置：可热改的字段由加载器换成活的引用。 */
export interface Config {
  enabled?: Volatile<boolean>
}

/** 配置表单；`.volatile()` 的字段改完不重新挂载这一行。它同时是设置页。 */
export const Config: z<ConfigInput, Config> = z.object({
  enabled: z.boolean().default(true).volatile().description('组件看板：关掉之后看板页面停止工作，卡片与组件都留在磁盘上'),
})

/**
 * 读一个可热改的配置项：加载器把它换成了活的引用，程序挂载时还是普通值。
 *
 * @param field - 配置里的那一项。
 * @param fallback - 没有设置时用的值。
 * @returns 生效的值。
 */
export function readConfigField<T>(field: Volatile<T> | T | undefined, fallback: T): T {
  if (field === undefined) return fallback
  if (typeof field === 'object' && field !== null && typeof (field as { get?: unknown }).get === 'function') {
    return (field as Volatile<T>).get() as T
  }
  return field as T
}

/**
 * 启动：读组件库与看板，注册路由与 `widgetBoard` 服务，开工件库的监视；拆除时按注册的反序释放（D11）。
 *
 * @param ctx - 宿主的上下文。
 * @param config - 这一行的配置。
 */
export async function apply(ctx: Context, config: Config = {}): Promise<void> {
  const lib = resolve(import.meta.dirname, '..')
  const builtin = join(lib, 'widgets')
  const runtime = join(lib, 'runtime')
  const home = join(dshHome(), 'widget-board')
  const boardFile = join(home, 'board.json')
  const grantFile = join(home, 'grants.json')
  const versions = createVersionStore(join(home, 'blobs'))
  // 用户组件目录先建出来：拖进来的组件有地方放，监视也挂得上（D17）。
  await mkdir(join(home, 'widgets'), { recursive: true })
  const roots: WidgetRoot[] = [
    { dir: builtin, source: 'builtin' },
    { dir: join(home, 'widgets'), source: 'user' },
  ]
  let enabled = readConfigField(config.enabled, true)
  let library: LibraryLoad = await loadLibrary(roots)
  for (const record of library.records.values()) await versions.remember(record)
  const live = createLive(await loadAssets(runtime))
  const sources = createRegistries()
  // 授权表：人给出过的那些，绑在组件版本上（D6）。
  const grants: GrantStore = await openGrants(grantFile)

  /**
   * 改一次看板：写到磁盘、换掉内存里的那份、推一条通知。
   *
   * 写入串行，后一次看得到前一次的结果，磁盘上不会出现两份互相覆盖的看板。布局提交带的是布局
   * 修订号，轮到它写入时再核对一次：两个页面同时松手时后到的那一份不会盖掉前一份，而组件状态的
   * 写入不会让一次正在进行的拖动变成过期（D5、D16）。
   */
  let writing: Promise<void> = Promise.resolve()
  /** 刷新路由要调的重读：重读函数在下面定义，闭包先接住这个变量。 */
  let refreshLibrary: () => Promise<void> = async () => {}
  /** 看板变了之后要让调度器重算：调度器在下面定义，这里先接住。 */
  let syncScheduler: () => void = () => {}
  const save: RouteContext['save'] = (change, options) => {
    const run = writing.then(async () => {
      const current = context.board
      if (options.expectedLayoutRevision !== undefined && options.expectedLayoutRevision !== current.layoutRevision) {
        throw new StaleRevisionError(options.expectedLayoutRevision, current.layoutRevision)
      }
      const next = {
        ...change(current),
        revision: current.revision + 1,
        layoutRevision: current.layoutRevision + (options.layoutChanged === true ? 1 : 0),
      }
      await writeBoard(boardFile, next)
      context.board = next
      live.notify(options.event(next))
      // 卡片增删、数据源改绑都从这里过：定时刷新的表跟着重算（D6）。
      syncScheduler()
      return next
    })
    writing = run.then(() => undefined, () => undefined)
    return run
  }

  const context: RouteContext = {
    records: library.records,
    entries: library.entries,
    library,
    roots,
    versions,
    board: await loadBoard(boardFile, library.records),
    save,
    live,
    connection: connectionOf(ctx),
    refresh: () => refreshLibrary(),
    sources,
    grants,
  }

  // 重读全部来源：组件库或运行时变了，或某个插件注册、撤下了一个目录（D17）。串行执行，监视与
  // 刷新按钮同时到来时后一次看得到前一次的结果。
  let reloading: Promise<void> = Promise.resolve()
  const reload = (): Promise<void> => {
    const run = reloading.then(async () => {
      const next = await loadLibrary(roots)
      for (const record of next.records.values()) await versions.remember(record)
      library = next
      context.records = next.records
      context.entries = next.entries
      context.library = next
      // 组件的 minBox 可能在这一版里变了：低于新下限的卡片抬上来，页面按新的盒子重取一次。
      const minBoxOf = (widget: string): WidgetMinBox | undefined => next.records.get(widget)?.manifest.minBox
      if (withLayouts(context.board, minBoxOf).changed) {
        await save((current) => withLayouts(current, minBoxOf).board, { layoutChanged: true, event: () => ({ type: 'board' }) })
      }
      live.publish(await loadAssets(runtime))
    })
    reloading = run.catch(() => undefined)
    return run
  }
  refreshLibrary = reload

  // 刷新的调度器（D6）：只有人看着的时候才按组件声明的间隔读，没人看就停。
  const scheduler = createScheduler({
    cards: () => context.board.instances.flatMap((instance) => {
      const everyMs = intervalOf(context.records.get(instance.widget)?.manifest.refresh)
      return everyMs === undefined || instance.source === undefined ? [] : [{ id: instance.id, everyMs }]
    }),
    viewers: () => live.viewers,
    read: async (id) => { await readInto(context, id) },
    onError: (id, error) => {
      console.error(`widget-board: 定时读卡片 ${id} 失败：${(error as Error).message}`)
    },
  })
  const stopWatchingViewers = live.onViewers(() => { scheduler.sync() })
  syncScheduler = () => { scheduler.sync() }

  const handler = createHandler(context)
  const disposeRoute = webServerOf(ctx).register({
    kind: 'prefix',
    path: PLUGIN_ROUTE,
    handler: async (request, response) => {
      if (!enabled) {
        response.writeHead(503, { 'content-type': 'application/json; charset=utf-8' })
        response.end(JSON.stringify({ error: '组件看板已经被关掉，在设置里打开它' }))
        return
      }
      await handler(request, response)
    },
  })

  // 构建写出的内置组件与运行时（开发时的热重载），以及用户组件目录（D7、D17）。
  // 读不出来时保留上一份并报出原因，不把一块空看板发给用户（D11）。
  const watch = (target: string): (() => void) => watchTree(target, () => {
    reload().catch((error: unknown) => {
      console.error(`widget-board: 重读组件库失败，继续用上一份：${(error as Error).message}`)
    })
  })
  const stopBuiltin = watch(lib)
  const stopUser = watch(join(home, 'widgets'))
  // 已经挂上监视的目录：插件注册的目录也监视，开发时改一个组件文件就能看到（D17）。
  const watched = new Set<string>([lib, join(home, 'widgets')])
  const watchOnce = (dir: string): (() => void) => {
    if (watched.has(dir)) return () => {}
    watched.add(dir)
    const stop = watch(dir)
    return () => {
      watched.delete(dir)
      stop()
    }
  }

  // 提供方的注册与生命周期：目录、它名下的数据源与动作、它留下的授权一起管（D12、D17）。
  const providers = createProviderRegistry({
    roots,
    reload,
    registerDataSource: (source) => sources.registerDataSource(source),
    registerAction: (action) => sources.registerAction(action),
    forgetGrants: async (provider) => { await grants.forget({ provider }) },
    idsIn: async (root) => await widgetIdsIn(root, async (file) => await readFile(file, 'utf8')),
    watch: watchOnce,
  })

  /** 插件提供的组件目录：注册时加入来源表并读一次，撤下时移出并重读（D17）。 */
  const service = {
    apiVersion: WIDGET_BOARD_API_VERSION,
    async registerWidgetType(registration: { apiVersion: number, provider: string, directory: string }): Promise<WidgetTypeHandle> {
      if (registration.apiVersion !== WIDGET_BOARD_API_VERSION) throw versionMismatch(WIDGET_BOARD_API_VERSION, registration.apiVersion)
      if (registration.provider.trim() === '' || registration.directory.trim() === '') {
        throw new Error('registerWidgetType 需要 provider 与 directory')
      }
      return await providers.register(registration)
    },
    registerDataSource(registration: { apiVersion: number } & Parameters<typeof sources.registerDataSource>[0]) {
      if (registration.apiVersion !== WIDGET_BOARD_API_VERSION) throw versionMismatch(WIDGET_BOARD_API_VERSION, registration.apiVersion)
      return sources.registerDataSource(registration)
    },
    registerAction(registration: { apiVersion: number } & Parameters<typeof sources.registerAction>[0]) {
      if (registration.apiVersion !== WIDGET_BOARD_API_VERSION) throw versionMismatch(WIDGET_BOARD_API_VERSION, registration.apiVersion)
      return sources.registerAction(registration)
    },
  }
  const provide = (ctx as { provide?: (name: string, value: unknown) => void }).provide
  if (typeof provide === 'function') provide.call(ctx, WIDGET_BOARD_SERVICE_NAME, service)

  // 面向会话的工具与 skill（D9）：只在宿主有工具注册表、且这一行开着时出现。注册与撤销跟着总开关
  // 走——关掉看板之后，会话里也不该再看见这几个工具。
  const toolContext = createToolContext(context, save, reload)
  let tools: ToolRegistration | undefined
  const syncTools = (): void => {
    if (enabled && tools === undefined) {
      tools = registerTools(ctx, toolContext, (names) => {
        console.log(`widget-board: 注册了 ${names.join('、')}`)
      })
      return
    }
    if (!enabled && tools !== undefined) {
      tools.dispose()
      tools = undefined
    }
  }
  syncTools()

  // 可热改的字段由加载器提交进这一行的引用，提交时发这个事件；事件名属于加载器，不在本插件的
  // 类型依赖里，所以按名字订阅一次。
  const onEvent = (ctx as { on?: (event: string, listener: () => void) => unknown }).on
  onEvent?.call(ctx, 'loader/volatile-update', () => {
    const next = readConfigField(config.enabled, true)
    if (next === enabled) return
    enabled = next
    syncTools()
    // 关掉时长连接一并收掉：页面不该停在一条不再有消息的连接上（D18）。
    if (!enabled) live.close()
  })

  ctx.effect(() => () => {
    tools?.dispose()
    stopWatchingViewers()
    scheduler.stop()
    stopBuiltin()
    stopUser()
    providers.disposeAll()
    disposeRoute()
    live.close()
  }, 'widget-board: routes and library watch')
}
