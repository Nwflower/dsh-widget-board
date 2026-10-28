/**
 * 提供方的纯值 SDK（D31）：根包的 `./provider`。
 *
 * 这里只做形状构造与校验：版本、提供方名、功能名，以及每一项注册必需的字段。不导入宿主实现、不读
 * 全局状态，所以宿主进程与浏览器半边都能打包同一份入口（D2）。拿到的对象交给 `widgetBoard` 服务，
 * 服务面本身仍然只有类型。
 *
 * 返回的对象都是冻结的：要加字段就展开成新对象，别原地改。
 */
import type {
  ProviderActionRegistration,
  ProviderCapabilityRegistration,
  ProviderDataSourceRegistration,
  ProviderMarketRegistration,
  ProviderNativeWidgetRegistration,
  WidgetBoardFeature,
  WidgetNativeProviderRegistration,
  WidgetProviderRegistration,
} from './service-types'
import { WIDGET_BOARD_PROVIDER_API_VERSION, requireFeatures } from './service'

/** 提供方两侧共用的身份：包名、注册版本与用途声明。 */
export interface ProviderIdentity {
  /** 提供方的包名。 */
  readonly provider: string
  /** 注册版本；只接受 `WIDGET_BOARD_PROVIDER_API_VERSION`。 */
  readonly apiVersion: number
  /** 这个提供方要用到的功能；不声明时为空。 */
  readonly features: readonly WidgetBoardFeature[]
}

/** 写提供方身份时的入参；版本省略时按 `WIDGET_BOARD_PROVIDER_API_VERSION` 算。 */
export interface ProviderDeclaration {
  /** 提供方的包名。 */
  provider: string
  /** 注册版本；只接受 `WIDGET_BOARD_PROVIDER_API_VERSION`。 */
  apiVersion?: number
  /** 这个提供方要用到的功能；只是用途声明。 */
  features?: readonly WidgetBoardFeature[]
}

/**
 * 报出提供方的名字；空的包名会让卡片上的归属与授权的清理都指错人。
 *
 * @param value - 名字。
 * @param label - 出错时说的那一样东西。
 * @throws {Error} 名字是空的。
 */
