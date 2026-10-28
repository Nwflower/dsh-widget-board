/**
 * 对外发布的服务（D12、D17）：其他插件经宿主侧的它注册自己的组件目录、数据源与动作，经浏览器
 * 侧的它提供画在父页面里的原生组件。
 *
 * 服务带一个 API 版本常量；提供方把自己的版本一起传进来，对不上就可见地拒绝，看板照常服务。
 * 类型面在 `service-types.ts`，经根包的 `./service` 只含类型的入口发布；运行时只走服务。
 */
export const WIDGET_BOARD_SERVICE_NAME = 'widgetBoard'

/**
 * 服务面的版本；形状一变就升这个数，并写明协商规则。
 *
 * 1 → 2：`registerWidgetType` 返回的不再是一个释放函数，而是一个把手（带 `provider`、`widgets`、
 * `register` 与 `dispose`）；数据源与动作的注册带上 `provider`，动作可以声明 `permission`。
 *
 * 2 → 3：新增宿主能力（`CapabilityRegistration`）：组件经 `widget.call` 按名字调用，带参数/结果
 * schema、权限、凭据与中止信号；把手与服务都多了 `registerCapability`（D24）。
 */
export const WIDGET_BOARD_API_VERSION = 3

export type {
  ActionPermission,
  ActionRegistration,
  CapabilityRegistration,
  DataSourceRegistration,
  InstanceFace,
  MarketInstallRecord,
  MarketListing,
  MarketVersionSummary,
  NativeWidgetRegistration,
  ProviderRegistration,
  WidgetBoardClientService,
  WidgetBoardHostService,
  WidgetMarketProviderRegistration,
  WidgetNativeProps,
  WidgetTypeHandle,
  WidgetTypeRegistration,
} from './service-types'

/**
 * 版本对不上时的拒绝：调用处直接抛出来，提供方在启动时就看得见（D12）。
 *
 * @param expected - 服务当前支持的版本。
 * @param actual - 提供方带来的版本。
 */
export function versionMismatch(expected: number, actual: number): Error {
  return new Error(`widgetBoard 服务版本是 ${expected}，注册时带来的是 ${actual}；请按 ${expected} 的接口改写提供方`)
}
