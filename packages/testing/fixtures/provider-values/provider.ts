/**
 * 提供方 SDK 的取值判据（D31）：`dsh-widget-board/provider` 在编译期取得值，打出来的产物里只剩下
 * 形状构造。
 *
 * 这个文件不进临时宿主：`scripts/check-provider-types.mjs` 先类型检查它，再把它打成一份 ESM，
 * 扫一遍产物里有没有宿主实现或全局状态，最后 import 回来跑几条校验。
 */
import {
  actionRegistration,
  capabilityRegistration,
  defineProvider,
  marketRegistration,
  nativeProviderRegistration,
  nativeRegistration,
  providerRegistration,
  sourceRegistration,
} from 'dsh-widget-board/provider'
import type { InstanceFace, WidgetBoardClientService, WidgetBoardHostService } from 'dsh-widget-board/service'

export * from 'dsh-widget-board/provider'

/** 提供方身份：功能名重复报一次，产物里应当只剩一份。 */
export const identity = defineProvider({
  provider: 'dsh-widget-board-provider-values',
  features: ['capabilityMetadata', 'marketProvider', 'marketProvider'],
})

/** 一份数据源：只报名字与读取函数。 */
export const source = sourceRegistration({ id: 'clock', read: () => new Date().toISOString() })

/** 一份带权限的动作。 */
export const action = actionRegistration({
  id: 'reset',
  permission: { commands: ['date'] },
  run: (instance: InstanceFace) => instance.id,
})

/** 一份带参数与结果声明的能力。 */
export const capability = capabilityRegistration({
  id: 'echo',
  input: { type: 'object' },
  output: { type: 'object' },
  call: (instance: InstanceFace, args: unknown) => ({ instance: instance.id, args }),
})

/** 一份市场提供方。 */
export const market = marketRegistration({
  id: 'local',
  title: { zh: '本地', en: 'Local' },
  list: async () => [],
  fetch: async () => new Uint8Array(),
})

/** 一份原生组件。 */
export const nativeWidget = nativeRegistration({ id: 'dsh-widget-board-provider-values.test-native', component: () => null })

/** 宿主侧一次注册的入参：身份与用途，资源随后经把手挂上。 */
export const registration = providerRegistration(identity)

/** 浏览器侧一次注册的入参：身份与用途，原生组件随后经把手挂上。 */
export const nativeRegistrationValue = nativeProviderRegistration(identity)

/**
 * 宿主侧提供方：一次注册拿到把手，之后补的每一项都省略版本与提供方名。
 *
 * @param service - 宿主侧的 widgetBoard 服务。
 */
export async function apply(service: WidgetBoardHostService): Promise<void> {
  if (service.registerProvider === undefined) throw new Error('宿主侧的 widgetBoard 服务没有 registerProvider')
  const handle = await service.registerProvider(registration)
  const second = await handle.registerWidgets({ directory: '/tmp/dsh-widget-board-provider-values/second' })
  handle.registerDataSource(sourceRegistration({ id: 'count', read: () => 0 }))
  handle.registerAction(actionRegistration({ id: 'touch', run: (instance: InstanceFace) => instance.id }))
  handle.registerCapability(capabilityRegistration({ id: 'ping', call: () => 'pong' }))
  if (handle.supports('marketProvider')) handle.registerMarketProvider(market)
  if (second.widgets.length === 0) await second.dispose()
}

/**
 * 浏览器侧提供方：一次注册拿到把手，再补一个原生组件。
 *
 * @param service - 浏览器侧的 widgetBoard 服务。
 */
export function applyClient(service: WidgetBoardClientService): void {
  if (service.registerProvider === undefined) throw new Error('浏览器侧的 widgetBoard 服务没有 registerProvider')
  const handle = service.registerProvider(nativeRegistrationValue)
  handle.registerNativeWidget(nativeRegistration({ id: 'dsh-widget-board-provider-values.test-native-second', component: () => null }))
  if (!handle.supports('eventData')) handle.dispose()
}
