/**
 * 卡片与外壳之间的握手（D3）：整页只有一个 `message` 监听器。
 *
 * 每张卡片自己挂一个监听器时，消息要按 `event.source` 逐张比较，卡片多了就是一页几十个监听器。
 * 这里把监听器收成一个：卡片登记自己的 iframe，组件发来 `ready` 时按来源找到它，再交回给那张卡。
 * 主题变化时同一个对象把新主题推给所有已握手的端口。
 */
import type { ShellTheme } from './theme'

/** 握手与主题广播。 */
export interface FrameHost {
  /** 登记一张卡片的 iframe；组件发来 `ready` 时调用 `adopt`。返回注销函数。 */
  attach(frame: HTMLIFrameElement, adopt: () => void): () => void
  /** 记下一个已握手的端口，主题变化时推给它。返回注销函数。 */
  hold(port: MessagePort): () => void
  /** 把主题推给所有已握手的端口。 */
  broadcast(theme: ShellTheme): void
  /** 摘掉监听器与全部端口。 */
  dispose(): void
}

/**
 * 建一个握手中心。
 *
 * @returns 握手与主题广播。
 */
export function createFrameHost(): FrameHost {
  const frames = new Map<HTMLIFrameElement, () => void>()
  const ports = new Set<MessagePort>()
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
  window.addEventListener('message', onMessage)
  return {
    attach(frame, adopt) {
      frames.set(frame, adopt)
      return () => {
        if (frames.get(frame) === adopt) frames.delete(frame)
      }
    },
    hold(port) {
      ports.add(port)
      return () => { ports.delete(port) }
    },
    broadcast(theme) {
      for (const port of ports) {
        // 端口可能刚被上一轮拆除关掉：发失败就摘掉它（D11）。
        try {
          port.postMessage({ type: 'theme', tokens: theme.tokens, lang: theme.lang, motion: theme.motion })
        } catch {
          ports.delete(port)
        }
      }
    },
    dispose() {
      window.removeEventListener('message', onMessage)
      frames.clear()
      ports.clear()
    },
  }
}
