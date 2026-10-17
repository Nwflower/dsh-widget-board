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

/** 看板快照：客户端从这里读看板、组件元信息与组件库（D5）。 */
export const BOARD_PATH = '/board'

/** 卡片布局：`POST /board/layout`，一次提交整块看板的卡片盒子（D16）。 */
export const BOARD_LAYOUT_PATH = '/board/layout'

/** 加一张卡：`POST /board/instance`（D17）。 */
export const BOARD_INSTANCE_PATH = '/board/instance'

/** 变更通知：宿主把发生了什么的告诉在线页面（D18）。 */
export const EVENTS_PATH = '/events'

/** 变更通知的地址，文档相对。 */
export const CLIENT_EVENTS_PATH = `${CLIENT_ROUTE}${EVENTS_PATH}`

/** 单张卡片的路由前缀：状态、数据与移除都挂在它下面（D5、D6）。 */
export const INSTANCE_ROUTE = '/instance'

/** 某个版本的组件文档：`GET /widget/<hash>/document`（D3）。 */
export const WIDGET_ROUTE = '/widget'

/**
 * 某张卡存状态的地址，文档相对。
 *
 * @param id - 卡片实例的 id。
 * @returns 存放状态的路径。
 */
export const instanceStatePath = (id: string): string => `${CLIENT_ROUTE}${INSTANCE_ROUTE}/${encodeURIComponent(id)}/state`

/**
 * 某张卡的数据的地址，文档相对。
 *
 * @param id - 卡片实例的 id。
 * @returns 推送数据的路径。
 */
export const instanceDataPath = (id: string): string => `${CLIENT_ROUTE}${INSTANCE_ROUTE}/${encodeURIComponent(id)}/data`

/**
 * 某张卡的动作地址，文档相对。
 *
 * @param id - 卡片实例的 id。
 * @returns 发出动作的路径。
 */
export const instanceActionPath = (id: string): string => `${CLIENT_ROUTE}${INSTANCE_ROUTE}/${encodeURIComponent(id)}/action`

/**
 * 从看板上移除一张卡的地址，文档相对。
 *
 * @param id - 卡片实例的 id。
 * @returns 移除的路径。
 */
export const instanceRemovePath = (id: string): string => `${CLIENT_ROUTE}${INSTANCE_ROUTE}/${encodeURIComponent(id)}/remove`

/** 提交卡片布局的地址，文档相对。 */
export const boardLayoutPath = (): string => `${CLIENT_ROUTE}${BOARD_LAYOUT_PATH}`

/** 往看板上加一张卡的地址，文档相对。 */
export const boardInstancePath = (): string => `${CLIENT_ROUTE}${BOARD_INSTANCE_PATH}`

/**
 * 某个版本组件文档的地址，文档相对。
 *
 * @param hash - 组件内容的哈希（D7）。
 * @param lang - 宿主当前的界面语言；文档的 `lang` 与标题按它取。
 * @returns 文档的路径。
 */
export const widgetDocumentPath = (hash: string, lang: string): string =>
  `${CLIENT_ROUTE}${WIDGET_ROUTE}/${hash}/document?lang=${encodeURIComponent(lang)}`
