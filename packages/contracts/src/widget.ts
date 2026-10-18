/**
 * 组件 manifest 的形状与它的 JSON Schema（D7）。
 *
 * 内置组件、用户组件、agent 生成的组件、导入的组件与插件提供的组件共用这一份：宿主读
 * `widget.json`，用 Ajv 按下面的 schema 校验，不合格的不进组件库，错误原样回给作者（D17）。
 */

/** 组件可以声明的尺寸族：网格族、位置族（D16）。 */
export const WIDGET_FAMILIES = ['s', 'm', 'l', 'wide', 'xl', 'hero', 'expanded', 'inline', 'rail'] as const

/** 一个尺寸族。 */
export type WidgetFamily = (typeof WIDGET_FAMILIES)[number]

/** 看板给组件的宽度档：窄列、常规、宽卡。 */
export const WIDGET_BOX_WIDTHS = ['narrow', 'regular', 'wide'] as const

/** 一个宽度档。 */
export type WidgetBoxWidth = (typeof WIDGET_BOX_WIDTHS)[number]

/** 看板给组件的高度档：矮、常规、高。 */
export const WIDGET_BOX_HEIGHTS = ['short', 'regular', 'tall'] as const

/** 一个高度档。 */
export type WidgetBoxHeight = (typeof WIDGET_BOX_HEIGHTS)[number]

/** 组件拿到的盒子档位：两个方向各自判定，组件按组合取舍内容。 */
export interface WidgetBoxClasses {
  width: WidgetBoxWidth
  height: WidgetBoxHeight
}

/** 宽度档的边界：小于它是窄列，大于等于宽卡边界是宽卡。 */
export const BOX_WIDTH_NARROW = 320

/** 宽卡的宽度边界。 */
export const BOX_WIDTH_WIDE = 600

/** 矮盒子的高度边界。 */
export const BOX_HEIGHT_SHORT = 260

/** 高盒子的高度边界。 */
export const BOX_HEIGHT_TALL = 360

/**
 * 按像素盒给出宽度与高度档位（D16）。
 *
 * 两个方向分开判定：一张两列宽、14rem 高的卡片是 `wide/short`，组件可以只加宽、不加高。
 *
 * @param width - 内容盒的像素宽度。
 * @param height - 内容盒的像素高度。
 * @returns 两个方向的档位。
 */
export function boxClassesOf(width: number, height: number): WidgetBoxClasses {
  return {
    width: width < BOX_WIDTH_NARROW ? 'narrow' : width >= BOX_WIDTH_WIDE ? 'wide' : 'regular',
    height: height < BOX_HEIGHT_SHORT ? 'short' : height >= BOX_HEIGHT_TALL ? 'tall' : 'regular',
  }
}

/** 组件库的一个来源：包内、用户目录、插件注册（D17）。 */
export const WIDGET_SOURCES = ['builtin', 'user', 'plugin'] as const

/** 一个来源。 */
export type WidgetSource = (typeof WIDGET_SOURCES)[number]

/** 一段双语文案。 */
export interface LocalizedText {
  zh: string
  en: string
}

/**
 * manifest 里声明的动作：组件按下时发出的名字（D6）。
 *
 * `id` 是看板自己的动作名，或者 `提供方:名字` 点名某个插件注册的动作。声明过的动作还要有人给出
 * 授权才能真的跑起来；这一点不由 manifest 决定（D6）。
 */
export interface WidgetAction {
  id: string
  label?: LocalizedText
}

/**
 * 组件声明的权限（D6）：没有声明的动作、主机与命令一律拒绝。
 *
 * 这是组件作者写下来的意图，界面上用它把授权说清楚；真正拦人的是宿主上的授权表。
 */
export interface WidgetPermissions {
  hosts?: string[]
  commands?: string[]
}

/** 刷新策略：按需，或按一个固定的间隔（D6）。 */
export const WIDGET_REFRESH_MODES = ['onDemand', 'interval'] as const

/** 一种刷新策略。 */
export type WidgetRefreshMode = (typeof WIDGET_REFRESH_MODES)[number]

/**
 * 组件声明的刷新策略（D6）。
 *
 * `onDemand`（省略时就是它）表示只有人按下刷新、或数据源被显式读一次时才读；`interval` 表示看板
 * 有人看着的时候按 `everyMs` 定时读。没有观众的实例一律不读——宿主上不该有没人看的轮询（D5）。
 */
export interface WidgetRefresh {
  mode: WidgetRefreshMode
  /** `interval` 时的间隔毫秒数；低于下限时按下限算。 */
  everyMs?: number
}

/** 定时刷新允许的最短间隔：再密就是拿组件自己的频率换宿主的读写。 */
export const REFRESH_MIN_MS = 1000

/** 省略 `everyMs` 时的间隔。 */
export const REFRESH_DEFAULT_MS = 30_000

