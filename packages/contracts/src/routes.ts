/**
 * 插件私有路由（D1、D3）。
 *
 * 前缀放在宿主 web 服务的 `/api/` 下：桌面外壳的页面来源是自定义协议（`dsh-app://app`），它的
 * 协议处理器只把 `/api/*` 转给宿主的 web 服务，`/plugins/*` 到不了宿主。浏览器半边因此一律用
 * 文档相对的地址——桌面外壳与子路径部署下，根相对地址都会跑到别的来源上去。
 *
 * 出处：任务看板的 `TASK_BOARD_API_PREFIX = '/api/task-board'` 与它 `client/host-api.ts` 里
 * 「DOCUMENT-RELATIVE」那段注释；本仓库在 0.2.1-rc.1 的桌面外壳里实证过 `api/task-board/state`
 * 回 200、`plugins/…` 回 404。
 */

/** 插件全部路由的前缀，宿主按它注册一条前缀路由。 */
export const PLUGIN_ROUTE = '/api/widget-board'

/** 浏览器半边用的地址前缀：去掉开头的斜杠，相对于当前文档。 */
export const CLIENT_ROUTE = PLUGIN_ROUTE.slice(1)

/** 看板快照：客户端从这里读看板与实例。 */
export const BOARD_PATH = '/board'

/** 变更通知：组件库或运行时变化时推送一次修订号（D7 的热重载）。 */
export const EVENTS_PATH = '/events'

/** 卡片的状态：`POST /instance/<id>/state`，组件把界面状态交给宿主存下来（D5）。 */
export const INSTANCE_ROUTE = '/instance'

/**
 * 某张卡存状态的地址，文档相对。
 *
 * @param id - 卡片实例的 id。
 * @returns 存放状态的路径。
 */
export const instanceStatePath = (id: string): string => `${CLIENT_ROUTE}${INSTANCE_ROUTE}/${encodeURIComponent(id)}/state`

/**
 * 某个版本组件文档的地址，文档相对。
 *
 * @param hash - 组件内容的哈希（D7）。
 * @returns 文档的路径。
 */
export const widgetDocumentPath = (hash: string): string => `${CLIENT_ROUTE}/widget/${hash}/document`
