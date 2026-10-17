/**
 * 对外发布的服务（D12、D17）：其他插件经宿主侧的它注册自己的组件目录、数据源与动作，经浏览器
 * 侧的它提供画在父页面里的原生组件。
 *
 * 服务带一个 API 版本常量；提供方把自己的版本一起传进来，对不上就可见地拒绝，看板照常服务。
 * 跨包时提供方只在自己包里写同形的 `declare module` 声明，不做值导入。
 */
import type { WidgetSize } from './bridge'

/** 宿主侧与浏览器侧服务的名字。 */
export const WIDGET_BOARD_SERVICE_NAME = 'widgetBoard'

/** 服务面的版本；形状一变就升这个数，并写明协商规则。 */
export const WIDGET_BOARD_API_VERSION = 1

/** 读数据或跑动作时能看到的这张卡片。 */
export interface InstanceFace {
  id: string
  widget: string
  props: Record<string, unknown>
}

/** 一个数据源：卡片的数据由它读出来（D6）。 */
export interface DataSourceRegistration {
  /** 服务的版本，与 {@link WIDGET_BOARD_API_VERSION} 相同才被接受。 */
  apiVersion: number
  /** 数据源的名字，实例按它绑定；全局唯一。 */
  id: string
  /** 读一次数据；结果按组件的 data schema 校验。 */
  read(instance: InstanceFace): unknown | Promise<unknown>
}

/** 一个动作：组件的按钮由它执行（D6）。 */
export interface ActionRegistration {
  /** 服务的版本，与 {@link WIDGET_BOARD_API_VERSION} 相同才被接受。 */
  apiVersion: number
  /** 动作的名字；组件在 manifest 里声明同名动作才能发出它。 */
  id: string
  /** 执行一次动作。 */
  run(instance: InstanceFace, payload: unknown): unknown | Promise<unknown>
}

/** 注册一个插件提供的组件目录（D7 的格式，来源记作 `plugin`）。 */
export interface WidgetTypeRegistration {
  /** 服务的版本，与 {@link WIDGET_BOARD_API_VERSION} 相同才被接受。 */
  apiVersion: number
  /** 提供方的包名，写在组件库与卡片上。 */
  provider: string
  /** 组件目录的绝对路径：目录里每个子目录是一个组件。 */
  directory: string
}

/** 宿主侧服务的形状。 */
export interface WidgetBoardHostService {
  readonly apiVersion: number
  /**
   * 注册一个组件目录，读一次并把新组件放进组件库。
   *
   * 目录读不出来时这一次注册抛出，来源不留下。注册成功之后返回释放函数，提供方卸载时随之撤下
   * （D17）。
   *
   * @param registration - 版本、提供方包名与目录。
   * @returns 释放这次注册的函数。
   */
  registerWidgetType(registration: WidgetTypeRegistration): Promise<() => Promise<void>>
  /** 注册一个数据源；返回释放函数。 */
  registerDataSource(registration: DataSourceRegistration): () => void
  /** 注册一个动作；返回释放函数。 */
  registerAction(registration: ActionRegistration): () => void
}

/**
 * 原生组件收到的参数（D3 的原生级）。
 *
 * 与 `window.widget` 同形：一个组件从沙箱级换成原生级，写法不必改。
 */
export interface WidgetNativeProps {
  /** 这个盒子的像素尺寸与位置。 */
  size: WidgetSize
  props: Record<string, unknown>
  data: unknown
  state: unknown
  /** 这张卡不在视口里：动画与计时可以停下。 */
  paused: boolean
  /** 把一份局部状态交给宿主保存（D5）。 */
  setState(patch: unknown): void
  /** 发出 manifest 里声明过的动作（D6）。 */
  action(id: string, payload?: unknown): void
  /** manifest 的 `text` 里的一条文案，按当前语言取。 */
  t(key: string): string
}

/** 注册一个原生组件：画在父页面里的 React 组件，画的是宿主组件库里同 id 的那个组件。 */
export interface NativeWidgetRegistration {
  /** 服务的版本，与 {@link WIDGET_BOARD_API_VERSION} 相同才被接受。 */
  apiVersion: number
  /** 提供方的包名，写在组件库与卡片上。 */
  provider: string
  /** 组件库里那个组件的 id。 */
  id: string
  /** 一个 React 组件，收到 {@link WidgetNativeProps}；形状由提供方自己声明。 */
  component: unknown
}

/** 浏览器侧服务的形状。 */
export interface WidgetBoardClientService {
  readonly apiVersion: number
  /** 注册一个原生组件；返回释放函数，提供方卸载时随之撤下。 */
  registerWidgetType(registration: NativeWidgetRegistration): () => void
}

/**
 * 版本对不上时的拒绝：调用处直接抛出来，提供方在启动时就看得见（D12）。
 *
 * @param expected - 服务当前支持的版本。
 * @param actual - 提供方带来的版本。
 */
export function versionMismatch(expected: number, actual: number): Error {
  return new Error(`widgetBoard 服务版本是 ${expected}，注册时带来的是 ${actual}；请按 ${expected} 的接口改写提供方`)
}
