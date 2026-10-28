/**
 * 数据源、动作与宿主能力的注册表（D6、D12、D17、D24）。
 *
 * 插件提供方经 `widgetBoard` 服务注册数据源、动作与能力；卡片的数据由数据源读出来，组件的按钮发出
 * 动作后由动作执行，组件需要参数、返回值、超时或取消时经能力调用。名字在同一时刻全局唯一：跨提供
 * 方重名时后到的注册被拒绝并说明原因，不静默覆盖——两个提供方的名字长得一样时，组件用
 * `提供方:名字` 点名（D12）。
 *
 * 注册随提供方的注册把手释放（`WidgetTypeHandle.dispose`）而撤下；提供方卸载后，指向它的卡片照旧
 * 留着，只是数据源、动作与能力不再存在，读取时报出「提供它的插件可能没有安装」。
 */
import type { ActionRegistration, CapabilityRegistration, DataSourceRegistration, InstanceFace } from '@dsh-widget-board/contracts'

/** 一条注册与它的提供方。 */
interface Owned<T> {
  entry: T
  provider: string
}

/** 解析出来的动作：注册本身与它的提供方。 */
export interface ResolvedAction {
  registration: ActionRegistration
  provider: string
}

/** 解析出来的数据源。 */
export interface ResolvedSource {
  registration: DataSourceRegistration
  provider: string
}

/** 解析出来的宿主能力。 */
export interface ResolvedCapability {
  registration: CapabilityRegistration
  provider: string
}

/** 数据源、动作与宿主能力的注册表。 */
export interface Registries {
  /** 注册一个数据源；返回释放函数。 */
  registerDataSource(source: DataSourceRegistration): () => void
  /** 注册一个动作；返回释放函数。 */
  registerAction(action: ActionRegistration): () => void
  /** 注册一个宿主能力；返回释放函数。 */
  registerCapability(capability: CapabilityRegistration): () => void
  /** 有没有这个名字的数据源。 */
  hasDataSource(id: string): boolean
  /** 按名字（或 `提供方:名字`）解析一个数据源；没有时是 `undefined`。 */
  resolveDataSource(id: string): ResolvedSource | undefined
  /** 按名字（或 `提供方:名字`）解析一个动作；没有时是 `undefined`。 */
  resolveAction(id: string): ResolvedAction | undefined
  /** 按名字（或 `提供方:名字`）解析一个宿主能力；没有时是 `undefined`。 */
  resolveCapability(id: string): ResolvedCapability | undefined
  /** 读一次数据；没有这个数据源时抛出。 */
  readSource(id: string, instance: InstanceFace): Promise<unknown>
  /** 跑一次动作；没有这个动作时抛出。 */
  runAction(id: string, instance: InstanceFace, payload: unknown): Promise<unknown>
  /** 调一次宿主能力；没有这个能力时抛出。 */
  callCapability(id: string, instance: InstanceFace, args: unknown, signal: AbortSignal): Promise<unknown>
  /** 某个提供方名下的全部名字，按注册顺序。 */
  namesOf(provider: string): { dataSources: string[], actions: string[], capabilities: string[] }
  /** 当前解析得到的全部能力名字，按注册顺序（D24）：握手里给组件看它有哪些可用。 */
  listCapabilities(): string[]
}

/**
 * 建一张注册表。
 *
 * @returns 数据源与动作的注册表。
 */
export function createRegistries(): Registries {
  const sources = new Map<string, Owned<DataSourceRegistration>>()
  const actions = new Map<string, Owned<ActionRegistration>>()
  const capabilities = new Map<string, Owned<CapabilityRegistration>>()

  const register = <T extends { id: string, provider: string }>(table: Map<string, Owned<T>>, entry: T, kind: string): (() => void) => {
    if (entry.provider.trim() === '') throw new Error(`${kind} ${entry.id} 要写明提供方`)
    const existing = table.get(entry.id)
    if (existing !== undefined) {
      throw new Error(`${kind} ${entry.id} 已经由 ${existing.provider} 注册过；换一个名字，或让组件用「${existing.provider}:${entry.id}」点名`)
    }
    const owned: Owned<T> = { entry, provider: entry.provider }
    table.set(entry.id, owned)
    return () => {
      if (table.get(entry.id) === owned) table.delete(entry.id)
    }
  }

  /**
   * 按 `提供方:名字` 或裸名字找一条。
   *
   * @param table - 数据源或动作的表。
   * @param id - 名字。
   * @returns 找到的那一条；裸名字按全局唯一解，带提供方时两者都要对上。
   */
  const lookup = <T extends { id: string }>(table: Map<string, Owned<T>>, id: string): Owned<T> | undefined => {
    const separator = id.indexOf(':')
    if (separator === -1) return table.get(id)
    const provider = id.slice(0, separator)
    const owned = table.get(id.slice(separator + 1))
    return owned !== undefined && owned.provider === provider ? owned : undefined
  }

  return {
    registerDataSource(source) {
      return register(sources, source, '数据源')
    },
    registerAction(action) {
      return register(actions, action, '动作')
    },
    registerCapability(capability) {
      return register(capabilities, capability, '能力')
    },
    hasDataSource(id) {
      return lookup(sources, id) !== undefined
    },
    resolveDataSource(id) {
      const found = lookup(sources, id)
      return found === undefined ? undefined : { registration: found.entry, provider: found.provider }
    },
    resolveAction(id) {
      const found = lookup(actions, id)
      return found === undefined ? undefined : { registration: found.entry, provider: found.provider }
    },
    resolveCapability(id) {
      const found = lookup(capabilities, id)
      return found === undefined ? undefined : { registration: found.entry, provider: found.provider }
    },
    async readSource(id, instance) {
      const found = lookup(sources, id)
      if (found === undefined) throw new Error(`没有数据源 ${id}，提供它的插件可能没有安装`)
      return await found.entry.read(instance)
    },
    async runAction(id, instance, payload) {
      const found = lookup(actions, id)
      if (found === undefined) throw new Error(`没有动作 ${id}，提供它的插件可能没有安装`)
      return await found.entry.run(instance, payload)
    },
    async callCapability(id, instance, args, signal) {
      const found = lookup(capabilities, id)
      if (found === undefined) throw new Error(`没有能力 ${id}，提供它的插件可能没有安装`)
      return await found.entry.call(instance, args, signal)
    },
    namesOf(provider) {
      const names = <T extends { id: string }>(table: Map<string, Owned<T>>): string[] =>
        [...table.values()].filter((owned) => owned.provider === provider).map((owned) => owned.entry.id)
      return { dataSources: names(sources), actions: names(actions), capabilities: names(capabilities) }
    },
    listCapabilities() {
      return [...capabilities.keys()]
    },
  }
}
