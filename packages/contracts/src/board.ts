/**
 * 看板快照的线上形状（D5）：宿主是唯一权威，浏览器半边读它、按它渲染。
 *
 * 两个半边共用这一份，形状只在这里写一次。修订号、提交与冲突处理按 PLAN 步骤 4 加进来。
 */
import type { WidgetFamily, LocalizedText } from './widget'

/** 一张卡片：哪个组件的哪个版本，以及它自己的 props、data 与 state。 */
export interface BoardInstance {
  id: string
  widget: string
  /** 组件内容的哈希（D7）。 */
  hash: string
  props: Record<string, unknown>
  data: unknown
  state: unknown
}

/** 一块看板。 */
export interface Board {
  version: number
  id: string
  title: string
  instances: BoardInstance[]
}

/** 快照里一张卡片要用的组件元信息。 */
export interface WidgetSummary {
  hash: string
  title: LocalizedText
  sizes: WidgetFamily[]
  text?: Record<string, LocalizedText>
}

/** `GET /board` 的响应。 */
export interface BoardSnapshot {
  board: Board
  widgets: Record<string, WidgetSummary>
}

/**
 * `POST /instance/<id>/state` 的请求体：组件把界面状态交给宿主。
 *
 * `patch` 合并进这张卡已经存下的状态：两边都是普通对象时合并一层，其余情况整体替换。
 */
export interface InstanceStateRequest {
  patch: unknown
}
