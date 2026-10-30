/**
 * 提供方的注册与生命周期（D31、D17）：新把手一个管完、旧入口各自释放、两者不混用，配额与监视归属按
 * 提供方算。
 */
import { describe, expect, it } from 'vitest'
import type { WidgetBoardFeature, WidgetRoot, WidgetTypeHandle } from '@dsh-widget-board/contracts'
import { WIDGET_BOARD_FEATURES, WIDGET_BOARD_PROVIDER_API_VERSION } from '@dsh-widget-board/contracts'
import type { ProviderDeps } from '../src/providers'
import {
  PROVIDER_CAPABILITY_LIMIT,
  PROVIDER_SOURCE_LIMIT,
  PROVIDER_WIDGET_LIMIT,
  createProviderRegistry,
  createWidgetBoardService,
} from '../src/providers'
import { createProviderHealth } from '../src/provider-health'
import { createRegistries } from '../src/sources'
import { createMarketRegistry } from '../src/market'
import { createWatchRegistry } from '../src/watch'

/** 一份市场注册。 */
const MARKET = {
  id: 'local',
  title: { zh: '本地', en: 'Local' },
  list: async () => [],
  fetch: async () => new Uint8Array(),
}

/** 一份记录注册与拆除的替身。 */
interface Harness {
  deps: ProviderDeps
  roots: WidgetRoot[]
  registries: ReturnType<typeof createRegistries>
  market: ReturnType<typeof createMarketRegistry>
  forgotten: string[]
  synced: (string | undefined)[]
  reloads: number
  /** 挂过监视的目录，按取用次序。 */
  starts: string[]
  /** 停掉的目录。 */
  stops: string[]
  /** 目录里有哪些组件 id。 */
  ids: Record<string, string[]>
  /** 注册表与提供方共用的健康记录。 */
  health: ReturnType<typeof createProviderHealth>
}

/**
 * 一个注册表与它的替身。
 *
 * @param ids - 目录到组件 id 的表。
 * @returns 替身。
 */
function harness(ids: Record<string, string[]> = {}): Harness {
  const roots: WidgetRoot[] = []
  const health = createProviderHealth()
  const registries = createRegistries(health)
  const market = createMarketRegistry()
  const forgotten: string[] = []
  const synced: (string | undefined)[] = []
  const starts: string[] = []
  const stops: string[] = []
  const watchers = createWatchRegistry((dir) => {
    starts.push(dir)
    return () => { stops.push(dir) }
  })
  const state: Harness = {
    deps: {
      roots,
      reload: async () => { state.reloads += 1 },
      registerDataSource: (source) => registries.registerDataSource(source),
      registerAction: (action) => registries.registerAction(action),
      registerCapability: (capability) => registries.registerCapability(capability),
      registerMarketProvider: (registration) => market.register(registration),
      forgetGrants: async (provider) => { forgotten.push(provider) },
      idsIn: async (root) => ids[root.dir] ?? [],
      watch: (dir) => watchers.acquire(dir),
      syncMarket: (provider) => { synced.push(provider) },
      health,
    },
    roots,
    registries,
    market,
    forgotten,
    synced,
    reloads: 0,
    starts,
    stops,
    ids,
    health,
  }
  return state
}

/** 宿主侧服务与它的注册表。 */
function serviceOf(h: Harness) {
  return createWidgetBoardService(createProviderRegistry(h.deps))
}

/** 新入口的一次注册。 */
function registration(provider: string) {
  return { apiVersion: WIDGET_BOARD_PROVIDER_API_VERSION, provider }
}

