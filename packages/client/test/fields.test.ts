/**
 * 配置一节的纯逻辑（D27）：schema 到控件的映射、名字与状态的取法。
 *
 * 这里不画 React，只判字段表与状态文字；保存时的宿主校验由宿主测试覆盖。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { credentialStatusOf, fieldsOf } from '../src/fields'

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
    title: { type: 'string', maxLength: 80 },
    columns: { type: 'integer', minimum: 1, maximum: 3 },
    compact: { type: 'boolean' },
    kind: { enum: ['line', 'area', 'bar'] },
    text: { type: 'string', maxLength: 400 },
    nested: { type: 'object', properties: { n: { type: 'number' } } },
  },
}

describe('配置字段', () => {
  it('按 schema 的次序给出控件种类与限制', () => {
    const fields = fieldsOf(SCHEMA, undefined)
    expect(fields.map((field) => field.key)).toEqual(['title', 'columns', 'compact', 'kind', 'text', 'nested'])
    expect(fields.find((field) => field.key === 'title')).toMatchObject({ kind: 'string', required: true, maxLength: 80 })
    expect(fields.find((field) => field.key === 'columns')).toMatchObject({ kind: 'number', min: 1, max: 3 })
    expect(fields.find((field) => field.key === 'compact')).toMatchObject({ kind: 'boolean' })
    expect(fields.find((field) => field.key === 'kind')).toMatchObject({ kind: 'enum', enumValues: ['line', 'area', 'bar'] })
    expect(fields.find((field) => field.key === 'text')).toMatchObject({ kind: 'string', multiline: true })
    expect(fields.find((field) => field.key === 'nested')).toMatchObject({ kind: 'complex' })
  })

  it('manifest 的 text 给出名字与说明', () => {
    const fields = fieldsOf(SCHEMA, {
      'props.title.label': { zh: '卡片标题', en: 'Card title' },
      'props.title.hint': { zh: '显示在卡片上', en: 'Shown on the card' },
    })
    expect(fields.find((field) => field.key === 'title')).toMatchObject({ label: '卡片标题', hint: '显示在卡片上' })
    expect(fields.find((field) => field.key === 'columns')?.label).toBe('Columns')
  })

  it('没有 properties 时是空表', () => {
    expect(fieldsOf(undefined, undefined)).toEqual([])
    expect(fieldsOf({ type: 'object' }, undefined)).toEqual([])
  })

  it('城市字段带定位与落点，隐藏字段不出控件', () => {
    const schema = {
      type: 'object',
      properties: {
        city: {
          type: 'string',
          format: 'city',
          fills: { place: 'place', latitude: 'latitude', longitude: 'longitude' },
        },
        place: { type: 'object', format: 'hidden' },
        latitude: { type: 'number', format: 'hidden' },
        note: { type: 'string' },
      },
    }
    const fields = fieldsOf(schema, undefined)
    expect(fields.map((field) => field.key)).toEqual(['city', 'note'])
    expect(fields.find((field) => field.key === 'city')).toMatchObject({
      kind: 'string',
      locate: true,
      fills: { place: 'place', latitude: 'latitude', longitude: 'longitude' },
    })
    expect(fields.find((field) => field.key === 'note')?.locate).toBeUndefined()
  })
})

describe('凭据状态', () => {
  it('按来源层说清楚值放在哪里', () => {
    expect(credentialStatusOf({ ref: 'GITHUB_TOKEN', label: { zh: '令牌', en: 'Token' }, info: { configured: true, source: 'file', writable: true } }))
      .toBe('保存在凭据文件里')
    expect(credentialStatusOf({ ref: 'GITHUB_TOKEN', label: { zh: '令牌', en: 'Token' }, info: { configured: false, writable: true } }))
      .toBe('未配置')
    expect(credentialStatusOf({ ref: 'GITHUB_TOKEN', label: { zh: '令牌', en: 'Token' }, unavailable: '宿主没有凭据服务' }))
      .toBe('宿主没有凭据服务')
  })
})
