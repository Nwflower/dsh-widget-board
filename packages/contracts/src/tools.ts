/**
 * 面向会话的工具与 skill（D9）。
 *
 * 看板对外暴露的不只是界面：会话里的 agent 要能列组件、写组件、读看板、放卡片、推数据。这些能力
 * 经宿主的工具注册表暴露给模型，因此这里写的是**接缝**——本插件只依赖这几个名字与形状，不依赖
 * `@deepseek-ai/dsh-tools` 的类型：那一包由宿主进程提供，本仓库在构建时拿不到它。
 *
 * 工具的 `parameters` 是给模型看的 JSON Schema（`@deepseek-ai/dsh-llm` 的 `ToolSchema.parameters`），
 * 直接注册时由工具自己校验输入（见 `packages/host/src/tools/`）。
 */
import type { WidgetSummary } from './board'
import type { WidgetCredential, WidgetFamily, WidgetSource } from './widget'
import type { ActionPermission } from './service'
/** 工具名（D9）；模型看到的就是这几个。 */
export const WIDGET_TOOL_NAMES = {
  /** 列出组件库里的组件类型。 */
  catalog: 'widget_catalog',
  /** 新建或更新一个组件类型。 */
  define: 'widget_define',
  /** 把一个组件内联显示在当前会话的回答里。 */
  show: 'widget_show',
  /** 读一块看板上的卡片，并列出全部看板。 */
  board: 'widget_board',
  /** 往看板上放一张卡、挪它、改它的大小或 props；可以指定看板。 */
  place: 'widget_place',
  /** 从看板上移除一张卡。 */
  remove: 'widget_remove',
  /** 把数据推给一张卡。 */
  push: 'widget_push',
} as const

/** 一个工具名。 */
export type WidgetToolName = (typeof WIDGET_TOOL_NAMES)[keyof typeof WIDGET_TOOL_NAMES]

/** 虚拟 skill 的名字（D9）：kebab-case，模型按它加载编写指南。 */
export const WIDGET_SKILL_NAME = 'widget-authoring'

/** 系统提示段的名字：与 skill 一同出现，只在本插件的工具可见时注册。 */
export const WIDGET_PROMPT_SECTION = 'dsh-widget-board'

/** 模型可见的一段内容。 */
export interface ToolContentBlock {
  type: 'text'
  text: string
}

/**
 * 一个工具自己的定义：写工具时只写这几项。
 *
 * 渲染与参数校验都留在这里；注册给宿主注册表时要套一层 `output`，那一步由 `toolRegistrations` 做。
 */
export interface WidgetToolSpec {
  name: string
  description: string
  /** 参数的 JSON Schema（对象根）。 */
  parameters: Record<string, unknown>
  /**
   * 跑一次工具，返回规范 JSON 值。
   *
   * @param args - 模型给的参数，原样传进来（由实现校验）。
   * @returns 规范值。
   */
  execute(args: unknown): Promise<unknown>
  /**
   * 把规范值投影成客户端工具视图要的载荷（D9）。
   *
   * 只有带视图的工具写这一项；返回的是一份能画出来的最小快照，宿主编进这次结果的 `meta`，
   * 视图从那里读它。不写时视图看不到这次调用。
   *
   * @param value - `execute` 返回的规范值。
   * @returns 视图要的载荷。
   */
  view?(value: unknown): unknown
  /**
   * 把规范值渲染成模型看到的内容。
   *
   * @param value - `execute` 返回的规范值。
   * @returns 模型可见的内容块。
   */
  render(value: unknown): ToolContentBlock[]
}

/**
 * 一个工具的注册项：宿主注册表读的形状。
 *
 * `output.schema` 会被用来校验 `execute` 的返回值，所以写成宽松的 `{}`——真正的形状由各自的
 * `render` 与单元测试盯着。
 */