describe('新把手', () => {
  it('一次注册挂上目录、数据源、动作、能力与市场，dispose 全部撤下', async () => {
    const h = harness({ '/p/one': ['acme.one', 'acme.two'], '/p/two': ['acme.three'] })
    const service = serviceOf(h)
    const handle = await service.registerProvider(registration('acme.widgets'))
    const first = await handle.registerWidgets({ directory: '/p/one' })
    const second = await handle.registerWidgets({ directory: '/p/two' })
    expect(first.widgets).toEqual(['acme.one', 'acme.two'])
    expect(second.widgets).toEqual(['acme.three'])
    expect(handle.directories).toEqual(['/p/one', '/p/two'])
    expect(handle.widgets).toEqual(['acme.one', 'acme.two', 'acme.three'])
    expect(handle.supportedApiVersions).toEqual([2, 3])
    expect(handle.supports('marketProvider')).toBe(true)
    expect(handle.features).toContain('capabilityMetadata')
    // 新把手的目录带作者域；旧入口的目录不带。
    expect(h.roots.map((root) => [root.source, root.provider, root.authorDomain])).toEqual([
      ['plugin', 'acme.widgets', true],
      ['plugin', 'acme.widgets', true],
    ])
    handle.registerDataSource({ id: 'count', read: () => 0 })
    handle.registerAction({ id: 'touch', run: () => undefined })
    handle.registerCapability({ id: 'ping', call: () => 'pong' })
    handle.registerMarketProvider(MARKET)
    // 子注册由把手注入版本与提供方名。
    expect(h.registries.resolveDataSource('count')).toMatchObject({ provider: 'acme.widgets', registration: { apiVersion: 3 } })
    expect(h.registries.resolveAction('touch')?.provider).toBe('acme.widgets')
    expect(h.registries.resolveCapability('ping')?.provider).toBe('acme.widgets')
    expect(h.market.sections().map((section) => section.provider)).toEqual(['acme.widgets'])
    expect(h.synced).toEqual(['acme.widgets'])

    await handle.dispose()
    expect(handle.directories).toEqual([])
    expect(h.roots).toEqual([])
    expect(h.registries.hasDataSource('count')).toBe(false)
    expect(h.registries.resolveAction('touch')).toBeUndefined()
    expect(h.registries.resolveCapability('ping')).toBeUndefined()
    expect(h.market.sections()).toEqual([])
    expect(h.forgotten).toEqual(['acme.widgets'])
    expect(h.stops.sort()).toEqual(['/p/one', '/p/two'])
    expect(h.synced.at(-1)).toBeUndefined()
  })

  it('dispose 幂等，撤下之后不能再往上挂', async () => {
    const h = harness()
    const handle = await serviceOf(h).registerProvider(registration('acme.widgets'))
    await handle.dispose()
    await handle.dispose()
    expect(h.forgotten).toEqual(['acme.widgets'])
    expect(() => handle.registerDataSource({ id: 'count', read: () => 0 })).toThrow(/已经撤下/)
    await expect(handle.registerWidgets({ directory: '/p/one' })).rejects.toThrow(/已经撤下/)
  })

  it('同一个提供方只能有一个活动把手，dispose 之后可以重新注册', async () => {
    const h = harness()
    const service = serviceOf(h)
    const handle = await service.registerProvider(registration('acme.widgets'))
    await expect(service.registerProvider(registration('acme.widgets'))).rejects.toThrow(/已经有一个活动的提供方把手/)
    await handle.dispose()
    const again = await service.registerProvider(registration('acme.widgets'))
    expect(again.provider).toBe('acme.widgets')
  })

  it('同一个目录在一个把手上只注册一次', async () => {
    const h = harness()
    const handle = await serviceOf(h).registerProvider(registration('acme.widgets'))
    await handle.registerWidgets({ directory: '/p/one' })
    await expect(handle.registerWidgets({ directory: '/p/one' })).rejects.toThrow(/已经注册过/)
    expect(h.roots).toHaveLength(1)
  })

  it('目录读不出来时那次注册不留下来源条目与监视', async () => {
    const h = harness()
    const deps = { ...h.deps, reload: async () => { throw new Error('重读失败') } }
    const handle = await createWidgetBoardService(createProviderRegistry(deps)).registerProvider(registration('acme.widgets'))
    await expect(handle.registerWidgets({ directory: '/p/one' })).rejects.toThrow(/重读失败/)
    expect(h.roots).toEqual([])
    expect(handle.directories).toEqual([])
  })
})

