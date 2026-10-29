/**
 * `widgetBoard` 服务的类型面（D31、D17）。
 *
 * 这个文件只有类型：它经根包的 `exports["./service"]` 发布给其他插件，`import type` 在编译时被抹掉，
 * 不产生模块请求。运行时值留在 `service.ts`；提供方读 `service.apiVersion` 协商版本。
 */
import type { CapabilityMetadata, WidgetHandles, WidgetSize } from './bridge'
import type { LocalizedText, WidgetCredential, WidgetRequires } from './widget'

/** 读数据或跑动作时能看到的这张卡片。 */
export interface InstanceFace {
  id: string
  widget: string
  props: Record<string, unknown>
}

/**
 * 一个数据源或一个动作注册时带的归属（D31、D17）。
 *
 * 名字在提供方内部唯一即可：跨提供方重名时后到的注册被拒绝并说明原因，不静默覆盖。组件的 manifest
 * 里可以用 `提供方:名字` 点名其中某一个。
 */
export interface ProviderRegistration {
  /** 服务的版本；旧入口接受 `WIDGET_BOARD_SUPPORTED_API_VERSIONS` 里的任一版本（2、3）。 */
  apiVersion: number
  /** 提供方的包名；卡片上与组件库里都用它标注归属。 */
  provider: string
}

/**
 * 服务面在 v3 上多出来的可选行为（D31）。
 *
 * 功能与版本分开数：同一个版本里某一侧可能没有某一项（浏览器半边没有市场），提供方缺一项时按项
 * 降级，不因为缺一项就把整次注册拒掉。
 */
export type WidgetBoardFeature = 'capabilityMetadata' | 'eventData' | 'marketProvider' | 'pushData'

/**
 * 版本集合与功能集合（D31）：两侧服务与它们发出的把手都带这一份，四项成员都是必需的。
 *
 * `supportedApiVersions` 说明旧入口接受哪些版本，`features` 与 `supports` 说明这一侧现在提供什么；
 * `supports` 由这一侧自己回答，不替另一侧回答：宿主进程有没有市场和浏览器页面有没有市场是两件事。
 */
export interface WidgetBoardSurface {
  /** 这一侧接受的注册版本，含新旧两个入口，升序。 */
  readonly supportedApiVersions: readonly number[]
  /** 这一侧声明的功能，按 `WIDGET_BOARD_FEATURES` 的次序。 */
  readonly features: readonly WidgetBoardFeature[]
  /**
   * 逐项查询这一侧的功能。
   *
   * @param feature - 要问的功能名。
   * @returns 这一侧提供它时为真。
   */
  supports(feature: WidgetBoardFeature): boolean
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
  /**
   * 读一次数据；结果按组件的 data schema 校验。
   *
   * `signal` 在超时、调用方取消或连接断开时中止；提供方应当尽快停下。只声明一个参数的实现照常
   * 工作——超时之后宿主照样放开调用方，只是那个实现会跑到自己结束为止。
   *
   * @param instance - 读这张卡片。
   * @param signal - 中止信号，实现可以忽略。
   * @returns 卡片的数据，按 `data` 校验。
   */
  read(instance: InstanceFace, signal?: AbortSignal): unknown | Promise<unknown>
  /**
   * 在有人看着、且这张卡的盒子可见时，把新数据推给宿主（D32）。
   *
   * 省略时这张卡只能按需读。宿主按组件的 data schema 校验推上来的数据之后再写进卡片，写入走与读
   * 回来同一条路径；同一张卡上订阅与定时刷新不会同时跑。返回的退订函数必须同步做完清理——停掉
   * 自己的计时器与在途请求，不再回调——宿主在卡片离开视口、或提供方撤下时直接调用它。
   *
   * @param instance - 订阅这张卡片。
   * @param emit - 推一次数据；时机由实现决定。
   * @returns 退订函数，同步清理。
   */
  subscribe?(instance: InstanceFace, emit: (data: unknown) => void): () => void
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
  /**
   * 执行一次动作。
   *
   * `signal` 在超时、调用方取消或连接断开时中止；只声明两个参数的实现照常工作。
   *
   * @param instance - 发起动作的这张卡片。
   * @param payload - 组件送来的值，原样转给实现。
   * @param signal - 中止信号，实现可以忽略。
   * @returns 动作的结果。
   */
  run(instance: InstanceFace, payload: unknown, signal?: AbortSignal): unknown | Promise<unknown>
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
   * 这次调用最多等多久，毫秒；省略时 15 秒，声明范围 1–25 秒。
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

/**
 * 挂在宿主侧把手下的一份数据源（v3）：版本与提供方名由把手注入（D31）。
 *
 * 与 `DataSourceRegistration` 同形，少掉的正是把手已经知道的那两项。
 */
export type ProviderDataSourceRegistration = Omit<DataSourceRegistration, 'apiVersion' | 'provider'>

/** 挂在宿主侧把手下的一份动作（v3）：版本与提供方名由把手注入。 */
export type ProviderActionRegistration = Omit<ActionRegistration, 'apiVersion' | 'provider'>

/** 挂在宿主侧把手下的一份能力（v3）：版本与提供方名由把手注入。 */
export type ProviderCapabilityRegistration = Omit<CapabilityRegistration, 'apiVersion' | 'provider'>

/** 挂在宿主侧把手下的一份市场提供方（v3）：版本与提供方名由把手注入。 */
export type ProviderMarketRegistration = Omit<WidgetMarketProviderRegistration, 'apiVersion' | 'provider'>

/** 注册一个插件提供的组件目录（D7 的格式，来源记作 `plugin`）。 */
export interface WidgetTypeRegistration {
  /** 服务的版本；旧入口接受 `WIDGET_BOARD_SUPPORTED_API_VERSIONS` 里的任一版本（2、3）。 */
  apiVersion: number
  /** 提供方的包名，写在组件库与卡片上。 */
  provider: string
  /** 组件目录的绝对路径：目录里每个子目录是一个组件。 */
  directory: string
}

/**
 * 一次组件目录注册拿到的把手，也是这个提供方的生命周期把手（D31、D17）。
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
   * 把数据源、动作与能力挂到这次注册名下。
   *
   * @param registrations - 数据源、动作与能力，任选；一项都没有时可以省略。
   * @returns 释放这一批注册的函数。
   */
  register(registrations?: { dataSources?: DataSourceRegistration[], actions?: ActionRegistration[], capabilities?: CapabilityRegistration[] }): () => void
  /** 撤下这次注册：组件目录与它名下的全部数据源、动作与能力一并释放。 */
  dispose(): Promise<void>
}

