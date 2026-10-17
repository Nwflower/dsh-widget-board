/**
 * 父页面与组件 iframe 之间的消息（D3）。
 *
 * 握手之后两端只经一个 `MessagePort` 说话；每条消息按这里的形状判定，两端用的是同一个判定函数，
 * 认不出的类型、缺字段与超限的载荷一律丢弃并报出来。形状只在 `contracts` 写一次。
 */
import type { WidgetFamily } from './widget'

/** 组件出现在哪儿：看板上的卡片、会话正文、右侧栏、展开浮层（D16）。 */
export const WIDGET_PLACEMENTS = ['board', 'inline', 'rail', 'expanded'] as const

/** 一个位置。 */
export type WidgetPlacement = (typeof WIDGET_PLACEMENTS)[number]

/** 组件拿到的自身尺寸：像素盒、位置、它占的列与尺寸族（D16）。 */
export interface WidgetSize {
  w: number
  h: number
  placement: WidgetPlacement
  /** 位置族：内联、右侧栏与展开浮层用 manifest 里的族名，看板上是 `board`。 */
  family: WidgetFamily | 'board'
  /** 看板上的跨列数；其他位置是 1。 */
  cols: number
}

/** 动画档位：宿主要求减弱动效时是 `reduced`（D10）。 */
export type MotionLevel = 'full' | 'reduced'

/** 主题：令牌的计算值、语言与动画档位；握手时给一次，之后变化时再给（D10）。 */
export interface WidgetTheme {
  /** 宿主令牌的计算值，键是 `组-名`；运行时写成 iframe 根节点的 `--w-*`。 */
  tokens: Record<string, string>
  lang: string
  motion: MotionLevel
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
  } & WidgetTheme)
  | { type: 'size', size: WidgetSize }
  | { type: 'data', data: unknown }
  | { type: 'props', props: unknown }
  | { type: 'state', state: unknown }
  | { type: 'theme' } & WidgetTheme
  | { type: 'pause' }
  | { type: 'resume' }

/** 一条组件发给父页面的消息。 */
export type WidgetMessage =
  | { type: 'ready' }
  | { type: 'setState', patch: unknown }
  | { type: 'action', id: string, payload?: unknown }
  | { type: 'height', height: number }
  | { type: 'error', message: string }

/** 一条消息的 JSON 长度上限；超限的丢弃并报错（D3）。 */
export const MESSAGE_LIMIT = 64 * 1024

/** 组件一秒内最多发多少条消息；超出的丢弃并报错（D3）。 */
export const MESSAGE_RATE_LIMIT = 200

/** 父页面消息的类型集合，供两端判定。 */
export const PARENT_MESSAGE_TYPES = ['init', 'size', 'data', 'props', 'state', 'theme', 'pause', 'resume'] as const

/** 组件消息的类型集合，供两端判定。 */
export const WIDGET_MESSAGE_TYPES = ['ready', 'setState', 'action', 'height', 'error'] as const

/**
 * 一条消息是否在长度上限之内。
 *
 * @param message - 已经结构化的消息。
 * @returns 未超限时为真。
 */
export function withinLimit(message: unknown): boolean {
  return JSON.stringify(message).length <= MESSAGE_LIMIT
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

/**
 * 判断一条父页面的消息。
 *
 * 只认形状完整的消息：缺 tokens 的 `theme`、位移不是数字的 `size`，都当作没有发过。
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
    default:
      return false
  }
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
    case 'height':
      return typeof value.height === 'number' && Number.isFinite(value.height) && value.height >= 0
    case 'error':
      return typeof value.message === 'string'
    default:
      return false
  }
}
