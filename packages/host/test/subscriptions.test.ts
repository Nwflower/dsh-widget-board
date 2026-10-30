/**
 * 数据订阅的生命周期（D32）：谁在什么时候订阅、什么时候退订，推送怎么进卡片。
 *
 * 这里的看板、通知器与注册表是替身：这一层判定的是订阅的启停判定与写入顺序，不是工作区的实现。
 * 定时链与订阅的互斥判定在 `intervalCardsOf` 里，是宿主真的那一份。
 */
import { describe, expect, it } from 'vitest'
import type { ActionPermission, Board, BoardEvent, BoardInstance, WidgetManifest } from '@dsh-widget-board/contracts'
import type { GrantStore } from '../src/grants'
import type { VisibleCards } from '../src/live'
import type { WidgetRecord } from '../src/library'
import { createProviderHealth } from '../src/provider-health'
import type { RouteContext } from '../src/routes'
import type { SaveOptions } from '../src/workspace'
import type { Registries } from '../src/sources'
import { createRegistries } from '../src/sources'
import type { Subscriptions } from '../src/subscriptions'
import { createSubscriptions, intervalCardsOf } from '../src/subscriptions'
import { memoryGrants } from './memory-grants'

/** 一个版本固定的组件。 */
const HASH = 'e'.repeat(64)

/** 一张卡的组件：data schema 要一个数字。 */
const MANIFEST: WidgetManifest = {
  id: 'feed',
  title: { zh: '推送源', en: 'Feed' },
  version: '0.1.0',
  sizes: ['s'],
  data: { type: 'object', required: ['n'], properties: { n: { type: 'number' } } },
}

/**
 * 一块看板。
 *
 * @param instances - 卡片。
 * @returns 看板。
 */
function boardOf(instances: BoardInstance[]): Board {
  return { version: 2, id: 'board', title: '看板', revision: 1, layoutRevision: 1, instances }
}

/**
 * 一张卡。
 *
 * @param id - 卡片 id。
 * @param source - 绑定的数据源。
 * @returns 卡片。
 */
function cardOf(id: string, source?: string): BoardInstance {
  return {
    id,
    widget: MANIFEST.id,
    hash: HASH,
    props: {},
    data: null,
    state: null,
    layout: { x: 0, y: 0, w: 1, h: 10 },
    ...(source === undefined ? {} : { source }),
  }
}

/** 一套替身。 */
interface Harness {
  context: RouteContext
  subscriptions: Subscriptions
  sources: Registries
  /** 写入落定的次序：每条推送的数据。 */
  writes: unknown[]
  /** 推给宿主的事件。 */
  events: BoardEvent[]
  /** 观众与可见集合，测试直接改。 */
  live: { setViewers(viewers: number): void, setVisible(visible: 'all' | string[]): void }
  /** 现在看板上的那张卡。 */
  board(): Board
  /** 改一张卡的 props。 */
  setProps(id: string, props: Record<string, unknown>): void
  /** 把一张卡从看板上拿掉。 */
  remove(id: string): void
  /** 等所有在途的推送写完。 */
  settled(): Promise<void>
}

/**
 * 起一套替身。
 *
 * @param instances - 看板上的卡片。
 * @param grants - 授权表；省略时是空的。
 * @param manifest - 组件库里的那一份；省略时是推送源本身。
 * @returns 上下文、订阅与可以直接改的观众。
 */
