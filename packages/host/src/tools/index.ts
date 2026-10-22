/**
 * 面向会话的工具（D9）：注册、撤销与它们的共同上下文。
 *
 * 工具只在宿主有 `tools` 服务时注册——会话里没有工具注册表就没有「暴露给会话」这回事，看板本身照常
 * 工作（D11）。注册与撤销都归这一行的 `ctx.effect`，插件卸载时一并收掉。
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

/**
 * 注册全部工具、系统提示段与 skill。
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
  const inject = (ctx as unknown as { inject?: (deps: string[], callback: (scoped: Context) => void) => unknown }).inject
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
    for (const tool of toolRegistrations(context)) {
      names.push(tool.name)
      hold(tools.register(tool))
    }
    onRegistered?.(names)
    // 系统提示段与 skill 各自等自己的服务：没有它们时工具照常可用（D9）。
    const injectOne = (scoped as unknown as { inject?: (deps: string[], callback: (inner: Context) => void) => unknown }).inject
    if (typeof injectOne === 'function') {
      injectOne.call(scoped, ['systemPrompt'], (inner: Context) => {
        const prompt = systemPromptOf(inner)
        if (prompt !== undefined) hold(prompt.section({ name: WIDGET_PROMPT_SECTION, order: 60, text: PROMPT_SECTION }))
      })
      injectOne.call(scoped, ['skills'], (inner: Context) => {
        const skills = skillsOf(inner)
        if (skills !== undefined) hold(skills.register(SKILL))
      })
    }
  })
  return {
    names,
    dispose() {
      disposed = true
      for (const dispose of disposers.reverse()) dispose()
      disposers.length = 0
    },
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
    save,
    reload,
    dataError,
    propsError,
    readSource: async (id, instance) => await route.sources.readSource(id, instance),
  }
}

/** 注册给模型看的那一段系统提示。 */
const PROMPT_SECTION = [
  '这个部署装着一个组件看板：一页可以拖动、缩放的卡片，每张卡片是一个沙箱里的小组件。',
  `要写一个新组件、或把看板上的卡片改一改时，先加载 \`${WIDGET_SKILL_NAME}\` 这条 skill，再用 ${WIDGET_TOOL_NAMES.catalog} 看现有的组件、用 ${WIDGET_TOOL_NAMES.define} 写新的、用 ${WIDGET_TOOL_NAMES.place} 放到看板上。想让读者当场看到组件，用 ${WIDGET_TOOL_NAMES.show} 把它内联显示在回答里。`,
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
  return toolSpecs(context).map((spec) => ({
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
  }))
}

/**
 * 全部工具的自身定义。
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
