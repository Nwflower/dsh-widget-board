/**
 * 数据订阅的生命周期（D32）：哪些卡现在订阅着、什么时候退订、推上来的数据怎么写进卡片。
 *
 * 一个判定决定一张卡订不订：它的数据源声明了 `subscribe`、这个源此刻解析得到、要读它的授权还在、
 * 而且至少有一位看板页的观众看得见它。四项任一不成立就退订——卡片离开视口、观众走光、卡片被移除、
 * 提供方撤下、授权被收回都走同一个判定，所以 `sync()` 可以被反复调用，不需要记住上一次发生了什么。
 *
 * 订阅身份带着 props：`subscribe` 拿到的是订阅成立那一刻的卡片面，props 变了而订阅还在时它一直读旧值。
 * 所以 props 的稳定表示进订阅身份与失败去重键，props 一变就先退订，再按最新的一面重订。
 *
 * 订阅不占定时刷新链：声明了 `subscribe` 的源只按订阅走（{@link intervalCardsOf}），同一张卡不会同时
 * 开着两条链。启动时不替组件读一次——需要初值的数据源在 `subscribe` 里自己推一次。
 *
 * 推送归数据源，写入归看板：每一条都按组件的 data schema 核对，再交给唯一的写入者（D5、D23）。同一张
 * 卡的推送按发出的顺序串行写；一条坏数据只停它自己，记在提供方的健康记录里，别的卡照常收。
 */
import type { ActionPermission, Board, DataSourceRegistration } from '@dsh-widget-board/contracts'
import { faceOf, grantFacts } from './lookup'
import { storeData } from './instance-operations'
import { grantProblemOf } from './permissions'
import type { RouteContext } from './routes'
import type { ScheduledCard } from './refresh'
import { intervalOf } from './refresh'
import { dataError } from './schema'

/** 一张卡该订的源：注册项里的 `subscribe` 已经取出来，判定过就一定在。 */
interface WantedSource {
  source: string
  provider: string
  /** 卡片 props 的稳定表示；props 变了就是另一份订阅。 */
  propsKey: string
  registration: DataSourceRegistration
  subscribe: NonNullable<DataSourceRegistration['subscribe']>
}

/** 一张卡现在开着的订阅。 */
interface Subscription {
  /** 卡片实例的 id。 */
  card: string
  /** 订阅的是哪个源；换源就是换订阅。 */
  source: string
  /** 提供方：失败记在它名下。 */
  provider: string
  /** 订阅成立时的 props 稳定表示；与卡片现在的 props 不一致就是该重订了。 */
  propsKey: string
  /** 退订；提供方在 `subscribe` 里交回来的那个。 */
  unsubscribe: () => void
  /**
   * 这张卡推送的写入队列：同一条队列保证写入按发出的顺序（D32）。
   *
   * 队列本身不会拒绝——一条推送的失败在写入那里就地处理掉，不留给下一条。
   */
  queue: Promise<void>
}

/** 订阅的生命周期。 */
export interface Subscriptions {
  /**
   * 按当前的观众、可见集合、卡片表、提供方与授权重算一次：不该订的退掉，该订的订上。
   *
   * 观众变化、可见集合变化、卡片增删、组件库重读、授权给出或收回、提供方注册或撤下之后都调它；
   * 卡片 props 变化之后也要调：props 是订阅身份的一部分。
   */
  sync(): void
  /** 退掉全部订阅并停止接新的；拆除时用。 */
  stop(): void
  /** 现在订阅着哪些卡，按卡片 id，给测试与排查看。 */
  readonly cards: ReadonlySet<string>
  /** 等所有在途的推送写完。 */
  settled(): Promise<void>
}

/** 一条推送失败的说法：哪张卡、哪个源、什么原因。 */
function pushFailure(card: string, source: string, reason: string): void {
  console.error(`widget-board: 卡片 ${card} 的订阅 ${source} 推来的数据没有写进去：${reason}`)
}

/**
 * 卡片 props 的稳定表示（D32）：同一个对象换个键序写出来的串相同。
 *
 * 订阅身份要按值比较 props，直接 `JSON.stringify` 会按写入时的键序比较，同一份 props 重新序列化一次
 * 就可能被当成变了，于是白退订白重建一次；写入方也不能指望每次都是同一个键序。
 *
 * @param props - 卡片的 props。
 * @returns 与键序无关的字符串。
 */
