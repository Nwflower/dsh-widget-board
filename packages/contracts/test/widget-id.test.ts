/**
 * 组件 id 的作者域（D7、D8、D30）：manifest、市场条目与浏览器侧的原生组件共用一份判据。
 *
 * 判据只有一处：`WIDGET_NAMESPACED_ID_PATTERN` 与 `isAuthorNamespacedWidgetId` 由同一段拼出来，
 * 市场条目的 schema 直接引用那个常量。这里判的是它挑得出、挑不出哪些 id，以及两处规则是不是同一份。
 */
import { describe, expect, it } from 'vitest'
import Ajv from 'ajv'
import type { WidgetRoot } from '@dsh-widget-board/contracts'
import {
  MARKET_INDEX_SCHEMA,
  MARKET_LISTING_SCHEMA,
  WIDGET_ID_PATTERN,
  WIDGET_MANIFEST_SCHEMA,
  WIDGET_NAMESPACED_ID_PATTERN,
  isAuthorNamespacedWidgetId,
} from '@dsh-widget-board/contracts'

const validateListing = new Ajv({ allErrors: true, strict: true }).compile(MARKET_LISTING_SCHEMA)
const validateIndex = new Ajv({ allErrors: true, strict: true }).compile(MARKET_INDEX_SCHEMA)

/** 一份最小的合格市场条目。 */
function listing(id: string): Record<string, unknown> {
  return {
    id,
    title: { zh: '时钟', en: 'Clock' },
    author: { name: 'acme' },
    versions: [{
      version: '1.0.0',
      sizes: ['s'],
      package: { url: 'acme.clock-1.0.0.dshw', sha256: 'a'.repeat(64), bytes: 1024 },
    }],
  }
}

/** 带作者域的 id：两段各自两个字以上。 */
const NAMESPACED = ['acme.clock', 'nwflower.example-basic', 'acme.two-words', 'ab.cd', 'a1.b2']

/** 不是带作者域的那一种：扁平的，或两段里有一段不合格。 */
const NOT_NAMESPACED = ['clock', 'acme.', '.clock', 'a.clock', 'acme..clock', 'Acme.clock', 'acme.Clock', 'acme .clock', 'acme-clock']

describe('作者域的形状', () => {
  it('两段各自是小写字母开头、两个字以上的名字', () => {
    for (const id of NAMESPACED) expect(isAuthorNamespacedWidgetId(id), id).toBe(true)
    for (const id of NOT_NAMESPACED) expect(isAuthorNamespacedWidgetId(id), id).toBe(false)
  })

  it('扁平 id 也进 manifest，但不带作者域', () => {
    const manifestId = new RegExp(WIDGET_ID_PATTERN)
    expect(manifestId.test('clock')).toBe(true)
    expect(manifestId.test('acme.clock')).toBe(true)
    for (const id of NAMESPACED) expect(isAuthorNamespacedWidgetId(id), id).toBe(true)
    expect(isAuthorNamespacedWidgetId('clock')).toBe(false)
  })
})

describe('市场条目只用共享的那条作者域规则', () => {
  it('schema 里的 id pattern 就是那个常量', () => {
    expect(MARKET_LISTING_SCHEMA.properties.id.pattern).toBe(WIDGET_NAMESPACED_ID_PATTERN)
  })

  it('带作者域的条目通过，扁平的条目被拒', () => {
    expect(validateListing(listing('acme.clock'))).toBe(true)
    expect(validateListing(listing('clock'))).toBe(false)
    expect(validateListing.errors?.some((error) => error.instancePath === '/id')).toBe(true)
  })

  it('两段里有一段不合格时被拒', () => {
    for (const id of ['a.clock', 'acme.', 'acme..clock', 'Acme.clock']) {
      expect(validateListing(listing(id)), id).toBe(false)
    }
  })

  it('schema 与判定函数对同一批 id 结论一致', () => {
    for (const id of [...NAMESPACED, ...NOT_NAMESPACED]) {
      expect(validateListing(listing(id)), id).toBe(isAuthorNamespacedWidgetId(id))
    }
  })
})

describe('市场索引的 schema 用同一条作者域规则', () => {
  it('索引 schema 里的 id pattern 就是那个常量', () => {
    expect(MARKET_INDEX_SCHEMA.properties.widgets.items.properties.id.pattern).toBe(WIDGET_NAMESPACED_ID_PATTERN)
  })

  it('第一段只有一个字母的 id 在索引里也被拒', () => {
    // 这一条正是两份规则漂移时漏掉的那一种：一段的名字至少要两个字。
    const index = {
      format: 1,
      market: { title: { zh: '市场', en: 'Market' } },
      widgets: [{
        id: 'a.clock',
        title: { zh: '时钟', en: 'Clock' },
        author: { name: 'a' },
        versions: [{ version: '1.0.0', sizes: ['s'], package: { url: 'p', sha256: 'a'.repeat(64), bytes: 1 } }],
      }],
    }
    expect(validateIndex(index)).toBe(false)
    expect(validateIndex.errors?.some((error) => error.instancePath === '/widgets/0/id')).toBe(true)
    expect(isAuthorNamespacedWidgetId('a.clock')).toBe(false)
  })
})

describe('manifest 与来源', () => {
  it('manifest 的 id pattern 接受带作者域的那一种', () => {
    const manifestId = new RegExp(WIDGET_MANIFEST_SCHEMA.properties.id.pattern)
    for (const id of NAMESPACED) expect(manifestId.test(id), id).toBe(true)
  })

  it('带作者域的来源声明 authorDomain，本地来源省略它', () => {
    const market: WidgetRoot = { dir: '/market/widgets/acme.clock', source: 'market', authorDomain: true }
    const user: WidgetRoot = { dir: '/user/widgets/clock', source: 'user' }
    expect(market.authorDomain).toBe(true)
    expect(user.authorDomain).toBeUndefined()
  })
})
