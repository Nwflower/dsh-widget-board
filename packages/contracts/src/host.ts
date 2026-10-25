/**
 * 宿主服务的契约（D1）：名字与它们读成的形状只在这里写一次。
 *
 * 出处是 `dsh-host-webserver` 的 `WebRoute` 与 `dsh-client-connection` 的
 * `HostConnectionHandle` 类型声明；这些包不是本仓库的依赖，所以形状在这里按宿主实际用到的部分记
 * 一次，宿主半边只从这里读。服务可能缺席时由调用方给出可见的说法（D11）。
 */

/** 宿主交到路由里的请求，只记本插件用到的字段。 */
export interface HostRequest {
  method?: string
  url?: string
  headers: Record<string, string | string[] | undefined>
  socket?: { remoteAddress?: string }
  /** 请求体按块读：`for await` 拿到的每一块，POST 的状态写在里面。 */
  [Symbol.asyncIterator](): AsyncIterator<string | Uint8Array>
  /** 客户端断开时取消在途调用（D24）；测试替身可以没有这一项。 */
  on?(event: 'aborted', listener: () => void): unknown
}

/** 宿主交到路由里的响应。 */
export interface HostResponse {
  writeHead(status: number, headers?: Record<string, string>): unknown
  end(body?: string | Uint8Array): unknown
  /** 一条已经开始的响应用它继续写（SSE）；一次性响应不必用。 */
  write?(chunk: string): unknown
  /** 订阅响应自身的关闭，用来把长连接的观众摘掉。 */
  on?(event: 'close', listener: () => void): unknown
}

/** 一条路由：`exact` 逐字匹配，`prefix` 匹配它本身与它下面的一切。 */
export interface HostRoute {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: HostRequest, res: HostResponse) => void | Promise<void>
}

/** 宿主的 web 服务：注册一条路由，返回解除注册的函数。 */
export interface HostWebServer {
  register(route: HostRoute): () => void
}

/** 宿主的请求栅栏与认证：被拒绝时给出状态码，放行时是 `undefined`。 */
export interface HostConnection {
  requestRejection(request: { headers: Record<string, string | string[] | undefined> }): 401 | 403 | undefined
}

/**
 * 从宿主上下文取出 web 服务。
 *
 * 宿主半边声明了 `inject: ['webServer']`，cordis 因此只在这项服务出现之后才调用 `apply`（D1）。
 *
 * @param context - 宿主交给插件 `apply` 的上下文。
 * @returns web 服务。
 */
export function webServerOf(context: unknown): HostWebServer {
  return (context as { webServer: HostWebServer }).webServer
}

/**
 * 宿主凭据服务里设置弹窗要用的那一面（D27）：查状态、写值、移除值。
 *
 * 形状按 `dsh-credentials` 的 `CredentialProvider` 记一次；值的品牌只在宿主侧编译期存在，这里用
 * 字符串接收，运行时按普通字符串传。`describe` 永远不回值。
 */
export interface HostCredentials {
  describe(ref: string): Promise<{ configured: boolean, source?: string, writable: boolean }>
  /**
   * 读出当前的值与它来自哪一层。只有宿主半边发请求时用它：值进了插件的进程就不再交给界面，
   * 设置弹窗读的仍是 `describe`（D27）。
   */
  resolve(ref: string): Promise<{ value: string, source: string } | undefined>
  set(ref: string, value: string): Promise<void>
  unset(ref: string): Promise<void>
}

/**
 * 宿主的凭据服务；部署里没有安装它时是 `undefined`，设置弹窗据此给出可见的说法（D11）。
 *
 * @param context - 宿主交给插件 `apply` 的上下文。
 * @returns 凭据服务，或 `undefined`。
 */
export function credentialsOf(context: unknown): HostCredentials | undefined {
  const get = (context as { get?: (name: string) => unknown }).get
  if (get === undefined) return undefined
  return get.call(context, 'credentials') as HostCredentials | undefined
}