function requireName(value: string, label: string): void {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} 不能为空`)
}

/**
 * 报出必需的函数。
 *
 * @param value - 要检查的值。
 * @param label - 出错时说的那一样东西。
 * @throws {Error} 值不是函数。
 */
function requireFunction(value: unknown, label: string): void {
  if (typeof value !== 'function') throw new Error(`${label} 必须是一个函数`)
}

/**
 * 校验版本：新入口只认 `WIDGET_BOARD_PROVIDER_API_VERSION`。
 *
 * @param apiVersion - 注册带来的版本；省略时按当前版本算。
 * @returns 校验过的版本。
 * @throws {Error} 版本不是新入口接受的那一个。
 */
function requireVersion(apiVersion: number | undefined): number {
  const version = apiVersion ?? WIDGET_BOARD_PROVIDER_API_VERSION
  if (version !== WIDGET_BOARD_PROVIDER_API_VERSION) {
    throw new Error(`registerProvider 只接受版本 ${WIDGET_BOARD_PROVIDER_API_VERSION}；带来的是 ${String(version)}`)
  }
  return version
}

/**
 * 校验并冻结一份身份：包名、版本与用途。
 *
 * 三个入口都从这里过，所以手工拼出来的身份与 `defineProvider` 造出来的一样过这一关。
 *
 * @param declaration - 包名、可省略的版本与功能。
 * @returns 冻结的身份。
 * @throws {Error} 包名为空、版本不是 `WIDGET_BOARD_PROVIDER_API_VERSION`，或功能名不认识。
 */
function requireIdentity(declaration: { provider: string, apiVersion?: number, features?: readonly WidgetBoardFeature[] }): ProviderIdentity {
  requireName(declaration.provider, '提供方的包名')
  return Object.freeze({
    provider: declaration.provider,
    apiVersion: requireVersion(declaration.apiVersion),
    features: requireFeatures(declaration.features),
  })
}

/**
 * 写出一份提供方身份：包名、版本与用途。两个 `*Registration` 都收它。
 *
 * @param declaration - 包名、可省略的版本与功能。
 * @returns 冻结的身份。
 * @throws {Error} 包名为空、版本不是 `WIDGET_BOARD_PROVIDER_API_VERSION`，或功能名不认识。
 */
export function defineProvider(declaration: ProviderDeclaration): ProviderIdentity {
  return requireIdentity(declaration)
}

/**
 * 组一次宿主侧 `registerProvider` 的入参：只有身份与用途，资源随后经把手挂上。
 *
 * @param identity - `defineProvider` 返回的身份，或手工构造的同形对象；功能名在这里重新校验。
 * @returns 冻结的注册。
 * @throws {Error} 身份里的包名、版本或功能名不合格。
 */
export function providerRegistration(identity: ProviderIdentity): WidgetProviderRegistration {
  return requireIdentity(identity)
}

/**
 * 组一次浏览器侧 `registerProvider` 的入参：只有身份与用途，原生组件随后经把手挂上。
 *
 * @param identity - `defineProvider` 返回的身份，或手工构造的同形对象；功能名在这里重新校验。
 * @returns 冻结的注册。
 * @throws {Error} 身份里的包名、版本或功能名不合格。
 */
export function nativeProviderRegistration(identity: ProviderIdentity): WidgetNativeProviderRegistration {
  return requireIdentity(identity)
}

/**
 * 组一份挂在把手下方的数据源。
 *
 * @param registration - 名字、权限与读取函数；版本与提供方名由把手注入。
 * @returns 冻结的注册。
 * @throws {Error} 名字为空，或没有 `read`。
 */
export function sourceRegistration(registration: ProviderDataSourceRegistration): ProviderDataSourceRegistration {
  requireName(registration.id, '数据源的名字')
  requireFunction(registration.read, `数据源 ${registration.id} 的 read`)
  return Object.freeze({ ...registration })
}

/**
 * 组一份挂在把手下方的动作。
 *
 * @param registration - 名字、权限与执行函数；版本与提供方名由把手注入。
 * @returns 冻结的注册。
 * @throws {Error} 名字为空，或没有 `run`。
 */
export function actionRegistration(registration: ProviderActionRegistration): ProviderActionRegistration {
  requireName(registration.id, '动作的名字')
  requireFunction(registration.run, `动作 ${registration.id} 的 run`)
  return Object.freeze({ ...registration })
}

/**
 * 组一份挂在把手下方的能力。
 *
 * @param registration - 名字、参数与结果的 schema、权限、凭据与调用函数；版本与提供方名由把手注入。
 * @returns 冻结的注册。
 * @throws {Error} 名字为空，或没有 `call`。
 */
export function capabilityRegistration(registration: ProviderCapabilityRegistration): ProviderCapabilityRegistration {
  requireName(registration.id, '能力的名字')
  requireFunction(registration.call, `能力 ${registration.id} 的 call`)
  return Object.freeze({ ...registration })
}

/**
 * 组一份挂在把手下方的市场提供方。
 *
 * @param registration - 名字、标题、列举与取包函数；版本与提供方名由把手注入。
 * @returns 冻结的注册。
 * @throws {Error} 名字为空，或没有 `list`、`fetch`。
 */
export function marketRegistration(registration: ProviderMarketRegistration): ProviderMarketRegistration {
  requireName(registration.id, '市场的名字')
  requireFunction(registration.list, `市场 ${registration.id} 的 list`)
  requireFunction(registration.fetch, `市场 ${registration.id} 的 fetch`)
  return Object.freeze({ ...registration })
}

/**
 * 组一份挂在浏览器侧把手下方的原生组件。
 *
 * @param registration - 组件 id 与 React 组件；版本与提供方名由把手注入。
 * @returns 冻结的注册。
 * @throws {Error} 组件 id 为空。
 */
export function nativeRegistration(registration: ProviderNativeWidgetRegistration): ProviderNativeWidgetRegistration {
  requireName(registration.id, '原生组件的 id')
  return Object.freeze({ ...registration })
}