function harness(instances: BoardInstance[], grants: GrantStore = memoryGrants(), manifest: WidgetManifest = MANIFEST): Harness {
  let board = boardOf(instances)
  const writes: unknown[] = []
  const events: BoardEvent[] = []
  let viewers = 0
  let visible: VisibleCards = 'all'
  const record: WidgetRecord = { manifest, source: 'user', dir: '/widgets/feed', hash: HASH, files: new Map() }
  const health = createProviderHealth()
  const sources = createRegistries(health)
  const workspace = {
    list: () => [board],
    activeId: () => board.id,
    active: () => board,
    board: () => board,
    has: () => true,
    findInstance: (id: string) => {
      const instance = board.instances.find((candidate) => candidate.id === id)
      return instance === undefined ? undefined : { board, instance }
    },
    save: async (_boardId: string, change: (current: Board) => Board, options: SaveOptions) => {
      const next = change(board)
      const event = options.event(next, board.id)
      const slow = event.type === 'instance' && typeof event.data === 'object' && event.data !== null
        && (event.data as { slow?: unknown }).slow === true
      // 慢的那一条让出事件循环：没串行的话，后发的那条会先落定。
      if (slow) await new Promise((resolve) => setTimeout(resolve, 20))
      board = next
      events.push(event)
      writes.push(event.type === 'instance' ? event.data : event)
      return next
    },
  }
  const live = {
    get viewers() { return viewers },
    get visible() { return visible },
  }
  const context = {
    records: new Map([[manifest.id, record]]),
    entries: [],
    sources,
    grants,
    live,
    workspace,
  } as unknown as RouteContext
  const subscriptions = createSubscriptions(context)
  return {
    context,
    subscriptions,
    sources,
    writes,
    events,
    live: {
      setViewers(next) { viewers = next },
      setVisible(next) { visible = next === 'all' ? 'all' : new Set(next) },
    },
    board: () => board,
    setProps(id, props) {
      board = { ...board, instances: board.instances.map((instance) => (instance.id === id ? { ...instance, props } : instance)) }
    },
    remove(id: string) { board = { ...board, instances: board.instances.filter((instance) => instance.id !== id) } },
    async settled() { await subscriptions.settled() },
  }
}

/** 一个能推数据的数据源，按卡片记住交给它的 emit。 */
interface Feed {
  /** 每张卡订阅、退订与读取的次数。 */
  counters: { subscribed: number, unsubscribed: number, read: number }
  /** 每张卡最后一次订阅拿到的 props。 */
  faces: Map<string, unknown>
  /** 一张卡的推送函数；退订之后仍然留着，用来试迟到的推送。 */
  emit(card: string, data: unknown): void
  /** 提供方撤下。 */
  dispose(): void
}

/**
 * 注册一个带 `subscribe` 的数据源。
 *
 * @param sources - 注册表。
 * @param options - 名字与它声明的权限。
 * @returns 推送函数与计数。
 */
function addFeed(sources: Registries, options: { id?: string, permission?: ActionPermission } = {}): Feed {
  const emitters = new Map<string, (data: unknown) => void>()
  const faces = new Map<string, unknown>()
  const counters = { subscribed: 0, unsubscribed: 0, read: 0 }
  const dispose = sources.registerDataSource({
    apiVersion: 3,
    provider: 'acme',
    id: options.id ?? 'feed',
    ...(options.permission === undefined ? {} : { permission: options.permission }),
    read: () => { counters.read += 1; return { n: 0 } },
    subscribe(instance, emit) {
      counters.subscribed += 1
      emitters.set(instance.id, emit)
      faces.set(instance.id, instance.props)
      return () => { counters.unsubscribed += 1 }
    },
  })
  return {
    counters,
    faces,
    emit(card, data) { emitters.get(card)?.(data) },
    dispose,
  }
}

