/**
 * 父页面与组件 iframe 之间的消息（D3）。
 *
 * 握手之后两端只经一个 `MessagePort` 说话；每条消息都按这里的形状判定，认不出的类型一律丢弃，
 * 载荷有长度上限。两侧共用这一份，形状只在 `contracts` 写一次。
 */
import type { WidgetFamily } from './widget'

/** 组件拿到的自身尺寸：像素盒、尺寸族、它占的列与行（D4）。 */
export interface WidgetSize {
  w: number
  h: number
  family: WidgetFamily
  cols: number
  rows: number
}

/** 动画档位：系统要求减弱动效时是 `reduced`（D10）。 */
export type MotionLevel = 'full' | 'reduced'

/** 一条父页面发给组件的消息。 */
export type ParentMessage =
  | {
    type: 'init'
    lang: string
    motion: MotionLevel
    size: WidgetSize
    props: unknown
    data: unknown
    state: unknown
    /** manifest 里的文案，按语言取（D7）。 */
    text: Record<string, { zh: string, en: string }>
    /** 宿主令牌的计算值，键是 `组-名`；运行时写成 iframe 根节点的 `--w-*`（D10）。 */
    tokens: Record<string, string>
  }
  | { type: 'size', size: WidgetSize }
  | { type: 'data', data: unknown }
  | { type: 'props', props: unknown }
  | { type: 'state', state: unknown }
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

/** 父页面消息的类型集合，供两端判定。 */
export const PARENT_MESSAGE_TYPES = ['init', 'size', 'data', 'props', 'state', 'pause', 'resume'] as const

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
