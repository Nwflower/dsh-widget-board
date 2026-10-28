/**
 * 高级源码、草稿与预览的形状（技术契约 4—5）。
 *
 * 三件事共用这一份形状：读一个组件的源码、把它写回去、在预览会话里跑它。宿主是唯一写入者：源码
 * 的来源保护、并发核对与目录交换都在宿主那一侧，浏览器半边只把看到的东西画出来。
 */
import type { LocalizedText, WidgetSource } from './widget'

/** 组件目录里可以编辑的文件。 */
export const WIDGET_SOURCE_FILES = ['widget.json', 'index.html', 'style.css', 'main.js', 'samples.json'] as const

/** 一个可编辑的文件。 */
export type WidgetSourceFile = (typeof WIDGET_SOURCE_FILES)[number]

/** 组件目录里必须有的文件。 */
export const WIDGET_REQUIRED_FILES = ['widget.json', 'index.html', 'style.css'] as const

/**
 * `GET /library/<id>/source` 的响应：一个组件类型的全部源码。
 *
 * 凭据值不在这里：manifest 只声明凭据的名字与用途，值由宿主的凭据服务保存（D27）。
 */
export interface WidgetSourceModel {
  usage?: { id: string, title: string, count: number }[]
  /** 组件 id。 */
  id: string
  /** 它来自哪里：内置、用户目录或插件提供（D17）。 */
  source: WidgetSource
  /** 插件来源的包名；内置与用户来源没有它。 */
  provider?: string
  /** 标题与说明，取自 manifest。 */
  title: LocalizedText
  /** 当前版本的内容哈希；更新时按它核对并发（D7）。 */
  hash: string
  /** manifest 的原文：编辑它就是编辑 `widget.json`。 */
  manifest: string
  /** 组件目录里的文件，键是相对路径。 */
  files: Record<string, string>
  /** 目录里还有哪些文件：资源与额外脚本，界面按文件列表呈现。 */
  assets: { path: string, bytes: number }[]
  binaryFiles?: Record<string, string>
  /**
   * 这个来源能不能就地改。
   *
   * 内置与插件提供的组件是只读源：改它们时另存为一个新的用户组件（C4）。
   */
  writable: boolean
  /** 只读源上的建议 id：另存为时用它做默认名。 */
  suggestedId?: string
}

/** `POST /library/define` 的请求体：新建或更新一个用户组件类型。 */
export interface WidgetDefineRequest {
  /** 组件 id；新建时它决定目录名，manifest 的 id 要与它一致。 */
  id: string
  /** manifest 的内容。 */
  manifest: unknown
  /** 组件目录里的文件，键是相对路径；`widget.json` 由 manifest 生成，不必在这里。 */
  files: Record<string, string>
  binaryFiles?: Record<string, string>
  /**
   * 更新时读到的版本哈希。
   *
   * 新建时不带；更新时必须带：与宿主上的当前哈希对不上就返回 409，让界面重读之后由人决定
   * （C4）。`replace=true` 不能绕过这一层。
   */
  expectedHash?: string
}

/** 一次组件定义的结果。 */
export interface WidgetDefined {
  /** 写下的组件 id。 */
  id: string
  /** 新版本的内容哈希。 */
  hash: string
  /** 是新建还是更新。 */
  created: boolean
  /** 目录的绝对路径。 */
  dir: string
  /** 用了哪些文件。 */
  files: string[]
}

/**
 * 一次草稿（技术契约 4、C5）。
 *
 * 草稿只住在插件自己的 `drafts/` 目录里，凭据值不进来：字段是凭据的名字与它有没有配，不是密钥本身
 * （C12）。
 */
export interface WidgetDraft {
  /** 草稿的 id。 */
  draftId: string
  /** 草稿针对的目标：一张已有的卡片或一个组件类型。 */
  target: { kind: 'instance', instanceId: string } | { kind: 'widget', widgetId: string }
  /** 基础版本：组件的哈希或看板的修订号；恢复时按它核对。 */
  base: { hash?: string, revision?: number }
  /** 源码模式的文件内容。 */
  files?: Record<string, string>
  binaryFiles?: Record<string, string>
  /** 表单模式的 props、data 与 state。 */
  form?: { props?: unknown, data?: unknown, state?: unknown }
  /** 什么时候写的。 */
  updatedAt: string
}

/** 草稿列表里的一项。 */
export interface WidgetDraftSummary {
  draftId: string
  target: WidgetDraft['target']
  updatedAt: string
  /** 有源码内容还是有表单内容。 */
  kind: 'source' | 'form'
}

/** `POST /preview` 的请求体：上传一份已校验的文件与预览数据。 */
export interface PreviewCreateRequest {
  /** 组件目录里的文件，键是相对路径。 */
  files: Record<string, string>
  binaryFiles?: Record<string, string>
  /** 预览用的 props。 */
  props?: Record<string, unknown>
  /** 预览用的 data。 */
  data?: unknown
  /** 预览用的 state。 */
  state?: unknown
}

/** 一次预览会话。 */
export interface PreviewSession {
  /** 不可猜测的预览 id。 */
  previewId: string
  /** 什么时候过期。 */
  expiresAt: string
}

/** 预览面板要画的那几档。 */
export const PREVIEW_WIDTHS = ['narrow', 'regular', 'wide'] as const

/** 一个宽度档。 */
export type PreviewWidth = (typeof PREVIEW_WIDTHS)[number]

/** 预览面板要画的那几档高度。 */
export const PREVIEW_HEIGHTS = ['short', 'regular', 'tall'] as const

/** 一个高度档。 */
export type PreviewHeight = (typeof PREVIEW_HEIGHTS)[number]
