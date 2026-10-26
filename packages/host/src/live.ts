/**
 * 变更通知：宿主把发生了什么推给在线的看板页（D18）。
 *
 * 一条通知带一个全局修订号与改动本身：卡片状态与数据就地合并，布局就地换掉，只有卡片增删与
 * 组件库变化才让页面重取快照。接上时先补一条「重取快照」，页面因此不必在订阅与取快照之间选先后。
 *
 * 同一条连接还带着观众身份与它上报的可见卡片（D6）：调度器按全部观众的并集决定读哪几张卡。
 * 一位观众可以同时接几条连接（看板页与设置页各一条，重连时旧的还会迟到一步关掉），这一份
 * 可见集合跟着观众走，最后一条连接断开才清掉。
 */
import type { BoardEvent, BoardEventFrame, HostResponse } from '@dsh-widget-board/contracts'
import type { DocumentAssets } from './document'

/**
 * 哪些卡片至少有一个看板页看得见（D6 的单卡可见性）。
 *
 * `'all'` 表示还有观众没上报过：按旧的页级行为视为全部可见，没带观众身份的老页面接上来时行为不变。
 */
export type VisibleCards = 'all' | ReadonlySet<string>

/** 在线客户端共享的一份：当前资产、当前修订号，以及订阅它们的响应。 */
export interface Live {
  readonly assets: DocumentAssets
  readonly revision: number
  /** 现在有几条看板页的连接（D6 的刷新调度按它启停）。 */
  readonly viewers: number
  /** 现在看得见哪些卡片；有人连上却还没上报时是 `'all'`。 */
  readonly visible: VisibleCards
  /**
   * 观众人数变化时调一次。
   *
   * @param listener - 收到当前人数。
   * @returns 取消订阅的函数。
   */
  onViewers(listener: (viewers: number) => void): () => void
  /**
   * 可见集合的并集变了时调一次（D6 的调度按它重算）。
   *
   * @param listener - 集合变了之后收到一次通知。
   * @returns 取消订阅的函数。
   */
  onVisible(listener: () => void): () => void
  /**
   * 一位观众报上自己看得见哪些卡片。
   *
   * @param viewer - 观众 id，与这条连接接上通知时的参数同一个。
   * @param ids - 现在看得见的卡片 id。
   * @returns 这位观众还在线、这份上报被记下时为真；连接已经断掉的上报丢掉。
   */
  reportVisible(viewer: string, ids: readonly string[]): boolean
  /**
   * 接一个 SSE 连接：先补一条重取快照的通知，之后跟着变化推。
   *
   * @param response - 这条长连接的响应。
   * @param viewer - 这位观众的身份；不带时按「还没上报」算（D6 的兼容）。
   */
  subscribe(response: HostResponse, viewer?: string): void
  /** 换一份资产，修订号加一并让页面重取快照。 */
  publish(assets: DocumentAssets): void
  /** 推一条改动。 */
  notify(event: BoardEvent): void
  /** 收掉心跳，结束全部长连接。 */
  close(): void
}

/** 心跳的间隔：反向代理与桌面外壳都会掐掉长时间没有字节的连接。 */
const HEARTBEAT_MS = 20_000

/**
 * 两份可见集合是不是同一份。
 *
 * @param a - 一份集合，或「全部可见」。
 * @param b - 另一份。
 * @returns 相同为真。
 */
function sameVisible(a: VisibleCards, b: VisibleCards): boolean {
  if (a === 'all' || b === 'all') return a === b
  if (a.size !== b.size) return false
  for (const id of a) {
    if (!b.has(id)) return false
  }
  return true
}

/**
 * 建一个变更通知。
 *
 * @param assets - 启动时读到的运行时资产。
 * @returns 通知器。
 */