describe('新旧入口', () => {
  it('旧入口接受 2 与 3，新入口只接受 3', async () => {
    const h = harness({ '/p/old': ['old-one'] })
    const service = serviceOf(h)
    const handle: WidgetTypeHandle = await service.registerWidgetType({ apiVersion: 2, provider: 'old', directory: '/p/old' })
    expect(handle.widgets).toEqual(['old-one'])
    expect(handle.provider).toBe('old')
    expect(h.roots[0]?.authorDomain).toBeUndefined()
    await expect(service.registerProvider({ apiVersion: 2, provider: 'acme' })).rejects.toThrow(/服务版本是 3/)
    await expect(service.registerWidgetType({ apiVersion: 1, provider: 'x', directory: '/p/x' })).rejects.toThrow(/接受版本 2、3/)
    expect(() => service.registerDataSource({ apiVersion: 4, provider: 'x', id: 's', read: () => 0 })).toThrow(/接受版本 2、3/)
    expect(() => service.registerAction({ apiVersion: 1, provider: 'x', id: 'a', run: () => undefined })).toThrow(/接受版本 2、3/)
    expect(() => service.registerCapability({ apiVersion: 4, provider: 'x', id: 'c', call: () => 0 })).toThrow(/接受版本 2、3/)
    expect(() => service.registerMarketProvider({ apiVersion: 1, ...MARKET, provider: 'x' })).toThrow(/接受版本 2、3/)
  })

  it('一个提供方不能同时经新旧两个入口注册', async () => {
    const h = harness({ '/p/old': ['old-one'], '/p/new': ['acme.new'] })
    const service = serviceOf(h)
    const old = await service.registerWidgetType({ apiVersion: 3, provider: 'acme', directory: '/p/old' })
    await expect(service.registerProvider(registration('acme'))).rejects.toThrow(/旧入口/)
    await old.dispose()
    const handle = await service.registerProvider(registration('acme'))
    await expect(service.registerWidgetType({ apiVersion: 2, provider: 'acme', directory: '/p/new' })).rejects.toThrow(/已经用 registerProvider 注册过/)
    expect(() => service.registerDataSource({ apiVersion: 2, provider: 'acme', id: 's', read: () => 0 })).toThrow(/已经用 registerProvider 注册过/)
    await handle.dispose()
    const legacy = await service.registerWidgetType({ apiVersion: 2, provider: 'acme', directory: '/p/new' })
    expect(legacy.widgets).toEqual(['acme.new'])
  })

  it('旧入口的把手只撤下自己这一个目录', async () => {
    const h = harness({ '/p/one': ['one'], '/p/two': ['two'] })
    const service = serviceOf(h)
    const first = await service.registerWidgetType({ apiVersion: 2, provider: 'p', directory: '/p/one' })
    await service.registerWidgetType({ apiVersion: 2, provider: 'p', directory: '/p/two' })
    await first.dispose()
    expect(h.roots.map((root) => root.dir)).toEqual(['/p/two'])
    expect(h.stops).toEqual(['/p/one'])
    expect(h.forgotten).toEqual(['p'])
  })

  it('把手上的子注册报别的提供方时抛出，且不留下一部分', async () => {
    const h = harness({ '/p/one': ['one'] })
    const handle = await serviceOf(h).registerProvider(registration('acme'))
    const directory = await handle.registerWidgets({ directory: '/p/one' })
    expect(() => directory.register({
      actions: [
        { apiVersion: 3, provider: 'acme', id: 'touch', run: () => undefined },
        { apiVersion: 3, provider: 'other', id: 'steal', run: () => undefined },
      ],
    })).toThrow(/provider 是 other/)
    expect(h.registries.resolveAction('touch')).toBeUndefined()
  })
})

