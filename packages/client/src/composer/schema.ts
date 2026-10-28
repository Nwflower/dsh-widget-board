/**
 * schema 到控件的映射（C03、C04、D27）：把一份 JSON Schema 读成一棵控件树。
 *
 * 树里不带路径与文案：同一个字段嵌在哪一层，路径就由渲染那一层拼出来，名字与说明也按拼好的路径去
 * manifest 的 `text` 里取。以 object 与 array 为递归边界，最多展开四层；更深的写法、`$ref`、联合
 * schema 之类不展开的写法给一个显式的 JSON 编辑入口与原因（C03、C04）。
 */
import type { LocalizedText } from '@dsh-widget-board/contracts'
import { isChinese } from '../copy'

/** 递归展开的层数上限；再深的写法只给 JSON 编辑（C03）。 */
export const SCHEMA_DEPTH = 4

/** 一个普通对象。 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** schema 树里的一种取值。 */
export type SchemaNode =
  | {
    kind: 'string'
    multiline: boolean
    maxLength?: number
    /** `date`、`time`、`url` 各出一只对应的输入框（C03）；其它字符串用文本框。 */
    format?: 'date' | 'time' | 'url'
  }
  | { kind: 'number', min?: number, max?: number, integer: boolean }
  | { kind: 'boolean' }
  | { kind: 'enum', values: string[] }
  | { kind: 'object', children: SchemaField[], additional: boolean }
  | { kind: 'array', item: SchemaNode, maxItems?: number }
  | { kind: 'json', reason: string }

/** 树里的一个字段：它在对象里的键、它的控件与是否必填。 */
export interface SchemaField {
  key: string
  node: SchemaNode
  required: boolean
  defaultValue?: unknown
}

/**
 * 字段名的备用说法：camelCase 拆成词，首字母大写。
 *
 * @param key - schema 里的字段名。
 * @returns 可显示的名字。
 */
function humanizeKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/^./, (first) => first.toUpperCase())
}

/**
 * 取一个字段的名字：manifest 的 `text.<节>.<路径>.label`，再退到字段名。
 *
 * 节是 `props`、`data` 或 `state`：一张卡的这三份内容用同一种表单填，名字就按同一条约定写进
 * manifest 的 `text`（D7 的 `props.<路径>.label` 在这里统称 `<节>.<路径>.label`）。
 *
 * @param path - 字段的点分路径，例如 `title` 或 `items.0.text`。
 * @param text - 组件的双语文案。
 * @param section - 这一份是 props、data 还是 state。
 * @returns 当前语言下的名字。
 */
export function labelOf(
  path: string,
  text: Readonly<Record<string, LocalizedText>> | undefined,
  section = 'props',
): string {
  const parent = path.replace(/\.\d+(?=\.|$)/g, '')
  const candidates = [
    `${section}.${path}.label`,
    `${section}.${parent}.label`,
    `${section}.${path}`,
    `${section}.${parent}`,
    `props.${path}.label`,
  ]
  for (const key of candidates) {
    const fromText = text?.[key]
    if (fromText !== undefined) return isChinese() ? fromText.zh : fromText.en
  }
  return humanizeKey(path.slice(path.lastIndexOf('.') + 1).replace(/^\d+$/, 'item'))
}

/**
 * 取一个字段的说明：manifest 的 `text.<节>.<路径>.hint`。
 *
 * @param path - 字段的点分路径。
 * @param text - 组件的双语文案。
 * @param section - 这一份是 props、data 还是 state。
 * @returns 说明，没有时是 `undefined`。
 */
export function hintOf(
  path: string,
  text: Readonly<Record<string, LocalizedText>> | undefined,
  section = 'props',
): string | undefined {
  const parent = path.replace(/\.\d+(?=\.|$)/g, '')
  for (const key of [`${section}.${path}.hint`, `${section}.${parent}.hint`, `props.${path}.hint`]) {
    const fromText = text?.[key]
    if (fromText !== undefined) return isChinese() ? fromText.zh : fromText.en
  }
  return undefined
}

/** 不展开的写法：交给 JSON 编辑，并说明为什么没展开。 */
function jsonNode(reason: string): SchemaNode {
  return { kind: 'json', reason }
}