/**
 * 看板上这张卡最小能缩到多大：跨列数与根字号的倍数（D16）。
 *
 * 缺省时按看板的通用下限。声明它让组件在缩到很小的时候仍然排得下自己的内容。
 */
export interface WidgetMinBox {
  w: number
  h: number
}

/** 一个组件的 `widget.json`。 */
export interface WidgetManifest {
  id: string
  title: LocalizedText
  description?: LocalizedText
  author?: string
  version: string
  sizes: WidgetFamily[]
  /** props 与 data 的 JSON Schema；数据源按它校验推给组件的数据（D6）。 */
  props?: Record<string, unknown>
  data?: Record<string, unknown>
  /**
   * 这个组件的默认数据源（D17）：加卡片时用它读第一次数据。
   *
   * 数据源不在时卡片照样加得进来，数据留空——提供方可能只是还没装好。
   */
  source?: string
  actions?: WidgetAction[]
  permissions?: WidgetPermissions
  /** 刷新策略（D6）；省略时按需。 */
  refresh?: WidgetRefresh
  libs?: string[]
  text?: Record<string, LocalizedText>
  /** 看板上的最小盒子（D16）。 */
  minBox?: WidgetMinBox
  /** 加卡片时的默认盒子；省略时是一列宽、22rem 高（D16）。 */
  defaultBox?: WidgetMinBox
}

/**
 * 组件库里的一个来源目录。
 *
 * `provider` 是插件来源的包名；内置与用户来源没有它。
 */
export interface WidgetRoot {
  dir: string
  source: WidgetSource
  provider?: string
}

/**
 * 组件库里的一个组件类型，浏览器半边据此画添加面板与不可用的卡片。
 *
 * `error` 有值时这个类型不可用：添加面板把它列在最后并说明原因，已有的卡片照着同一个原因显示
 * 占位（D17）。
 */
export interface WidgetLibraryEntry {
  id: string
  source: WidgetSource
  provider?: string
  title: LocalizedText
  description?: LocalizedText
  sizes: WidgetFamily[]
  /** 当前版本的哈希；类型不合格时没有。 */
  hash?: string
  error?: string
}

/**
 * 一个读不出来的组件目录或一次失败的注册。
 *
 * `id` 在 manifest 都已经读不出时为空，这时用 `dir` 指出是哪一个目录。
 */
export interface WidgetLibraryError {
  source: WidgetSource
  provider?: string
  dir: string
  id?: string
  message: string
}

/** 校验 manifest 用的 JSON Schema；与 `WidgetManifest` 一一对应。 */
export const WIDGET_MANIFEST_SCHEMA = {
  $id: 'https://dsh-widget-board/widget.json',
  type: 'object',
  additionalProperties: false,
  required: ['id', 'title', 'version', 'sizes'],
  properties: {
    id: { type: 'string', pattern: '^[a-z][a-z0-9-]{1,39}$' },
    title: { $ref: '#/$defs/text' },
    description: { $ref: '#/$defs/text' },
    author: { type: 'string', minLength: 1, maxLength: 80 },
    version: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?$' },
    sizes: { type: 'array', minItems: 1, uniqueItems: true, items: { enum: WIDGET_FAMILIES } },
    props: { type: 'object' },
    data: { type: 'object' },
    source: { type: 'string', pattern: '^[a-z][a-z0-9.-]{1,63}$' },
    actions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id'],
        properties: {
          id: { type: 'string', pattern: '^[a-z][a-z0-9.-]{1,39}(?::[a-z][a-z0-9.-]{1,39})?$' },
          label: { $ref: '#/$defs/text' },
        },
      },
    },
    permissions: {
      type: 'object',
      additionalProperties: false,
      properties: {
        hosts: { type: 'array', items: { type: 'string', minLength: 1 } },
        commands: { type: 'array', items: { type: 'string', minLength: 1 } },
      },
    },
    refresh: {
      type: 'object',
      additionalProperties: false,
      required: ['mode'],
      properties: {
        mode: { enum: WIDGET_REFRESH_MODES },
        everyMs: { type: 'integer', minimum: REFRESH_MIN_MS },
      },
    },
    libs: { type: 'array', items: { type: 'string', minLength: 1 } },
    text: { type: 'object', additionalProperties: { $ref: '#/$defs/text' } },
    minBox: { $ref: '#/$defs/box' },
    defaultBox: { $ref: '#/$defs/box' },
  },
  $defs: {
    text: {
      type: 'object',
      additionalProperties: false,
      required: ['zh', 'en'],
      properties: {
        zh: { type: 'string', minLength: 1 },
        en: { type: 'string', minLength: 1 },
      },
    },
    box: {
      type: 'object',
      additionalProperties: false,
      required: ['w', 'h'],
      properties: {
        w: { type: 'integer', minimum: 1, maximum: 4 },
        h: { type: 'number', minimum: 1, maximum: 200 },
      },
    },
  },
} as const