/**
 * 一次 `registerProvider` 的入参（v3，D31）。
 *
 * 与两个旧入口的注册相比，它只报身份与用途：组件目录、数据源、动作、能力与市场都经把手逐个挂上，
 * 每一项只说自己的名字与行为。这个入口只接受 `WIDGET_BOARD_PROVIDER_API_VERSION`。
 */
export interface WidgetProviderRegistration {
  /** 服务的版本；只接受 `WIDGET_BOARD_PROVIDER_API_VERSION`。 */
  apiVersion: number
  /** 提供方的包名；卡片上与组件库里都用它标注归属。 */
  provider: string
  /** 这个提供方要用到的功能；只是用途声明，这一侧没有的那一项按项降级。 */
  features?: readonly WidgetBoardFeature[]
}

/**
 * 一次 `registerProvider` 拿到的宿主侧把手（v3，D31、D17）。
 *
 * 一个提供方的目录、数据源、动作、能力与市场都挂在这一个把手上：撤下它就是把这五样一起撤下。
 * 新加的每一项只报自己的名字与行为，版本与提供方名由把手注入。
 */
export interface WidgetProviderHandle extends WidgetBoardSurface {
  /** 这个提供方的名字，与注册时报的相同。 */
  readonly provider: string
  /** 已经挂上的组件目录，按注册顺序。 */
  readonly directories: readonly string[]
  /** 这次注册名下的组件 id，按注册顺序。 */
  readonly widgets: readonly string[]
  /**
   * 再挂一个组件目录，读一次。
   *
   * @param registration - 组件目录的绝对路径，格式与 `WidgetTypeRegistration.directory` 相同。
   * @returns 这一次目录注册的把手。
   * @throws {Error} 目录读不出来，或同一个目录已经挂在这个把手下；失败的那一次不留痕迹。
   */
  registerWidgets(registration: { directory: string }): Promise<WidgetTypeHandle>
  /** 挂一份数据源；返回撤下这一份的函数。 */
  registerDataSource(registration: ProviderDataSourceRegistration): () => void
  /** 挂一份动作；返回撤下这一份的函数。 */
  registerAction(registration: ProviderActionRegistration): () => void
  /** 挂一份能力；返回撤下这一份的函数。 */
  registerCapability(registration: ProviderCapabilityRegistration): () => void
  /** 挂一份市场提供方；返回撤下这一份的函数。 */
  registerMarketProvider(registration: ProviderMarketRegistration): () => void
  /** 撤下这次注册：目录、名下的注册、这个提供方留下的授权与目录监视一并释放。 */
  dispose(): Promise<void>
}

/**
 * 宿主侧服务的形状。
 *
 * 同一份服务对象还要扮演 v2——旧入口接受 2 与 3——服务面因此报出 v3 的全部成员：`supportedApiVersions`
 * 让提供方看出旧入口接受哪些版本，`registerProvider` 是唯一的 v3 入口。这里不做「有没有」的探测：
 * 缺一项是这一侧的装配错误，不是提供方要降级的情形。
 */
