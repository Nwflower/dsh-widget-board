/**
 * 卡片与外壳之间的握手（D3）：整页只有一个 `message` 监听器。
 *
 * 每张卡片自己挂一个监听器时，消息要按 `event.source` 逐张比较，卡片多了就是一页几十个监听器。
 * 这里把监听器收成一个：卡片登记自己的 iframe，组件发来 `ready` 时按来源找到它，再交回给那张卡。
 * 主题变化时同一个对象把新主题推给所有已握手的端口；整页转场期间把正在跑的卡片停一帧，转场结束再
 * 放开（D29）。
 */
import type { ShellTheme } from './theme'

/** 一个已握手的端口，以及它属于哪张卡、现在是不是已经暂停。 */
interface HeldPort {
  frame: HTMLIFrameElement | null
  /** 这张卡当前是否已经暂停（离开视口或组卡翻到了背面）。 */
  paused: () => boolean
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
export function createFrameHost(): FrameHost {
  const frames = new Map<HTMLIFrameElement, () => void>()
  const ports = new Map<MessagePort, HeldPort>()
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
      for (const port of [...ports.keys()]) {
        send(port, { type: 'theme', tokens: theme.tokens, lang: theme.lang, motion: theme.motion })
      }
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
      window.removeEventListener('message', onMessage)
      frames.clear()
      ports.clear()
    },
  }
}
