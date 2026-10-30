/**
 * 面向会话的工具（D9）：注册、按点名再注册，以及它们的共同上下文。
 *
 * 工具只在宿主有 `tools` 服务时注册——会话里没有工具注册表就没有「暴露给会话」这回事，看板本身照常
 * 工作（D11）。注册与撤销都归这一行的 `ctx.effect`，插件卸载时一并收掉。看板的存在与使用边界写在
 * 虚拟 skill 的描述里，不另注入系统提示段。
 *
 * 七个工具在启动时一次注册完，不按点名增删。工具表在会话中途变化会让宿主那条线路的前缀缓存
 * 整段失效——一次就是几十万 token 的重算——所以"点名之后才出现"这个机制被去掉：代价是每轮多带
 * 六份 schema，而它们命中缓存后几乎免费。
 *
 * 工具读的是路由上下文这一份**活的**引用：组件库与看板随热重载、写入被替换，工具跟着看新的那一份。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Board, BoardEvent, InstanceFace, WidgetToolRegistration, WidgetToolSpec } from '@dsh-widget-board/contracts'
import {
  WIDGET_SKILL_NAME,
  WIDGET_TOOL_NAMES,
  skillsOf,
  toolsOf,
} from '@dsh-widget-board/contracts'
import type { RouteContext } from '../routes'
import { dataError, propsError } from '../schema'
import { WIDGET_AUTHORING_GUIDE } from './guide'
import { boardTool, catalogTool } from './read'
import { placeTool, pushTool, removeTool } from './write'
import { defineTool } from './define'
import { showTool } from './show'

/** 一次工具调用要动的东西：都在宿主这一侧，工具只经这里读写。 */
export interface ToolContext {
  /** 路由上下文：组件库、看板、写入链与数据源注册表都在它上面（D5）。 */
  route: RouteContext
  /**
   * `widget_catalog` 点名过的工具（D9）。
   *
   * 只用于记账：七个工具在启动时已经全部注册，点名不改变工具表。
   */
  enabled: Set<string>
  /**
   * `expose` 点名时的记账入口（D9）。
   *
   * 七个工具在启动时已经全部注册，这里不会改变工具表；单元测试只测点名本身，不填这个函数。
   */
  reveal?: (names: readonly string[]) => void
  /**
   * 改一次看板：与界面走同一条写入链。
   *
   * @param change - 从当前看板算出新看板。
   * @param options - 要不要动布局修订号、推哪条事件。
   * @returns 写入之后的看板。
   */
  save: (change: (current: Board) => Board, options: { layoutChanged?: boolean, event: (next: Board) => BoardEvent }) => Promise<Board>
  /** 重读组件库（D17）：写完一个组件之后调用。 */
  reload: () => Promise<void>
  /** 组件声明的 data schema 校验（D6）。 */
  dataError: (schema: Record<string, unknown> | undefined, data: unknown) => string | undefined
  /** 组件声明的 props schema 校验（D27）。 */
  propsError: (schema: Record<string, unknown> | undefined, props: unknown) => string | undefined
  /** 组件的默认数据源读一次（D17）。 */
  readSource: (id: string, instance: InstanceFace) => Promise<unknown>
}

/** 这一轮注册的工具与它们的撤销函数。 */
export interface ToolRegistration {
  /** 已经注册的工具名。 */
  readonly names: readonly string[]
  /** 全部撤下。 */
  dispose(): void
}

/** 宿主上下文里以名取的那几项。 */
interface HostContextAccess {
  inject?: (deps: string[], callback: (scoped: Context) => void) => unknown
}

/**
 * 注册工具与 skill（D9）。
 *
 * 七个工具在启动时一次注册；`widget_catalog` 点名的 `expose` 只记账，不再改变工具表。
 *
 * 两项服务都按可选依赖挂上去：cordis 只允许读声明过的服务，直接读未声明的属性会抛，所以这里用
 * `ctx.inject` 等它们出现；它们不出现时看板照常工作，只是会话里看不到这几个工具（D1、D11）。
 * 看板的存在与使用边界只写在 skill 的描述与正文里，不注入额外的系统提示段。
 *
 * @param ctx - 宿主的上下文。
 * @param context - 工具要动的那些东西。
 * @param onRegistered - 注册完成时报告注册了哪些工具；宿主拿它写一行日志。
 * @returns 注册结果；宿主连 `ctx.inject` 都没有时给 `undefined`。
 */
