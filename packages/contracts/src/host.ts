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
