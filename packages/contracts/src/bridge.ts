/**
 * 父页面与组件 iframe 之间的消息（D3）。
 *
 * 握手之后两端只经一个 `MessagePort` 说话；每条消息按这里的形状判定，两端用的是同一个判定函数，
 * 认不出的类型、缺字段与超限的载荷一律丢弃并报出来。形状只在 `contracts` 写一次。
 */
import type { InspectionResult } from './inspect'
import { isInspectionReport } from './inspect'
import type { LocalizedText, WidgetFamily, WidgetPermissions } from './widget'

/** 组件出现在哪儿：看板上的卡片、会话正文、右侧栏、展开浮层与组件库里的缩略画面（D16）。 */
export const WIDGET_PLACEMENTS = ['board', 'inline', 'rail', 'expanded', 'preview'] as const

/** 一个位置。 */
export type WidgetPlacement = (typeof WIDGET_PLACEMENTS)[number]

/** 组件拿到的自身尺寸：像素盒、位置、它占的列与尺寸族（D16）。 */
export interface WidgetSize {
  w: number
  h: number
  placement: WidgetPlacement
  /** 位置族：内联、右侧栏、展开浮层与缩略画面用 manifest 里的族名或 `preview`，看板上是 `board`。 */
  family: WidgetFamily | 'board' | 'preview'
  /** 看板上的跨列数；其他位置是 1。 */
  cols: number
}

/** 动画档位：宿主要求减弱动效时是 `reduced`（D10）。 */
export type MotionLevel = 'full' | 'reduced'

/**
 * 组件发到看板栏上的一条通知（D7）。
 *
 * 只带给人看的两段文字：看板栏记下未读条数，正文留作悬停时的那一句。标题省略时外壳用组件的标题。
 */
export interface WidgetNotification {
  title?: string
  body?: string
}

/** 通知标题的长度上限；更长的消息按形状不对丢弃。 */
export const NOTIFICATION_TITLE_LIMIT = 120

/** 通知正文的长度上限。 */
export const NOTIFICATION_BODY_LIMIT = 400

/** 组件可以请父页面打开的地址长度上限。 */
export const OPEN_URL_LIMIT = 2048

/** 组件可以请父页面打开的协议：只有网页能出去，`javascript:` 之类的一律当形状不对。 */
export const OPEN_URL_PROTOCOLS = ['http:', 'https:'] as const

/**
 * 这个地址能不能请宿主打开。
 *
 * 组件在 iframe 里导航不了，点开一条链接要由父页面代劳；新页是宿主页面开的，所以只收 http 与
 * https 的完整地址，其余一律不开。
 *
 * @param value - 外来值。
 * @returns 可以交给父页面打开时为真。
 */
export function isOpenableUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value === '' || value.length > OPEN_URL_LIMIT) return false
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  return (OPEN_URL_PROTOCOLS as readonly string[]).includes(url.protocol)
}

/**
 * 组件交给宿主的那几件交互，沙箱级与原生级同形（D3、D24）。
 *
 * 两种组件都经这几个方法说话：状态、动作、能力调用、通知与文案。分开写会让两边的形状漂移，
 * 这里只写一次。
 */
export interface WidgetHandles {
  /** 把一份局部状态交给宿主保存（D5）。 */
  setState(patch: unknown): void
  /** 发出 manifest 里声明过的动作（D6）。 */
  action(id: string, payload?: unknown): void
  /** 调用 manifest 里声明过的宿主能力（D24）。 */
  call(capability: string, args?: unknown, options?: { signal?: AbortSignal }): Promise<unknown>
  /** 往看板栏上记一条未读通知（D7）。 */
  notify(notification?: WidgetNotification): void
  /** 请父页面在新标签页里打开一个网页（D26）。得由一次点击引发，否则浏览器拦下弹窗。 */
  open(url: string): void
  /** manifest 的 `text` 里的一条文案，按当前语言取。 */
  t(key: string): string
}

