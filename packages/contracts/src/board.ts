/**
 * 看板快照的线上形状（D5）：宿主是唯一权威，浏览器半边读它、按它渲染。
 *
 * 两个半边共用这一份，形状只在这里写一次。
 */
import type { WidgetCredential, WidgetFamily, WidgetLibraryEntry, LocalizedText, WidgetRefresh, WidgetSource } from './widget'
import type { Grant, GrantKind } from './permission'
import type { ActionPermission } from './service'

/**
 * 一张卡片在看板上的位置与尺寸。
 *
 * `x` 与 `w` 是列号与跨列数，`y` 与 `h` 是根字号的倍数（D16）。列宽随看板宽度连续变化，
 * 高度由用户缩放决定；组件内容填满这个盒子，不再反过来撑高卡片。
 */
export interface CardLayout {
  x: number
  y: number
  w: number
  h: number
}

/** 组卡的模板：目前只有翻面一种（D19）。 */
export const GROUP_TEMPLATES = ['flip'] as const

/** 一个组卡模板。 */
export type GroupTemplate = (typeof GROUP_TEMPLATES)[number]

/** 组卡里的位置。 */
export const GROUP_SIDES = ['front', 'back'] as const

/** 组卡里的一个位置。 */
export type GroupSide = (typeof GROUP_SIDES)[number]

/**
 * 组卡的标记：两张普通卡片共享一个组 id，正面一张、背面一张（D19）。
 *
 * 组没有自己的组件文档，它由外壳把两张普通卡片放进一个盒子里；`side` 决定哪一张是正面。
 */
export interface InstanceGroup {
  id: string
  side: GroupSide
  template: GroupTemplate
}

/** 一张卡片：哪个组件的哪个版本，它自己的 props、data、state，以及它在看板上的盒子。 */
export interface BoardInstance {
  id: string
  widget: string
  /** 组件内容的哈希（D7）。 */
  hash: string
  /** 数据源的名字：卡片的数据由它读出来（D6）。 */
  source?: string
  props: Record<string, unknown>
  data: unknown
  state: unknown
  /** 卡片在看板上的位置与尺寸（D16）。 */
  layout: CardLayout
  /** 组卡标记：普通卡片没有这一项（D19）。 */
  group?: InstanceGroup
}

/** 翻面组在组件库里的 id；它不是一张组件卡，添加时由宿主建出正反两张卡。 */
export const FLIP_GROUP_ID = 'flip-group'

/** 翻面组的正面固定用这个组件，背面固定用下一个；原型阶段不做自由配置（D19）。 */
export const FLIP_GROUP_FRONT = 'stat'

/** 翻面组的背面组件。 */
export const FLIP_GROUP_BACK = 'chart'

/** 看板题头组件的 id；旧看板升级时补上这一张卡（D16）。 */
export const BOARD_HERO_ID = 'board-hero'

/** 一块看板。 */
export interface Board {
  version: number
  id: string
  title: string
  /** 看板内容的修订号：每次写入加一（D5）。 */
  revision: number
  /**
   * 布局的修订号：只有卡片增删与布局提交会让它加一。组件状态的写入不碰它，拖动的提交因此
   * 不会被同一页面上的计时器写成过期（D5、D16）。
   */
  layoutRevision: number
  instances: BoardInstance[]
}

/** 快照里一张卡片要用的组件元信息。 */
export interface WidgetSummary {
  hash: string
  title: LocalizedText
  sizes: WidgetFamily[]
  text?: Record<string, LocalizedText>
  /** 组件从哪儿来：内置、用户目录或插件（D17）。 */
  source: WidgetSource
  provider?: string
  /** 看板上的最小盒子（D16）。 */
  minBox?: { w: number, h: number }
  /** 这个类型有没有可配置的 props 或凭据（D22）：设置按钮据此决定出不出现。 */
  settings?: boolean
}

/** `GET /boards` 的响应：整个工作区。 */
export interface WorkspaceSnapshot {
  /** 当前选中的看板 id（D21）。 */
  active: string
  /** 全部看板，按索引里的次序；每一块的卡片同时挂载（D21）。 */
  boards: Board[]
  /** 卡片要用的组件元信息，按组件 id 索引；不可用的类型不在其中。 */
  widgets: Record<string, WidgetSummary>
  /** 组件库的全部类型，含读不出来的那些（D17）。 */
  library: WidgetLibraryEntry[]
  /** 看板上的卡片拿到过的授权（D6）；界面据此决定要不要问人。 */
  grants: Grant[]
}

/** 一次布局提交成功后的答复：只带这次落定的盒子与修订号（D16）。 */
export interface BoardLayoutSaved {
  /** 写入之后的布局修订号。 */
  layoutRevision: number
  /** 宿主存下的盒子，按卡片 id 索引；提交里没有的卡片不出现。 */
  layouts: Record<string, CardLayout>
}

/**
 * 一项凭据在设置弹窗里的状态（D22）：只有是否存在、来自哪一层、能不能写，永远没有值。
 *
 * 与宿主 `ctx.credentials.describe()` 的答复同形；看板不引宿主包，所以形状在这里记一次。
 */
export interface CredentialStatus {
  configured: boolean
  /** 提供值的那一层，例如 `env`、`file`；未配置时缺席。 */
  source?: string
  writable: boolean
}

