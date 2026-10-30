/**
 * 对外发布的服务（D31、D17）：其他插件经宿主侧的它注册自己的组件目录、数据源与动作，经浏览器
 * 侧的它提供画在父页面里的原生组件。
 *
 * 服务带一个 API 版本常量；提供方把自己的版本一起传进来，对不上就可见地拒绝，看板照常服务。
 * 类型面在 `service-types.ts`，经根包的 `./service` 只含类型的入口发布；运行时只走服务。
 */
import type { WidgetBoardFeature } from './service-types'

export const WIDGET_BOARD_SERVICE_NAME = 'widgetBoard'

/**
 * 服务面的版本；新增方法或可选字段不升这个数，移除旧方法或改变既有语义时升，并写明协商规则与弃用期。
 *
 * 一个方法标上弃用之后至少留到下一个主版本才移除，这期间旧入口照原样接受它；移除时调用处
 * 的错误写出替代它的方法与新位置。
 *
 * 1 → 2：`registerWidgetType` 返回的不再是一个释放函数，而是一个把手（带 `provider`、`widgets`、
 * `register` 与 `dispose`）；数据源与动作的注册带上 `provider`，动作可以声明 `permission`。
 *
 * 2 → 3：新增宿主能力（`CapabilityRegistration`）：组件经 `widget.call` 按名字调用，带参数/结果
 * schema、权限、凭据与中止信号；把手与服务都多了 `registerCapability`（D24）。新入口
 * `registerProvider` 只报身份与用途，组件目录、数据源、动作、能力与市场经把手逐个挂上；两侧服务
 * 与把手都报出 `supportedApiVersions`、`features` 与 `supports`。
 */
export const WIDGET_BOARD_API_VERSION = 3

/**
 * `registerProvider` 接受的版本；新入口只认这一个数，旧入口认 `WIDGET_BOARD_SUPPORTED_API_VERSIONS`。
 *
 * 版本集合升到 4 时，这里与集合一起改，并在差异里写明 3 → 4 只能从新入口进来。
 */
export const WIDGET_BOARD_PROVIDER_API_VERSION = 3

/** 两侧服务与它们发出的把手接受的注册版本，升序；旧入口含 2。 */
export const WIDGET_BOARD_SUPPORTED_API_VERSIONS: readonly number[] = Object.freeze([2, WIDGET_BOARD_API_VERSION])

/** 功能名与清单一一对应：少写一项会在类型检查时就发现。 */
const FEATURE_LIST: Readonly<Record<WidgetBoardFeature, true>> = {
  capabilityMetadata: true,
  eventData: true,
  marketProvider: true,
  pushData: true,
}

/**
 * v3 的功能清单：四项各是一种可选行为。服务与把手用它回答 `supports`，`./provider` 用它校验
 * 提供方声明的功能名。
 */
export const WIDGET_BOARD_FEATURES: readonly WidgetBoardFeature[] = Object.freeze(Object.keys(FEATURE_LIST) as WidgetBoardFeature[])

/**
 * 未知功能名的说法：拼错的那一项会被静默当成「不支持」，所以两处判定都直接抛出（D11）。
 *
 * @param feature - 报上来的名字。
 * @returns 要说给作者的原因。
 */
function unknownFeature(feature: string): Error {
  return new Error(`未知的功能 ${feature}；v3 的功能是 ${WIDGET_BOARD_FEATURES.join('、')}`)
}

/**
 * 校验一份功能声明（D31）：只认 `WIDGET_BOARD_FEATURES` 里的名字，重复的去掉，次序按声明。
 *
 * 声明只是用途，不决定这一侧提供什么：缺的一两项按项降级，写错一个名字则整次注册可见地失败。
 *
 * @param declared - 提供方声明的功能；省略时为空。
 * @returns 冻结的功能清单。
 * @throws {Error} 清单里有 v3 没有的功能名。
 */
export function requireFeatures(declared: readonly WidgetBoardFeature[] | undefined): readonly WidgetBoardFeature[] {
  if (declared === undefined) return Object.freeze([])
  const unique = new Set<WidgetBoardFeature>()
  for (const feature of declared) {
    if (!WIDGET_BOARD_FEATURES.includes(feature)) throw unknownFeature(String(feature))
    unique.add(feature)
  }
  return Object.freeze([...unique])
}

/**
 * 这一侧有没有某项功能（D31）。
 *
 * 名字先按全局清单校验：拼错的那一项会静默变成「不支持」，所以这里抛出，不返回 `false`。这一侧
 * 真有哪几项由调用方传进来，两侧服务与把手共用这一条判定。
 *
 * @param supported - 这一侧真有的功能。
 * @param feature - 要问的功能名。
 * @returns 这一侧提供它时为真。
 * @throws {Error} 名字不是 v3 的功能。
 */
export function supportsFeature(supported: readonly WidgetBoardFeature[], feature: WidgetBoardFeature): boolean {
  if (!WIDGET_BOARD_FEATURES.includes(feature)) throw unknownFeature(String(feature))
  return supported.includes(feature)
}

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
  ProviderActionRegistration,
  ProviderCapabilityRegistration,
  ProviderDataSourceRegistration,
  ProviderMarketRegistration,
  ProviderNativeWidgetRegistration,
  ProviderRegistration,
  WidgetBoardClientService,
  WidgetBoardFeature,
  WidgetBoardHostService,
  WidgetBoardSurface,
  WidgetMarketProviderRegistration,
  WidgetNativeProps,
  WidgetNativeProviderHandle,
  WidgetNativeProviderRegistration,
  WidgetProviderHandle,
  WidgetProviderRegistration,
  WidgetTypeHandle,
  WidgetTypeRegistration,
} from './service-types'

/**
 * 版本对不上时的拒绝：调用处直接抛出来，提供方在启动时就看得见（D31）。
 *
 * @param expected - 服务当前支持的版本。
 * @param actual - 提供方带来的版本。
 */
export function versionMismatch(expected: number, actual: number): Error {
  return new Error(`widgetBoard 服务版本是 ${expected}，注册时带来的是 ${actual}；请按 ${expected} 的接口改写提供方`)
}