/** 主题：令牌的计算值、语言与动画档位；握手时给一次，之后变化时再给（D10）。 */
export interface WidgetTheme {
  /** 宿主令牌的计算值，键是 `组-名`；运行时写成 iframe 根节点的 `--w-*`。 */
  tokens: Record<string, string>
  lang: string
  motion: MotionLevel
}

/**
 * 一项宿主能力的元数据（D32）：握手时随 init 给一次，组件在调用之前就知道哪些能力现在能调。
 *
 * 可用项从能力注册项取完整信息；不可用项只留 manifest 声明的 id 与 `available: false`，其余字段
 * 没有。来自注册项的每一项都按注册项可省略的样子写成可选，不填占位值。
 */
export interface CapabilityMetadata {
  /** manifest 里声明的那个名字：`名字`，或点名提供方的 `提供方:名字`。 */
  id: string
  /** 提供方的包名。声明的名字没带提供方、宿主又解不出唯一的一个时省略这一项，不填占位字符串。 */
  provider?: string
  /** 给人看的名字；注册项没给时省略。 */
  title?: LocalizedText
  /** 一句说明；注册项没给时省略。 */
  description?: LocalizedText
  /** 参数的 JSON Schema；注册项不校验参数时省略。 */
  input?: Record<string, unknown>
  /** 返回值的 JSON Schema；注册项不校验结果时省略。 */
  output?: Record<string, unknown>
  /** 这个能力要的权限，与 manifest 的 `permissions` 同形（D6）；注册项没声明时省略。 */
  permission?: WidgetPermissions
  /** 宿主现在解析得到它：提供方在，名字也解得开。 */
  available: boolean
}

/** 一条父页面发给组件的消息。 */
export type ParentMessage =
  | ({
    type: 'init'
    size: WidgetSize
    props: unknown
    data: unknown
    state: unknown
    /** manifest 里的文案，按语言取（D7）。 */
    text: Record<string, { zh: string, en: string }>
    /**
     * 这张卡的 manifest 声明过、而宿主当前解析得到的能力（D24），给照旧读字符串数组的旧运行时用。
     *
     * 带 `capabilityMetadata` 时它就是其中 `available` 为真的那些 id，两份不会说两套话（D32）。
     */
    capabilities?: string[]
    /**
     * 声明过的每一项能力的元数据（D32），按 manifest 的声明次序，现在不可用的那些也在里面。
     *
     * 只随 init 给一次：之后提供方撤下由一次 `call-error` 可见地反馈。省略表示这一侧没有投影能力面。
     */
    capabilityMetadata?: CapabilityMetadata[]
  } & WidgetTheme)
  | { type: 'size', size: WidgetSize }
  | { type: 'data', data: unknown }
  | { type: 'props', props: unknown }
  | { type: 'state', state: unknown }
  | { type: 'theme' } & WidgetTheme
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'call-result', requestId: string, result: unknown }
  | { type: 'call-error', requestId: string, code: string, message: string }
  /** 让组件在当前盒子里跑一次检查器（D9、D13）。 */
  | { type: 'inspect', requestId: string }

/** 一条组件发给父页面的消息。 */
export type WidgetMessage =
  | { type: 'ready' }
  | { type: 'setState', patch: unknown }
  | { type: 'action', id: string, payload?: unknown }
  | { type: 'call', requestId: string, capability: string, args?: unknown }
  | { type: 'cancel', requestId: string }
  | { type: 'height', height: number }
  | { type: 'error', message: string }
  | ({ type: 'notify' } & WidgetNotification)
  /** 请父页面开一个新页；地址必须是 http 或 https（D26）。 */
  | { type: 'open', url: string }
  /** 检查器的结果，回应同一 `requestId` 的 `inspect`。 */
  | ({ type: 'report', requestId: string } & InspectionResult)

