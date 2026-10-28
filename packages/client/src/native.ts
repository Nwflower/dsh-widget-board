/**
 * 原生组件的登记处（D3 的原生级、D31、D17）。
 *
 * 插件注册的组件画在父页面里，不再套 iframe：它本来就是已安装的代码。登记按组件 id 索引，
 * 与宿主组件库里的同名组件对上之后，卡片改用这个组件渲染，而不是取组件文档。
 *
 * 一个提供方同一时刻只有一个活动把手：新入口 `registerProvider` 一个把手管完它名下的全部原生组件，
 * 旧入口 `registerWidgetType` 一次一个、各自释放。一个提供方只能占其中一条路，占着的时候另一条抛出
 * （D31）。
 */
import { useSyncExternalStore } from 'react'
import type { ComponentType } from 'react'
import type {
  NativeWidgetRegistration,
  ProviderNativeWidgetRegistration,
  WidgetBoardClientService,
  WidgetBoardFeature,
  WidgetNativeProps,
  WidgetNativeProviderHandle,
} from '@dsh-widget-board/contracts'
import {
  WIDGET_BOARD_API_VERSION,
  WIDGET_BOARD_PROVIDER_API_VERSION,
  WIDGET_BOARD_SUPPORTED_API_VERSIONS,
  isAuthorNamespacedWidgetId,
  requireFeatures,
  supportsFeature,
  versionMismatch,
} from '@dsh-widget-board/contracts'

/** 一个原生组件。 */
export interface NativeWidget {
  provider: string
  component: ComponentType<WidgetNativeProps>
}

/** 一个提供方最多挂这么多个原生组件；超过的抛出，让它把这一批拆开（D31）。 */
export const NATIVE_WIDGETS_PER_PROVIDER = 128

/**
 * 这一侧真有的功能（D31）：只列浏览器半边做得到的项。
 *
 * `eventData`（宿主推来的 `instance` 事件带 `data`，页面就地合并，D18）与 `pushData`（页面把数据
 * 推给一张卡，D17）的落点都在页面上；能力注册表的那份元数据（标题、说明、参数与结果 schema）只有
 * 宿主那一侧有（D24），市场提供方也只发布在宿主那一侧（D30），所以这两项不列。
 */
const CLIENT_FEATURES: readonly WidgetBoardFeature[] = Object.freeze(['eventData', 'pushData'] as const)

const registry = new Map<string, NativeWidget>()
const listeners = new Set<() => void>()

/**
 * 一个提供方此刻的活动注册。
 *
 * 新入口的把手与旧入口的单独注册记在同一张表里，一个提供方只能占其中一种；最后一个组件撤下时整条
 * 记录一起删掉，同一个提供方可以再注册。
 */
interface ProviderSlot {
  /** `registerProvider` 发出的把手；旧入口注册时没有。 */
  handle?: WidgetNativeProviderHandle
  /** 旧入口此刻挂着的组件数。 */
  legacy: number
}

const providers = new Map<string, ProviderSlot>()

/** 通知所有订阅者登记处变了。 */
function notify(): void {
  for (const listener of listeners) listener()
}

/**
 * 一个组件 id 上登记的原生组件。
 *
 * @param id - 组件 id。
 * @returns 登记项，没有时为 `undefined`。
 */
export function nativeWidgetOf(id: string): NativeWidget | undefined {
  return registry.get(id)
}

/**
 * 在组件里读登记处；登记或撤下时重新渲染。
 *
 * @param id - 组件 id。
 * @returns 登记项，没有时为 `undefined`。
 */
export function useNativeWidget(id: string): NativeWidget | undefined {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    () => registry.get(id),
  )
}

/**
 * 旧入口的版本判据：接受 `WIDGET_BOARD_SUPPORTED_API_VERSIONS` 里的任一版本（2、3）。
 *
 * @param apiVersion - 注册带来的版本。
 * @throws {Error} 版本不在这一侧接受的集合里。
 */
function requireSupportedVersion(apiVersion: number): void {
  if (!WIDGET_BOARD_SUPPORTED_API_VERSIONS.includes(apiVersion)) {
    throw versionMismatch(WIDGET_BOARD_API_VERSION, apiVersion)
  }
}

/**
 * 新入口的版本判据：只认 `WIDGET_BOARD_PROVIDER_API_VERSION`。
 *
 * @param apiVersion - 注册带来的版本。
 * @throws {Error} 版本不是新入口接受的那一个。
 */
function requireProviderVersion(apiVersion: number): void {
  if (apiVersion !== WIDGET_BOARD_PROVIDER_API_VERSION) {
    throw new Error(`registerProvider 只接受版本 ${WIDGET_BOARD_PROVIDER_API_VERSION}；带来的是 ${String(apiVersion)}`)
  }
}

/**
 * 核对 React 组件的形状：数字、字符串这类登记进去要到画的时候才炸。
 *
 * @param id - 组件 id，出错时指人。
 * @param component - 报上来的组件。
 * @returns 同一个值，类型收窄成组件。
 * @throws {Error} 既不是函数也不是对象。
 */
function requireComponent(id: string, component: unknown): ComponentType<WidgetNativeProps> {
  if (typeof component !== 'function' && (typeof component !== 'object' || component === null)) {
    throw new Error(`${id} 的 component 要是 React 组件`)
  }
  return component as ComponentType<WidgetNativeProps>
}

/**
 * 登记一个原生组件：与组件库同一条规则，同 id 先到者胜，后到的抛出并说明已有提供方（D31）。
 *
 * @param id - 组件 id。
 * @param provider - 提供方包名。
 * @param component - 画这个组件的 React 组件。
 * @returns 记下来的那一项，释放时按它判断还归不归自己撤。
 * @throws {Error} 这个 id 已经被别的提供方登记。
 */
