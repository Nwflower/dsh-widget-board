/**
 * 卡片与外壳之间的握手（D3）：整页只有一个 `message` 监听器。
 *
 * 每张卡片自己挂一个监听器时，消息要按 `event.source` 逐张比较，卡片多了就是一页几十个监听器。
 * 这里把监听器收成一个：卡片登记自己的 iframe，组件发来 `ready` 时按来源找到它，再交回给那张卡。
 * 主题变化时同一个对象把新主题推给所有已握手的端口；整页转场期间把正在跑的卡片停一帧，转场结束再
 * 放开；卡片 iframe 不在整页快照里，新主题按圆点扫到卡片的时刻分批推（D29）。
 */
import type { ShellTheme } from './theme'

/** 一个已握手的端口，以及它属于哪张卡、现在是不是已经暂停。 */
interface HeldPort {
  frame: HTMLIFrameElement | null
  /** 这张卡当前是否已经暂停（离开视口或组卡翻到了背面）。 */
  paused: () => boolean
}

/** 整页圆点转场的时间与圆心，卡片的新主题按它分批推送。 */
export interface ThemeReveal {
  origin: { x: number, y: number }
  radius: number
  duration: number
  easing: string
}

/** 握手、主题广播与转场期间的暂停。 */
export interface FrameHost {
  /** 登记一张卡片的 iframe；组件发来 `ready` 时调用 `adopt`。返回注销函数。 */
  attach(frame: HTMLIFrameElement, adopt: () => void): () => void
  /**
   * 记下一个已握手的端口，主题变化时推给它。
   *
   * @param port - 组件那一端的端口。
   * @param state - 这张卡属于哪个 iframe、现在是否已经暂停；省略时按未暂停、不属于任何 iframe 处理。
   * @returns 注销函数。
   */
  hold(port: MessagePort, state?: { frame?: HTMLIFrameElement | null, paused?: () => boolean }): () => void
  /** 把主题推给所有已握手的端口。 */
  broadcast(theme: ShellTheme): void
  /**
   * 整页转场开始前登记圆心与节奏：接下来的一次主题广播先扣住，按卡片远角被圆点盖住的时刻分批推。
   *
   * `except` 是发起这次转场的卡片，它的主题立即送达，圆环才能跟这一次按下同时开始。
   */
  stageTheme(except: HTMLIFrameElement | null, reveal: ThemeReveal): void
  /** 转场的圆点开始展开：按登记的节奏给尚未收到主题的卡片排推送。 */
  startThemeReveal(): void
  /** 转场结束、被跳过或兜底超时：把剩余卡片的主题补齐，清掉计时器。 */
  endThemeReveal(): void
  /**
   * 暂停所有还没暂停的卡片，返回只恢复这一批的函数（D29）。
   *
   * @param except - 不暂停的那张 iframe；整页转场由它发起，保留它自己的过场。
   * @returns 恢复这次暂停的函数；重复调用没有第二次效果。
   */
  suspend(except?: HTMLIFrameElement | null): () => void
  /** 摘掉监听器与全部端口。 */
  dispose(): void
}

/**
 * 建一个握手中心。
 *
 * @returns 握手、主题广播与暂停。
 */
/**
 * 给定圆点展开的进度，算它在 `cubic-bezier()` 时间轴上对应的时刻。
 *
 * 动画的进度是缓动曲线的 y，时间是 x；这里对 y 做二分，把 y 反解成时间比例。
 */
function timeFraction(progress: number, easing: string): number {
  if (progress <= 0) return 0
  if (progress >= 1) return 1
  const match = /^cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)$/.exec(easing.trim())
  if (match === null) return progress
  const [x1, y1, x2, y2] = match.slice(1).map(Number)
  if (![x1, y1, x2, y2].every(Number.isFinite)) return progress
  const at = (t: number, a: number, b: number): number => (1 - t) ** 3 * 0 + 3 * (1 - t) ** 2 * t * a + 3 * (1 - t) * t ** 2 * b + t ** 3
  let low = 0
  let high = 1
  for (let step = 0; step < 24; step += 1) {
    const middle = (low + high) / 2
    if (at(middle, y1, y2) < progress) low = middle
    else high = middle
  }
  return at((low + high) / 2, x1, x2)
}