function propsKeyOf(props: Record<string, unknown>): string {
  return JSON.stringify(props, (_key, value: unknown) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return value
    const sorted: Record<string, unknown> = {}
    const record = value as Record<string, unknown>
    for (const key of Object.keys(record).sort()) sorted[key] = record[key]
    return sorted
  })
}

/**
 * 一张卡的订阅该不该开着：数据源声明了 `subscribe`、要读它的授权还在，而且观众看得见它。
 *
 * @param context - 路由上下文。
 * @param card - 卡片实例与它绑定的源名。
 * @returns 该订的源与它的注册项；不订时为 `undefined`。
 */
function wantedSourceOf(
  context: RouteContext,
  card: { id: string, source?: string, props: Record<string, unknown> },
): WantedSource | undefined {
  const source = card.source
  if (source === undefined) return undefined
  const resolved = context.sources.resolveDataSource(source)
  const subscribe = resolved?.registration.subscribe
  if (resolved === undefined || subscribe === undefined) return undefined
  return { source, provider: resolved.provider, propsKey: propsKeyOf(card.props), registration: resolved.registration, subscribe }
}

/**
 * 建一份订阅的生命周期。
 *
 * @param context - 路由上下文：看板、组件库、注册表、授权表与观众。
 * @returns 订阅的生命周期。
 */
