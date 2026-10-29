/**
 * 插件提供方的注册与生命周期（D31、D17）。
 *
 * 一个提供方把组件目录、数据源、动作、能力与市场挂到同一个把手上；看板要把它们当成一件事管：提供方
 * 卸载时，目录、名下的注册、它留下的授权与它的目录监视一起撤下，不留下指向已经不存在的提供方的东西。
 *
 * 新旧两个入口都在这里。旧入口一次注册一份，各自释放；新入口 registerProvider 一个把手管完，子注册
 * 省掉版本与提供方名。同一个提供方在同一侧只有一个活动把手，两个入口不能混用；新旧注册都计入按提供方
 * 算的配额。
 *
 * 注册与撤下都排在同一条串行链上：一次撤下与一次注册同时到来时，后一次看得到前一次的结果。
 */
import { join } from 'node:path'
import type {
  ActionRegistration,
  CapabilityRegistration,
  DataSourceRegistration,
  ProviderActionRegistration,
  ProviderCapabilityRegistration,
  ProviderDataSourceRegistration,
  ProviderMarketRegistration,
  WidgetBoardFeature,
  WidgetBoardHostService,
  WidgetMarketProviderRegistration,
  WidgetProviderHandle,
  WidgetProviderRegistration,
  WidgetRoot,
  WidgetTypeHandle,
  WidgetTypeRegistration,
} from '@dsh-widget-board/contracts'
import {
  WIDGET_BOARD_API_VERSION,
  WIDGET_BOARD_FEATURES,
  WIDGET_BOARD_PROVIDER_API_VERSION,
  WIDGET_BOARD_SUPPORTED_API_VERSIONS,
  requireFeatures,
  supportsFeature,
  versionMismatch,
} from '@dsh-widget-board/contracts'
import { insertRoot } from './library'
import type { ProviderHealth } from './provider-health'

/** 一个提供方最多挂多少个组件（D31）。 */
export const PROVIDER_WIDGET_LIMIT = 128

/** 一个提供方最多挂多少个数据源。 */
export const PROVIDER_SOURCE_LIMIT = 64

/** 一个提供方最多挂多少个动作。 */
export const PROVIDER_ACTION_LIMIT = 64

/** 一个提供方最多挂多少个能力。 */
export const PROVIDER_CAPABILITY_LIMIT = 64

/** 一次提供方注册要动的那几样东西。 */
export interface ProviderDeps {
  /** 组件来源表；注册时加进去，撤下时移出来。 */
  roots: WidgetRoot[]
  /** 注册与撤下之后重读组件库。 */
  reload: () => Promise<void>
  registerDataSource: (source: DataSourceRegistration) => () => void
  registerAction: (action: ActionRegistration) => () => void
  registerCapability: (capability: CapabilityRegistration) => () => void
  registerMarketProvider: (registration: WidgetMarketProviderRegistration) => () => void
  /** 撤下时清掉这个提供方留下的授权。 */
  forgetGrants: (provider: string) => Promise<void>
  /** 读一个组件目录里现在有哪些组件 id。 */
  idsIn: (root: WidgetRoot) => Promise<string[]>
  /** 给一个新目录挂上监视；返回停止函数。 */
  watch: (dir: string) => () => void
  /**
   * 市场注册或撤下之后：读一次条目并发一次事件（D8、D18）。
   *
   * @param provider - 刚注册的提供方；撤下时为 undefined。
   */
  syncMarket: (provider?: string) => void
  /**
   * 提供方的健康记录（D31）：目录与市场的成功注册记在里面，撤下时还回去。
   *
   * 数据源、动作与能力的那几项由它们的注册表自己记，这里只补上提供方级的两样。
   */
  health: ProviderHealth
}