export function createFrameHost(): FrameHost {
  const frames = new Map<HTMLIFrameElement, () => void>()
  const ports = new Map<MessagePort, HeldPort>()
  /** 一次整页转场里扣住的主题：圆心、节奏、尚未送达的端口。 */
  let reveal: {
    except: HTMLIFrameElement | null
    plan: ThemeReveal
    theme: ShellTheme | null
    startedAt: number | null
    sent: Set<MessagePort>
    scheduled: Set<MessagePort>
    timers: Map<MessagePort, number>
  } | null = null
  const onMessage = (event: MessageEvent): void => {
    if ((event.data as { type?: unknown } | undefined)?.type !== 'ready') return
    for (const [frame, adopt] of frames) {
      // 只有这一帧的文档能把端口交上来；别的窗口发来的 ready 一概不认（D3）。
      if (event.source !== null && event.source === frame.contentWindow) {
        adopt()
        return
      }
    }
  }
  /** 发一条消息；端口可能刚被上一轮拆除关掉，发失败就摘掉它（D11）。 */
  const send = (port: MessagePort, message: unknown): boolean => {
    try {
      port.postMessage(message)
      return true
    } catch {
      ports.delete(port)
      return false
    }
  }
  const themeMessage = (theme: ShellTheme): unknown => ({ type: 'theme', tokens: theme.tokens, lang: theme.lang, motion: theme.motion })
  const sendTheme = (port: MessagePort, theme: ShellTheme): void => {
    if (send(port, themeMessage(theme))) reveal?.sent.add(port)
  }
  /** 按卡片的远角被圆点盖住的先后排推送；同一张卡只排一次。 */
  const scheduleReveal = (): void => {
    const current = reveal
    if (current === null || current.theme === null || current.startedAt === null) return
    const elapsed = performance.now() - current.startedAt
    for (const [port, state] of ports) {
      if (current.sent.has(port) || current.scheduled.has(port)) continue
      if (current.except !== null && state.frame === current.except) continue
      const frame = state.frame
      if (frame === null) {
        sendTheme(port, current.theme)
        continue
      }
      const rect = frame.getBoundingClientRect()
      // 取矩形上离圆心最远的角：整张卡都进入圆内才换主题，卡片任何一角都不会提前露出新模式。
      const dx = Math.max(Math.abs(rect.left - current.plan.origin.x), Math.abs(rect.right - current.plan.origin.x))
      const dy = Math.max(Math.abs(rect.top - current.plan.origin.y), Math.abs(rect.bottom - current.plan.origin.y))
      const distance = Math.hypot(dx, dy)
      const progress = current.plan.radius <= 0 ? 1 : Math.min(1, distance / current.plan.radius)
      const due = timeFraction(progress, current.plan.easing) * current.plan.duration - elapsed
      if (due <= 0) {
        sendTheme(port, current.theme)
        continue
      }
      current.scheduled.add(port)
      const timer = window.setTimeout(() => {
        current.timers.delete(port)
        current.scheduled.delete(port)
        if (reveal !== current || current.theme === null) return
        sendTheme(port, current.theme)
      }, due)
      current.timers.set(port, timer)
    }
  }
  const endReveal = (): void => {
    const current = reveal
    if (current === null) return
    reveal = null
    for (const timer of current.timers.values()) window.clearTimeout(timer)
    if (current.theme !== null) {
      for (const port of [...ports.keys()]) {
        if (!current.sent.has(port)) send(port, themeMessage(current.theme))
      }
    }
  }
  window.addEventListener('message', onMessage)
  return {
    attach(frame, adopt) {
      frames.set(frame, adopt)
      return () => {
        if (frames.get(frame) === adopt) frames.delete(frame)
      }
    },
    hold(port, state = {}) {
      ports.set(port, { frame: state.frame ?? null, paused: state.paused ?? (() => false) })
      return () => { ports.delete(port) }
    },
    broadcast(theme) {
      if (reveal !== null) {
        reveal.theme = theme
        if (reveal.except !== null) {
          for (const [port, state] of ports) {
            if (state.frame === reveal.except && !reveal.sent.has(port)) sendTheme(port, theme)
          }
        }
        if (reveal.startedAt !== null) scheduleReveal()
        return
      }
      for (const port of [...ports.keys()]) send(port, themeMessage(theme))
    },
    stageTheme(except, plan) {
      endReveal()
      reveal = {
        except,
        plan,
        theme: null,
        startedAt: null,
        sent: new Set(),
        scheduled: new Set(),
        timers: new Map(),
      }
    },
    startThemeReveal() {
      if (reveal === null || reveal.startedAt !== null) return
      reveal.startedAt = performance.now()
      scheduleReveal()
    },
    endThemeReveal() {
      endReveal()
    },
    suspend(except = null) {
      const held: MessagePort[] = []
      for (const [port, state] of ports) {
        if (except !== null && state.frame === except) continue
        if (state.paused()) continue
        if (send(port, { type: 'pause' })) held.push(port)
      }
      let resumed = false
      return () => {
        if (resumed) return
        resumed = true
        // 分批恢复：十张卡在同一帧里一起重启计时器与画布，会在转场结束时挤出一段卡顿。
        held.forEach((port, index) => {
          window.setTimeout(() => {
            const state = ports.get(port)
            // 这一轮里被移出视口的卡片已经自己停了，不能再替它恢复。
            if (state !== undefined && !state.paused()) send(port, { type: 'resume' })
          }, index * 16)
        })
      }
    },
    dispose() {
      endReveal()
      window.removeEventListener('message', onMessage)
      frames.clear()
      ports.clear()
    },
  }
}
