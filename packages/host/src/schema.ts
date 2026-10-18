/**
 * 组件数据的校验：组件的 manifest 可以声明 data 的 JSON Schema（D6），数据源读出来的值与推送的
 * 值都按它核对。
 *
 * 校验器按 schema 的内容缓存：同一份 schema 只编译一次。schema 来自组件作者，Ajv 用宽松模式编译，
 * 免得一条少见的写法让整个组件变成不可用。
 */
import Ajv from 'ajv'
import type { ErrorObject, ValidateFunction } from 'ajv'

const ajv = new Ajv({ allErrors: true, strict: false })
const compiled = new Map<string, ValidateFunction>()

/** 一条 schema 校验不过的字段：路径与原因（D22）。 */
export interface SchemaIssue {
  /** JSON Pointer 形状的路径，例如 `/title`；顶层是 `/`。 */
  path: string
  message: string
}

/** 一条 Ajv 错误落在哪个字段上；缺字段时指向缺的那一项。 */
function pathOf(error: ErrorObject): string {
  if (error.keyword === 'required') {
    const missing = (error.params as { missingProperty?: unknown }).missingProperty
    if (typeof missing === 'string') return `${error.instancePath}/${missing}`
  }
  return error.instancePath === '' ? '/' : error.instancePath
}

/**
 * 按一份 schema 校验一个值。
 *
 * @param schema - JSON Schema；没有声明时不校验。
 * @param value - 要校验的值。
 * @returns 不相符的字段；相符时为 `undefined`。
 */
function issuesOf(schema: Record<string, unknown> | undefined, value: unknown): SchemaIssue[] | undefined {
  if (schema === undefined) return undefined
  const key = JSON.stringify(schema)
  let validate = compiled.get(key)
  if (validate === undefined) {
    validate = ajv.compile(schema)
    compiled.set(key, validate)
  }
  if (validate(value)) return undefined
  return (validate.errors ?? []).map((error) => ({
    path: pathOf(error),
    message: (error.message ?? '不符合 schema').trim(),
  }))
}

/**
 * 一份数据与组件的 data schema 是否相符。
 *
 * @param schema - manifest 里的 `data`；没有声明时不校验。
 * @param value - 数据源读出来或推给卡片的数据。
 * @returns 不相符时的原因，相符时为 `undefined`。
 */
export function dataError(schema: Record<string, unknown> | undefined, value: unknown): string | undefined {
  const issues = issuesOf(schema, value)
  if (issues === undefined) return undefined
  return `数据与组件的 data schema 不符：${issues.map((issue) => `${issue.path} ${issue.message}`).join('；')}`
}

/**
 * 一份 props 与组件的 props schema 的差距（D22）：设置弹窗按字段路径逐项显示。
 *
 * @param schema - manifest 里的 `props`；没有声明时不校验。
 * @param value - 准备存进卡片的 props。
 * @returns 不相符的字段；相符时为 `undefined`。
 */
export function propsIssues(schema: Record<string, unknown> | undefined, value: unknown): SchemaIssue[] | undefined {
  return issuesOf(schema, value)
}

/**
 * 一份 props 与组件的 props schema 是否相符：给工具与路由回一条能直接显示的原因。
 *
 * @param schema - manifest 里的 `props`；没有声明时不校验。
 * @param value - 准备存进卡片的 props。
 * @returns 不相符时的原因，相符时为 `undefined`。
 */
export function propsError(schema: Record<string, unknown> | undefined, value: unknown): string | undefined {
  const issues = issuesOf(schema, value)
  if (issues === undefined) return undefined
  return `props 与组件的 props schema 不符：${issues.map((issue) => `${issue.path} ${issue.message}`).join('；')}`
}