export interface WidgetToolRegistration {
  name: string
  description: string
  parameters: Record<string, unknown>
  output: {
    schema: Record<string, unknown>
    render(args: unknown, value: unknown): ToolContentBlock[]
    /**
     * 这次调用交给客户端视图的载荷（D9）。宿主把它存进结果的 `meta`；`WidgetToolSpec.view`
     * 是它在这里的来源。
     */
    presentationMeta?(args: unknown, value: unknown): unknown
  }
  execute(args: unknown): Promise<unknown>
}

/** 工具注册表：宿主发布 `ctx.tools` 的那几项里，本插件用到的两个方法。 */
export interface HostToolsService {
  /** 注册一个工具；返回注销它的函数。 */
  register(tool: WidgetToolRegistration): () => void
}

/** 系统提示服务：只用到注册一段。 */
export interface HostSystemPromptService {
  /**
   * 注册一段系统提示。
   *
   * @param section - 名字、排序与文本。
   * @returns 注销它的函数。
   */
  section(section: { name: string, order: number, text: string }): () => void
}

/** 一条 skill 的注册项：按 `SkillRegistration` 里本插件会写的那几项。 */
export interface WidgetSkillRegistration {
  name: string
  description: string
  /** 正文（Markdown）。 */
  content: string
  /** 谁能调用它；两个都开。 */
  invocation: { modelInvocable: boolean, userInvocable: boolean }
  /** 来源：运行时注册的算 `runtime`。 */
  source: string
  /** 提供方标签。 */
  provider: string
}

/** skill 注册表：只用到注册一条运行时 skill。 */
export interface HostSkillsService {
  /**
   * 注册一条运行时 skill。
   *
   * @param skill - skill 的定义。
   * @returns 注销它的函数。
   */
  register(skill: WidgetSkillRegistration): () => void
}

/** 宿主上下文里本插件会用到的那几项可选服务。 */
export interface HostToolServices {
  tools?: HostToolsService
  systemPrompt?: HostSystemPromptService
  skills?: HostSkillsService
}

/**
 * 从宿主上下文里取工具注册表。
 *
 * 上下文是一个代理，读未声明的服务会抛，所以按名字取、取不到时给 `undefined`（D1、D11）。
 *
 * @param context - 宿主的上下文。
 * @returns 工具注册表，或 `undefined`。
 */
export function toolsOf(context: unknown): HostToolsService | undefined {
  return serviceOf<HostToolsService>(context, 'tools')
}

/**
 * 从宿主上下文里取系统提示服务。
 *
 * @param context - 宿主的上下文。
 * @returns 系统提示服务，或 `undefined`。
 */
export function systemPromptOf(context: unknown): HostSystemPromptService | undefined {
  return serviceOf<HostSystemPromptService>(context, 'systemPrompt')
}

/**
 * 从宿主上下文里取 skill 注册表。
 *
 * @param context - 宿主的上下文。
 * @returns skill 注册表，或 `undefined`。
 */
export function skillsOf(context: unknown): HostSkillsService | undefined {
  return serviceOf<HostSkillsService>(context, 'skills')
}

/** 按名字读一项宿主服务；没有这一项或它还没有出现时给 `undefined`。 */
function serviceOf<T>(context: unknown, name: string): T | undefined {
  if (typeof context !== 'object' || context === null) return undefined
  try {
    const value = (context as Record<string, unknown>)[name]
    return typeof value === 'object' && value !== null ? value as T : undefined
  } catch {
    // 读未声明的服务会抛：按没有这一项算，插件照常起来（D11）。
    return undefined
  }
}