/** 提供方注册表。 */
export interface ProviderRegistry {
  /**
   * 新入口（v3）：拿到一个把手，目录、数据源、动作、能力与市场都经它挂上，撤下也由它一次办。
   *
   * @param provider - 提供方的包名。
   * @param features - 这次注册声明的功能；只进健康记录，不改变这一侧提供什么（D31）。
   * @returns 这个提供方的把手。
   * @throws {Error} 同一个提供方已经有一个活动把手，或已经经旧入口注册过。
   */
  registerProvider(provider: string, features?: readonly WidgetBoardFeature[]): Promise<WidgetProviderHandle>
  /**
   * 旧入口（v2、v3）：注册一个组件目录，读一次。
   *
   * @param provider - 提供方的包名。
   * @param directory - 组件目录的绝对路径。
   * @returns 这次注册的把手；释放它只撤下这一个目录。
   * @throws {Error} 同一个提供方已经用新入口注册过，或这一次读不出来。
   */
  registerEntryDirectory(provider: string, directory: string): Promise<WidgetTypeHandle>
  /** 旧入口（v2、v3）：注册一个数据源；返回释放函数。 */
  registerEntryDataSource(registration: DataSourceRegistration): () => void
  /** 旧入口（v2、v3）：注册一个动作；返回释放函数。 */
  registerEntryAction(registration: ActionRegistration): () => void
  /** 旧入口（v2、v3）：注册一个能力；返回释放函数。 */
  registerEntryCapability(registration: CapabilityRegistration): () => void
  /** 旧入口（v2、v3）：注册一个市场提供方；返回释放函数。 */
  registerEntryMarketProvider(registration: WidgetMarketProviderRegistration): () => void
  /** 已经注册的目录，按注册顺序。 */
  readonly roots: readonly WidgetRoot[]
  /** 撤下全部注册；拆除时用。 */
  disposeAll(): Promise<void>
}

/** 一个目录在内部的样子。 */
interface Directory {
  root: WidgetRoot
  /** 经这个目录把手挂上的数据源、动作与能力。 */
  entries: Set<() => void>
  /** 目录里读出来的组件 id。 */
  widgets: Set<string>
  stopWatch: () => void
  disposed: boolean
  /** 健康记录里这一项注册的释放函数；读失败的那一次没有。 */
  releaseHealth?: () => void
}

/** 一个提供方在内部的样子。 */
interface ProviderState {
  provider: string
  /** 经哪个入口注册：新把手还是一个接一个的旧入口。 */
  entrance: 'provider' | 'entry'
  directories: Map<string, Directory>
  sources: Set<() => void>
  actions: Set<() => void>
  capabilities: Set<() => void>
  releaseMarket?: () => void
  /** 健康记录里这个把手的释放函数；旧入口没有。 */
  releasePresent?: () => void
  disposed: boolean
}

/** 子注册的种类；配额与说法按它分。 */
type ChildKind = 'source' | 'action' | 'capability'

/** 每种子的配额。 */
const CHILD_LIMITS: Readonly<Record<ChildKind, number>> = {
  source: PROVIDER_SOURCE_LIMIT,
  action: PROVIDER_ACTION_LIMIT,
  capability: PROVIDER_CAPABILITY_LIMIT,
}

/** 每种子的说法。 */
const CHILD_LABELS: Readonly<Record<ChildKind, string>> = { source: '数据源', action: '动作', capability: '能力' }

/**
 * 建一个提供方注册表。
 *
 * @param deps - 要动的那几样东西。
 * @returns 注册表。
 */
