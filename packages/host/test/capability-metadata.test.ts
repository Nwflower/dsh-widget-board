/**
 * 能力元数据与能力面（D32）：manifest 声明过的每一项按声明次序解析，可用项取注册项的实值，不可用项
 * 只留声明的名字；快照里的白名单、可用子集与元数据由同一次解析得出。
 */
import { describe, expect, it } from 'vitest'
import type { WidgetManifest } from '@dsh-widget-board/contracts'
import { DESCRIPTION_CODE_POINT_LIMIT, capabilityMetadataOf, providerOfDeclaredId } from '../src/capability-metadata'
import type { WidgetRecord } from '../src/library'
import { widgetSummaryOf, workspaceSnapshot } from '../src/snapshot'
import { createRegistries } from '../src/sources'

/** 一个版本固定的组件。 */
const HASH = 'b'.repeat(64)

/**
 * 一份组件记录。
 *
 * @param declared - manifest 里声明的能力。
 * @returns 组件记录。
 */
function recordOf(declared: string[]): WidgetRecord {
  const manifest: WidgetManifest = {
    id: 'meter',
    title: { zh: '用量', en: 'Meter' },
    version: '0.1.0',
    sizes: ['s'],
    capabilities: declared,
  }
  return { manifest, source: 'user', dir: '/widgets/meter', hash: HASH, files: new Map() }
}

/** 注册一份带齐标题、说明、schema 与权限的能力。 */
function registriesWithCapabilities() {
  const sources = createRegistries()
  sources.registerCapability({
    apiVersion: 3,
    provider: 'acme',
    id: 'ping',
    title: { zh: '探活', en: 'Ping' },
    description: { zh: '问一次对方在不在', en: 'Asks whether the peer is there' },
    input: { type: 'object', properties: { host: { type: 'string' } } },
    output: { type: 'object', properties: { ok: { type: 'boolean' } } },
    permission: { hosts: ['example.com'] },
    call: () => ({ ok: true }),
  })
  // 裸名注册、没有任何可选字段：元数据里那几项一并省略，不填占位值。
  sources.registerCapability({ apiVersion: 3, provider: 'beta', id: 'echo', call: () => null })
  return sources
}

describe('能力元数据', () => {
  it('可用项按声明次序取注册项的实值，限定名与裸名都解得出提供方', () => {
    const sources = registriesWithCapabilities()
    const metadata = capabilityMetadataOf(['acme:ping', 'echo'], (id) => sources.resolveCapability(id))
    expect(metadata).toEqual([
      {
        id: 'acme:ping',
        provider: 'acme',
        title: { zh: '探活', en: 'Ping' },
        description: { zh: '问一次对方在不在', en: 'Asks whether the peer is there' },
        input: { type: 'object', properties: { host: { type: 'string' } } },
        output: { type: 'object', properties: { ok: { type: 'boolean' } } },
        permission: { hosts: ['example.com'] },
        available: true,
      },
      { id: 'echo', provider: 'beta', available: true },
    ])
  })

  it('不可用项保留声明的名字，限定名还能解出提供方，裸名不编一个', () => {
    const metadata = capabilityMetadataOf(['absent:thing', 'nowhere'], () => undefined)
    expect(metadata).toEqual([
      { id: 'absent:thing', provider: 'absent', available: false },
      { id: 'nowhere', available: false },
    ])
  })

  it('次序跟声明走，不跟注册顺序走', () => {
    const sources = createRegistries()
    sources.registerCapability({ apiVersion: 3, provider: 'acme', id: 'second', call: () => 0 })
    sources.registerCapability({ apiVersion: 3, provider: 'acme', id: 'first', call: () => 0 })
    expect(capabilityMetadataOf(['second', 'first'], (id) => sources.resolveCapability(id)).map((item) => item.id))
      .toEqual(['second', 'first'])
  })

  it('没有声明时是空表', () => {
    expect(capabilityMetadataOf(undefined, () => undefined)).toEqual([])
  })

  it('只有点名提供方的名字才给出提供方', () => {
    expect(providerOfDeclaredId('acme:ping')).toBe('acme')
    expect(providerOfDeclaredId('ping')).toBeUndefined()
  })
})