/**
 * 一份 schema 的控件种类。
 *
 * @param raw - `properties` 里的一项，或数组的 `items`。
 * @param depth - 当前层数；对象与数组是递归边界。
 * @returns 这一项的控件。
 */
function nodeOf(raw: unknown, depth: number): SchemaNode {
  if (!isRecord(raw)) return jsonNode('这处写法不支持表单编辑')
  if (raw.$ref !== undefined) return jsonNode('引用别的 schema，请用 JSON 编辑')
  if (raw.oneOf !== undefined || raw.anyOf !== undefined || raw.allOf !== undefined) {
    return jsonNode('联合 schema，表单不替你猜该填哪一支')
  }
  const enumValues = Array.isArray(raw.enum) && raw.enum.every((value) => typeof value === 'string')
    ? raw.enum as string[]
    : undefined
  if (enumValues !== undefined) return { kind: 'enum', values: enumValues }
  if (raw.type === 'boolean') return { kind: 'boolean' }
  if (raw.type === 'integer' || raw.type === 'number') {
    return {
      kind: 'number',
      integer: raw.type === 'integer',
      ...(typeof raw.minimum === 'number' ? { min: raw.minimum } : {}),
      ...(typeof raw.maximum === 'number' ? { max: raw.maximum } : {}),
    }
  }
  if (raw.type === 'string') {
    const maxLength = typeof raw.maxLength === 'number' ? raw.maxLength : undefined
    const format = raw.format === 'date' || raw.format === 'time'
      ? raw.format
      : raw.format === 'uri' || raw.format === 'url' ? 'url' : undefined
    return {
      kind: 'string',
      multiline: raw.format === 'textarea' || (maxLength ?? 0) > 200,
      ...(maxLength === undefined ? {} : { maxLength }),
      ...(format === undefined ? {} : { format }),
    }
  }
  if (raw.type === 'object' || isRecord(raw.properties)) {
    if (depth >= SCHEMA_DEPTH) return jsonNode(`嵌套超过 ${String(SCHEMA_DEPTH)} 层，请用 JSON 编辑`)
    return {
      kind: 'object',
      children: fieldsUnder(raw, depth + 1),
      additional: isRecord(raw.properties) ? raw.additionalProperties !== false : true,
    }
  }
  if (raw.type === 'array') {
    if (depth >= SCHEMA_DEPTH) return jsonNode(`嵌套超过 ${String(SCHEMA_DEPTH)} 层，请用 JSON 编辑`)
    return {
      kind: 'array',
      item: isRecord(raw.items) ? nodeOf(raw.items, depth + 1) : jsonNode('数组项没有声明形状'),
      ...(typeof raw.maxItems === 'number' ? { maxItems: raw.maxItems } : {}),
    }
  }
  return jsonNode('这处写法不支持表单编辑')
}

/**
 * 一个对象 schema 下面的字段，按声明的次序。
 *
 * @param schema - 对象 schema。
 * @param depth - 这一层是第几层。
 * @returns 字段表。
 */
function fieldsUnder(schema: Record<string, unknown>, depth: number): SchemaField[] {
  if (!isRecord(schema.properties)) return []
  const required = Array.isArray(schema.required)
    ? schema.required.filter((key): key is string => typeof key === 'string')
    : []
  return Object.entries(schema.properties).map(([key, raw]) => ({
    key,
    node: nodeOf(raw, depth),
    required: required.includes(key),
    ...(isRecord(raw) && raw.default !== undefined ? { defaultValue: raw.default } : {}),
  }))
}

/**
 * 一份 schema 的字段树。
 *
 * @param schema - manifest 的 props、data 或 state schema。
 * @returns 字段表；没有 properties 时是空表。
 */
export function fieldsOfTree(schema: Record<string, unknown> | undefined): SchemaField[] {
  return isRecord(schema) ? fieldsUnder(schema, 0) : []
}

/**
 * 按一层层的键取一个值；中途缺了或类型不对时返回 `undefined`。
 *
 * @param value - 整份值。
 * @param path - 键的序列。
 * @returns 取到的值。
 */
export function valueAt(value: unknown, path: readonly string[]): unknown {
  let current: unknown = value
  for (const key of path) {
    if (!isRecord(current)) return undefined
    current = current[key]
  }
  return current
}
