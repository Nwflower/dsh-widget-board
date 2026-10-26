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

/** 按组 id 操作整组：移除与换槽都挂在它下面（D19、D27）。 */
export const GROUP_ROUTE = '/group'

/** 按组 id 移除整组：`POST /group/remove`（D19）。 */
export const GROUP_REMOVE_PATH = `${GROUP_ROUTE}/remove`

/** 主动热刷新：`POST /refresh`，宿主重读组件库与运行时（D17）。 */
export const REFRESH_PATH = '/refresh'

/** 变更通知：宿主把发生了什么的告诉在线页面（D18）。 */
export const EVENTS_PATH = '/events'

/** 变更通知的地址，文档相对。 */
export const CLIENT_EVENTS_PATH = `${CLIENT_ROUTE}${EVENTS_PATH}`

/**
 * 观众身份的查询参数：每个浏览器看板页一个，接在变更通知与可见性上报上（D6）。
 *
 * 断线重连沿用同一个 id，宿主把重连当成同一位观众回来，不会多出一个人。
 */
export const VIEWER_QUERY = 'viewer'

/** 一个观众 id 最多多长：它只是路由参数，宿主按它存一份可见集合。 */
export const VIEWER_MAX_LENGTH = 128

/**
 * 变更通知的地址，文档相对，带上观众身份（D6、D18）。
 *
 * @param viewer - 这个页面的观众 id。
 * @returns 订阅通知的路径。
 */
export const eventsPath = (viewer: string): string =>
  `${CLIENT_EVENTS_PATH}?${VIEWER_QUERY}=${encodeURIComponent(viewer)}`

/**
 * 单卡可见性上报：页面告诉宿主自己看得见哪些卡片（D6 的「没有观众不刷新」细化到单张卡）。
 */
export const VISIBILITY_PATH = '/visibility'

/** 可见性上报的地址，文档相对。 */
export const CLIENT_VISIBILITY_PATH = `${CLIENT_ROUTE}${VISIBILITY_PATH}`

/** 一次上报的请求体上限。 */
export const VISIBILITY_LIMIT = 16 * 1024

/** 一次上报最多带多少个卡片 id；每次请求各算各的，不累计。 */
export const VISIBILITY_MAX_IDS = 512

/** 一次上报里一个卡片 id 最多多长。 */
export const VISIBILITY_MAX_ID_LENGTH = 128

/** 一次可见性上报的主体。 */
export interface VisibilityReport {
  /** 上报的观众 id，与接通知时的同一个。 */
  viewer: string
  /** 这个观众现在看得见的卡片 id；空数组表示这一页一张卡都没在视口里。 */
  visible: string[]
}

/**
 * 判定一份可见性上报。
 *
 * @param value - 解出来的 JSON。
 * @returns 可以当 `VisibilityReport` 用时为真。
 */
export function isVisibilityReport(value: unknown): value is VisibilityReport {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const { viewer, visible } = value as Record<string, unknown>
  if (typeof viewer !== 'string' || viewer === '' || viewer.length > VIEWER_MAX_LENGTH) return false
  if (!Array.isArray(visible) || visible.length > VISIBILITY_MAX_IDS) return false
  return visible.every((id: unknown) => typeof id === 'string' && id !== '' && id.length <= VISIBILITY_MAX_ID_LENGTH)
}

/** 单张卡片的路由前缀：状态、数据、动作、授权与移除都挂在它下面（D5、D6）。 */
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
 * 某张卡调用一个宿主能力的地址，文档相对（D24）。
 *
 * @param id - 卡片实例的 id。
 * @returns 调用能力的路径。
 */
export const instanceCallPath = (id: string): string => `${CLIENT_ROUTE}${INSTANCE_ROUTE}/${encodeURIComponent(id)}/call`

/**
 * 某张卡读一次数据的地址，文档相对（D6）。
 *
 * @param id - 卡片实例的 id。
 * @returns 读数据的路径。
 */
export const instanceReadPath = (id: string): string => `${CLIENT_ROUTE}${INSTANCE_ROUTE}/${encodeURIComponent(id)}/read`

/**
 * 给某张卡的一份授权，文档相对（D6）。
 *
 * @param id - 卡片实例的 id。
 * @returns 授权的路径。
 */
export const instanceGrantPath = (id: string): string => `${CLIENT_ROUTE}${INSTANCE_ROUTE}/${encodeURIComponent(id)}/grant`

