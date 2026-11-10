/**
 * 人工创建与编辑实例内容的形状（技术契约 3）。
 *
 * 两条写路由只给插件自己的界面用：创建时一次写进完整的 props、data、state，编辑时只改被点名的
 * 那几项。校验、额度与冲突判定都在宿主，界面按读模型与逐字段原因画表单。
 */
import type { BoardInstance, CardLayout } from './board'
import type { MediaBinding, InstanceMedia } from './media'
import type { LocalizedText, WidgetFamily, WidgetMinBox, WidgetSource } from './widget'

/**
 * 一条内容写入被拒绝时逐字段的原因。
 *
 * `path` 是 JSON Pointer 形状的路径，例如 `/items/0/text`；顶层是 `/`。界面按它把原因放到对应的
 * 那一行上，不把整条消息压成一句。
 */
export interface ContentIssue {
  path: string
  message: string
}

/** 创建器读的组件表单：props 与 data 的 schema、文案与盒子。 */
export interface WidgetFormModel {
  id: string
  hash: string
  title: LocalizedText
  version: string
  source: WidgetSource
  provider?: string
  /** manifest 的 `props` schema；没有时表单只剩说明。 */
  propsSchema?: Record<string, unknown>
  /** manifest 的 `data` schema：链接、正文与其它数据卡的表单按它生成。 */
  dataSchema?: Record<string, unknown>
  /** manifest 的 `state` schema：待办这类把内容存进界面状态的组件按它生成。 */
  stateSchema?: Record<string, unknown>
  text?: Record<string, LocalizedText>
  sizes: WidgetFamily[]
  defaultBox?: WidgetMinBox
  minBox?: WidgetMinBox
}

/** `GET /instance/<id>/content` 的响应：编辑一张已有的卡要读的那一份。 */
export interface CardContentModel {
  instance: BoardInstance
  /**
   * 这张卡所在的看板修订号。
   *
   * 内容写入按它判定冲突：编辑器打开之后别的窗口改了这张卡，提交就收到 409，界面保留草稿并给出
   * 重新读取的入口（技术契约 3）。
   */
  revision: number
  widget: WidgetFormModel
}

/** `POST /boards/<id>/compose` 的请求体：一次创建一张完整的卡片。 */
export interface InstanceComposeRequest extends MediaBinding {
  /** 组件 id；它的 props、data 与 state 都按这个组件的 manifest 校验。 */
  widget: string
  /** 编辑器里预览的那一版组件；不给出时不核对，版本变了也照常创建。 */
  expectedHash?: string
  props?: Record<string, unknown>
  data?: unknown
  state?: unknown
  /** 期望的盒子；省略时宿主放进末尾。 */
  layout?: CardLayout
}

/** `POST /instance/<id>/content` 的请求体：编辑当前实例的内容。 */
export interface InstanceContentRequest extends MediaBinding {
  /** 编辑器读到的那份看板修订号；对不上就返回 409。 */
  expectedRevision: number
  props?: Record<string, unknown>
  data?: unknown
  state?: unknown
}

/** 内容写入成功后的答复：写入之后的修订号与存下来的那几项。 */
export interface CardContentSaved {
  media?: InstanceMedia
  revision: number
  props: Record<string, unknown>
  data: unknown
  state: unknown
}