describe('订阅的启停', () => {
  it('有人看着且看得见才订阅，启动时不替组件读一次', () => {
    const test = harness([cardOf('card', 'feed')])
    const feed = addFeed(test.sources)
    test.subscriptions.sync()
    expect(feed.counters.subscribed).toBe(0)

    test.live.setViewers(1)
    test.subscriptions.sync()
    expect(feed.counters.subscribed).toBe(1)
    expect(test.subscriptions.cards.has('card')).toBe(true)
    // 初值由提供方在 subscribe 里自己推：宿主不替它读一次。
    expect(feed.counters.read).toBe(0)
  })

  it('观众走光就退订', () => {
    const test = harness([cardOf('card', 'feed')])
    const feed = addFeed(test.sources)
    test.live.setViewers(1)
    test.subscriptions.sync()
    test.live.setViewers(0)
    test.subscriptions.sync()
    expect(feed.counters.unsubscribed).toBe(1)
    expect(test.subscriptions.cards.has('card')).toBe(false)
  })

  it('看不见的卡不订阅，离开视口就退订，看回来再订', () => {
    const test = harness([cardOf('card', 'feed')])
    const feed = addFeed(test.sources)
    test.live.setViewers(1)
    test.live.setVisible([])
    test.subscriptions.sync()
    expect(feed.counters.subscribed).toBe(0)

    test.live.setVisible(['card'])
    test.subscriptions.sync()
    expect(feed.counters.subscribed).toBe(1)

    test.live.setVisible([])
    test.subscriptions.sync()
    expect(feed.counters.unsubscribed).toBe(1)
    expect(test.subscriptions.cards.has('card')).toBe(false)
  })

  it('卡片被移除就退订', () => {
    const test = harness([cardOf('card', 'feed')])
    const feed = addFeed(test.sources)
    test.live.setViewers(1)
    test.subscriptions.sync()
    test.remove('card')
    test.subscriptions.sync()
    expect(feed.counters.unsubscribed).toBe(1)
  })

  it('提供方撤下就退订', () => {
    const test = harness([cardOf('card', 'feed')])
    const feed = addFeed(test.sources)
    test.live.setViewers(1)
    test.subscriptions.sync()
    expect(feed.counters.subscribed).toBe(1)
    feed.dispose()
    test.subscriptions.sync()
    expect(feed.counters.unsubscribed).toBe(1)
    expect(test.subscriptions.cards.has('card')).toBe(false)
  })

  it('授权不在就不开订阅，给出授权才开，收回就退订', async () => {
    const grants = memoryGrants()
    const permission: ActionPermission = { hosts: ['example.com'] }
    const test = harness([cardOf('card', 'feed')], grants)
    const feed = addFeed(test.sources, { permission })
    test.live.setViewers(1)
    test.subscriptions.sync()
    expect(feed.counters.subscribed).toBe(0)

    await grants.grant({ kind: 'source', id: 'feed', hash: HASH, widget: MANIFEST.id, provider: 'acme', permission })
    test.subscriptions.sync()
    expect(feed.counters.subscribed).toBe(1)

    await grants.revoke('source', HASH, 'feed')
    test.subscriptions.sync()
    expect(feed.counters.unsubscribed).toBe(1)
  })

  it('退订之后迟到的推送不再写卡片', async () => {
    const test = harness([cardOf('card', 'feed')])
    const feed = addFeed(test.sources)
    test.live.setViewers(1)
    test.subscriptions.sync()
    test.live.setViewers(0)
    test.subscriptions.sync()
    feed.emit('card', { n: 3 })
    await test.settled()
    expect(test.writes).toEqual([])
    expect(test.board().instances[0]?.data).toBeNull()
  })
})

describe('props 变化后的重订', () => {
  it('props 变了先退订再按最新 props 重订，新订阅照常收到推送', async () => {
    const test = harness([cardOf('card', 'feed')])
    const feed = addFeed(test.sources)
    test.live.setViewers(1)
    test.subscriptions.sync()
    expect(feed.faces.get('card')).toEqual({})
    expect(feed.counters.subscribed).toBe(1)

    test.setProps('card', { title: '用量', page: 2 })
    test.subscriptions.sync()
    // 旧订阅当场退掉，新的那次订阅拿到的是改过之后的 props。
    expect(feed.counters.unsubscribed).toBe(1)
    expect(feed.counters.subscribed).toBe(2)
    expect(feed.faces.get('card')).toEqual({ title: '用量', page: 2 })
    expect(test.subscriptions.cards.has('card')).toBe(true)

    // 重订之后的订阅是活的：推上来的数据照旧写进卡片。
    feed.emit('card', { n: 4 })
    await test.settled()
    expect(test.board().instances[0]?.data).toEqual({ n: 4 })
  })

  it('props 没变的重同步不重建，内容相同而键序不同也是同一份', () => {
    const test = harness([cardOf('card', 'feed')])
    const feed = addFeed(test.sources)
    test.live.setViewers(1)
    test.subscriptions.sync()
    test.subscriptions.sync()
    expect(feed.counters.subscribed).toBe(1)
    expect(feed.counters.unsubscribed).toBe(0)

    test.setProps('card', { title: '用量', page: 2 })
    test.subscriptions.sync()
    expect(feed.counters.subscribed).toBe(2)

    // 同样的内容按另一个键序写一次：还是同一份 props，不退订也不重建。
    test.setProps('card', { page: 2, title: '用量' })
    test.subscriptions.sync()
    expect(feed.counters.subscribed).toBe(2)
    expect(feed.counters.unsubscribed).toBe(1)
  })

  it('props 变了而订阅条件不再满足时只退订，不重建', () => {
    const test = harness([cardOf('card', 'feed')])
    const feed = addFeed(test.sources)
    test.live.setViewers(1)
    test.subscriptions.sync()
    test.live.setViewers(0)
    test.setProps('card', { title: '用量' })
    test.subscriptions.sync()
    expect(feed.counters.unsubscribed).toBe(1)
    expect(feed.counters.subscribed).toBe(1)
    expect(test.subscriptions.cards.has('card')).toBe(false)
  })
})

