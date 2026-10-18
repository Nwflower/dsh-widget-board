/**
 * 刷新的调度器（D6）：谁在什么时候读一次数据。
 *
 * 只有一条定时链，按「有哪些卡片声明了定时刷新」与「现在有几个页面在看」这两件事算出来：
 *
 * - 没有观众时一律不跑。宿主上不该有没人看的轮询（D5）。
 * - 有观众时按最短的那个间隔跑；开始观察时先读一次，之后每次只读那些到期了的卡片。
 * - 声明了按需（或没声明）的卡片从不被定时读，只有人按刷新或工具显式读一次时才读。
 *
 * 调度器自己不认识组件与数据源：调用方给出「哪些卡片要按什么间隔读」与「怎么读一张卡」，它只管
 * 什么时候调。这样它的启停规则可以被单元测试直接盯着。
 */

import type { WidgetRefresh } from '@dsh-widget-board/contracts'
import { REFRESH_DEFAULT_MS, REFRESH_MIN_MS } from '@dsh-widget-board/contracts'

/** 一张要定时读的卡。 */
export interface ScheduledCard {
  /** 卡片实例的 id。 */
  id: string
  /** 间隔毫秒数，已经按下限抬过。 */
  everyMs: number
}

/** 一次批量读取里一张卡的结果。 */
export interface ReadOutcome {
  /** 卡片实例的 id。 */
  id: string
  /** 读失败的原因；成功时缺席。 */
  error?: unknown
}

/** 调度器的依赖。 */
export interface SchedulerDeps {
  /** 现在有几张卡要读、各按什么间隔。 */
  cards: () => readonly ScheduledCard[]
  /** 现在有几个看板页在看。 */
  viewers: () => number
  /**
   * 读一批到期的卡；同一块看板的卡由实现合成一次写入（D6）。
   *
   * @param ids - 这一轮到期的卡片实例 id。
   * @returns 每张卡的结果；失败的那几张由调度器报出来。
   */
  read: (ids: readonly string[]) => Promise<readonly ReadOutcome[]>
  /** 出错时报一声；一张卡读不出来不影响别的卡。 */
  onError?: (id: string, error: unknown) => void
  /** 定时器工厂；测试里换成手动推进的替身。 */
  setTimer?: (callback: () => void, ms: number) => { cancel: () => void }
}

/** 调度器。 */
export interface Scheduler {
  /** 按当前情况重算一次：要不要跑、跑多快。看板或观众变了就调它。 */
  sync(): void
  /** 现在跑着没有。 */
  readonly running: boolean
  /** 这一次运行里每张卡下一次该读的时刻；没跑时是空表。 */
  readonly due: ReadonlyMap<string, number>
  /** 停掉定时器。 */
  stop(): void
}

/** 默认的定时器：`unref` 掉，进程不会因为它在跑而不肯退出。 */
function defaultTimer(callback: () => void, ms: number): { cancel: () => void } {
  const handle = setInterval(callback, ms)
  handle.unref()
  return { cancel: () => { clearInterval(handle) } }
}

/**
 * 建一个调度器。
 *
 * @param deps - 卡片、观众与读一张卡的办法。
 * @returns 调度器。
 */
export function createScheduler(deps: SchedulerDeps): Scheduler {
  const setTimer = deps.setTimer ?? defaultTimer
  let timer: { cancel: () => void } | undefined
  let due = new Map<string, number>()
  /** 正在读的卡：一次读还没回来时不重复发。 */
  const reading = new Set<string>()
  /** 上一轮的间隔，用来判断要不要重建定时器。 */
  let period: number | undefined

  /** 这一轮要不要跑，跑的话间隔是多少。 */
  const plan = (): number | undefined => {
    if (deps.viewers() <= 0) return undefined
    const cards = deps.cards()
    if (cards.length === 0) return undefined
    return Math.min(...cards.map((card) => card.everyMs))
  }

  const tick = (): void => {
    const cards = deps.cards()
    if (deps.viewers() <= 0 || cards.length === 0) {
      stop()
      return
    }
    const now = Date.now()
    const dueIds: string[] = []
    for (const card of cards) {
      let at = due.get(card.id)
      if (at === undefined) {
        // 第一次见到这张卡：先读一次，之后按间隔排期。打开看板就该看到当下的数据。
        at = now
        due.set(card.id, at)
      }
      if (at > now || reading.has(card.id)) continue
      due.set(card.id, now + card.everyMs)
      reading.add(card.id)
      dueIds.push(card.id)
    }
    if (dueIds.length === 0) return
    deps.read(dueIds).then((outcomes) => {
      for (const outcome of outcomes) {
        if (outcome.error !== undefined) deps.onError?.(outcome.id, outcome.error)
      }
    }, (error: unknown) => {
      for (const id of dueIds) deps.onError?.(id, error)
    }).finally(() => {
      for (const id of dueIds) reading.delete(id)
    })
  }

  const stop = (): void => {
    timer?.cancel()
    timer = undefined
    period = undefined
    due = new Map()
  }

  const sync = (): void => {
    const wanted = plan()
    if (wanted === undefined) {
      stop()
      return
    }
    // 卡片表变了就重算到期时刻：新来的卡在下一轮立刻读一次，走掉的卡不再占位。
    const known = new Set(deps.cards().map((card) => card.id))
    for (const id of [...due.keys()]) {
      if (!known.has(id)) due.delete(id)
    }
    if (timer !== undefined && period === wanted) return
    timer?.cancel()
    period = wanted
    timer = setTimer(tick, wanted)
    // 刚刚有观众（或换成更短的间隔）：立刻读一次，不用等满一个间隔。
    tick()
  }

  return {
    sync,
    get running() { return timer !== undefined },
    get due() { return due },
    stop,
  }
}

/**
 * 一张卡声明的间隔，抬到下限。
 *
 * @param refresh - manifest 里的刷新策略。
 * @returns 要定时读时的间隔毫秒数；按需时是 `undefined`。
 */
export function intervalOf(refresh: WidgetRefresh | undefined): number | undefined {
  if (refresh?.mode !== 'interval') return undefined
  return Math.max(refresh.everyMs ?? REFRESH_DEFAULT_MS, REFRESH_MIN_MS)
}