/** 一条组件消息（组件发给父页面）的 JSON 长度上限；超限的丢弃并报错（D3）。 */
export const MESSAGE_LIMIT = 64 * 1024

/**
 * 一条父页面消息（父页面发给组件）的 JSON 长度上限；超限的丢弃并报错（D3）。
 *
 * 父页面是可信的一侧，这个上限只防失控：它要盖住宿主存得下的 data（256 KiB，D23）与 state
 * （64 KiB）拼进同一条 init 的情形，否则宿主合法落盘的数据永远送不进组件。
 */
export const PARENT_MESSAGE_LIMIT = 320 * 1024

/** 组件一秒内最多发多少条消息；超出的丢弃并报错（D3）。 */
export const MESSAGE_RATE_LIMIT = 200

/** 父页面消息的类型集合，供两端判定。 */
export const PARENT_MESSAGE_TYPES = ['init', 'size', 'data', 'props', 'state', 'theme', 'pause', 'resume', 'call-result', 'call-error', 'inspect'] as const

/** 组件消息的类型集合，供两端判定。 */
export const WIDGET_MESSAGE_TYPES = ['ready', 'setState', 'action', 'call', 'cancel', 'height', 'error', 'notify', 'open', 'report'] as const

/**
 * 一条消息是否在长度上限之内。
 *
 * @param message - 已经结构化的消息。
 * @param limit - 长度上限；父页面发给组件的消息传 `PARENT_MESSAGE_LIMIT`。
 * @returns 未超限时为真。
 */
export function withinLimit(message: unknown, limit: number = MESSAGE_LIMIT): boolean {
  return JSON.stringify(message).length <= limit
}

/** 判断一个外来值是不是普通对象。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 判断一条消息能不能当 `WidgetSize` 用。
 *
 * @param value - 外来值。
 * @returns 形状对时为真。
 */
export function isWidgetSize(value: unknown): value is WidgetSize {
  if (!isRecord(value)) return false
  const { w, h, placement, family, cols } = value
  return typeof w === 'number' && Number.isFinite(w) && w >= 0
    && typeof h === 'number' && Number.isFinite(h) && h >= 0
    && typeof cols === 'number' && Number.isSafeInteger(cols) && cols >= 1
    && typeof family === 'string'
    && (WIDGET_PLACEMENTS as readonly string[]).includes(placement as string)
}

/** 判断一段双语文案：两段都是非空字符串。 */
function isLocalizedTextValue(value: unknown): value is LocalizedText {
  return isRecord(value) && typeof value.zh === 'string' && value.zh !== ''
    && typeof value.en === 'string' && value.en !== ''
}

/** 判断一段可选的双语文案。 */
function isOptionalLocalizedText(value: unknown): boolean {
  return value === undefined || isLocalizedTextValue(value)
}

/** 判断一个可选的 JSON Schema：只要求是对象。 */
function isOptionalSchema(value: unknown): boolean {
  return value === undefined || isRecord(value)
}

/** 判断一个可选的字符串数组：每一项都是非空字符串。 */
function isOptionalTextList(value: unknown): boolean {
  return value === undefined || (Array.isArray(value) && value.every((item) => typeof item === 'string' && item !== ''))
}

/** 判断一段可选的权限声明：只有 `hosts` 与 `commands` 两个字符串数组（D6）。 */
function isOptionalPermission(value: unknown): boolean {
  if (value === undefined) return true
  return isRecord(value) && isOptionalTextList(value.hosts) && isOptionalTextList(value.commands)
}

/**
 * 判断一项能力元数据（D32）。
 *
 * 每一项都按完整形状判：可用项带着注册项的标题、schema 与权限，不可用项只有 id 与
 * `available: false`，所以缺 `available`、把 schema 写成字符串、`provider` 是空串都不认。
 *
 * @param value - 外来值。
 * @returns 形状对时为真。
 */
