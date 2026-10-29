/**
 * 按需读能力 `widget-board:data.read`（D32）：白名单、默认源、授权、schema 与「只返回数据不写卡片」。
 *
 * 这里的上下文是替身：这一层判定的是能力自己的白名单与它转手的读路径，不是工作区的实现。
 */
import { describe, expect, it } from 'vitest'
import type { Board, BoardInstance, WidgetManifest } from '@dsh-widget-board/contracts'
import { capabilityMetadataOf } from '../src/capability-metadata'
import { DATA_READ_CAPABILITY, DATA_READ_PROVIDER, dataReadCapability, registerDataRead } from '../src/data-read'
import type { GrantStore } from '../src/grants'
import type { WidgetRecord } from '../src/library'
import type { ProviderHealth } from '../src/provider-health'
import { createProviderHealth } from '../src/provider-health'
import { Refusal } from '../src/refusal'
import type { RouteContext } from '../src/routes'
import type { Registries } from '../src/sources'
import { createRegistries } from '../src/sources'
import { memoryGrants } from './memory-grants'

/** 一个版本固定的组件。 */
const HASH = 'c'.repeat(64)

/** 声明了默认源、一个额外源与 data schema 的组件。 */
const MANIFEST: WidgetManifest = {
  id: 'meter',
  title: { zh: '用量', en: 'Meter' },
  version: '0.1.0',
  sizes: ['s'],
  source: 'demo:count',
  sources: ['demo:extra'],
  data: { type: 'object', required: ['n'], properties: { n: { type: 'number' } } },
  // 组件要能调它，才谈得上白名单：能力的声明与调用许可都是 manifest 的内容（D24、D32）。
  capabilities: [`${DATA_READ_PROVIDER}:${DATA_READ_CAPABILITY}`],
}

/** 一套替身：上下文、注册表、健康记录、写入次数与调一次能力。 */
interface Harness {
  context: RouteContext
  sources: Registries
  health: ProviderHealth
  /** 走到看板写入的次数：data.read 一次都不该走。 */
  saves: string[]
  call(args?: unknown): Promise<unknown>
}

/**
 * 起一套替身。
 *
 * @param options - 组件的 manifest、卡片绑定的源与授权表。
 * @returns 上下文与调一次能力的函数。
 */
function harness(options: { manifest: WidgetManifest, bound?: string, grants?: GrantStore }): Harness {
  const manifest = options.manifest
  const record: WidgetRecord = { manifest, source: 'user', dir: '/widgets/meter', hash: HASH, files: new Map() }
  const health = createProviderHealth()
  const sources = createRegistries(health)
  const card: BoardInstance = {
    id: 'card',
    widget: manifest.id,
    hash: HASH,
    props: {},
    data: { kept: true },
    state: null,
    layout: { x: 0, y: 0, w: 1, h: 10 },
    ...(options.bound === undefined ? {} : { source: options.bound }),
  }
  const board: Board = { version: 2, id: 'board', title: '看板', revision: 1, layoutRevision: 1, instances: [card] }
  const saves: string[] = []
  const context = {
    records: new Map([[manifest.id, record]]),
    entries: [],
    sources,
    grants: options.grants ?? memoryGrants(),
    workspace: {
      list: () => [board],
      activeId: () => board.id,
      active: () => board,
      board: () => board,
      has: () => true,
      findInstance: (id: string) => (id === card.id ? { board, instance: card } : undefined),
      save: async (id: string) => { saves.push(id); return board },
    },
  } as unknown as RouteContext
  return {
    context,
    sources,
    health,
    saves,
    call: async (args) => await dataReadCapability(context).call({ id: card.id, widget: card.widget, props: {} }, args, new AbortController().signal),
  }
}

/**
 * 一次本该被拒绝的调用拿到的拒绝。
 *
 * @param work - 那次调用。
 * @returns 拒绝本身。
 */
async function refusalOf(work: Promise<unknown>): Promise<Refusal> {
  try {
    await work
  } catch (error) {
    if (error instanceof Refusal) return error
    throw error
  }
  throw new Error('这次调用本该被拒绝')
}

/**
 * 一段文案里出现几次某句话：一句前缀只该说一遍，界面才看不到重复的两遍。
 *
 * @param text - 文案。
 * @param phrase - 要找的那一句。
 * @returns 出现次数。
 */
function timesIn(text: string, phrase: string): number {
  return text.split(phrase).length - 1
}

/** 注册默认源与额外源，数据分别是 `{ n: 1 }` 与 `{ n: 2 }`。 */
function registerDemoSources(sources: Registries): void {
  sources.registerDataSource({ apiVersion: 3, provider: 'demo', id: 'count', read: () => ({ n: 1 }) })
  sources.registerDataSource({ apiVersion: 3, provider: 'demo', id: 'extra', read: () => ({ n: 2 }) })
}

