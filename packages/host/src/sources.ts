/**
 * 数据源与动作的注册表（D6、D17）。
 *
 * 插件提供方经 `widgetBoard` 服务注册数据源与动作；卡片的数据由数据源读出来，组件的按钮发出
 * 动作后由动作执行。注册随提供方的释放在拆除时撤下，名字冲突时后注册的失败并说明原因（D17）。
 */
import type { ActionRegistration, DataSourceRegistration, InstanceFace } from '@dsh-widget-board/contracts'

/** 数据源与动作的注册表。 */
export interface Registries {
  /** 注册一个数据源；返回释放函数。 */
  registerDataSource(source: DataSourceRegistration): () => void
  /** 注册一个动作；返回释放函数。 */
  registerAction(action: ActionRegistration): () => void
  /** 有没有这个名字的数据源。 */
  hasDataSource(id: string): boolean
  /** 读一次数据；没有这个数据源时抛出。 */
  readSource(id: string, instance: InstanceFace): Promise<unknown>
  /** 跑一次动作；没有这个动作时抛出。 */
  runAction(id: string, instance: InstanceFace, payload: unknown): Promise<unknown>
}

/**
 * 建一张注册表。
 *
 * @returns 数据源与动作的注册表。
 */
export function createRegistries(): Registries {
  const sources = new Map<string, DataSourceRegistration>()
  const actions = new Map<string, ActionRegistration>()

  const register = <T extends { id: string }>(table: Map<string, T>, entry: T, kind: string): (() => void) => {
    if (table.has(entry.id)) throw new Error(`${kind} ${entry.id} 已经注册过了`)
    table.set(entry.id, entry)
    return () => {
      if (table.get(entry.id) === entry) table.delete(entry.id)
    }
  }

  return {
    registerDataSource(source) {
      return register(sources, source, '数据源')
    },
    registerAction(action) {
      return register(actions, action, '动作')
    },
    hasDataSource(id) {
      return sources.has(id)
    },
    async readSource(id, instance) {
      const source = sources.get(id)
      if (source === undefined) throw new Error(`没有数据源 ${id}，提供它的插件可能没有安装`)
      return await source.read(instance)
    },
    async runAction(id, instance, payload) {
      const action = actions.get(id)
      if (action === undefined) throw new Error(`没有动作 ${id}，提供它的插件可能没有安装`)
      return await action.run(instance, payload)
    },
  }
}