/** `widget_catalog` 里一个组件的说明。 */
export interface CatalogEntry {
  id: string
  title: { zh: string, en: string }
  description?: { zh: string, en: string }
  version: string
  sizes: WidgetFamily[]
  source: WidgetSource
  provider?: string
  /** 当前版本的内容哈希；不可用时没有。 */
  hash?: string
  /** 读不出来或没有可用的版本时写原因。 */
  error?: string
  /** 组件声明的数据源。 */
  source_id?: string
  actions?: string[]
  /** props 的 JSON Schema。 */
  props?: Record<string, unknown>
  /** 设置弹窗要显示的凭据声明（D22）。 */
  credentials?: WidgetCredential[]
  /** 组件声明的宿主能力与它们的接口（D24）；没装提供方时 `error` 写明原因。 */
  capabilities?: CatalogCapability[]
  /** data 的 JSON Schema。 */
  data?: Record<string, unknown>
  /** 看板上的最小盒子与默认盒子。 */
  minBox?: { w: number, h: number }
  defaultBox?: { w: number, h: number }
}

/** 一个宿主能力在组件目录里的说明（D24）。 */
export interface CatalogCapability {
  id: string
  provider?: string
  title?: { zh: string, en: string }
  description?: { zh: string, en: string }
  permission?: ActionPermission
  input?: Record<string, unknown>
  output?: Record<string, unknown>
  /** 提供方不在或读不出来时的原因。 */
  error?: string
}

/** `widget_catalog` 的返回值。 */
export interface CatalogValue {
  widgets: CatalogEntry[]
  /** 读不出来的目录与原因。 */
  errors: { source: WidgetSource, provider?: string, dir: string, message: string }[]
}

/** 看板上的一张卡。 */
export interface BoardCardValue {
  id: string
  widget: string
  title: { zh: string, en: string }
  /** 组件不在组件库里时写原因。 */
  error?: string
  hash: string
  source?: string
  props: Record<string, unknown>
  data: unknown
  state: unknown
  layout: { x: number, y: number, w: number, h: number }
}

/** 工作区里的一块看板，给工具选目标用。 */
export interface BoardSummaryValue {
  id: string
  title: string
  /** 是不是当前选中的那一块。 */
  active: boolean
  /** 卡片总数。 */
  cards: number
}

/** `widget_board` 的返回值。 */
export interface BoardValue {
  /** 工作区里的全部看板，按标签次序；后续调用按 `id` 点名。 */
  boards: BoardSummaryValue[]
  /** 这次读的是哪一块。 */
  board: string
  title: string
  revision: number
  layoutRevision: number
  cards: BoardCardValue[]
}

/** `widget_place` 的返回值。 */
export interface PlaceValue {
  id: string
  widget: string
  layout: { x: number, y: number, w: number, h: number }
  /** 换了组件、或参数被宿主改过时写原因。 */
  notes?: string[]
}

/**
 * `widget_show` 的返回值：内联视图按这一份快照画一张组件（D9）。
 *
 * 看板上的卡片用它的 id，内联视图与看板上的那一张写同一份状态；一次性快照的 id 由宿主起，
 * 它不在任何看板上，写状态与发动作都会被宿主拒绝，视图只把状态留在本地。
 */
export interface ShowValue {
  /** 卡片 id。 */
  id: string
  widget: string
  /** 要渲染的那一份组件版本（D7）；看板上的卡用卡片钉住的那一份。 */
  hash: string
  source?: string
  props: Record<string, unknown>
  data: unknown
  state: unknown
  /** 内联盒子的尺寸族（D16）：组件在 manifest 声明过的族里换排版。 */
  family: WidgetFamily
  /** 组件元信息，与工作区快照里的同一份（D5）。 */
  summary: WidgetSummary
  /** 卡片在看板上的位置；一次性快照没有这一项。 */
  board?: { id: string, title: string }
}

/** `widget_define` 写下的一个组件。 */
export interface DefineValue {
  id: string
  /** 组件目录的绝对路径。 */
  dir: string
  hash: string
  /** 覆盖了已有的同名组件时为真。 */
  replaced: boolean
  /** 校验留下的说明：写下的文件、被改过的字段。 */
  notes: string[]
}

/** 一次工具调用失败的原因：抛出去，宿主把它收敛成 `isError`。 */
export class ToolRefusal extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolRefusal'
  }
}
