/**
 * 原生组件的登记处（D3 的原生级、D17）。
 *
 * 插件注册的组件画在父页面里，不再套 iframe：它本来就是已安装的代码。登记按组件 id 索引，
 * 与宿主组件库里的同名组件对上之后，卡片改用这个组件渲染，而不是取组件文档。
 */
import { useSyncExternalStore } from 'react'
import type { ComponentType } from 'react'
import type { NativeWidgetRegistration, WidgetBoardClientService, WidgetNativeProps } from '@dsh-widget-board/contracts'
import { WIDGET_BOARD_API_VERSION, versionMismatch } from '@dsh-widget-board/contracts'

/** 一个原生组件。 */
export interface NativeWidget {
  provider: string
  component: ComponentType<WidgetNativeProps>
}

const registry = new Map<string, NativeWidget>()
const listeners = new Set<() => void>()

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
 * 建浏览器侧的服务。
 *
 * @returns `widgetBoard` 服务。
 */
export function createClientService(): WidgetBoardClientService {
  return {
    apiVersion: WIDGET_BOARD_API_VERSION,
    registerWidgetType(registration: NativeWidgetRegistration) {
      if (registration.apiVersion !== WIDGET_BOARD_API_VERSION) {
        throw versionMismatch(WIDGET_BOARD_API_VERSION, registration.apiVersion)
      }
      if (registration.provider.trim() === '' || registration.id.trim() === '') {
        throw new Error('registerWidgetType 需要 provider 与 id')
      }
      const component = registration.component
      if (typeof component !== 'function' && (typeof component !== 'object' || component === null)) {
        throw new Error(`${registration.id} 的 component 要是 React 组件`)
      }
      // 与宿主组件库同一条规则：同 id 先到者为准，后到的注册抛出并说明已有提供方。
      const existing = registry.get(registration.id)
      if (existing !== undefined) {
        throw new Error(`组件 ${registration.id} 已经由 ${existing.provider} 注册；先到的那一个继续用`)
      }
      const entry: NativeWidget = { provider: registration.provider, component: component as ComponentType<WidgetNativeProps> }
      registry.set(registration.id, entry)
      notify()
      return () => {
        if (registry.get(registration.id) !== entry) return
        registry.delete(registration.id)
        notify()
      }
    },
  }
}