describe('注册配额', () => {
  it('数据源到 64 个上限就抛出，撤下一个之后又能注册', async () => {
    const h = harness()
    const handle = await serviceOf(h).registerProvider(registration('acme'))
    const releases = []
    for (let index = 0; index < PROVIDER_SOURCE_LIMIT; index += 1) {
      releases.push(handle.registerDataSource({ id: 's' + String(index), read: () => 0 }))
    }
    expect(() => handle.registerDataSource({ id: 'over', read: () => 0 })).toThrow(/数据源已经到 64 个上限/)
    releases[0]?.()
    expect(() => handle.registerDataSource({ id: 'over', read: () => 0 })).not.toThrow()
  })

  it('动作与能力各有自己的上限，新旧入口一起算', async () => {
    const h = harness({ '/p/old': [] })
    const service = serviceOf(h)
    for (let index = 0; index < 64; index += 1) {
      service.registerAction({ apiVersion: 2, provider: 'acme', id: 'a' + String(index), run: () => undefined })
    }
    expect(() => service.registerAction({ apiVersion: 2, provider: 'acme', id: 'over', run: () => undefined })).toThrow(/动作已经到 64 个上限/)
    const handle = await service.registerProvider(registration('other'))
    for (let index = 0; index < PROVIDER_CAPABILITY_LIMIT; index += 1) {
      handle.registerCapability({ id: 'c' + String(index), call: () => 0 })
    }
    expect(() => handle.registerCapability({ id: 'over', call: () => 0 })).toThrow(/能力已经到 64 个上限/)
    expect(() => service.registerCapability({ apiVersion: 3, provider: 'acme', id: 'x', call: () => 0 })).not.toThrow()
  })

  it('组件数到 128 个上限就抛出，那一次目录不留在来源表里', async () => {
    const ids: Record<string, string[]> = { '/p/full': [] }
    for (let index = 0; index < PROVIDER_WIDGET_LIMIT; index += 1) {
      ids['/p/full']?.push('acme.w' + String(index))
    }
    ids['/p/extra'] = ['acme.extra']
    const h = harness(ids)
    const handle = await serviceOf(h).registerProvider(registration('acme'))
    await handle.registerWidgets({ directory: '/p/full' })
    await expect(handle.registerWidgets({ directory: '/p/extra' })).rejects.toThrow(/组件上限是 128 个/)
    expect(handle.directories).toEqual(['/p/full'])
    expect(h.roots.map((root) => root.dir)).toEqual(['/p/full'])
    expect(h.starts).toEqual(['/p/full'])
  })
})

describe('重名与监视归属', () => {
  it('跨提供方重名保留先到者，并说明已有提供方', async () => {
    const h = harness()
    const service = serviceOf(h)
    const first = await service.registerProvider(registration('acme'))
    const second = await service.registerProvider(registration('beta'))
    first.registerDataSource({ id: 'count', read: () => 1 })
    first.registerAction({ id: 'touch', run: () => undefined })
    expect(() => second.registerDataSource({ id: 'count', read: () => 2 })).toThrow(/已经由 acme 注册过/)
    expect(() => second.registerAction({ id: 'touch', run: () => undefined })).toThrow(/已经由 acme 注册过/)
    expect(h.registries.resolveDataSource('count')?.provider).toBe('acme')
  })

  it('两个提供方注册同一个目录时共用一个监视，先撤下的那个不停掉别人的', async () => {
    const h = harness({ '/shared': ['acme.one'] })
    const service = serviceOf(h)
    const first = await service.registerProvider(registration('acme'))
    const second = await service.registerProvider(registration('beta'))
    await first.registerWidgets({ directory: '/shared' })
    await second.registerWidgets({ directory: '/shared' })
    expect(h.starts).toEqual(['/shared'])
    await first.dispose()
    expect(h.stops).toEqual([])
    expect(h.roots.map((root) => root.provider)).toEqual(['beta'])
    await second.dispose()
    expect(h.stops).toEqual(['/shared'])
  })

  it('旧入口的目录与把手共用同一个监视', async () => {
    const h = harness({ '/shared': [] })
    const service = serviceOf(h)
    const legacy = await service.registerWidgetType({ apiVersion: 2, provider: 'acme', directory: '/shared' })
    const handle = await service.registerProvider(registration('beta'))
    await handle.registerWidgets({ directory: '/shared' })
    expect(h.starts).toEqual(['/shared'])
    await legacy.dispose()
    expect(h.stops).toEqual([])
    await handle.dispose()
    expect(h.stops).toEqual(['/shared'])
  })
})