export function createProviderRegistry(deps: ProviderDeps): ProviderRegistry {
  const states = new Map<string, ProviderState>()
  let chain: Promise<void> = Promise.resolve()

  /** 把一件事排进串行链；前一件失败不影响后一件。 */
  const serialize = <T>(work: () => Promise<T>): Promise<T> => {
    const run = chain.then(work)
    chain = run.then(() => undefined, () => undefined)
    return run
  }

  /** 旧入口登记出来的状态在名下的注册都撤完之后就消失，之后可以换成新入口。 */
  const prune = (state: ProviderState): void => {
    if (state.entrance !== 'entry' || state.disposed) return
    if (state.directories.size > 0 || state.sources.size > 0 || state.actions.size > 0 || state.capabilities.size > 0) return
    if (state.releaseMarket !== undefined) return
    states.delete(state.provider)
  }

  /** 这个提供方名下现在有哪些组件 id，按注册顺序。 */
  const widgetIdsOf = (state: ProviderState): string[] => {
    const ids: string[] = []
    for (const directory of state.directories.values()) {
      for (const id of directory.widgets) if (!ids.includes(id)) ids.push(id)
    }
    return ids
  }

  /** 一个把手已经撤下时拒绝再往上挂东西。 */
  const requireLive = (state: ProviderState): void => {
    if (state.disposed) throw new Error(state.provider + ' 的提供方把手已经撤下；要再挂东西先重新注册')
  }

  /** 按提供方名取旧入口用的状态；与新把手冲突时抛出。 */
  const entryState = (provider: string): ProviderState => {
    if (provider.trim() === '') throw new Error('提供方的包名不能为空')
    const existing = states.get(provider)
    if (existing !== undefined) {
      if (existing.entrance === 'provider') {
        throw new Error(provider + ' 已经用 registerProvider 注册过；同一个提供方不能同时经新旧两个入口注册，改用把手上的方法')
      }
      return existing
    }
    const created: ProviderState = {
      provider,
      entrance: 'entry',
      directories: new Map(),
      sources: new Set(),
      actions: new Set(),
      capabilities: new Set(),
      disposed: false,
    }
    states.set(provider, created)
    return created
  }

  /** 旧入口一次注册：失败时不留下这个提供方的状态。 */
  const withEntryState = <T>(provider: string, work: (state: ProviderState) => T): T => {
    const state = entryState(provider)
    try {
      return work(state)
    } catch (error) {
      prune(state)
      throw error
    }
  }

  /** 旧入口一次异步注册：同上。 */
  const withEntryStateAsync = async <T>(provider: string, work: (state: ProviderState) => Promise<T>): Promise<T> => {
    const state = entryState(provider)
    try {
      return await work(state)
    } catch (error) {
      prune(state)
      throw error
    }
  }

  /** 把一份子注册挂上去：配额在这里算，释放函数可以重复调用。 */
  const trackChild = <T extends { id: string, provider: string }>(
    state: ProviderState,
    kind: ChildKind,
    table: Set<() => void>,
    registration: T,
    register: (registration: T) => () => void,
  ): () => void => {
    requireLive(state)
    if (table.size >= CHILD_LIMITS[kind]) {
      throw new Error(state.provider + ' 的' + CHILD_LABELS[kind] + '已经到 ' + String(CHILD_LIMITS[kind]) + ' 个上限；先撤下几个再注册')
    }
    const release = register(registration)
    table.add(release)
    let released = false
    return () => {
      if (released) return
      released = true
      table.delete(release)
      release()
      prune(state)
    }
  }

  /** 撤下一个目录的同步部分：监视、子注册、健康记录与来源条目一起走。 */
  const detachDirectory = (state: ProviderState, directory: Directory): void => {
    if (directory.disposed) return
    directory.disposed = true
    state.directories.delete(directory.root.dir)
    directory.releaseHealth?.()
    directory.releaseHealth = undefined
    directory.stopWatch()
    const entries = [...directory.entries]
    directory.entries.clear()
    for (const release of entries) release()
    const index = deps.roots.indexOf(directory.root)
    if (index !== -1) deps.roots.splice(index, 1)
  }

  /** 撤下一个提供方名下的全部东西：目录、子注册与市场；授权与重读由调用方接着办。 */
  const releaseState = (state: ProviderState): void => {
    for (const directory of [...state.directories.values()]) detachDirectory(state, directory)
    const children = [...state.sources, ...state.actions, ...state.capabilities]
    state.sources.clear()
    state.actions.clear()
    state.capabilities.clear()
    for (const release of children) release()
    state.releaseMarket?.()
    state.releaseMarket = undefined
  }

  /** 一个目录注册的把手：它名下的子注册随它一起释放。 */
  const directoryHandle = (state: ProviderState, directory: Directory): WidgetTypeHandle => ({
    provider: state.provider,
    get widgets() {
      return [...directory.widgets]
    },
    register(registrations = {}) {
      const added = new Set<() => void>()
      try {
        for (const source of registrations.dataSources ?? []) {
          requireSameProvider(state, '数据源 ' + source.id, source.provider)
          added.add(trackChild(state, 'source', state.sources, source, deps.registerDataSource))
        }
        for (const action of registrations.actions ?? []) {
          requireSameProvider(state, '动作 ' + action.id, action.provider)
          added.add(trackChild(state, 'action', state.actions, action, deps.registerAction))
        }
        for (const capability of registrations.capabilities ?? []) {
          requireSameProvider(state, '能力 ' + capability.id, capability.provider)
          added.add(trackChild(state, 'capability', state.capabilities, capability, deps.registerCapability))
        }
      } catch (error) {
        for (const release of added) release()
        throw error
      }
      for (const release of added) directory.entries.add(release)
      return () => {
        for (const release of added) {
          if (directory.entries.delete(release)) release()
        }
      }
    },
    async dispose() {
      if (directory.disposed) return
      await serialize(async () => {
        detachDirectory(state, directory)
        await deps.forgetGrants(state.provider)
        await deps.reload()
        prune(state)
      })
    },
  })

  /** 挂一个市场提供方：同一时刻一个提供方只有一个。 */
  const addMarket = (state: ProviderState, registration: ProviderMarketRegistration): (() => void) => {
    requireLive(state)
    if (state.releaseMarket !== undefined) {
      throw new Error(state.provider + ' 已经注册过市场；先撤下它再注册新的')
    }
    const release = deps.registerMarketProvider({ ...registration, apiVersion: WIDGET_BOARD_PROVIDER_API_VERSION, provider: state.provider })
    const releasedHealth = deps.health.registered(state.provider)
    let released = false
    const revoke = (): void => {
      if (released) return
      released = true
      state.releaseMarket = undefined
      releasedHealth()
      release()
      deps.syncMarket()
      prune(state)
    }
    state.releaseMarket = revoke
    deps.syncMarket(state.provider)
    return revoke
  }

  /** 新入口的把手：目录、数据源、动作、能力与市场都挂在它名下，撤下时一次走完。 */
  const providerHandle = (state: ProviderState): WidgetProviderHandle => ({
    provider: state.provider,
    supportedApiVersions: WIDGET_BOARD_SUPPORTED_API_VERSIONS,
    features: WIDGET_BOARD_FEATURES,
    supports(feature: WidgetBoardFeature) {
      return supportsFeature(WIDGET_BOARD_FEATURES, feature)
    },
    get directories() {
      return [...state.directories.keys()]
    },
    get widgets() {
      return widgetIdsOf(state)
    },
    async registerWidgets(registration) {
      return await addDirectory(state, registration.directory, true)
    },
    registerDataSource(registration: ProviderDataSourceRegistration) {
      return trackChild(state, 'source', state.sources, {
        ...registration,
        apiVersion: WIDGET_BOARD_PROVIDER_API_VERSION,
        provider: state.provider,
      }, deps.registerDataSource)
    },
    registerAction(registration: ProviderActionRegistration) {
      return trackChild(state, 'action', state.actions, {
        ...registration,
        apiVersion: WIDGET_BOARD_PROVIDER_API_VERSION,
        provider: state.provider,
      }, deps.registerAction)
    },
    registerCapability(registration: ProviderCapabilityRegistration) {
      return trackChild(state, 'capability', state.capabilities, {
        ...registration,
        apiVersion: WIDGET_BOARD_PROVIDER_API_VERSION,
        provider: state.provider,
      }, deps.registerCapability)
    },
    registerMarketProvider(registration: ProviderMarketRegistration) {
      return addMarket(state, registration)
    },
    async dispose() {
      if (state.disposed) return
      state.disposed = true
      states.delete(state.provider)
      state.releasePresent?.()
      state.releasePresent = undefined
      releaseState(state)
      await serialize(async () => {
        await deps.forgetGrants(state.provider)
        await deps.reload()
      })
    },
  })

  /** 挂上一个组件目录，读一次。 */
  const addDirectory = async (state: ProviderState, path: string, authorDomain: boolean): Promise<WidgetTypeHandle> => {
    requireLive(state)
    if (typeof path !== 'string' || path.trim() === '') throw new Error(state.provider + ' 注册组件目录要写 directory')
    if (state.directories.has(path)) {
      throw new Error(state.provider + ' 已经注册过 ' + path + '；同一个目录只注册一次')
    }
    const root: WidgetRoot = { dir: path, source: 'plugin', provider: state.provider, ...(authorDomain ? { authorDomain: true } : {}) }
    const ids = await deps.idsIn(root)
    const held = widgetIdsOf(state).length
    const total = new Set([...widgetIdsOf(state), ...ids]).size
    if (total > PROVIDER_WIDGET_LIMIT) {
      throw new Error(state.provider + ' 的组件上限是 ' + String(PROVIDER_WIDGET_LIMIT) + ' 个：现在有 ' + String(held) + ' 个，' + path + ' 里这 ' + String(new Set(ids).size) + ' 个再加进来就超了')
    }
    // 目录先读 id、再进来源表：读不出来的那一次不留下来源条目与监视（D11）。
    insertRoot(deps.roots, root)
    const directory: Directory = { root, entries: new Set(), widgets: new Set(ids), stopWatch: deps.watch(root.dir), disposed: false }
    state.directories.set(path, directory)
    try {
      await serialize(deps.reload)
    } catch (error) {
      detachDirectory(state, directory)
      throw error
    }
    // 读完并重读成功才算一项注册（D31）：健康记录里的注册数与可用性跟着这一项。
    directory.releaseHealth = deps.health.registered(state.provider)
    return directoryHandle(state, directory)
  }

  return {
    get roots() {
      return deps.roots
    },
    async registerProvider(provider, features) {
      if (provider.trim() === '') throw new Error('registerProvider 需要提供方的包名')
      const existing = states.get(provider)
      if (existing !== undefined) {
        if (existing.entrance === 'provider') {
          throw new Error(provider + ' 已经有一个活动的提供方把手；先 dispose 再注册新的')
        }
        throw new Error(provider + ' 已经经 registerWidgetType 这类旧入口注册过；同一个提供方不能同时经新旧两个入口注册，先释放旧的注册')
      }
      const state: ProviderState = {
        provider,
        entrance: 'provider',
        directories: new Map(),
        sources: new Set(),
        actions: new Set(),
        capabilities: new Set(),
        disposed: false,
      }
      states.set(provider, state)
      // 拿到把手就算可用，但不算一项注册：目录、数据源这些挂上来时各自再记一次（D31）。
      state.releasePresent = deps.health.present(provider, features)
      return providerHandle(state)
    },
    async registerEntryDirectory(provider, directory) {
      return await withEntryStateAsync(provider, async (state) => await addDirectory(state, directory, false))
    },
    registerEntryDataSource(registration) {
      return withEntryState(registration.provider, (state) => trackChild(state, 'source', state.sources, registration, deps.registerDataSource))
    },
    registerEntryAction(registration) {
      return withEntryState(registration.provider, (state) => trackChild(state, 'action', state.actions, registration, deps.registerAction))
    },
    registerEntryCapability(registration) {
      return withEntryState(registration.provider, (state) => trackChild(state, 'capability', state.capabilities, registration, deps.registerCapability))
    },
    registerEntryMarketProvider(registration) {
      return withEntryState(registration.provider, (state) => addMarket(state, registration))
    },
    async disposeAll() {
      const all = [...states.values()]
      states.clear()
      for (const state of all) {
        state.disposed = true
        state.releasePresent?.()
        state.releasePresent = undefined
        releaseState(state)
      }
      // 授权跟着提供方一起撤下（D18）；插件正在拆除，剩下的来源也一起走，不再逐个重读组件库。
      for (const state of all) await deps.forgetGrants(state.provider)
    },
  }
}

