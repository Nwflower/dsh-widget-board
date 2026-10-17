/**
 * 宿主插槽的契约（D1）：名字、注册选项与服务的形状只在这里写一次。
 *
 * 出处是 `dsh-client-ui-sidebar` 与 `dsh-client-ui-layout` 的 `client/contract` 类型声明，
 * 以及在真实宿主上注册成功的任务看板（`packages/dsh-task-board/src/client/native-panel.tsx`）。
 * 这些包不是本仓库的依赖，所以形状在这里记一次，浏览器半边只从这里读；真实宿主上的注册由
 * `packages/testing/smoke.cjs` 验证。
 */

/** 侧栏的全局面板行：外壳画按钮、标签、高亮与收起后的图标栏，插件只画图标。 */
export const SIDEBAR_PANELLIST_SLOT = 'sidebar.panellist'

/** 中栏页面：只在该面板被选中时挂载。 */
export const MAIN_SLOT = 'main'

/**
 * 设置页里的一节（D21）。
 *
 * 这一节由设置外壳声明，只在侧栏的「设置」那一行挂载期间存在，所以注册要经 `inject` 等它出现。
 * 一次只挂载导航选中的那一节，组件收到的 `close` 用来关掉设置面板。
 */
export const SETTINGS_SECTION_SLOT = 'settings.section'

/** 设置页里一节的注册选项。 */
export interface SettingsSectionRegistration {
  name: typeof SETTINGS_SECTION_SLOT
  /** 这一节的 id，同时是导航里选中的那一项。 */
  id: string
  order?: number
  label?: SlotLabel
}

/** 标签可以是函数：外壳每次读它都重新调用，语言切换因此不需要重新注册。 */
export type SlotLabel = string | (() => string)

/** 面板行的注册选项。图标组件收到 `{ size, active }`，只画图形。 */
export interface PanelRowRegistration {
  name: typeof SIDEBAR_PANELLIST_SLOT
  id: string
  order?: number
  label?: SlotLabel
}

/** 中栏页面的注册选项。 */
export interface PanelPageRegistration {
  name: typeof MAIN_SLOT
  key: string
}

/** 设置页里一节收到的宿主能力：关掉设置面板。 */
export interface SettingsSectionProps {
  close: () => void
}

/**
 * 插槽服务（`ctx.slots`）。
 *
 * `inject` 的回调只在宿主声明过那个插槽之后运行，加载顺序因此不影响注册；宿主没有那个插槽时
 * 回调不运行，插件就不出现，而不是把整个界面挂掉。回调返回的释放函数随插件卸载。
 */
export interface SlotsService {
  inject(slot: string, callback: () => () => void): () => void
  register(options: PanelRowRegistration, component: unknown): () => void
  register(options: PanelPageRegistration, component: unknown): () => void
  register(options: SettingsSectionRegistration, component: unknown): () => void
}

/**
 * 从宿主上下文取出插槽注册表。
 *
 * 浏览器半边在插件上声明了 `inject: ['slots']`，cordis 因此只在这项服务出现之后才调用 `apply`；
 * 服务缺席时插件停在 pending，宿主启动时的检查报出它在等哪一项（D11）。所以这里直接读。
 *
 * @param context - 宿主交给插件 `apply` 的上下文。
 * @returns 插槽注册表。
 */
export function slotsOf(context: unknown): SlotsService {
  return (context as { slots: SlotsService }).slots
}