export function registerTools(ctx: Context, context: ToolContext, onRegistered?: (names: string[]) => void): ToolRegistration | undefined {
  const inject = (ctx as unknown as HostContextAccess).inject
  if (typeof inject !== 'function') return undefined
  const disposers: (() => void)[] = []
  const names: string[] = []
  let disposed = false
  /** 挂一项副作用；已经撤下时立刻撤掉它。 */
  const hold = (dispose: () => void): void => {
    if (disposed) dispose()
    else disposers.push(dispose)
  }
  inject.call(ctx, ['tools'], (scoped: Context) => {
    const tools = toolsOf(scoped)
    if (tools === undefined) return
    const register = (spec: WidgetToolSpec): void => {
      if (names.includes(spec.name)) return
      names.push(spec.name)
      hold(tools.register(toRegistration(spec)))
      onRegistered?.([...names])
    }
    const specs = toolSpecs(context)
    // 一次全部挂上，会话中途不再增删：每次增删都会让前缀缓存整体作废
    // （Kimi 那一类自动前缀缓存按内容匹配，工具表一变，前面的历史全部重算）。
    for (const spec of specs) register(spec)
    context.reveal = (wanted) => {
      for (const spec of specs) if (wanted.includes(spec.name)) register(spec)
    }
    const injectOne = (scoped as unknown as HostContextAccess).inject
    if (typeof injectOne !== 'function') return
    injectOne.call(scoped, ['skills'], (inner: Context) => {
      const skills = skillsOf(inner)
      if (skills !== undefined) hold(skills.register(SKILL))
    })
  })
  return {
    names,
    dispose() {
      disposed = true
      for (const dispose of disposers.reverse()) dispose()
      disposers.length = 0
      context.reveal = undefined
    },
  }
}

/**
 * 把一份工具定义套成宿主注册表读的形状。
 *
 * @param spec - 工具自己的定义。
 * @returns 注册项。
 */
function toRegistration(spec: WidgetToolSpec): WidgetToolRegistration {
  return {
    name: spec.name,
    description: spec.description,
    parameters: spec.parameters,
    output: {
      schema: {},
      render: (_args, value) => spec.render(value),
      // 带视图的工具把返回值投影成客户端要的载荷；宿主把它存进这次结果的 meta（D9）。
      ...(spec.view === undefined ? {} : { presentationMeta: (_args: unknown, value: unknown) => spec.view?.(value) }),
    },
    execute: async (args, exec) => await spec.execute(args, { callId: exec.callId, signal: exec.signal }),
  }
}

/**
 * 建一份工具上下文。
 *
 * @param route - 路由上下文（活的引用）。
 * @param save - 与界面同一条写入链。
 * @param reload - 重读组件库。
 * @returns 工具上下文。
 */
export function createToolContext(
  route: RouteContext,
  save: ToolContext['save'],
  reload: () => Promise<void>,
): ToolContext {
  return {
    route,
    enabled: new Set([WIDGET_TOOL_NAMES.catalog]),
    save,
    reload,
    dataError,
    propsError,
    readSource: async (id, instance) => await route.sources.readSource(id, instance),
  }
}

/**
 * 注册给模型看的那一条 skill。
 *
 * 看板的存在、什么时候该碰它、以及看板归用户所有这几件事都写在 `description` 里：技能目录在每个会话
 * 都可见，模型按它决定要不要加载；正文在加载之后才读。
 */
const SKILL = {
  name: WIDGET_SKILL_NAME,
  description: '用户点名看板、卡片、组件，或要改的卡片已经在看板上时，写一个看板组件或改看板上的卡片：组件的目录格式、可以声明什么、怎么放上看板。看板归用户所有；未经请求不新增、删除、重排卡片，不改既有卡片的 props 或数据源、不向它推数据；改既有卡片前先 widget_board 读回，改完再读回确认。请求缺宾语时先查最便宜的状态证据（工作目录是否落后或脏、板上是否真有那张卡），要澄清时至少给一个不涉及看板的选项。',
  content: WIDGET_AUTHORING_GUIDE,
  invocation: { modelInvocable: true, userInvocable: true },
  source: 'runtime',
  provider: 'dsh-widget-board',
}

/**
 * 拼出全部工具，并套成宿主注册表读的形状。
 *
 * @param context - 工具要动的那些东西。
 * @returns 工具的注册项。
 */
export function toolRegistrations(context: ToolContext): WidgetToolRegistration[] {
  return toolSpecs(context).map(toRegistration)
}

/**
 * 全部工具的自身定义。
 *
 * 第一个是入口工具，始终出现在模型面前；其余六个要经它点名才出现（D9）。
 *
 * @param context - 工具要动的那些东西。
 * @returns 工具的定义。
 */
export function toolSpecs(context: ToolContext): WidgetToolSpec[] {
  return [
    catalogTool(context),
    defineTool(context),
    showTool(context),
    boardTool(context),
    placeTool(context),
    removeTool(context),
    pushTool(context),
  ]
}

/** 要经入口工具点名才出现的那些工具（D9）：七个里的后六个，按工具表里 `expose` 的次序。 */
export const OPTIONAL_TOOLS: readonly string[] = [
  WIDGET_TOOL_NAMES.define,
  WIDGET_TOOL_NAMES.place,
  WIDGET_TOOL_NAMES.remove,
  WIDGET_TOOL_NAMES.push,
  WIDGET_TOOL_NAMES.show,
  WIDGET_TOOL_NAMES.board,
]
