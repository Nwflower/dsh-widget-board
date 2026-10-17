/**
 * 组件数据的校验：组件的 manifest 可以声明 data 的 JSON Schema（D6），数据源读出来的值与推送的
 * 值都按它核对。
 *
 * 校验器按 schema 的内容缓存：同一份 schema 只编译一次。schema 来自组件作者，Ajv 用宽松模式编译，
 * 免得一条少见的写法让整个组件变成不可用。
 */
import Ajv from 'ajv'
import type { ValidateFunction } from 'ajv'

const ajv = new Ajv({ allErrors: true, strict: false })
const compiled = new Map<string, ValidateFunction>()

/**
 * 一份数据与组件的 data schema 是否相符。
 *
 * @param schema - manifest 里的 `data`；没有声明时不校验。
 * @param value - 数据源读出来或推给卡片的数据。
 * @returns 不相符时的原因，相符时为 `undefined`。
 */
export function dataError(schema: Record<string, unknown> | undefined, value: unknown): string | undefined {
  if (schema === undefined) return undefined
  const key = JSON.stringify(schema)
  let validate = compiled.get(key)
  if (validate === undefined) {
    validate = ajv.compile(schema)
    compiled.set(key, validate)
  }
  if (validate(value)) return undefined
  const reasons = (validate.errors ?? []).map((error) => `${error.instancePath || '/'} ${error.message ?? ''}`.trim())
  return `数据与组件的 data schema 不符：${reasons.join('；')}`
}