function claimWidget(id: string, provider: string, component: ComponentType<WidgetNativeProps>): NativeWidget {
  const existing = registry.get(id)
  if (existing !== undefined) {
    throw new Error(`组件 ${id} 已经由 ${existing.provider} 注册；先到的那一个继续用`)
  }
  const entry: NativeWidget = { provider, component }
  registry.set(id, entry)
  notify()
  return entry
}

/**
 * 撤下一个登记项：只撤还归自己撤的那一份，别人后来登记的同名组件不动。
 *
 * 调用处自己 `notify()`，一次撤下多个时只通知一遍。
 *
 * @param id - 组件 id。
 * @param entry - 当初登记的那一项。
 */
function dropWidget(id: string, entry: NativeWidget): void {
  if (registry.get(id) === entry) registry.delete(id)
}

/**
 * 建一个提供方把手（v3）：组件记在它名下，`dispose` 一次全部撤下、再调用一次什么都不做。
 *
 * @param provider - 提供方包名。
 * @returns 这个提供方的把手。
 */
function createHandle(provider: string): WidgetNativeProviderHandle {
  const widgets: { id: string, entry: NativeWidget }[] = []
  let disposed = false
  const handle: WidgetNativeProviderHandle = {
    provider,
    supportedApiVersions: WIDGET_BOARD_SUPPORTED_API_VERSIONS,
    features: CLIENT_FEATURES,
    get widgets(): readonly string[] {
      return Object.freeze(widgets.map((item) => item.id))
    },
    supports: (feature) => supportsFeature(CLIENT_FEATURES, feature),
    registerNativeWidget(registration: ProviderNativeWidgetRegistration): () => void {
      if (disposed) {
        throw new Error(`提供方 ${provider} 的注册已经撤下；要再挂原生组件，重新 registerProvider`)
      }
      const { id } = registration
      if (typeof id !== 'string' || id.trim() === '') {
        throw new Error(`提供方 ${provider} 的原生组件需要 id`)
      }
      // 带作者域的 id 让每个作者各占一段名字；同 id 仍然先到者胜，作者域只说明这一份归谁（D30）。
      if (!isAuthorNamespacedWidgetId(id)) {
        throw new Error(`原生组件的 id 要写成 <作者域>.<名字>，${id} 不合这条规则（D30）`)
      }
      if (widgets.length >= NATIVE_WIDGETS_PER_PROVIDER) {
        throw new Error(`提供方 ${provider} 名下的原生组件上限是 ${NATIVE_WIDGETS_PER_PROVIDER} 个，${id} 超出了这一批`)
      }
      const entry = claimWidget(id, provider, requireComponent(id, registration.component))
      const item = { id, entry }
      widgets.push(item)
      let released = false
      return () => {
        if (released) return
        released = true
        const index = widgets.indexOf(item)
        if (index >= 0) widgets.splice(index, 1)
        dropWidget(id, entry)
        notify()
      }
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      for (const item of widgets.splice(0)) dropWidget(item.id, item.entry)
      if (providers.get(provider)?.handle === handle) providers.delete(provider)
      notify()
    },
  }
  return handle
}

/**
 * 建浏览器侧的服务。
 *
 * @returns `widgetBoard` 服务。
 */
export function createClientService(): WidgetBoardClientService {
  return {
    apiVersion: WIDGET_BOARD_API_VERSION,
    supportedApiVersions: WIDGET_BOARD_SUPPORTED_API_VERSIONS,
    features: CLIENT_FEATURES,
    supports: (feature) => supportsFeature(CLIENT_FEATURES, feature),
    registerProvider(registration) {
      requireProviderVersion(registration.apiVersion)
      if (registration.provider.trim() === '') throw new Error('registerProvider 需要提供方的包名')
      requireFeatures(registration.features)
      const slot = providers.get(registration.provider)
      if (slot?.handle !== undefined) {
        throw new Error(`提供方 ${registration.provider} 已经有一个活动的把手；先 dispose 再重新注册`)
      }
      if (slot !== undefined && slot.legacy > 0) {
        throw new Error(`提供方 ${registration.provider} 已经用 registerWidgetType 注册过原生组件；新旧入口不能混用`)
      }
      const handle = createHandle(registration.provider)
      providers.set(registration.provider, { handle, legacy: 0 })
      return handle
    },
    registerWidgetType(registration: NativeWidgetRegistration) {
      requireSupportedVersion(registration.apiVersion)
      if (registration.provider.trim() === '' || registration.id.trim() === '') {
        throw new Error('registerWidgetType 需要 provider 与 id')
      }
      // 旧入口的 id 保持扁平：带点的那一种归新把手，两条路不能各写一次同一个名字（D30）。
      if (isAuthorNamespacedWidgetId(registration.id)) {
        throw new Error(`旧入口的 id 是扁平名字，${registration.id} 带作者域；带点的 id 走 registerProvider`)
      }
      const slot = providers.get(registration.provider)
      if (slot?.handle !== undefined) {
        throw new Error(`提供方 ${registration.provider} 已经用 registerProvider 注册了一个把手；新旧入口不能混用`)
      }
      const entry = claimWidget(registration.id, registration.provider, requireComponent(registration.id, registration.component))
      const owned = slot ?? { legacy: 0 }
      owned.legacy += 1
      providers.set(registration.provider, owned)
      let released = false
      return () => {
        if (released) return
        released = true
        dropWidget(registration.id, entry)
        owned.legacy -= 1
        if (owned.legacy <= 0 && owned.handle === undefined && providers.get(registration.provider) === owned) {
          providers.delete(registration.provider)
        }
        notify()
      }
    },
  }
}