export interface WidgetBoardHostService extends WidgetBoardSurface {
  readonly apiVersion: number
  /**
   * 注册一个提供方（v3）：报出身份与用途，拿到一个把手，目录、数据源、动作、能力与市场都经把手挂上。
   *
   * @param registration - 提供方与它用到的功能。
   * @returns 这个提供方的把手。
   */
  registerProvider(registration: WidgetProviderRegistration): Promise<WidgetProviderHandle>
  /**
   * 注册一个组件目录，读一次并把新组件放进组件库。
   *
   * 目录读不出来时这一次注册抛出，来源不留下。注册成功之后拿到的把手带着这次注册名下的组件与
   * 子注册，提供方卸载时调用它的 `dispose`（D17）。这个入口与下面四个一样接受
   * `supportedApiVersions` 里的任一版本；新写的提供方用 `registerProvider`，一个把手管完目录与它
   * 名下的数据源、动作、能力与市场。
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
  /** 宿主的界面语言，如 `zh-CN`；沙箱组件从握手里拿到同一个值。 */
  lang?: string
  /**
   * manifest 声明过、宿主当前解析得到的能力名（D24），与沙箱组件的 `widget.capabilities` 同一份
   * （D32）。
   *
   * 省略表示这一侧没有投影能力面，组件按空能力面处理。
   */
  capabilities?: readonly string[]
  /** 上面这些能力的元数据（D32），与沙箱组件在 init 里拿到的 `capabilityMetadata` 同一份。 */
  capabilityMetadata?: readonly CapabilityMetadata[]
}

/** 注册一个原生组件：画在父页面里的 React 组件，画的是宿主组件库里同 id 的那个组件。 */
export interface NativeWidgetRegistration {
  /** 服务的版本；旧入口接受 `WIDGET_BOARD_SUPPORTED_API_VERSIONS` 里的任一版本（2、3）。 */
  apiVersion: number
  /** 提供方的包名，写在组件库与卡片上。 */
  provider: string
  /** 组件库里那个组件的 id。 */
  id: string
  /** 一个 React 组件，收到 `WidgetNativeProps`；形状由提供方自己声明。 */
  component: unknown
}

/**
 * 挂在浏览器侧把手下的一份原生组件（v3）：版本与提供方名由把手注入（D31）。
 */
export type ProviderNativeWidgetRegistration = Omit<NativeWidgetRegistration, 'apiVersion' | 'provider'>

/** 一次 `registerProvider` 的入参（v3，浏览器侧）：身份与用途；原生组件经把手逐个挂上。 */
export interface WidgetNativeProviderRegistration {
  /** 服务的版本；只接受 `WIDGET_BOARD_PROVIDER_API_VERSION`。 */
  apiVersion: number
  /** 提供方的包名。 */
  provider: string
  /** 这个提供方要用到的功能；只是用途声明。 */
  features?: readonly WidgetBoardFeature[]
}

/**
 * 一次 `registerProvider` 拿到的浏览器侧把手（v3，D31）。
 *
 * 浏览器半边没有目录监视与授权这类要撤的宿主资源，所以 `dispose` 是同步的；撤下之后可以重新
 * 注册同一个提供方。
 */
export interface WidgetNativeProviderHandle extends WidgetBoardSurface {
  /** 这个提供方的名字，与注册时报的相同。 */
  readonly provider: string
  /** 这次注册名下的组件 id，按注册顺序。 */
  readonly widgets: readonly string[]
  /** 挂一个原生组件；返回撤下它的函数。 */
  registerNativeWidget(registration: ProviderNativeWidgetRegistration): () => void
  /** 撤下这次注册名下的全部原生组件。 */
  dispose(): void
}

/**
 * 浏览器侧服务的形状。
 *
 * 与宿主侧一样报出 v3 的全部成员：`supportedApiVersions`、`features`、`supports` 与
 * `registerProvider` 都在这一侧实现里。
 */
export interface WidgetBoardClientService extends WidgetBoardSurface {
  readonly apiVersion: number
  /**
   * 注册一个提供方（v3）：报出身份与用途，拿到一个把手，原生组件经把手挂上。
   *
   * @param registration - 提供方与它用到的功能。
   * @returns 这个提供方的把手。
   */
  registerProvider(registration: WidgetNativeProviderRegistration): WidgetNativeProviderHandle
  /**
   * 注册一个原生组件；返回释放函数，提供方卸载时随之撤下。
   *
   * 这个入口与宿主侧的一样接受 `supportedApiVersions` 里的任一版本；新写的提供方用
   * `registerProvider`。
   */
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
  /** 对宿主的版本要求（D30），与组件 manifest 的同名项同形。 */
  requires?: WidgetRequires
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
