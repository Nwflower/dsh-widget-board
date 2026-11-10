/**
 * 创建卡片的模板（C01、C02）：每个模板是一种组件、一份预填的内容与一句说明。
 *
 * 模板只是组件的预设，不新建组件类型：选中之后仍然是那种组件的普通实例，表单按同样的 schema 画。
 * 校园与图片两个模板要等媒体与校园组件可用之后才出现（T05、T06），不在这里放点了没有用的入口。
 */
import type { LocalizedText } from '@dsh-widget-board/contracts'
import { DEFAULT_CAMPUS_PROPS, EMPTY_CAMPUS_STATE } from '@dsh-widget-board/model/campus/model'

/** 模板的键；顺序就是界面上的顺序（C02）。 */
export const TEMPLATE_KEYS = ['text', 'todo', 'links', 'countdown', 'image', 'campus', 'advanced'] as const

/** 一个模板。 */
export type TemplateKey = (typeof TEMPLATE_KEYS)[number]

/** 一份预填的内容：props、data 与 state 都按组件的 schema 写。 */
export interface TemplateSeed {
  props: Record<string, unknown>
  data: unknown
  state: unknown
}

/** 一个模板的定义。 */
export interface Template {
  key: TemplateKey
  /** 用哪种组件；`advanced` 由人在创建界面里再挑一个。 */
  widget: string
  title: LocalizedText
  hint: LocalizedText
  seed: TemplateSeed
  /**
   * 模板要展开的那几节，按次序。
   *
   * 组件把内容分散在 props、data 与 state 三处；一个模板只展开它真正用到的那几节，别让「初始状态」
   * 这种实现细节站到正文前面（C03、C04）。
   */
  sections: readonly ('props' | 'data' | 'state')[]
}

/** 一份空内容：模板没有预填时用它。 */
const EMPTY: TemplateSeed = { props: {}, data: null, state: null }

/**
 * 全部模板。
 *
 * 文本笔记优先复用 markdown（C02）：它的 data.markdown 就是正文，标题走 props.title。待办与链接的
 * 表单分别落在 todo 的 state.items 与 links 的 data.items 上，形状与组件脚本读的一致。
 */
export const TEMPLATES: readonly Template[] = [
  {
    key: 'text',
    widget: 'markdown',
    title: { zh: '文本笔记', en: 'Text note' },
    hint: { zh: '一段 Markdown 正文', en: 'A body of Markdown' },
    seed: { props: { title: '' }, data: { markdown: '' }, state: null },
    sections: ['props', 'data'],
  },
  {
    key: 'todo',
    widget: 'todo',
    title: { zh: '待办清单', en: 'To-do list' },
    hint: { zh: '几条待办，可勾选、可排序', en: 'A few to-dos to tick and reorder' },
    seed: { props: {}, data: null, state: { items: [] } },
    sections: ['state'],
  },
  {
    key: 'links',
    widget: 'links',
    title: { zh: '常用链接', en: 'Bookmarks' },
    hint: { zh: '一组 http(s) 地址与说明', en: 'A set of http(s) links with notes' },
    seed: { props: {}, data: { items: [] }, state: null },
    sections: ['data'],
  },
  {
    key: 'countdown',
    widget: 'countdown',
    title: { zh: '日期倒计时', en: 'Countdown' },
    hint: { zh: '离某个日期还有多久', en: 'How long until a date' },
    seed: { props: {}, data: null, state: null },
    sections: ['props'],
  },
  {
    key: 'image',
    widget: 'image',
    title: { zh: '图片', en: 'Image' },
    hint: { zh: '本地图片、说明与焦点位置', en: 'Local image, caption and focal point' },
    seed: { props: { focusX: 50, focusY: 50 }, data: { alt: '', caption: '' }, state: null },
    sections: ['props', 'data'],
  },
  {
    key: 'campus', widget: 'campus', title: { zh: '校园事务', en: 'Campus planner' },
    hint: { zh: '个人事项、阶段里程碑与学校入口', en: 'Personal deadlines, milestones and school links' },
    seed: { props: { ...DEFAULT_CAMPUS_PROPS }, data: null, state: EMPTY_CAMPUS_STATE }, sections: ['props', 'state'],
  },
  {
    key: 'advanced',
    widget: '',
    title: { zh: '高级组件', en: 'Any widget' },
    hint: { zh: '从组件库里挑一个，按它的声明填', en: 'Pick a widget and fill in what it declares' },
    seed: EMPTY,
    sections: ['props', 'data', 'state'],
  },
]

/**
 * 按组件找模板：预览与表单要知道这份内容属于哪个模板。
 *
 * @param widget - 组件 id。
 * @returns 对应的模板；没有时是 `undefined`（高级模板按任何组件走）。
 */
export function templateOf(widget: string): Template | undefined {
  return TEMPLATES.find((template) => template.widget !== '' && template.widget === widget)
}

/**
 * 一个模板的预填内容。
 *
 * 值都是新造的对象：两个创建器同时打开时，改一份不会改到另一份。
 *
 * @param template - 模板。
 * @returns 预填的 props、data 与 state。
 */
export function seedOf(template: Template): TemplateSeed {
  return {
    props: JSON.parse(JSON.stringify(template.seed.props)) as Record<string, unknown>,
    data: template.seed.data === null ? null : JSON.parse(JSON.stringify(template.seed.data)) as unknown,
    state: template.seed.state === null ? null : JSON.parse(JSON.stringify(template.seed.state)) as unknown,
  }
}
