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

/** 组件库的一个来源：包内、用户目录、插件注册（D17）。 */
export const WIDGET_SOURCES = ['builtin', 'user', 'plugin'] as const

/** 一个来源。 */
export type WidgetSource = (typeof WIDGET_SOURCES)[number]

/** 一段双语文案。 */
export interface LocalizedText {
  zh: string
  en: string
}

/** manifest 里声明的动作：组件按下时发出的名字（D6）。 */
export interface WidgetAction {
  id: string
  label?: LocalizedText
}

/** 组件声明的权限（D6）：没有声明的动作、主机与命令一律拒绝。 */
export interface WidgetPermissions {
  hosts?: string[]
  commands?: string[]
}

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
  libs?: string[]
  text?: Record<string, LocalizedText>
  /** 看板上的最小盒子（D16）。 */
  minBox?: WidgetMinBox
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
          id: { type: 'string', pattern: '^[a-z][a-z0-9.-]{1,39}$' },
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
    libs: { type: 'array', items: { type: 'string', minLength: 1 } },
    text: { type: 'object', additionalProperties: { $ref: '#/$defs/text' } },
    minBox: {
      type: 'object',
      additionalProperties: false,
      required: ['w', 'h'],
      properties: {
        w: { type: 'integer', minimum: 1, maximum: 4 },
        h: { type: 'number', minimum: 1, maximum: 200 },
      },
    },
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
  },
} as const
