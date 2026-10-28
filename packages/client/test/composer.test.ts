/**
 * 嵌套表单的纯逻辑（C03、C04）：schema 读成控件树、路径换算、数组身份的稳定与 JSON 兜底的判定。
 *
 * 这里不画 React：字段表、错误路径与递归边界都是纯函数，渲染那一层只按这份判定画控件。
 */
import { describe, expect, it } from 'vitest'
import { SCHEMA_DEPTH, fieldsOfTree, labelOf } from '../src/composer/schema'
import { formPathOf, formResult } from '../src/composer/fields'
import { TEMPLATES, seedOf, templateOf } from '../src/composer/templates'
import { buildSync } from 'esbuild'
import { runInNewContext } from 'node:vm'
import { resolve } from 'node:path'

const countdownScript = buildSync({ entryPoints: [resolve('packages/widgets/countdown/main.js')], bundle: true, write: false, platform: 'browser', format: 'iife' }).outputFiles[0]!.text
function countdownFor(props: Record<string, unknown>) {
  const nodes = new Map<string, { textContent: string, hidden: boolean, dataset: Record<string, string> }>()
  const node = (selector: string) => {
    if (!nodes.has(selector)) nodes.set(selector, { textContent: '', hidden: false, dataset: {} })
    return nodes.get(selector)!
  }
  const card = { dataset: {} as Record<string, string>, querySelector: node }
  class Clock extends Date { static now() { return 0 } }
  runInNewContext(countdownScript, { document: { querySelector: () => card }, window: { widget: { props, lang: 'zh', t: (key: string) => key, onProps: () => {}, onPause: () => {} } }, Date: Clock, Intl, setInterval: () => 1, clearInterval: () => {} })
  return { phase: card.dataset.phase, message: node('[data-role="empty"]').textContent, minutes: Number(node('[data-role="days"]').textContent) * 1440 + Number(node('[data-role="hours"]').textContent) * 60 + Number(node('[data-role="minutes"]').textContent) }
}

describe('倒计时时区', () => {
  it('拒绝不存在的夏令时墙上时间与未知时区', () => {
    expect(countdownFor({ date: '2026-03-08', time: '02:30', zone: 'America/New_York' }).phase).toBe('empty')
    expect(countdownFor({ date: '2026-03-08', time: '02:30', zone: 'Invalid/Zone' }).phase).toBe('empty')
  })
  it('重复时间必须选择偏移，两个有效偏移相差一小时', () => {
    const props = { date: '2026-11-01', time: '01:30', zone: 'America/New_York' }
    expect(countdownFor(props).phase).toBe('empty')
    const early = countdownFor({ ...props, offsetMinutes: -240 })
    const late = countdownFor({ ...props, offsetMinutes: -300 })
    expect(early.phase).toBe('remaining')
    expect(late.minutes - early.minutes).toBe(60)
    expect(countdownFor({ ...props, offsetMinutes: 480 }).phase).toBe('empty')
  })
})

/** 一份带对象、数组与两种兜底写法的 schema。 */
const SCHEMA = {
  type: 'object',
  required: ['title'],
  properties: {
    title: { type: 'string', maxLength: 80 },
    body: { type: 'string', maxLength: 4000 },
    date: { type: 'string', format: 'date' },
    count: { type: 'integer', minimum: 1, maximum: 9 },
    pinned: { type: 'boolean' },
    kind: { enum: ['a', 'b'] },
    nested: { type: 'object', properties: { note: { type: 'string' } } },
    items: {
      type: 'array',
      maxItems: 3,
      items: { type: 'object', required: ['text'], properties: { text: { type: 'string' }, done: { type: 'boolean' } } },
    },
    union: { oneOf: [{ type: 'string' }, { type: 'number' }] },
    ref: { $ref: '#/$defs/thing' },
  },
}