describe('按需读能力', () => {
  it('不给源名时读卡片绑定的那个，只把数据交回来，不写卡片', async () => {
    const test = harness({ manifest: MANIFEST, bound: 'demo:count' })
    registerDemoSources(test.sources)
    expect(await test.call(undefined)).toEqual({ n: 1 })
    expect(test.saves).toEqual([])
  })

  it('点名默认源或白名单里的额外源都可读', async () => {
    const test = harness({ manifest: MANIFEST, bound: 'demo:count' })
    registerDemoSources(test.sources)
    expect(await test.call({ source: 'demo:count' })).toEqual({ n: 1 })
    expect(await test.call({ source: 'demo:extra' })).toEqual({ n: 2 })
  })

  it('manifest 的 source 与 sources 里都没有的源被拒绝，原因可见', async () => {
    const test = harness({ manifest: MANIFEST, bound: 'demo:count' })
    registerDemoSources(test.sources)
    const refusal = await refusalOf(test.call({ source: 'other:nowhere' }))
    expect(refusal.status).toBe(400)
    expect(refusal.message).toContain('组件没有声明数据源 other:nowhere')
    expect(refusal.extra.code).toBe('source-unavailable')
  })

  it('白名单里放过、注册表里没有的源报「没有这个源」', async () => {
    const test = harness({ manifest: MANIFEST, bound: 'demo:count' })
    test.sources.registerDataSource({ apiVersion: 3, provider: 'demo', id: 'count', read: () => ({ n: 1 }) })
    const refusal = await refusalOf(test.call({ source: 'demo:extra' }))
    expect(refusal.status).toBe(400)
    expect(refusal.message).toContain('没有数据源 demo:extra')
  })

  it('组件没有声明源、参数里也没给时拒绝', async () => {
    const manifest: WidgetManifest = { ...MANIFEST }
    delete manifest.source
    delete manifest.sources
    const test = harness({ manifest })
    const refusal = await refusalOf(test.call(undefined))
    expect(refusal.status).toBe(400)
    expect(refusal.message).toContain('这张卡没有数据源')
  })

  it('注册项声明了权限时要人给出授权，给了之后读得通', async () => {
    const test = harness({ manifest: MANIFEST, bound: 'demo:count' })
    test.sources.registerDataSource({
      apiVersion: 3,
      provider: 'demo',
      id: 'count',
      permission: { hosts: ['example.com'] },
      read: () => ({ n: 1 }),
    })
    const refusal = await refusalOf(test.call(undefined))
    expect(refusal.status).toBe(403)
    expect(refusal.extra.code).toBe('grant-required')
    await test.context.grants.grant({ kind: 'source', id: 'demo:count', hash: HASH, widget: MANIFEST.id, provider: 'demo', permission: { hosts: ['example.com'] } })
    expect(await test.call(undefined)).toEqual({ n: 1 })
  })

  it('数据与组件的 data schema 不符时拒绝，并记在提供方名下', async () => {
    const test = harness({ manifest: MANIFEST, bound: 'demo:count' })
    test.sources.registerDataSource({ apiVersion: 3, provider: 'demo', id: 'count', read: () => ({ n: '不是数字' }) })
    const refusal = await refusalOf(test.call(undefined))
    expect(refusal.status).toBe(400)
    expect(refusal.message).toContain('data schema 不符')
    // dataError 自带的那一句就是全部：前缀在文案里只出现一次。
    expect(timesIn(refusal.message, 'data schema 不符')).toBe(1)
    expect(test.health.snapshot().find((entry) => entry.provider === 'demo')?.failures).toBe(1)
    expect(test.saves).toEqual([])
  })

  it('数据源真的抛出异常时回 502，原因原样带回，只记数据源自己那一次失败', async () => {
    const test = harness({ manifest: MANIFEST, bound: 'demo:count' })
    test.sources.registerDataSource({ apiVersion: 3, provider: 'demo', id: 'count', read: () => { throw new Error('网络断了') } })
    const refusal = await refusalOf(test.call(undefined))
    expect(refusal.status).toBe(502)
    expect(refusal.message).toContain('网络断了')
    expect(refusal.extra.source).toBe('demo:count')
    expect(test.health.snapshot().find((entry) => entry.provider === 'demo')?.failures).toBe(1)
    expect(test.saves).toEqual([])
  })

  it('数据源抛出的已经是宿主拒绝时原样透出，不翻成 502 也不记失败', async () => {
    const test = harness({ manifest: MANIFEST, bound: 'demo:count' })
    test.sources.registerDataSource({ apiVersion: 3, provider: 'demo', id: 'count', read: () => { throw new Refusal(409, '源自己拒绝了这次读取') } })
    const refusal = await refusalOf(test.call(undefined))
    expect(refusal.status).toBe(409)
    expect(refusal.message).toBe('源自己拒绝了这次读取')
    expect(test.health.snapshot().find((entry) => entry.provider === 'demo')?.failures).toBe(0)
  })

  it('注册之后就是一个可解析的能力，元数据里带着参数 schema', async () => {
    const test = harness({ manifest: MANIFEST, bound: 'demo:count' })
    registerDataRead(test.sources, test.context)
    const resolved = test.sources.resolveCapability(`${DATA_READ_PROVIDER}:${DATA_READ_CAPABILITY}`)
    expect(resolved?.provider).toBe(DATA_READ_PROVIDER)
    expect(resolved?.registration.id).toBe(DATA_READ_CAPABILITY)
    const metadata = capabilityMetadataOf([`${DATA_READ_PROVIDER}:${DATA_READ_CAPABILITY}`], (id) => test.sources.resolveCapability(id))
    expect(metadata[0]?.available).toBe(true)
    expect(metadata[0]?.input).toMatchObject({ properties: { source: { type: 'string' } } })
    // 返回值的形状由组件自己的 data schema 定，能力不另写一份会过期的说法。
    expect(metadata[0]?.output).toBeUndefined()
  })
})
