/**
 * 宿主半边（D5、D21）：组件库、多块看板的存储、组件文档路由、数据源注册表与热重载。
 *
 * 组件库有三个来源（D17）：包内的内置组件、`$DSH_HOME/widget-board/widgets/` 里的用户组件、
 * 插件经 `widgetBoard` 服务注册的目录。看板与实例只在这里写；浏览器半边是它的视图，事件把改动
 * 推给在线页面（D18）。
 */
import { join, resolve } from 'node:path'
import { mkdir, readFile } from 'node:fs/promises'
import type { Context, Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { BoardEvent, WidgetMinBox, WidgetRoot } from '@dsh-widget-board/contracts'
import {
  BOARD_COMPATIBILITY,
  PACKAGE_NAME,
  PLUGIN_ROUTE,
  WIDGET_BOARD_API_VERSION,
  WIDGET_BOARD_SERVICE_NAME,
  connectionOf,
  credentialsOf,
  sessionsOf,
  webServerOf,
  workspaceRegistryOf,
} from '@dsh-widget-board/contracts'
import { createVersionStore } from './blobs'
import { loadAssets } from './assets'
import { createHttpSource } from './http'
import { createRequestLog } from './request-log'
import { openGrants } from './grants'
import type { GrantStore } from './grants'
import { loadLibrary } from './library'
import type { LibraryLoad } from './library'
import { createLive } from './live'
import type { RouteContext } from './routes'
import { createHandler } from './routes'
import { readManyInto } from './batch-reads'
import { BOARD_STATE_WRITES_PER_SECOND, STATE_WRITES_PER_SECOND, createRateLimiter } from './limits'
import { createRegistries } from './sources'
import { createProviderRegistry, createWidgetBoardService, widgetIdsIn } from './providers'
import { createMarketRegistry } from './market'
import { registerDshAccount } from './dsh-account'
import { createSystemMetricsSource } from './system-metrics'
import { createGitDiffSource } from './git-diff'
import { createGitLogSource, createMarkdownDocSource, createRepoLinksSource } from './git-log'
import type { GitLogDeps } from './git-log'
import {
  createBoardJsonSource,
  createCapacityItemsSource,
  createProvidersTableSource,
  createRuntimeKvSource,
  createSessionsListSource,
  createUsageChartSource,
  createUsageStatSource,
} from './board-sources'
import type { BoardSourceDeps } from './board-sources'
import { registerGithub } from './github'
import { registerTheme } from './theme'
import { createUsageReader, registerUsage } from './usage'
import { createScheduler } from './refresh'
import { createSubscriptions, intervalCardsOf } from './subscriptions'
import { registerDataRead } from './data-read'
import { createToolContext, registerTools } from './tools'
import { createProviderHealth } from './provider-health'
import { createSelfChecks } from './selfcheck'
import type { ToolRegistration } from './tools'
import { openWorkspace } from './workspace'
import { createWatchRegistry, watchTree } from './watch'
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
 * 一条变更通知要不要重算定时链与订阅表（D6、D32）。
 *
 * 卡片增删与组件库重读换掉整张卡片表；卡片 props 变了则是另一份订阅——订阅身份带着 props 的稳定
 * 表示，props 一变就要退订、按最新的一面重订（D32）。状态、数据、补丁与布局只改一张卡的内容，订阅
 * 判定不看它们，重算一次只是白跑。
 *
 * @param event - 刚推给在线页面的一条通知。
 * @returns 要重算时为真。
 */
export function resyncsSources(event: BoardEvent): boolean {
  if (event.type === 'board') return true
  return event.type === 'instance' && event.props !== undefined
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
  const grantFile = join(home, 'grants.json')
  const versions = createVersionStore(join(home, 'blobs'))
  // 用户组件目录先建出来：拖进来的组件有地方放，监视也挂得上（D17）。
  await mkdir(join(home, 'widgets'), { recursive: true })
  // 市场组件落在自己的来源目录里（D17）：与内置、用户、插件来源分开，提供方卸载后组件保留。
  const marketDir = join(home, 'market-widgets')
  await mkdir(marketDir, { recursive: true })
  const roots: WidgetRoot[] = [
    { dir: builtin, source: 'builtin' },
    { dir: join(home, 'widgets'), source: 'user' },
    // 市场来源排在插件之前、示例之前：同 id 先到者胜，索引见 contracts 的 WIDGET_SOURCES。
    { dir: marketDir, source: 'market', authorDomain: true },
    // 给 agent 的写法样例（D17）：包内目录，构建写进 lib/widgets-examples；缺失按空算。
    { dir: join(lib, 'widgets-examples'), source: 'example' },
  ]
  let enabled = readConfigField(config.enabled, true)
  let library: LibraryLoad = await loadLibrary(roots)
  for (const record of library.records.values()) await versions.remember(record)
  const live = createLive(await loadAssets(runtime))
  // 提供方调用的执行器与健康记录（D31）：读取、动作与能力的超时与并发只在这一份里。失败、超时与
  // 可用性一变就推一条快照通知，设置页因此看得到当前计数。
  const health = createProviderHealth()
  const stopHealth = health.onChange(() => { live.notify({ type: 'board' }) })
  const sources = createRegistries(health)
  // 内置的 DSH 账户能力（D24）：余额这类宿主服务由一个小提供方按能力注册，看板核心不认它。
  const disposeDshAccount = registerDshAccount(sources, ctx)
  // 外观主题（D29）：通用能力，任何组件都能读写；浏览器半边用同名能力接住调用，补上整页转场。
  const disposeTheme = registerTheme(sources, ctx)
  // GitHub 的 issue 列表（D24）：令牌从卡片设置的凭据服务现取，看板核心不碰 GitHub。
  const disposeGithub = registerGithub(sources, () => credentialsOf(ctx))
  // 会话用量（D24）：看板自己读会话日志、自己缓存，组件不必依赖别的插件；装了 dsh-claude-style
  // 时组件先问它，两份汇总不会同时算。实时那一路先取 dsh-usage 的启动前快照再订阅，因此要等它。
  const disposeUsage = await registerUsage(sources, ctx, home)
  // 全部看板与唯一的写入者（D21）：旧版本的单份 `board.json` 在这一步搬成第一块看板。
  // 卡片增删、组件库重读与卡片 props 变化才改变定时链与订阅表；状态、数据与布局写入不重算它们（D6、D32）。
  let syncLive: () => void = () => {}
  const workspace = await openWorkspace(home, library.records, (event) => {
    live.notify(event)
    if (resyncsSources(event)) syncLive()
  })
  // 授权表：人给出过的那些，绑在组件版本上（D6）。
  const grants: GrantStore = await openGrants(grantFile)

  /** 刷新路由要调的重读：重读函数在下面定义，闭包先接住这个变量。 */
  let refreshLibrary: () => Promise<void> = async () => {}
  /**
   * 改当前选中的看板：转给 workspace 的唯一写入队列（D5、D21）。
   */
  const save: RouteContext['save'] = async (change, options) => {
    return await workspace.save(workspace.activeId(), change, {
      ...options,
      event: (board, id) => options.event(board, id),
    })
  }

  /** 组件对外请求的日志（D28）：按卡片记在进程里。 */
  const requests = createRequestLog()

  // 市场提供方（D8 之后的市场契约）：注册、条目缓存与超时在这里；安装走路由，提供方不碰文件系统。
  const market = createMarketRegistry()

  const context: RouteContext = {
    records: library.records,
    entries: library.entries,
    library,
    roots,
    versions,
    workspace,
    get board() { return workspace.active() },
    save,
    live,
    connection: connectionOf(ctx),
    refresh: () => refreshLibrary(),
    sources,
    grants,
    limits: {
      stateCard: createRateLimiter(STATE_WRITES_PER_SECOND),
      stateBoard: createRateLimiter(BOARD_STATE_WRITES_PER_SECOND),
    },
    credentials: () => credentialsOf(ctx),
    selfChecks: createSelfChecks(),
    requests,
    market,
    marketDir,
  }
  // 运行成本的数据源（issue #5）：只读宿主自己的内存与工作区、组件库，不声明权限（D6）。卡片可见期间
  // 由它自己的订阅持续采样，「再测一次」走按需读能力（D32），不再另注册一个动作。
  const disposeSystemMetrics = sources.registerDataSource(createSystemMetricsSource({
    workspace,
    records: () => context.records,
    versions,
    assets: () => live.assets,
    diskPath: join(home, 'boards'),
  }))
  // 仓库改动的数据源：读的是本地 Git 仓库，不声明权限（D6）。读哪个目录由卡片自己的 props 决定，
  // 没填时跟随当前活跃会话或第一个工作区；卡片可见期间由它自己的订阅每 5 秒推一份（D32）。
  const disposeGitDiff = sources.registerDataSource(createGitDiffSource({
    sessions: () => sessionsOf(ctx),
    workspaces: () => workspaceRegistryOf(ctx),
  }))
  /**
   * 宿主本机客户端的根地址：宿主还没有绑定端口时它抛出来，这里按缺席处理（D11）。
   */
  const originOf = (): string | undefined => {
    try {
      return webServerOf(ctx).getOrigin?.()
    } catch {
      return undefined
    }
  }
  // 仓库与文档的三个数据源：提交时间线、仓库链接与一份 Markdown 文档。都只读本机，不声明权限（D6）。
  const gitDeps: GitLogDeps = {
    sessions: () => sessionsOf(ctx),
    workspaces: () => workspaceRegistryOf(ctx),
    origin: () => originOf(),
  }
  // 宿主自己状态的七个数据源：会话、工作区、用量、容量、提供方、运行环境与当前看板。都只读宿主
  // 进程里的东西，不声明权限（D6）；用量那两个读的是 `usage.ts` 已经折好的同一份汇总。
  const boardDeps: BoardSourceDeps = {
    sessions: () => sessionsOf(ctx),
    workspaces: () => workspaceRegistryOf(ctx),
    readUsage: createUsageReader(ctx, home),
    health,
    workspace,
    records: () => context.records,
    diskPath: join(home, 'boards'),
    version: BOARD_COMPATIBILITY.boardVersion,
  }
  const disposeGitLog = sources.registerDataSource(createGitLogSource(gitDeps))
  const disposeRepoLinks = sources.registerDataSource(createRepoLinksSource(gitDeps))
  const disposeMarkdownDoc = sources.registerDataSource(createMarkdownDocSource(gitDeps))
  const disposeSessionsList = sources.registerDataSource(createSessionsListSource(boardDeps))
  const disposeUsageChart = sources.registerDataSource(createUsageChartSource(boardDeps))
  const disposeUsageStat = sources.registerDataSource(createUsageStatSource(boardDeps))
  const disposeCapacityItems = sources.registerDataSource(createCapacityItemsSource(boardDeps))
  const disposeProvidersTable = sources.registerDataSource(createProvidersTableSource(boardDeps))
  const disposeRuntimeKv = sources.registerDataSource(createRuntimeKvSource(boardDeps))
  const disposeBoardJson = sources.registerDataSource(createBoardJsonSource(boardDeps))
  // 宿主自己的 HTTP 数据源（D6）：地址与主机来自组件的 manifest，映射成界面由组件自己负责；每次请求记进这张卡的日志（D28）。
  const disposeHttpSource = sources.registerDataSource(
    createHttpSource(() => context.records, PACKAGE_NAME, WIDGET_BOARD_API_VERSION, {
      credentials: () => credentialsOf(ctx),
      record: (id, entry) => { requests.add(id, entry) },
    }),
  )
  // 按需读能力（D32）：组件给一个源名，宿主先过 manifest 的 source/sources 白名单，再走与读取同一条
  // 路径——授权、执行器与 data schema 都在 loadData 里，这里不另开一条读。
  const disposeDataRead = registerDataRead(sources, context)

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
      // 组件的 minBox 可能在这一版里变了：每块看板里低于新下限的卡片抬上来，页面按新的盒子重取一次。
      const minBoxOf = (widget: string): WidgetMinBox | undefined => next.records.get(widget)?.manifest.minBox
      await workspace.relayout(minBoxOf)
      live.publish(await loadAssets(runtime))
      // 刷新声明与能推数据的源可能随这一版变了：定时链与订阅表各按新的卡片表重算一次（D6、D32）。
      syncLive()
    })
    reloading = run.catch(() => undefined)
    return run
  }
  refreshLibrary = reload

  // 刷新的调度器（D6）：只有人看着的时候才按组件声明的间隔读——没人看就全停，一张卡没落进任何
  // 一页的视口就不读它。
  const scheduler = createScheduler({
    // 卡片 id 全工作区唯一；定时链按全部看板算，不只看选中的那一块（D6、D21）。声明了 subscribe 的
    // 源按订阅走，不进这张表（D32）：同一张卡不会同时开着两条链。
    cards: () => intervalCardsOf(context),
    viewers: () => live.viewers,
    visible: () => live.visible,
    read: async (ids) => await readManyInto(context, ids),
    onError: (id, error) => {
      console.error(`widget-board: 定时读卡片 ${id} 失败：${(error as Error).message}`)
    },
  })
  // 数据订阅的生命周期（D32）：观众、可见集合、卡片表、提供方与授权的任何一种变化之后都走同一处
  // syncLive，与定时链同一个入口——宿主里没有第二个调度器。
  const subscriptions = createSubscriptions(context)
  const stopWatchingViewers = live.onViewers(() => { syncLive() })
  // 可见集合一变就重算一次：新看得见的卡立刻读，离开视口的卡不再排期并退订（D6、D32）。
  const stopWatchingVisibility = live.onVisible(() => { syncLive() })
  syncLive = () => { scheduler.sync(); subscriptions.sync() }

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
  const watchers = createWatchRegistry((target) => watchTree(target, () => {
    reload().catch((error: unknown) => {
      console.error(`widget-board: 重读组件库失败，继续用上一份：${(error as Error).message}`)
    })
  }))
  // 每个目录一份监视，按目录共享：插件注册的目录也监视，开发时改一个组件文件就能看到（D17）；
  // 两个提供方注册同一个目录时只有一个底层监视，最后一个撤下才停。
  void watchers.acquire(lib)
  void watchers.acquire(join(home, 'widgets'))

  // 提供方的注册与生命周期：目录、它名下的数据源、动作、能力、市场与它留下的授权一起管（D31、D17）。
  const providers = createProviderRegistry({
    roots,
    reload,
    // 能推数据的源可能随提供方注册或撤下出现与消失：订阅表跟着重算一次（D32）。
    registerDataSource: (source) => {
      const dispose = sources.registerDataSource(source)
      syncLive()
      return () => { dispose(); syncLive() }
    },
    registerAction: (action) => sources.registerAction(action),
    registerCapability: (capability) => sources.registerCapability(capability),
    registerMarketProvider: (registration) => market.register(registration),
    forgetGrants: async (provider) => {
      await grants.forget({ provider })
      syncLive()
    },
    idsIn: async (root) => await widgetIdsIn(root, async (file) => await readFile(file, 'utf8')),
    watch: (dir) => watchers.acquire(dir),
    health,
    syncMarket: (provider) => {
      if (provider === undefined) {
        live.notify({ type: 'board' })
        return
      }
      // 注册后立刻读一次条目：市场区打开时已经有东西可看；失败只进那一节的错误（D11）。
      void market.refresh(provider).then(() => live.notify({ type: 'board' }))
    },
  })

  /** 宿主侧的 widgetBoard 服务（D31）：新旧两个入口，版本协商与入口归属由它把关。 */
  const service = createWidgetBoardService(providers)
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
  // 类型依赖里，所以按名字订阅一次，拆除时退订（D18）。
  const onEvent = (ctx as { on?: (event: string, listener: () => void) => unknown }).on
  const unsubscribeVolatile = onEvent?.call(ctx, 'loader/volatile-update', () => {
    const next = readConfigField(config.enabled, true)
    if (next === enabled) return
    enabled = next
    syncTools()
    // 关掉时长连接一并收掉：页面不该停在一条不再有消息的连接上（D18）。
    if (!enabled) live.close()
  }) as (() => void) | undefined

  ctx.effect(() => () => {
    unsubscribeVolatile?.()
    disposeDshAccount()
    disposeTheme()
    disposeGithub()
    disposeUsage()
    tools?.dispose()
    disposeSystemMetrics()
    disposeGitDiff()
    disposeGitLog()
    disposeRepoLinks()
    disposeMarkdownDoc()
    disposeSessionsList()
    disposeUsageChart()
    disposeUsageStat()
    disposeCapacityItems()
    disposeProvidersTable()
    disposeRuntimeKv()
    disposeBoardJson()
    disposeHttpSource()
    disposeDataRead()
    subscriptions.stop()
    stopWatchingViewers()
    stopWatchingVisibility()
    stopHealth()
    scheduler.stop()
    providers.disposeAll()
    watchers.stopAll()
    disposeRoute()
    live.close()
  }, 'widget-board: routes and library watch')
}