/**
 * 撤掉某张卡的一份授权，文档相对（D6）。
 *
 * @param id - 卡片实例的 id。
 * @returns 撤权的路径。
 */
export const instanceRevokePath = (id: string): string => `${CLIENT_ROUTE}${INSTANCE_ROUTE}/${encodeURIComponent(id)}/revoke`

/**
 * 从看板上移除一张卡的地址，文档相对。
 *
 * @param id - 卡片实例的 id。
 * @returns 移除的路径。
 */
export const instanceRemovePath = (id: string): string => `${CLIENT_ROUTE}${INSTANCE_ROUTE}/${encodeURIComponent(id)}/remove`

/**
 * 一张卡的设置读模型地址，文档相对（D27）。
 *
 * @param id - 卡片实例的 id。
 * @returns 读设置的路径。
 */
export const instanceSettingsPath = (id: string): string => `${CLIENT_ROUTE}${INSTANCE_ROUTE}/${encodeURIComponent(id)}/settings`

/**
 * 保存一张卡的 props 的地址，文档相对（D27）。
 *
 * @param id - 卡片实例的 id。
 * @returns 写 props 的路径。
 */
export const instancePropsPath = (id: string): string => `${CLIENT_ROUTE}${INSTANCE_ROUTE}/${encodeURIComponent(id)}/props`

/**
 * 写一张卡的一项凭据的地址，文档相对（D27）。
 *
 * @param id - 卡片实例的 id。
 * @returns 写凭据的路径。
 */
export const instanceCredentialPath = (id: string): string => `${CLIENT_ROUTE}${INSTANCE_ROUTE}/${encodeURIComponent(id)}/credential`

/**
 * 一张卡对外请求的日志地址，文档相对（D28）。
 *
 * @param id - 卡片实例的 id。
 * @returns 读日志的路径。
 */
export const instanceLogPath = (id: string): string => `${CLIENT_ROUTE}${INSTANCE_ROUTE}/${encodeURIComponent(id)}/log`

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

/**
 * 一块看板的导出地址，文档相对（D8）。
 *
 * @param id - 看板 id。
 * @returns 导出的路径；写成 `<a download>` 的 href 就能直接下载。
 */
export const boardExportPath = (id: string): string => boardPath(id, 'export')

/** 把看板包装进工作区的地址，文档相对（D8）。 */
export const boardImportPath = (): string => `${CLIENT_ROUTE}${BOARD_ROUTE}/import`

/** 组件库导入一个 `.dshw` 的路径（D8）。 */
export const LIBRARY_IMPORT_PATH = '/library/import'

/** 组件库里一个组件的导出挂在它下面（D8）。 */
export const LIBRARY_WIDGET_ROUTE = '/library/widget'

/** 把一个 `.dshw` 交给组件库的地址，文档相对（D8）。 */
export const libraryImportPath = (): string => `${CLIENT_ROUTE}${LIBRARY_IMPORT_PATH}`

/**
 * 组件库里一个组件的导出地址，文档相对（D8）。
 *
 * @param id - 组件 id。
 * @returns 下载 `.dshw` 的路径；写成 `<a download>` 的 href 就能直接下载。
 */
export const libraryWidgetExportPath = (id: string): string =>
  `${CLIENT_ROUTE}${LIBRARY_WIDGET_ROUTE}/${encodeURIComponent(id)}/export`

/** 按组 id 移除整组的地址，文档相对。 */
export const groupRemovePath = (): string => `${CLIENT_ROUTE}${GROUP_REMOVE_PATH}`

/**
 * 把一个组槽换成另一个组件的地址，文档相对（D27）。
 *
 * @param id - 组 id。
 * @returns 换槽的路径。
 */
export const groupSlotPath = (id: string): string => `${CLIENT_ROUTE}${GROUP_ROUTE}/${encodeURIComponent(id)}/slot`

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

/**
 * 自检的路由前缀（D9）：`GET /selfcheck/<callId>` 等宿主交出这次调用的自检任务，
 * `POST /selfcheck/<callId>` 交回报告。`callId` 就是会话里那次 `widget_define` 的调用 id。
 */
export const SELF_CHECK_ROUTE = '/selfcheck'

/**
 * 某次工具调用的自检地址，文档相对。
 *
 * @param callId - 会话里那次工具调用的 id。
 * @returns 取任务与交报告共用的路径。
 */
export const selfCheckPath = (callId: string): string => `${CLIENT_ROUTE}${SELF_CHECK_ROUTE}/${encodeURIComponent(callId)}`