/**
 * 宿主的请求栅栏；部署里没有这项服务时是 `undefined`，此时只放行本机回环（D3）。
 *
 * 读服务属性要在插件上声明过 `inject`，所以走 `get` 这条「可能没有」的路。
 *
 * @param context - 宿主交给插件 `apply` 的上下文。
 * @returns 栅栏，或 `undefined`。
 */
export function connectionOf(context: unknown): HostConnection | undefined {
  const get = (context as { get?: (name: string) => unknown }).get
  if (get === undefined) return undefined
  const connection = get.call(context, 'connection')
  return connection as HostConnection | undefined
}

/**
 * 一次账户查询的界面身份（D24）；宿主据此生成 Platform 请求头，里面没有 token。
 *
 * 形状按 `dsh-deepseek-account` 的 `AccountClientMetadata` 记一次；本插件只在宿主半边调用它。
 */
export interface AccountClientMetadata {
  /** 发起调用的界面版本。 */
  version: string
  /** 当前界面语言；Platform 只取主语言标签。 */
  locale: string
  /** 本地时间减 UTC 的秒数，东八区是 28800。 */
  timezoneOffsetSeconds: number
}

/** 一个充值钱包或赠送钱包的余额；十进制字符串保留服务端精度。 */
export interface AccountWallet {
  currency: 'CNY' | 'USD'
  balance: string
}

/** 一次余额查询的结果；失败与成功分开，失败时不带钱包。 */
export type AccountBalance =
  | { status: 'ready', value: readonly AccountWallet[], bonusWallets: readonly AccountWallet[] }
  | { status: 'failed' }

/**
 * 宿主的 DeepSeek 账户服务里余额查询的一面（D24）。
 *
 * 形状按 `ctx.deepseekAccount` 的 `getBalance` 记一次；这是 Host 侧服务，浏览器与组件都拿不到
 * token。部署里没有这项服务、或账号未登录时，调用方要给出可见的说法（D11）。
 */
export interface HostAccount {
  /** 查一次充值钱包与赠送钱包；未登录或查询期间账号变化时是 `null`。 */
  getBalance(client: AccountClientMetadata): Promise<AccountBalance | null>
}

/**
 * 宿主的 DeepSeek 账户服务；没有安装时是 `undefined`。
 *
 * @param context - 宿主交给插件 `apply` 的上下文。
 * @returns 账户服务，或 `undefined`。
 */
export function accountOf(context: unknown): HostAccount | undefined {
  const get = (context as { get?: (name: string) => unknown }).get
  if (get === undefined) return undefined
  return get.call(context, 'deepseekAccount') as HostAccount | undefined
}

/**
 * 宿主的设置服务里本插件用到的两件事：读全部入口、按入口写一处（D29）。
 *
 * 形状按 `dsh-settings` 的 `SettingsForms.describe` 与 `SettingsForms.update` 记一次；`value` 是这一
 * 行生效后的配置，`revision` 是写入时用来做比较交换的版本号。
 */
export interface HostSettingsDescriptor {
  /** 配置入口的 id，例如 `ui-theme`。 */
  ns: string
  /** 这一份配置的修订号。 */
  revision: number
  /** 生效后的配置值。 */
  value?: unknown
}

/** 宿主的设置服务；没有安装时是 `undefined`。 */
export interface HostSettings {
  describe(): HostSettingsDescriptor[]
  update(ns: string, patch: Record<string, unknown>, expectedRevision?: number): Promise<void>
}

/**
 * 宿主的设置服务。
 *
 * @param context - 宿主交给插件 `apply` 的上下文。
 * @returns 设置服务，或 `undefined`。
 */
export function settingsOf(context: unknown): HostSettings | undefined {
  const get = (context as { get?: (name: string) => unknown }).get
  if (get === undefined) return undefined
  return get.call(context, 'settings') as HostSettings | undefined
}
