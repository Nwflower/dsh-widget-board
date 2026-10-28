/**
 * `widgetBoard` 服务的类型面（D12、D17）。
 *
 * 这个文件只有类型：它经根包的 `exports["./service"]` 发布给其他插件，`import type` 在编译时被抹掉，
 * 不产生模块请求。运行时值留在 `service.ts`；提供方读 `service.apiVersion` 协商版本。
 */
import type { WidgetHandles, WidgetSize } from './bridge'
import type { LocalizedText, WidgetCredential } from './widget'

/** 读数据或跑动作时能看到的这张卡片。 */
export interface InstanceFace {
  id: string
  widget: string
  props: Record<string, unknown>
}

/**
 * 一个数据源或一个动作注册时带的归属（D12、D17）。
 *
 * 名字在提供方内部唯一即可：跨提供方重名时后到的注册被拒绝并说明原因，不静默覆盖。组件的 manifest
 * 里可以用 `提供方:名字` 点名其中某一个。
 */
export interface ProviderRegistration {
  /** 服务的版本，与 `WIDGET_BOARD_API_VERSION` 相同才被接受。 */
  apiVersion: number
  /** 提供方的包名；卡片上与组件库里都用它标注归属。 */
  provider: string
}

/** 一个数据源或一个动作自己声明的权限：它要动的主机与要跑的命令（D6）。 */
export interface ActionPermission {
  hosts?: string[]
  commands?: string[]
}

/** 一个数据源：卡片的数据由它读出来（D6）。 */
export interface DataSourceRegistration extends ProviderRegistration {
  /** 数据源的名字；同一时刻全局唯一。 */
  id: string
  /**
   * 这个数据源要的权限（D6）。省略表示它只读宿主自己的东西——读一个插件发布的服务、看板自己的
   * 状态——不必问人。
   *
   * 有值时每次读它之前都要有一份绑在这张卡的组件版本与这份权限上的授权：数据源可能去动外部世界
   * （跑命令、发请求），和动作一样要由人给一次。
   */
  permission?: ActionPermission
  /** 读一次数据；结果按组件的 data schema 校验。 */
  read(instance: InstanceFace): unknown | Promise<unknown>
}

/** 一个动作：组件的按钮由它执行（D6）。 */
export interface ActionRegistration extends ProviderRegistration {
  /** 动作的名字；同一时刻全局唯一。 */
  id: string
  /**
   * 这个动作要的权限（D6）。省略表示它不需要额外权限——只读看板自己的数据之类。
   *
   * 有值时跑它之前要有一份绑在这张卡的组件版本与这份权限上的授权，且授权只由人给出。
   */
  permission?: ActionPermission
  /** 执行一次动作。 */
  run(instance: InstanceFace, payload: unknown): unknown | Promise<unknown>
}

/**
 * 一个宿主能力（D24）：组件经 `widget.call` 按名字调用的通用接口。
 *
 * 数据源、动作与一次性查询可以分开注册；能力是给那些需要参数、返回值、超时与取消的调用准备的。
 * 参数与返回值都可以声明 JSON Schema，宿主在调用前后各校验一次；声明了 `permission` 的能力还要
 * 一份绑在这张卡当前组件版本上的授权。
 */
export interface CapabilityRegistration extends ProviderRegistration {
  /** 能力的名字；同一时刻全局唯一。 */
  id: string
  /** 给人看的名字；省略时界面用 id。 */
  title?: LocalizedText
  /** 一句说明，显示在设置弹窗里。 */
  description?: LocalizedText
  /** 参数的 JSON Schema；省略时不校验。 */
  input?: Record<string, unknown>
  /** 返回值的 JSON Schema；省略时不校验。 */
  output?: Record<string, unknown>
  /** 这个能力要的权限；省略表示不问人。 */
  permission?: ActionPermission
  /** 这个能力要用的凭据；设置弹窗把它们和组件自己声明的合在一起显示。 */
  credentials?: WidgetCredential[]
  /**
   * 这次调用最多等多久，毫秒；省略时是 `CALL_TIMEOUT_MS`，上限 `CALL_TIMEOUT_MAX_MS`。
   *
   * 提供方自己也要在超时之内作答：超时之后宿主中止提供方，并把卡片上的调用判为失败。冷启动要现算
   * 数据的能力（例如在会话日志上折一遍用量）把它调长，而不是让第一次调用失败。
   */
  timeoutMs?: number
  /**
   * 跑一次。`signal` 在调用方取消、超时或连接断开时中止；提供方应当尽快停下。
   *
   * @param instance - 发起调用的这张卡片。
   * @param args - 已经按 `input` 校验过的参数。
   * @param signal - 中止信号。
   * @returns 返回值，按 `output` 校验。
   */
  call(instance: InstanceFace, args: unknown, signal: AbortSignal): unknown | Promise<unknown>
}

/** 注册一个插件提供的组件目录（D7 的格式，来源记作 `plugin`）。 */
export interface WidgetTypeRegistration {
  /** 服务的版本，与 `WIDGET_BOARD_API_VERSION` 相同才被接受。 */
  apiVersion: number
  /** 提供方的包名，写在组件库与卡片上。 */
  provider: string
  /** 组件目录的绝对路径：目录里每个子目录是一个组件。 */
  directory: string
}

/**
 * 一次组件目录注册拿到的把手，也是这个提供方的生命周期把手（D12、D17）。
 *
 * 一次注册可能分几步：先给组件目录，之后才补上数据源与动作。`register` 让后补的那几步也归在这次
 * 注册名下；看板在提供方卸载、或这次注册被撤下时，把它名下的注册一并释放，不留下指向已经不存在的
 * 提供方的数据源。子注册的 `provider` 必须与把手相同。
 */