/**
 * 子注册的提供方必须与把手相同：认错人的注册会在撤下时留下指错人的残留。
 *
 * @param state - 提供方的状态。
 * @param label - 出错时说的那一样东西。
 * @param provider - 子注册自己报的提供方。
 * @throws {Error} 两者不同。
 */
function requireSameProvider(state: ProviderState, label: string, provider: string): void {
  if (provider !== state.provider) throw new Error(label + ' 的 provider 是 ' + provider + '，这次注册的提供方是 ' + state.provider)
}

/**
 * 旧入口接受的注册版本：集合里的任一版本都行（D31）。
 *
 * @param entry - 是哪个入口。
 * @param apiVersion - 提供方带来的版本。
 * @throws {Error} 版本不在集合里。
 */
function requireEntranceVersion(entry: string, apiVersion: number): void {
  if (!WIDGET_BOARD_SUPPORTED_API_VERSIONS.includes(apiVersion)) {
    throw new Error(entry + ' 接受版本 ' + WIDGET_BOARD_SUPPORTED_API_VERSIONS.join('、') + '；带来的是 ' + String(apiVersion))
  }
}

/**
 * 建宿主侧的 widgetBoard 服务（D31）。
 *
 * 同一份服务对象同时扮演 v2 与 v3：registerProvider 是 v3 才有的入口，只接受
 * WIDGET_BOARD_PROVIDER_API_VERSION；旧入口接受 WIDGET_BOARD_SUPPORTED_API_VERSIONS 里的任一版本。
 *
 * @param providers - 提供方注册表。
 * @returns 服务面。
 */