describe('说明的大小控制', () => {
  /**
   * 注册一项说明由参数给出的能力。
   *
   * @param zh - 中文说明。
   * @param en - 英文说明。
   * @returns 注册表与那一项的注册项。
   */
  function registered(zh: string, en: string) {
    const sources = createRegistries()
    sources.registerCapability({ apiVersion: 3, provider: 'acme', id: 'long', description: { zh, en }, call: () => null })
    const registration = sources.resolveCapability('acme:long')?.registration
    if (registration === undefined) throw new Error('注册的能力没有解析出来')
    return { metadata: capabilityMetadataOf(['acme:long'], (id) => sources.resolveCapability(id))[0], registration }
  }

  it('超过上限的中文说明留前 511 个码点加省略号，注册项里的那一份不动', () => {
    const zh = '说明'.repeat(400)
    const en = 'Asks whether the peer is there'
    const { metadata, registration } = registered(zh, en)
    const description = metadata?.description
    expect(description?.zh).toBe(`${'说明'.repeat(255)}说…`)
    expect(Array.from(description?.zh ?? '')).toHaveLength(DESCRIPTION_CODE_POINT_LIMIT)
    // 没超长的那一段原样过去。
    expect(description?.en).toBe(en)
    // 设置弹窗读的是注册项：完整说明还在那里。
    expect(registration.description).toEqual({ zh, en })
    expect(metadata?.available).toBe(true)
  })

  it('恰好到上限不截断，超一个码点就截断', () => {
    const exact = 'a'.repeat(DESCRIPTION_CODE_POINT_LIMIT)
    expect(registered(exact, exact).metadata?.description).toEqual({ zh: exact, en: exact })

    const over = `${exact}b`
    const description = registered(over, over).metadata?.description
    expect(description?.zh).toBe(`${'a'.repeat(DESCRIPTION_CODE_POINT_LIMIT - 1)}…`)
    // 两种语言各自算：英文那一侧同样截到 511 加省略号。
    expect(description?.en).toBe(description?.zh)
  })

  it('按码点截断，emoji 的代理对不被切开', () => {
    // 第 511 个码点正好落在一个由两个 UTF-16 单元组成的 emoji 上：按单元切会留下孤立代理项。
    const zh = `${'a'.repeat(510)}😀${'b'.repeat(100)}`
    const description = registered(zh, 'ok').metadata?.description
    expect(description?.zh).toBe(`${'a'.repeat(510)}😀…`)
    expect(Array.from(description?.zh ?? '')).toHaveLength(DESCRIPTION_CODE_POINT_LIMIT)
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(description?.zh ?? '')).toBe(false)
  })
})

describe('快照里的能力面', () => {
  it('白名单、可用子集与元数据由同一次解析得出，限定名不再靠名字比对', () => {
    const sources = registriesWithCapabilities()
    const record = recordOf(['acme:ping', 'absent:thing', 'echo'])
    const snapshot = workspaceSnapshot({
      records: new Map([[record.manifest.id, record]]),
      entries: [],
      workspace: {
        list: () => [{ version: 2, id: 'board', title: '看板', revision: 0, layoutRevision: 0, instances: [] }],
        activeId: () => 'board',
      },
      grants: { all: () => [] },
      sources,
    })
    const summary = snapshot.widgets.meter
    expect(summary?.capabilities).toEqual(['acme:ping', 'absent:thing', 'echo'])
    // 点名提供方的那一项解得出：原来的名字比对在这里永远判不出来。
    expect(summary?.availableCapabilities).toEqual(['acme:ping', 'echo'])
    expect(summary?.capabilityMetadata?.map((item) => [item.id, item.available])).toEqual([
      ['acme:ping', true],
      ['absent:thing', false],
      ['echo', true],
    ])
    expect(summary?.capabilityMetadata?.[0]?.title).toEqual({ zh: '探活', en: 'Ping' })
  })

  it('没有能力注册表时维持旧的省略：只给声明的白名单', () => {
    const record = recordOf(['acme:ping'])
    const summary = widgetSummaryOf(record)
    expect(summary.capabilities).toEqual(['acme:ping'])
    expect(summary.availableCapabilities).toBeUndefined()
    expect(summary.capabilityMetadata).toBeUndefined()
  })

  it('没声明能力时不补空表', () => {
    const record: WidgetRecord = { ...recordOf([]), manifest: { ...recordOf([]).manifest } }
    delete record.manifest.capabilities
    const summary = widgetSummaryOf(record, () => undefined)
    expect(summary.capabilities).toBeUndefined()
    expect(summary.capabilityMetadata).toBeUndefined()
  })
})