export interface WidgetTypeHandle {
  /** 这个提供方的名字。 */
  readonly provider: string
  /** 这次注册名下的组件 id，按注册顺序。 */
  readonly widgets: readonly string[]
  /**
   * 把数据源与动作挂到这次注册名下。
   *
   * @param registrations - 数据源与动作，任选；一项都没有时可以省略。
   * @returns 释放这一批注册的函数。
   */
  register(registrations?: { dataSources?: DataSourceRegistration[], actions?: ActionRegistration[], capabilities?: CapabilityRegistration[] }): () => void
  /** 撤下这次注册：组件目录与它名下的全部数据源、动作与能力一并释放。 */
  dispose(): Promise<void>
}

/** 宿主侧服务的形状。 */
export interface WidgetBoardHostService {
  readonly apiVersion: number
  /**
   * 注册一个组件目录，读一次并把新组件放进组件库。
   *
   * 目录读不出来时这一次注册抛出，来源不留下。注册成功之后拿到的把手带着这次注册名下的组件与
   * 子注册，提供方卸载时调用它的 `dispose`（D17）。
   *
   * @param registration - 版本、提供方包名与目录。
   * @returns 这次注册的把手。
   */
  registerWidgetType(registration: WidgetTypeRegistration): Promise<WidgetTypeHandle>
  /** 注册一个数据源；返回释放函数。 */
  registerDataSource(registration: DataSourceRegistration): () => void
  /** 注册一个动作；返回释放函数。 */
  registerAction(registration: ActionRegistration): () => void
  /** 注册一个宿主能力；返回释放函数。 */
  registerCapability(registration: CapabilityRegistration): () => void
  /**
   * 注册一个市场提供方；返回释放函数。
   *
   * 撤下后市场区回到空状态，已安装的组件保留在 `market` 来源里，提供方名标成来源不可用。
   */
  registerMarketProvider(registration: WidgetMarketProviderRegistration): () => void
}

/**
 * 原生组件收到的参数（D3 的原生级）。
 *
 * 与 `window.widget` 同形：一个组件从沙箱级换成原生级，写法不必改。
 */
export interface WidgetNativeProps extends WidgetHandles {
  /** 这个盒子的像素尺寸与位置。 */
  size: WidgetSize
  props: Record<string, unknown>
  data: unknown
  state: unknown
  /** 这张卡不在视口里：动画与计时可以停下。 */
  paused: boolean
}

/** 注册一个原生组件：画在父页面里的 React 组件，画的是宿主组件库里同 id 的那个组件。 */
export interface NativeWidgetRegistration {
  /** 服务的版本，与 `WIDGET_BOARD_API_VERSION` 相同才被接受。 */
  apiVersion: number
  /** 提供方的包名，写在组件库与卡片上。 */
  provider: string
  /** 组件库里那个组件的 id。 */
  id: string
  /** 一个 React 组件，收到 `WidgetNativeProps`；形状由提供方自己声明。 */
  component: unknown
}

/** 浏览器侧服务的形状。 */
export interface WidgetBoardClientService {
  readonly apiVersion: number
  /** 注册一个原生组件；返回释放函数，提供方卸载时随之撤下。 */
  registerWidgetType(registration: NativeWidgetRegistration): () => void
}

/**
 * 市场索引里的一个组件条目：提供方把它读成可序列化的形状交给看板，看板画市场区。
 *
 * 条目按 `MARKET_LISTING_SCHEMA` 校验；字段不合格的条目在市场区列成不可用并写明原因，其余照常
 * 显示。安装时以包内 `widget.json` 的实际声明为准，`declares` 只是安装前给人看的摘要。
 */
export interface MarketListing {
  /** 组件 id；市场条目必须带作者域，形如 `<作者域>.<名字>`。 */
  id: string
  title: LocalizedText
  description?: LocalizedText
  author: { name: string, url?: string }
  license?: string
  versions: MarketVersionSummary[]
}

/** 一个版本的分发说明：包地址、哈希、尺寸族与依赖声明。 */
export interface MarketVersionSummary {
  version: string
  sizes: string[]
  requires?: { serviceApiVersion?: number, dsh?: string }
  declares?: { capabilities?: string[], credentials?: string[], hosts?: string[] }
  /** `.dshw` 包的地址、内容哈希与大小；安装时核对哈希与大小之后才解包。 */
  package: { url: string, sha256: string, bytes: number }
  changelog?: string
}

/**
 * 一个市场提供方（D8 之后的市场契约）：把「有哪些远端组件、怎么取包」交给看板。
 *
 * 提供方不接触文件系统与看板存储：安装、来源记录、冲突处理都由看板完成。`registerMarketProvider`
 * 返回释放函数；撤下后市场区回到空状态，已安装的组件保留。
 */
export interface WidgetMarketProviderRegistration extends ProviderRegistration {
  /** 这个市场的名字；同一时刻一个提供方只注册一次。 */
  id: string
  title: LocalizedText
  description?: LocalizedText
  /** 列出远端条目；看板设超时与条数上限，失败只影响市场区。 */
  list(): Promise<MarketListing[]>
  /**
   * 取一个版本的 `.dshw` 包字节。
   *
   * @param listing - 条目（`list` 返回的那个对象）。
   * @param version - 要取的版本。
   * @returns 包的字节；宿主核对 `sha256` 与大小。
   */
  fetch(listing: MarketListing, version: string): Promise<Uint8Array>
}

/** 来源记录：一个市场组件是从哪个提供方、哪个条目、哪个版本装来的。 */
export interface MarketInstallRecord {
  provider: string
  listingId: string
  version: string
  sha256: string
  installedAt: string
}