export function createWidgetBoardService(providers: ProviderRegistry): WidgetBoardHostService {
  return {
    apiVersion: WIDGET_BOARD_API_VERSION,
    supportedApiVersions: WIDGET_BOARD_SUPPORTED_API_VERSIONS,
    features: WIDGET_BOARD_FEATURES,
    supports(feature: WidgetBoardFeature) {
      return supportsFeature(WIDGET_BOARD_FEATURES, feature)
    },
    async registerProvider(registration: WidgetProviderRegistration): Promise<WidgetProviderHandle> {
      if (registration.apiVersion !== WIDGET_BOARD_PROVIDER_API_VERSION) {
        throw versionMismatch(WIDGET_BOARD_PROVIDER_API_VERSION, registration.apiVersion)
      }
      // 功能声明只是用途（D31）：拼错的一个名字让这次注册可见地失败，合法的子集照常注册。
      const features = requireFeatures(registration.features)
      return await providers.registerProvider(registration.provider, features)
    },
    async registerWidgetType(registration: WidgetTypeRegistration): Promise<WidgetTypeHandle> {
      requireEntranceVersion('registerWidgetType', registration.apiVersion)
      return await providers.registerEntryDirectory(registration.provider, registration.directory)
    },
    registerDataSource(registration: DataSourceRegistration) {
      requireEntranceVersion('registerDataSource', registration.apiVersion)
      return providers.registerEntryDataSource(registration)
    },
    registerAction(registration: ActionRegistration) {
      requireEntranceVersion('registerAction', registration.apiVersion)
      return providers.registerEntryAction(registration)
    },
    registerCapability(registration: CapabilityRegistration) {
      requireEntranceVersion('registerCapability', registration.apiVersion)
      return providers.registerEntryCapability(registration)
    },
    registerMarketProvider(registration: WidgetMarketProviderRegistration) {
      requireEntranceVersion('registerMarketProvider', registration.apiVersion)
      return providers.registerEntryMarketProvider(registration)
    },
  }
}

/**
 * 一个组件目录里现在有哪些组件 id。
 *
 * 读不出来就跳过：这一次注册少清一条授权，不影响看板。
 *
 * @param root - 组件来源。
 * @param readManifest - 读一个组件目录的 manifest；测试里换成替身。
 * @returns 组件 id。
 */
export async function widgetIdsIn(root: WidgetRoot, readManifest: (file: string) => Promise<string>): Promise<string[]> {
  const { readdir } = await import('node:fs/promises')
  let entries
  try {
    entries = await readdir(root.dir, { withFileTypes: true })
  } catch {
    return []
  }
  const ids: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    try {
      const manifest = JSON.parse(await readManifest(join(root.dir, entry.name, 'widget.json'))) as { id?: unknown }
      if (typeof manifest.id === 'string' && manifest.id !== '') ids.push(manifest.id)
    } catch {
      // 读不出来就跳过。
    }
  }
  return ids
}
