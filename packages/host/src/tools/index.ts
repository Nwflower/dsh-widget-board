/**
 * 面向会话的工具（D9）：注册、按点名再注册，以及它们的共同上下文。
 *
 * 工具只在宿主有 `tools` 服务时注册——会话里没有工具注册表就没有「暴露给会话」这回事，看板本身照常
 * 工作（D11）。注册与撤销都归这一行的 `ctx.effect`，插件卸载时一并收掉。
 *
 * 启动时只注册入口工具 `widget_catalog`；其余六个等它被点名之后再注册。模型看到的工具表因此默认只有
 * 一项，点名之后才变长。
 *
 * 工具读的是路由上下文这一份**活的**引用：组件库与看板随热重载、写入被替换，工具跟着看新的那一份。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Board, BoardEvent, InstanceFace, WidgetToolRegistration, WidgetToolSpec } from '@dsh-widget-board/contracts'
import {
  WIDGET_PROMPT_SECTION,
  WIDGET_SKILL_NAME,
  WIDGET_TOOL_NAMES,
  skillsOf,
  systemPromptOf,
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
   * 已经启用的工具（D9）。
   *
   * 入口工具一上来就在里面；其余六个由 `expose` 加进来。
   */
  enabled: Set<string>
  /**
   * 把点名的工具注册进宿主的注册表；注册一次之后再点名不会重复注册（D9）。
   *
   * 注册时由这一层填入；单元测试只测点名本身，不填这个函数。
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
 * 注册工具、系统提示段与 skill（D9）。
 *
 * 先只注册入口工具；`widget_catalog` 点名之后经 `context.reveal` 把其余工具补进注册表，从下一步起
 * 它们就出现在工具表里。
 *
 * 三项服务都按可选依赖挂上去：cordis 只允许读声明过的服务，直接读未声明的属性会抛，所以这里用
 * `ctx.inject` 等它们出现；它们不出现时看板照常工作，只是会话里看不到这几个工具（D1、D11）。
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
    /** 注册一个工具；已经注册过的不再注册。 */
    const register = (spec: WidgetToolSpec): void => {
      if (names.includes(spec.name)) return
      names.push(spec.name)
      hold(tools.register(toRegistration(spec)))
      onRegistered?.([...names])
    }
    const specs = toolSpecs(context)
    // 入口工具常驻；其余六个等点名（D9）。
    const entry = specs.find((spec) => spec.name === WIDGET_TOOL_NAMES.catalog)
    if (entry !== undefined) register(entry)
    context.reveal = (wanted) => {
      for (const spec of specs) if (wanted.includes(spec.name)) register(spec)
    }
    const injectOne = (scoped as unknown as HostContextAccess).inject
    if (typeof injectOne !== 'function') return
    // 系统提示段与 skill 各自等自己的服务：没有它们时工具照常可用（D9）。
    injectOne.call(scoped, ['systemPrompt'], (inner: Context) => {
      const prompt = systemPromptOf(inner)
      if (prompt !== undefined) hold(prompt.section({ name: WIDGET_PROMPT_SECTION, order: 60, text: PROMPT_SECTION }))
    })
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
 * 注册给模型看的那一段系统提示。
 *
 * 讲清先加载编写指南，以及要动看板时先点名工具：工具表默认只有入口工具（D9）。
 */
const PROMPT_SECTION = [
  '这个部署装着一个组件看板：一页可以拖动、缩放的卡片，每张卡片是一个沙箱里的小组件。',
  `要写一个新组件、或把看板上的卡片改一改时，先加载 \`${WIDGET_SKILL_NAME}\` 这条 skill，再用 ${WIDGET_TOOL_NAMES.catalog} 看现有的组件。`,
  `写组件、放卡、改卡、推数据、内联显示各有一个工具，它们要经 ${WIDGET_TOOL_NAMES.catalog} 在 \`expose\` 里点名才会出现；点名的同一次调用里还不能用它们，从下一次调用起才能用。`,
  '组件的代码在沙箱里跑，拿不到网络与 cookie；要数据就声明一个数据源，要动手就声明一个动作，两者都由宿主上的插件提供。',
].join('\n')

/** 这一行注册的虚拟 skill。 */
const SKILL = {
  name: WIDGET_SKILL_NAME,
  description: '写一个看板组件、或把看板上的卡片改一改：组件的目录格式、可以声明什么、怎么放上看板。',
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
