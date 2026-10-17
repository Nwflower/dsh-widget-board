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

/**
 * 工作区：`GET /boards` 读全部看板与当前选中，`POST /boards` 新建一块（D21）。
 *
 * 动作的对象是一块看板时，看板 id 写在路径里；对象是一张卡片或一组卡片时按它们自己的 id 找，
 * 卡片与组的 id 是全工作区唯一的，路由因此不必再带看板。
 */
export const BOARDS_PATH = '/boards'

/** 一块看板：改标题、移除、选中，以及它自己的卡片操作都挂在这下面（D21）。 */
export const BOARD_ROUTE = '/boards'

/** 加一张卡：`POST /boards/<id>/instance`（D17）。 */
export const INSTANCE_ADD_ROUTE = 'instance'

/** 加一张固定的翻面组：`POST /boards/<id>/group`（D19）。 */
export const GROUP_ADD_ROUTE = 'group'

/** 卡片布局：`POST /boards/<id>/layout`，一次提交整块看板的卡片盒子（D16）。 */
export const LAYOUT_ROUTE = 'layout'

/** 按组 id 移除整组：`POST /group/remove`（D19）。 */
export const GROUP_REMOVE_PATH = '/group/remove'

/** 主动热刷新：`POST /refresh`，宿主重读组件库与运行时（D17）。 */
export const REFRESH_PATH = '/refresh'

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

/** 工作区快照与新建看板的地址，文档相对。 */
export const boardsPath = (): string => `${CLIENT_ROUTE}${BOARDS_PATH}`

/**
 * 一块看板下面某一项的地址，文档相对。
 *
 * @param id - 看板 id。
 * @param tail - 这一项的路径；空串表示看板本身。
 * @returns 路径。
 */
const boardPath = (id: string, tail: string): string =>
  `${CLIENT_ROUTE}${BOARD_ROUTE}/${encodeURIComponent(id)}${tail === '' ? '' : `/${tail}`}`

/** 提交卡片布局的地址，文档相对。 */
export const boardLayoutPath = (id: string): string => boardPath(id, LAYOUT_ROUTE)

/** 往看板上加一张卡的地址，文档相对。 */
export const boardInstancePath = (id: string): string => boardPath(id, INSTANCE_ADD_ROUTE)

/** 往看板上加一张固定翻面组的地址，文档相对。 */
export const boardGroupPath = (id: string): string => boardPath(id, GROUP_ADD_ROUTE)

/** 改一块看板标题的地址，文档相对。 */
export const boardRenamePath = (id: string): string => boardPath(id, 'rename')

/** 移除一块看板的地址，文档相对。 */
export const boardRemovePath = (id: string): string => boardPath(id, 'remove')

/** 选中一块看板的地址，文档相对。 */
export const boardActivatePath = (id: string): string => boardPath(id, 'activate')

/** 按组 id 移除整组的地址，文档相对。 */
export const groupRemovePath = (): string => `${CLIENT_ROUTE}${GROUP_REMOVE_PATH}`

/** 主动热刷新的地址，文档相对。 */
export const refreshPath = (): string => `${CLIENT_ROUTE}${REFRESH_PATH}`

/**
 * 某个版本组件文档的地址，文档相对。
 *
 * @param hash - 组件内容的哈希（D7）。
 * @param lang - 宿主当前的界面语言；文档的 `lang` 与标题按它取。
 * @returns 文档的路径。
 */
export const widgetDocumentPath = (hash: string, lang: string): string =>
  `${CLIENT_ROUTE}${WIDGET_ROUTE}/${hash}/document?lang=${encodeURIComponent(lang)}`