describe('schema 读成控件树', () => {
  it('两种字符串、日期、数字、布尔与枚举各出对应的控件', () => {
    const fields = fieldsOfTree(SCHEMA)
    expect(fields.map((field) => field.key)).toEqual(['title', 'body', 'date', 'count', 'pinned', 'kind', 'nested', 'items', 'union', 'ref'])
    expect(fields.find((field) => field.key === 'title')).toMatchObject({ node: { kind: 'string', multiline: false, maxLength: 80 }, required: true })
    expect(fields.find((field) => field.key === 'body')).toMatchObject({ node: { kind: 'string', multiline: true } })
    expect(fields.find((field) => field.key === 'date')).toMatchObject({ node: { kind: 'string', format: 'date' } })
    expect(fields.find((field) => field.key === 'count')).toMatchObject({ node: { kind: 'number', integer: true, min: 1, max: 9 } })
    expect(fields.find((field) => field.key === 'pinned')).toMatchObject({ node: { kind: 'boolean' } })
    expect(fields.find((field) => field.key === 'kind')).toMatchObject({ node: { kind: 'enum', values: ['a', 'b'] } })
  })

  it('对象与数组展开，深层的不展开但给出原因', () => {
    const fields = fieldsOfTree(SCHEMA)
    const nested = fields.find((field) => field.key === 'nested')?.node
    expect(nested?.kind).toBe('object')
    const items = fields.find((field) => field.key === 'items')?.node
    expect(items).toMatchObject({ kind: 'array', maxItems: 3 })
    if (items?.kind !== 'array') throw new Error('items 应当是数组')
    expect(items.item.kind).toBe('object')
    expect(fields.find((field) => field.key === 'union')?.node.kind).toBe('json')
    expect(fields.find((field) => field.key === 'ref')?.node.kind).toBe('json')
  })

  it(`展开到 ${String(SCHEMA_DEPTH)} 层为止，更深的换成 JSON 入口`, () => {
    let deep: Record<string, unknown> = { type: 'string' }
    for (let level = 0; level < SCHEMA_DEPTH + 1; level += 1) {
      deep = { type: 'object', properties: { inner: deep } }
    }
    const fields = fieldsOfTree({ type: 'object', properties: { root: deep } })
    let node = fields[0]?.node
    let objects = 0
    for (let level = 0; level < SCHEMA_DEPTH + 2 && node?.kind === 'object'; level += 1) {
      objects += 1
      node = node.children[0]?.node
    }
    expect(objects).toBe(SCHEMA_DEPTH)
    expect(node?.kind).toBe('json')
  })

  it('没有 properties 的 schema 是空表', () => {
    expect(fieldsOfTree(undefined)).toEqual([])
    expect(fieldsOfTree({ type: 'object' })).toEqual([])
  })
})

describe('字段名字', () => {
  it('按 props、data、state 三节各自的键取双语文案', () => {
    const text = {
      'data.items.label': { zh: '链接', en: 'Links' },
      'data.items.0.url.label': { zh: '地址', en: 'Address' },
      'state.items.done.label': { zh: '已完成', en: 'Done' },
    }
    expect(labelOf('items', text, 'data')).toBe('链接')
    // 数组项的路径把下标换成点分键：`items.0.url` 找的是 `data.items.url.label`。
    expect(labelOf('items.0.url', text, 'data')).toBe('地址')
    expect(labelOf('items.0.done', text, 'state')).toBe('已完成')
    // 同一段路径在别的节里没有名字时退回字段名，不借用另一节的说法。
    expect(labelOf('items.0.url', text, 'state')).toBe('Url')
  })

  it('没写文案时把字段名拆成词', () => {
    expect(labelOf('maxItemsPerRow', undefined)).toBe('Max Items Per Row')
  })
})

describe('错误路径与表单值的转换', () => {
  it('JSON Pointer 换成点分路径', () => {
    expect(formPathOf('/items/0/text')).toBe('items.0.text')
    expect(formPathOf('/title')).toBe('title')
    expect(formPathOf('/')).toBe('')
  })

  it('表单值写回卡片时顶层一定是对象', () => {
    expect(formResult({ title: 'a' })).toEqual({ title: 'a' })
    expect(formResult(null)).toEqual({})
    expect(formResult('text')).toEqual({})
  })
})

describe('模板', () => {
  it('五个内容模板各指向一种已存在的组件，高级模板留给用户挑', () => {
    const keys = TEMPLATES.map((template) => template.key)
    expect(keys).toEqual(['text', 'todo', 'links', 'countdown', 'image', 'advanced'])
    expect(TEMPLATES.find((template) => template.key === 'text')?.widget).toBe('markdown')
    expect(TEMPLATES.find((template) => template.key === 'todo')?.widget).toBe('todo')
    expect(TEMPLATES.find((template) => template.key === 'links')?.widget).toBe('links')
    expect(TEMPLATES.find((template) => template.key === 'countdown')?.widget).toBe('countdown')
    expect(TEMPLATES.find((template) => template.key === 'image')?.widget).toBe('image')
    expect(TEMPLATES.find((template) => template.key === 'advanced')?.widget).toBe('')
  })

  it('预填内容每次都是新造的对象', () => {
    const template = TEMPLATES.find((entry) => entry.key === 'todo')
    if (template === undefined) throw new Error('没有待办模板')
    const first = seedOf(template)
    const second = seedOf(template)
    expect(first).toEqual(second)
    expect(first).not.toBe(second)
    expect(seedOf(template).state).not.toBe(template.seed.state)
  })

  it('按组件找模板', () => {
    expect(templateOf('links')?.key).toBe('links')
    expect(templateOf('countdown')?.key).toBe('countdown')
    expect(templateOf('weather')).toBeUndefined()
  })
})