export function isCapabilityMetadata(value: unknown): value is CapabilityMetadata {
  if (!isRecord(value)) return false
  const { id, provider, title, description, input, output, permission, available } = value
  if (typeof id !== 'string' || id === '') return false
  if (typeof available !== 'boolean') return false
  if (provider !== undefined && (typeof provider !== 'string' || provider === '')) return false
  return isOptionalLocalizedText(title) && isOptionalLocalizedText(description)
    && isOptionalSchema(input) && isOptionalSchema(output) && isOptionalPermission(permission)
}

/**
 * 判断一条父页面的消息。
 *
 * 只认形状完整的消息：缺 tokens 的 `theme`、位移不是数字的 `size`、能力名单或元数据坏掉的
 * `init`，都当作没有发过。
 *
 * @param value - 外来值。
 * @returns 可以当 `ParentMessage` 用时为真。
 */
export function isParentMessage(value: unknown): value is ParentMessage {
  if (!isRecord(value) || typeof value.type !== 'string') return false
  switch (value.type) {
    case 'init':
      return isWidgetSize(value.size)
        && isRecord(value.tokens)
        && typeof value.lang === 'string'
        && (value.motion === 'full' || value.motion === 'reduced')
        && isRecord(value.text)
        && isOptionalTextList(value.capabilities)
        && (value.capabilityMetadata === undefined
          || (Array.isArray(value.capabilityMetadata) && value.capabilityMetadata.every(isCapabilityMetadata)))
    case 'theme':
      return isRecord(value.tokens) && typeof value.lang === 'string'
        && (value.motion === 'full' || value.motion === 'reduced')
    case 'size':
      return isWidgetSize(value.size)
    case 'pause':
    case 'resume':
      return true
    case 'data':
      return 'data' in value
    case 'props':
      return isRecord(value.props)
    case 'state':
      return 'state' in value
    case 'call-result':
      return typeof value.requestId === 'string' && value.requestId !== '' && 'result' in value
    case 'call-error':
      return typeof value.requestId === 'string' && value.requestId !== ''
        && typeof value.code === 'string' && typeof value.message === 'string'
    case 'inspect':
      return typeof value.requestId === 'string' && value.requestId !== ''
    default:
      return false
  }
}

/**
 * 一段可选的文字是否在规定长度以内。
 *
 * @param value - 外来值。
 * @param limit - 最长的字符数。
 * @returns 没给、或在长度以内时为真。
 */
function isOptionalText(value: unknown, limit: number): boolean {
  return value === undefined || (typeof value === 'string' && value.length <= limit)
}

/**
 * 判断一条组件的消息。
 *
 * @param value - 外来值。
 * @returns 可以当 `WidgetMessage` 用时为真。
 */
export function isWidgetMessage(value: unknown): value is WidgetMessage {
  if (!isRecord(value) || typeof value.type !== 'string') return false
  switch (value.type) {
    case 'ready':
      return true
    case 'setState':
      return 'patch' in value
    case 'action':
      return typeof value.id === 'string' && value.id !== ''
    case 'call':
      return typeof value.requestId === 'string' && value.requestId !== ''
        && typeof value.capability === 'string' && value.capability !== ''
    case 'cancel':
      return typeof value.requestId === 'string' && value.requestId !== ''
    case 'height':
      return typeof value.height === 'number' && Number.isFinite(value.height) && value.height >= 0
    case 'error':
      return typeof value.message === 'string'
    case 'notify':
      return isOptionalText(value.title, NOTIFICATION_TITLE_LIMIT)
        && isOptionalText(value.body, NOTIFICATION_BODY_LIMIT)
    case 'open':
      return isOpenableUrl(value.url)
    case 'report':
      return typeof value.requestId === 'string' && value.requestId !== ''
        && isInspectionReport(value.report)
        && Array.isArray(value.problems) && value.problems.every((problem) => typeof problem === 'string')
    default:
      return false
  }
}