describe('功能声明与 supports', () => {
  it('未知的功能名让注册失败，合法的子集照常注册', async () => {
    const h = harness()
    const service = serviceOf(h)
    await expect(service.registerProvider({ apiVersion: WIDGET_BOARD_PROVIDER_API_VERSION, provider: 'acme', features: ['nope' as WidgetBoardFeature] }))
      .rejects.toThrow(/未知的功能 nope/)
    const handle = await service.registerProvider({
      apiVersion: WIDGET_BOARD_PROVIDER_API_VERSION,
      provider: 'acme',
      features: ['marketProvider', 'eventData'],
    })
    expect(handle.provider).toBe('acme')
    expect(handle.supports('marketProvider')).toBe(true)
    expect(handle.supports('capabilityMetadata')).toBe(true)
    expect(handle.features).toEqual([...WIDGET_BOARD_FEATURES])
  })

  it('没有功能声明时照常注册', async () => {
    const h = harness()
    const handle = await serviceOf(h).registerProvider(registration('acme'))
    expect(handle.supports('pushData')).toBe(true)
  })

  it('service 与把手的 supports 遇到未知名字都抛出', async () => {
    const h = harness()
    const service = serviceOf(h)
    const handle = await service.registerProvider(registration('acme'))
    expect(() => service.supports?.('nope' as WidgetBoardFeature)).toThrow(/未知的功能 nope/)
    expect(() => handle.supports('nope' as WidgetBoardFeature)).toThrow(/未知的功能 nope/)
    expect(service.supports?.('pushData')).toBe(true)
    expect(handle.supports('eventData')).toBe(true)
  })
})

describe('拆除', () => {
  it('disposeAll 撤下全部提供方与它们的授权', async () => {
    const h = harness({ '/p/one': ['one'] })
    const registry = createProviderRegistry(h.deps)
    const service = createWidgetBoardService(registry)
    const handle = await service.registerProvider(registration('acme'))
    await handle.registerWidgets({ directory: '/p/one' })
    handle.registerDataSource({ id: 'count', read: () => 0 })
    await service.registerWidgetType({ apiVersion: 2, provider: 'legacy', directory: '/p/one' })
    await registry.disposeAll()
    expect(h.roots).toEqual([])
    expect(h.registries.hasDataSource('count')).toBe(false)
    expect(h.forgotten.sort()).toEqual(['acme', 'legacy'])
    expect(registry.roots).toEqual([])
  })
})

describe('健康记录', () => {
  it('目录、数据源、动作、能力与市场的注册都计数，dispose 之后不可用，重新注册恢复', async () => {
    const h = harness({ '/p/one': ['acme.one'] })
    const service = serviceOf(h)
    const handle = await service.registerProvider({
      apiVersion: WIDGET_BOARD_PROVIDER_API_VERSION,
      provider: 'acme',
      features: ['marketProvider'],
    })
    await handle.registerWidgets({ directory: '/p/one' })
    handle.registerDataSource({ id: 'count', read: () => 0 })
    handle.registerAction({ id: 'touch', run: () => undefined })
    handle.registerCapability({ id: 'ping', call: () => 'pong' })
    handle.registerMarketProvider(MARKET)
    expect(h.health.snapshot()).toEqual([
      { provider: 'acme', features: ['marketProvider'], registrations: 5, failures: 0, timeouts: 0, available: true },
    ])
    await handle.dispose()
    // 计数留着：设置页看得出这个提供方曾经注册过几项、现在还在不在。
    expect(h.health.snapshot()[0]).toMatchObject({ registrations: 5, failures: 0, timeouts: 0, available: false })
    const again = await service.registerProvider({ apiVersion: WIDGET_BOARD_PROVIDER_API_VERSION, provider: 'acme' })
    expect(h.health.snapshot()[0]).toMatchObject({ registrations: 5, available: true })
    await again.dispose()
  })

  it('目录读不出来时那一次不计注册', async () => {
    const h = harness()
    const deps = { ...h.deps, reload: async () => { throw new Error('重读失败') } }
    const handle = await createWidgetBoardService(createProviderRegistry(deps)).registerProvider(registration('acme'))
    await expect(handle.registerWidgets({ directory: '/p/one' })).rejects.toThrow(/重读失败/)
    expect(h.health.snapshot()[0]).toMatchObject({ registrations: 0, available: true })
  })
})