export function createSubscriptions(context: RouteContext): Subscriptions {
  const active = new Map<string, Subscription>()
  /**
   * `subscribe` 抛过的卡与它当时的「源|提供方|props」。
   *
   * 条件不变就不再试：每一次 sync 都撞同一次失败，换成每条请求都报一次错。条件变了（换源、换提供方、
   * 换 props）就再给一次机会。
   */
  const refused = new Map<string, string>()
  let stopped = false

  /** 一张卡现在能不能订：授权在不在，问的是与读取同一条判定（D6）。 */
  const permitted = (board: Board, card: { id: string }, source: string, provider: string, permission: ActionPermission | undefined): boolean => {
    return grantProblemOf(grantFacts(context, board), card.id, 'source', source, permission, provider) === undefined
  }

  /** 退掉一张卡的订阅；提供方交回来的那一个可能抛错，一张卡出错不波及其他卡（D11）。 */
  const release = (card: string, reason?: string): void => {
    const entry = active.get(card)
    if (entry === undefined) return
    active.delete(card)
    if (reason !== undefined) console.error(`widget-board: 卡片 ${card} 的订阅停了：${reason}`)
    try {
      entry.unsubscribe()
    } catch (error) {
      console.error(`widget-board: 卡片 ${card} 的订阅退订失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * 写一条推上来的数据：授权、data schema 与唯一的写入者。
   *
   * 失败只停这一条：schema 不符按提供方记一次，写入失败只报出来，都不抛出——一张卡的提供方出错不该让
   * 其余的卡跟着停（D11、D32）。
   */
  const write = async (entry: Subscription, data: unknown): Promise<void> => {
    if (active.get(entry.card) !== entry) return
    const found = context.workspace.findInstance(entry.card)
    // 卡片在两次推送之间被移除了：这一条没有落点，丢掉。退订走的是同一张卡的下一次 sync。
    if (found === undefined) return
    const resolved = context.sources.resolveDataSource(entry.source)
    if (resolved === undefined) {
      release(entry.card, `数据源 ${entry.source} 已经不在了`)
      return
    }
    const problem = grantProblemOf(grantFacts(context, found.board), entry.card, 'source', entry.source, resolved.registration.permission, resolved.provider)
    if (problem !== undefined) {
      release(entry.card, problem.message)
      return
    }
    const schema = context.records.get(found.instance.widget)?.manifest.data
    const mismatch = dataError(schema, data)
    if (mismatch !== undefined) {
      // dataError 交出来的已经是一整句「数据与组件的 data schema 不符：…」：健康记录只写来源与卡片，
      // 同一句话不在文案里出现两次。
      context.sources.health.failed(entry.provider, 'provider-output', `数据源 ${entry.source} 推给卡片 ${entry.card} 的数据不合格：${mismatch}`)
      pushFailure(entry.card, entry.source, mismatch)
      return
    }
    try {
      await storeData(context, entry.card, data)
    } catch (error) {
      pushFailure(entry.card, entry.source, error instanceof Error ? error.message : String(error))
    }
  }

  /** 在途的推送数：{@link Subscriptions.settled} 据此等它们都写完。 */
  let pending = 0
  /** 在途的推送清零时叫醒的人。 */
  const idle: (() => void)[] = []

  /** 一条推送：排进这张卡的队列，于是同一张卡的写入按发出的顺序落定。 */
  const pushInto = (entry: Subscription, data: unknown): void => {
    if (active.get(entry.card) !== entry) return
    pending += 1
    entry.queue = entry.queue.then(async () => {
      try {
        await write(entry, data)
      } finally {
        pending -= 1
        if (pending === 0) {
          for (const resolve of idle.splice(0)) resolve()
        }
      }
    })
  }

  const sync = (): void => {
    if (stopped) return
    const wanted = new Map<string, WantedSource>()
    if (context.live.viewers > 0) {
      const visible = context.live.visible
      for (const board of context.workspace.list()) {
        for (const card of board.instances) {
          if (visible !== 'all' && !visible.has(card.id)) continue
          const wantedSource = wantedSourceOf(context, card)
          if (wantedSource === undefined) continue
          // 组件不在库里的卡画成占位，不替它开订阅。
          if (!context.records.has(card.widget)) continue
          // 授权不在的卡连订阅都不开：订阅会在没人给授权的情况下持续拿到数据（D6、D32）。
          if (!permitted(board, card, wantedSource.source, wantedSource.provider, wantedSource.registration.permission)) continue
          wanted.set(card.id, wantedSource)
        }
      }
    }

    // 不该订的先退：换源、换提供方、props 变了、看不见、观众走光、卡片移除、提供方撤下、授权失效都落在这一步。
    for (const [card, entry] of [...active]) {
      const next = wanted.get(card)
      if (next !== undefined && next.source === entry.source && next.provider === entry.provider && next.propsKey === entry.propsKey) continue
      release(card)
    }

    for (const [card, want] of wanted) {
      if (active.has(card)) continue
      const key = `${want.source}\u0000${want.provider}\u0000${want.propsKey}`
      if (refused.get(card) === key) continue
      const found = context.workspace.findInstance(card)
      if (found === undefined) continue
      const entry: Subscription = { card, source: want.source, provider: want.provider, propsKey: want.propsKey, unsubscribe: () => undefined, queue: Promise.resolve() }
      try {
        // 订阅在写入这张卡的订阅表之前拿到退订函数：实现立刻推第一条时，它已经能排进队列。
        active.set(card, entry)
        entry.unsubscribe = want.subscribe(faceOf(found.board, card), (data: unknown) => { pushInto(entry, data) })
      } catch (error) {
        active.delete(card)
        refused.set(card, key)
        console.error(`widget-board: 卡片 ${card} 订阅 ${want.source} 失败：${error instanceof Error ? error.message : String(error)}`)
      }
    }

    // 条件又变得可能满足的卡重新有机会：订阅失败只在同一份条件下不再重试。
    for (const card of [...refused.keys()]) {
      if (!wanted.has(card)) refused.delete(card)
    }
  }

  return {
    sync,
    stop() {
      stopped = true
      for (const card of [...active.keys()]) release(card)
      refused.clear()
    },
    get cards() { return new Set(active.keys()) },
    async settled() {
      if (pending === 0) return
      await new Promise<void>((resolve) => { idle.push(resolve) })
    },
  }
}

/**
 * 现在哪些卡该按定时链读（D6、D32）。
 *
 * 声明了定时刷新、且绑了源的卡才在里面；声明了 `subscribe` 的源按订阅走，不进这张表——同一张卡不会
 * 同时开着两条链。只算声明，不算观众与可见性：那两件事由调度器按观众算。
 *
 * @param context - 看板、组件库与注册表。
 * @returns 定时链要管的卡片。
 */
export function intervalCardsOf(context: Pick<RouteContext, 'workspace' | 'records' | 'sources'>): ScheduledCard[] {
  const cards: ScheduledCard[] = []
  for (const board of context.workspace.list()) {
    for (const card of board.instances) {
      if (card.source === undefined) continue
      if (context.sources.resolveDataSource(card.source)?.registration.subscribe !== undefined) continue
      const everyMs = intervalOf(context.records.get(card.widget)?.manifest.refresh)
      if (everyMs === undefined) continue
      cards.push({ id: card.id, everyMs })
    }
  }
  return cards
}