export function createLive(assets: DocumentAssets): Live {
  let current = assets
  let revision = 0
  const audience = new Set<HostResponse>()
  /** 一条连接对应的观众身份；不带 id 的老页面没有登记，按「还没上报」算。 */
  const viewerOf = new Map<HostResponse, string>()
  /**
   * 每位观众现在还接着的连接。
   *
   * 一页可以开两条（看板页与设置页各订阅一次，同一个 id），重连时旧的那条还会迟到一步关掉，
   * 因此只有最后一条走掉才清掉这位观众。
   */
  const connectionsOf = new Map<string, Set<HostResponse>>()
  /** 每位观众上报的可见集合；缺席表示还没上报过。 */
  const reported = new Map<string, ReadonlySet<string>>()
  const watchers = new Set<(viewers: number) => void>()
  const visibleWatchers = new Set<() => void>()
  /** 人数变了就告诉等它的人；一个监听器抛错不影响别人（D11）。 */
  const announceViewers = (): void => {
    for (const listener of watchers) {
      try {
        listener(audience.size)
      } catch {
        watchers.delete(listener)
      }
    }
  }
  /** 可见集合变了才通知：页面只为真的变化发上报，宿主也不为没变的事重算调度。 */
  const announceVisible = (): void => {
    for (const listener of visibleWatchers) {
      try {
        listener()
      } catch {
        visibleWatchers.delete(listener)
      }
    }
  }
  /**
   * 各观众可见集合的并集；有任何一条连接还没上报时是 `'all'`。
   *
   * 按连接遍历而不是按观众：没带身份的老页面永远不会有上报，它必须把结果压回旧的页级行为。
   */
  const visibleNow = (): VisibleCards => {
    const union = new Set<string>()
    for (const response of audience) {
      const viewer = viewerOf.get(response)
      const set = viewer === undefined ? undefined : reported.get(viewer)
      if (set === undefined) return 'all'
      for (const id of set) union.add(id)
    }
    return union
  }
  /** 一次改动之后再比一次：真的变了才通知。 */
  const notifyVisible = (before: VisibleCards): void => {
    if (!sameVisible(before, visibleNow())) announceVisible()
  }
  /**
   * 一条连接离开：它对应的观众与上报的集合一起清掉。
   *
   * 同一位观众还有别的连接接着时留着：重连的页面不该因为旧连接迟到一步就被当成没上报过。
   */
  const forget = (response: HostResponse): void => {
    audience.delete(response)
    const viewer = viewerOf.get(response)
    viewerOf.delete(response)
    if (viewer === undefined) return
    const connections = connectionsOf.get(viewer)
    if (connections === undefined) return
    connections.delete(response)
    if (connections.size > 0) return
    connectionsOf.delete(viewer)
    reported.delete(viewer)
  }
  /** 一条连接离开之后：人数与可见集合各通知一次。 */
  const drop = (response: HostResponse): void => {
    const before = visibleNow()
    forget(response)
    announceViewers()
    notifyVisible(before)
  }
  let heartbeat: ReturnType<typeof setInterval> | undefined
  /** 起心跳；`close()` 收掉之后有新观众接上时重新起，免得重开的连接停在没有字节的线上。 */
  const startHeartbeat = (): void => {
    if (heartbeat !== undefined) return
    heartbeat = setInterval(() => {
      for (const response of audience) {
        try {
          response.write?.(': ping\n\n')
        } catch {
          // 与 announce 同一条规则：断在半条消息上的观众摘掉，其余观众照常收（D11）。
          drop(response)
        }
      }
    }, HEARTBEAT_MS)
    heartbeat.unref()
  }
  startHeartbeat()
  const announce = (event: BoardEvent): void => {
    revision += 1
    const frame: BoardEventFrame = { revision, event }
    const payload = `data: ${JSON.stringify(frame)}\n\n`
    for (const response of audience) {
      try {
        response.write?.(payload)
      } catch {
        // 观众断在半条消息上：摘掉它，其余观众照常收（D11）。
        drop(response)
      }
    }
  }
  return {
    get assets() { return current },
    get revision() { return revision },
    get viewers() { return audience.size },
    get visible() { return visibleNow() },
    onViewers(listener) {
      watchers.add(listener)
      listener(audience.size)
      return () => { watchers.delete(listener) }
    },
    onVisible(listener) {
      visibleWatchers.add(listener)
      listener()
      return () => { visibleWatchers.delete(listener) }
    },
    reportVisible(viewer, ids) {
      // 连接已经断掉的上报不记：宿主只按在线的观众算可见集合，重连的页面会自己再报一次。
      if (!connectionsOf.has(viewer)) return false
      const before = visibleNow()
      reported.set(viewer, new Set(ids))
      notifyVisible(before)
      return true
    },
    subscribe(response, viewer) {
      const before = visibleNow()
      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        connection: 'keep-alive',
      })
      audience.add(response)
      if (viewer !== undefined) {
        viewerOf.set(response, viewer)
        const connections = connectionsOf.get(viewer) ?? new Set<HostResponse>()
        connections.add(response)
        connectionsOf.set(viewer, connections)
      }
      announceViewers()
      startHeartbeat()
      // 长连接没有响应体结束的那一刻，观众离开只有这一个信号。
      response.on?.('close', () => { drop(response) })
      const frame: BoardEventFrame = { revision, event: { type: 'board' } }
      try {
        response.write?.(`data: ${JSON.stringify(frame)}\n\n`)
      } catch {
        drop(response)
        return
      }
      notifyVisible(before)
    },
    publish(next) {
      current = next
      announce({ type: 'board' })
    },
    notify(event) {
      announce(event)
    },
    close() {
      if (heartbeat !== undefined) clearInterval(heartbeat)
      heartbeat = undefined
      for (const response of audience) {
        // 拆除时观众可能已经断开，结束它失败不必处理：这里做的正是释放（D11）。
        try {
          response.end()
        } catch {
          audience.delete(response)
        }
      }
      audience.clear()
      viewerOf.clear()
      connectionsOf.clear()
      reported.clear()
      watchers.clear()
      visibleWatchers.clear()
    },
  }
}
