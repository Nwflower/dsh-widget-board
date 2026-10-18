/**
 * 变更通知的事件（D18）：宿主把发生了什么告诉在线页面，页面只取缺的那一份。
 *
 * 一条状态写入曾经让每个页面重取整份快照；番茄钟每秒写一次，几个页面同时开着就把读写放大了
 * 几倍。现在事件带着改动本身：卡片状态与数据就地合并，布局就地换掉，只有卡片增删与组件库
 * 变化才重取快照。
 */
import type { CardLayout } from './board'

/** 一条变更通知。 */
export type BoardEvent =
  /** 卡片或看板增删、组件库变化：页面重取整个工作区的快照（D21）。 */
  | { type: 'board' }
  /** 一次布局提交落定：页面换掉这块看板的卡片盒子（D16、D21）。 */
  | { type: 'layout', board: string, layoutRevision: number, layouts: Record<string, CardLayout> }
  /** 一张卡的状态、数据或 props 变了：页面就地合并（D5、D22）；卡片 id 全工作区唯一，所以不带看板。 */
  | { type: 'instance', id: string, state?: unknown, data?: unknown, props?: Record<string, unknown> }
  /** 换了一块看板：页面把选中的标签换过去，不必重取快照（D21）。 */
  | { type: 'active', board: string }

/** 一条通知的线上形状：全局修订号与它携带的改动。 */
export interface BoardEventFrame {
  revision: number
  event: BoardEvent
}

/**
 * 判定一条外来通知。
 *
 * @param value - 解出来的 JSON。
 * @returns 可以当 `BoardEventFrame` 用时为真。
 */
export function isBoardEventFrame(value: unknown): value is BoardEventFrame {
  if (typeof value !== 'object' || value === null) return false
  const { revision, event } = value as Record<string, unknown>
  if (!Number.isSafeInteger(revision) || (revision as number) < 0) return false
  if (typeof event !== 'object' || event === null) return false
  const kind = (event as { type?: unknown }).type
  if (kind === 'board') return true
  if (kind === 'layout') {
    const { board, layoutRevision, layouts } = event as Record<string, unknown>
    return typeof board === 'string' && board !== ''
      && Number.isSafeInteger(layoutRevision) && typeof layouts === 'object' && layouts !== null && !Array.isArray(layouts)
  }
  if (kind === 'instance') {
    const { id } = event as Record<string, unknown>
    return typeof id === 'string' && id !== ''
  }
  if (kind === 'active') {
    const { board } = event as Record<string, unknown>
    return typeof board === 'string' && board !== ''
  }
  return false
}
