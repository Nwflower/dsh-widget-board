/**
 * props 表单的纯逻辑（D22）：schema 到字段的映射、标签与类型判断。
 *
 * 这里不画 React，只判字段表；保存时的宿主校验由宿主测试覆盖。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fieldsOf, humanizeKey } from '../src/props-form'

/**
 * 文案按文档语言取（`copy.ts` 的 `currentLang`）；node 环境里没有 `document`，会退到
 * `navigator.language`，那个值跟着机器走。用例要的是中文，所以这一层临时借一份最小的 `document`。
 */
type Globals = Record<string, unknown>
const globals = globalThis as Globals
const hadDocument = 'document' in globals
beforeAll(() => {
  if (!hadDocument) globals.document = { documentElement: { lang: 'zh-CN' } }
})
afterAll(() => {
  if (!hadDocument) delete globals.document
})

const SCHEMA = {
  type: 'object',
  required: ['title'],
  additionalProperties: false,
  properties: {
    kicker: { type: 'string', maxLength: 40 },
    title: { type: 'string', maxLength: 80 },
    meta: { type: 'string', maxLength: 400 },
    columns: { type: 'integer', minimum: 1, maximum: 3 },
    compact: { type: 'boolean' },
    kind: { enum: ['line', 'area', 'bar'] },
    nested: { type: 'object', properties: { n: { type: 'number' } } },
    unknown: true,
  },
}

describe('props 字段', () => {
  it('按 schema 的次序给出类型、必填与限制', () => {
    const fields = fieldsOf(SCHEMA, undefined)
    expect(fields.map((field) => field.key)).toEqual(['kicker', 'title', 'meta', 'columns', 'compact', 'kind', 'nested', 'unknown'])
    expect(fields.find((field) => field.key === 'title')).toMatchObject({ kind: 'string', required: true, maxLength: 80 })
    expect(fields.find((field) => field.key === 'meta')).toMatchObject({ kind: 'string', multiline: true })
    expect(fields.find((field) => field.key === 'columns')).toMatchObject({ kind: 'number', min: 1, max: 3 })
    expect(fields.find((field) => field.key === 'compact')).toMatchObject({ kind: 'boolean' })
    expect(fields.find((field) => field.key === 'kind')).toMatchObject({ kind: 'enum', enumValues: ['line', 'area', 'bar'] })
    expect(fields.find((field) => field.key === 'nested')).toMatchObject({ kind: 'complex' })
    expect(fields.find((field) => field.key === 'unknown')).toMatchObject({ kind: 'complex' })
  })

  it('manifest 的 text 优先于内置标签与字段名', () => {
    const fields = fieldsOf(SCHEMA, {
      'props.title.label': { zh: '卡片标题', en: 'Card title' },
      'props.title.hint': { zh: '显示在卡片上', en: 'Shown on the card' },
    })
    expect(fields.find((field) => field.key === 'title')).toMatchObject({ label: '卡片标题', hint: '显示在卡片上' })
    expect(fields.find((field) => field.key === 'columns')?.label).toBe('列数')
  })

  it('没有 properties 时给出空表', () => {
    expect(fieldsOf(undefined, undefined)).toEqual([])
    expect(fieldsOf({ type: 'object' }, undefined)).toEqual([])
  })

  it('字段名的兜底说法拆开 camelCase', () => {
    expect(humanizeKey('frontTitle')).toBe('Front Title')
    expect(humanizeKey('back_text')).toBe('Back text')
  })
})
