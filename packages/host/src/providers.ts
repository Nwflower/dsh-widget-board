/**
 * 插件提供方的注册与生命周期（D12、D17）。
 *
 * 一个提供方经 `widgetBoard` 服务注册一个组件目录，并在这次注册名下挂上自己的数据源与动作。看板
 * 要把这三样当一件事管：提供方卸载时，目录、数据源、动作、它留下的授权与它的目录监视一起撤下，
 * 不留下指向已经不存在的提供方的数据源。
 *
 * 撤下与注册都排在同一条串行链上：一次撤下与一次注册同时到来时，后一次看得到前一次的结果。
 */
import { join } from 'node:path'
import type { DataSourceRegistration, ActionRegistration, CapabilityRegistration, WidgetRoot, WidgetTypeHandle } from '@dsh-widget-board/contracts'
import { insertRoot } from './library'

/** 一次提供方注册要动的那几样东西。 */
export interface ProviderDeps {
  /** 组件来源表；注册时加进去，撤下时移出来。 */
  roots: WidgetRoot[]
  /** 注册与撤下之后重读组件库。 */
  reload: () => Promise<void>
  registerDataSource: (source: DataSourceRegistration) => () => void
  registerAction: (action: ActionRegistration) => () => void
  registerCapability: (capability: CapabilityRegistration) => () => void
  /** 撤下时清掉这个提供方留下的授权。 */
  forgetGrants: (provider: string) => Promise<void>
  /** 读一个组件目录里现在有哪些组件 id。 */
  idsIn: (root: WidgetRoot) => Promise<string[]>
  /** 给一个新目录挂上监视；返回停止函数。 */
  watch: (dir: string) => () => void
}

/** 提供方注册表。 */
export interface ProviderRegistry {
  /**
   * 注册一个组件目录，读一次。
   *
   * @param registration - 提供方与目录。
   * @returns 这次注册的把手。
   * @throws {Error} 同一个目录同一个提供方已经注册过，或这一次读不出来。
   */
  register(registration: { provider: string, directory: string }): Promise<WidgetTypeHandle>
  /** 已经注册的目录，按注册顺序。 */
  readonly roots: readonly WidgetRoot[]
  /** 撤下全部注册；拆除时用。 */
  disposeAll(): Promise<void>
}

/** 一次注册在内部的样子。 */
interface Handle {
  provider: string
  root: WidgetRoot
  /** 这次注册名下的数据源与动作的释放函数。 */
  entries: Set<() => void>
  /** 这次目录里读出来的组件 id。 */
  widgets: Set<string>
  stopWatch: () => void
  disposed: boolean
}

/**
 * 建一个提供方注册表。
 *
 * @param deps - 要动的那几样东西。
 * @returns 注册表。
 */
export function createProviderRegistry(deps: ProviderDeps): ProviderRegistry {
  const handles = new Set<Handle>()
  let chain: Promise<void> = Promise.resolve()

  /** 把一件事排进串行链；前一件失败不影响后一件。 */
  const serialize = <T>(work: () => Promise<T>): Promise<T> => {
    const run = chain.then(work)
    chain = run.then(() => undefined, () => undefined)
    return run
  }

  /** 撤下一个把手的同步部分：目录监视、子注册与来源条目一起走；授权与重读由调用方接着办。 */
  const detachHandle = (handle: Handle): void => {
    if (handle.disposed) return
    handle.disposed = true
    handles.delete(handle)
    handle.stopWatch()
    for (const dispose of handle.entries) dispose()
    handle.entries.clear()
    const index = deps.roots.indexOf(handle.root)
    if (index !== -1) deps.roots.splice(index, 1)
  }

  const disposeHandle = async (handle: Handle): Promise<void> => {
    if (handle.disposed) return
    detachHandle(handle)
    await deps.forgetGrants(handle.provider)
    await deps.reload()
  }

  return {
    get roots() {
      return deps.roots
    },
    async register(registration) {
      const root: WidgetRoot = { dir: registration.directory, source: 'plugin', provider: registration.provider }
      if (deps.roots.some((existing) => existing.dir === root.dir && existing.provider === root.provider)) {
        throw new Error(`${registration.provider} 已经注册过 ${registration.directory}`)
      }
      const handle: Handle = { provider: registration.provider, root, entries: new Set(), widgets: new Set(), stopWatch: () => {}, disposed: false }
      handles.add(handle)
      // 插件目录排在示例之前（D17）：注册是运行时的事，来源表按 WIDGET_SOURCES 的次序插。
      insertRoot(deps.roots, root)
      handle.stopWatch = deps.watch(root.dir)
      try {
        await serialize(deps.reload)
      } catch (error) {
        handle.disposed = true
        handles.delete(handle)
        handle.stopWatch()
        const index = deps.roots.indexOf(root)
        if (index !== -1) deps.roots.splice(index, 1)
        throw error
      }
      for (const id of await deps.idsIn(root)) handle.widgets.add(id)
      return {
        provider: registration.provider,
        get widgets() {
          return [...handle.widgets]
        },
        register(registrations = {}) {
          const added = new Set<() => void>()
          try {
            for (const source of registrations.dataSources ?? []) {
              // 子注册归这次注册的提供方：撤下时按把手上的名字清授权，另一个名字会留下指错人的残留。
              if (source.provider !== handle.provider) {
                throw new Error(`数据源 ${source.id} 的 provider 是 ${source.provider}，这次注册的提供方是 ${handle.provider}`)
              }
              added.add(deps.registerDataSource(source))
            }
            for (const action of registrations.actions ?? []) {
              if (action.provider !== handle.provider) {
                throw new Error(`动作 ${action.id} 的 provider 是 ${action.provider}，这次注册的提供方是 ${handle.provider}`)
              }
              added.add(deps.registerAction(action))
            }
            for (const capability of registrations.capabilities ?? []) {
              if (capability.provider !== handle.provider) {
                throw new Error(`能力 ${capability.id} 的 provider 是 ${capability.provider}，这次注册的提供方是 ${handle.provider}`)
              }
              added.add(deps.registerCapability(capability))
            }
          } catch (error) {
            for (const dispose of added) dispose()
            throw error
          }
          for (const dispose of added) handle.entries.add(dispose)
          return () => {
            for (const dispose of added) {
              if (handle.entries.delete(dispose)) dispose()
            }
          }
        },
        async dispose() {
          await serialize(async () => { await disposeHandle(handle) })
        },
      }
    },
    async disposeAll() {
      const removed = [...handles]
      for (const handle of removed) detachHandle(handle)
      // 授权跟着提供方一起撤下（D18）；插件正在拆除，剩下的来源也一起走，不再逐个重读组件库。
      for (const handle of removed) await deps.forgetGrants(handle.provider)
    },
  }
}

/**
 * 一个组件目录里现在有哪些组件 id。
 *
 * 读不出来就跳过：撤下时少清一条授权，不影响看板。
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