describe('推送进入卡片', () => {
  it('按组件 data schema 核对后写入，发一条 instance data 事件', async () => {
    const test = harness([cardOf('card', 'feed')])
    const feed = addFeed(test.sources)
    test.live.setViewers(1)
    test.subscriptions.sync()
    feed.emit('card', { n: 7 })
    await test.settled()
    expect(test.writes).toEqual([{ n: 7 }])
    expect(test.events.at(-1)).toEqual({ type: 'instance', id: 'card', data: { n: 7 } })
    expect(test.board().instances[0]?.data).toEqual({ n: 7 })
  })

  it('不合 schema 的推送不写卡片，记在提供方名下，别的卡照常收', async () => {
    const test = harness([cardOf('first', 'feed'), cardOf('second', 'feed')])
    const feed = addFeed(test.sources)
    test.live.setViewers(1)
    test.subscriptions.sync()
    feed.emit('first', { n: '不是数字' })
    feed.emit('second', { n: 2 })
    await test.settled()
    expect(test.board().instances[0]?.data).toBeNull()
    expect(test.board().instances[1]?.data).toEqual({ n: 2 })
    expect(test.writes).toEqual([{ n: 2 }])
    const record = test.sources.health.snapshot().find((entry) => entry.provider === 'acme')
    expect(record?.failures).toBe(1)
    // 来源与卡片写在前面，dataError 自带的那一句只出现一次。
    expect(record?.lastError).toMatch(/^provider-output：数据源 feed 推给卡片 first 的数据不合格：数据与组件的 data schema 不符：/)
    expect(record?.lastError?.match(/data schema 不符/g)).toHaveLength(1)
  })

  it('同一张卡的两次推送按发出的顺序写入', async () => {
    const test = harness([cardOf('card', 'feed')])
    const feed = addFeed(test.sources)
    test.live.setViewers(1)
    test.subscriptions.sync()
    // 第一条故意慢：没串行的话第二条会先落定。
    feed.emit('card', { n: 1, slow: true })
    feed.emit('card', { n: 2 })
    await test.settled()
    expect(test.writes).toEqual([{ n: 1, slow: true }, { n: 2 }])
    expect(test.board().instances[0]?.data).toEqual({ n: 2 })
  })
})

describe('订阅与定时链的互斥', () => {
  it('声明了 subscribe 的源不进定时表，没声明的按间隔在里面', () => {
    const test = harness(
      [cardOf('pushed', 'feed'), cardOf('polled', 'plain')],
      memoryGrants(),
      { ...MANIFEST, refresh: { mode: 'interval', everyMs: 5000 } },
    )
    addFeed(test.sources)
    test.sources.registerDataSource({ apiVersion: 3, provider: 'acme', id: 'plain', read: () => ({ n: 0 }) })
    // 两张卡都声明了定时刷新：带 subscribe 的那一张只按订阅走，不进定时表。
    expect(intervalCardsOf(test.context)).toEqual([{ id: 'polled', everyMs: 5000 }])
  })
})
