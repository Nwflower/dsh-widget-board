/**
 * 组件 manifest 的形状与它的 JSON Schema（D7）。
 *
 * 内置组件、用户组件、agent 生成的组件与导入的组件共用这一份：宿主读 `widget.json`，用 Ajv 按
 * 下面的 schema 校验，不合格的不进组件库，错误原样回给作者。`sizes` 里的族名与 `model` 的尺寸族
 * 表同源（D4）。
 */

/** 组件可以声明的尺寸族：网格族、位置族（D4）。 */
export const WIDGET_FAMILIES = ['s', 'm', 'l', 'wide', 'xl', 'hero', 'expanded', 'inline', 'rail'] as const

/** 一个尺寸族。 */
export type WidgetFamily = (typeof WIDGET_FAMILIES)[number]

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
  actions?: WidgetAction[]
  permissions?: WidgetPermissions
  libs?: string[]
  text?: Record<string, LocalizedText>
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