/** 设置弹窗里的一条凭据声明与它的当前状态（D22）。 */
export interface CredentialSetting extends WidgetCredential {
  info?: CredentialStatus
  /** 凭据服务缺席或读不出来时的原因。 */
  unavailable?: string
}

/**
 * 一张卡在设置弹窗里要读的全部东西（D22）。
 *
 * `propsSchema` 来自当前组件版本；`source` 带上它的权限与当前授权状态；`credentials` 只有状态。
 * 读模型按需取，不放进每次工作区快照。
 */
export interface CardSettings {
  instance: BoardInstance
  widget: {
    title: LocalizedText
    description?: LocalizedText
    version: string
    hash: string
    source: WidgetSource
    provider?: string
    propsSchema?: Record<string, unknown>
    text?: Record<string, LocalizedText>
    refresh?: WidgetRefresh
  }
  /** 卡片绑定的数据源；没有绑定或提供方不在时缺席。 */
  source?: {
    id: string
    provider: string
    permission?: ActionPermission
    /** 当前组件版本上有没有一份覆盖这份权限的授权（D6）。 */
    granted: boolean
  }
  /** 绑定了数据源但找不到提供方时的原因。 */
  sourceError?: string
  /** 与这张卡当前组件版本有关的授权（D6）。 */
  grants: Grant[]
  credentials: CredentialSetting[]
  /** 宿主有没有凭据服务；没有时凭据这一节显示原因。 */
  credentialsAvailable: boolean
}

/** `POST /instance/<id>/props` 的请求体：设置弹窗保存整份 props（D22）。 */
export interface InstancePropsRequest {
  props: Record<string, unknown>
}

/**
 * `POST /instance/<id>/credential` 的请求体（D22）。
 *
 * 只接受这张卡的组件 manifest 声明过的 `ref`；`set` 要带非空 `value`，`unset` 不带。
 */
export interface InstanceCredentialRequest {
  ref: string
  action: 'set' | 'unset'
  value?: string
}

/** `POST /group/<id>/slot` 的请求体：把组的一个槽换成另一个组件（D22）。 */
export interface GroupSlotRequest {
  side: GroupSide
  widget: string
}

/** `POST /boards` 的请求体：新建一块看板（D21）。 */
export interface BoardCreateRequest {
  /** 标题；省略时宿主起一个「未命名看板」加序号。 */
  title?: string
}

/** `POST /boards/<id>/rename` 的请求体（D21）。 */
export interface BoardRenameRequest {
  title: string
}

/**
 * `POST /instance/<id>/state` 的请求体：组件把界面状态交给宿主。
 *
 * `patch` 合并进这张卡已经存下的状态：两边都是普通对象时合并一层，其余情况整体替换。
 */
export interface InstanceStateRequest {
  patch: unknown
}

/** `POST /instance/<id>/data` 的请求体：数据源或 agent 把数据交给这张卡（D6）。 */
export interface InstanceDataRequest {
  data: unknown
}

/**
 * `POST /instance/<id>/read` 的请求体：按卡片绑定的（或点名的）数据源读一次数据（D6）。
 *
 * 省略 `source` 时用卡片自己绑定的那个。
 */
export interface InstanceReadRequest {
  source?: string
}

/** `POST /instance/<id>/grant` 的请求体：人给出一份授权（D6）。 */
export interface GrantRequest {
  /** 授权指向的是动作还是数据源；省略时是动作。 */
  kind?: GrantKind
  /** 动作或数据源的名字。 */
  id: string
}

/** `POST /instance/<id>/revoke` 的请求体：撤掉一份授权（D6）。 */
export interface RevokeRequest {
  kind?: GrantKind
  id: string
}

/**
 * `POST /instance/<id>/action` 的请求体：组件按下按钮（D6）。
 *
 * `id` 必须在这个组件的 manifest 的 `actions` 里声明过；`payload` 原样交给注册的动作。
 */
export interface InstanceActionRequest {
  id: string
  payload?: unknown
}

/**
 * `POST /board/instance` 的请求体：往看板上加一张卡（D17）。
 *
 * `source` 取名自插件注册的数据源；省略时卡片的数据保持为空，由后续推送填写。
 * `layout` 是拖到看板上的落点；省略时宿主把卡片放进最矮的一列。
 */
export interface InstanceAddRequest {
  widget: string
  source?: string
  props?: Record<string, unknown>
  layout?: CardLayout
}

/**
 * `POST /board/group` 的请求体：加一张固定的翻面组（D19）。
 *
 * 原型阶段正反两张卡的组件由宿主固定，请求只带落点。
 */
export interface GroupAddRequest {
  layout?: CardLayout
}

/** `POST /board/group/remove` 的请求体：按组 id 移除整组（D19）。 */
export interface GroupRemoveRequest {
  group: string
}

/**
 * `POST /board/layout` 的请求体：一次提交整块看板的卡片盒子。
 *
 * 拖动与缩放在本地预览，松手时带上读到的布局修订号整体提交；宿主发现布局修订号过期时返回
 * 当前快照，页面按它重画（D5、D16）。
 */
export interface BoardLayoutRequest {
  layoutRevision: number
  layouts: Record<string, CardLayout>
}
