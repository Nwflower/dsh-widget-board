import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { BoardInstance, ParentMessage, WidgetMessage, WidgetSummary } from '@dsh-widget-board/contracts'
import { WIDGET_MESSAGE_TYPES, widgetDocumentPath, withinLimit } from '@dsh-widget-board/contracts'
import type { FlowMetrics, FlowPlacement } from '@dsh-widget-board/model'
import { clampCardHeight } from '@dsh-widget-board/model'
import { resolveTokens } from './tokens'

/** 卡片向页面登记的暂停与恢复，由页面唯一的一个 IntersectionObserver 调用（D15）。 */
export interface CardControls {
  register(id: string, handlers: { pause: () => void, resume: () => void }): () => void
}

/** 一张卡片要画的东西。 */
export interface WidgetCardProps {
  instance: BoardInstance
  widget: WidgetSummary
  metrics: FlowMetrics
  placement: FlowPlacement
  /** 组件报上来的内容高度，看板按它重新摆放（D15）。 */
  onHeight: (id: string, height: number) => void
  controls: CardControls
}

/** 系统是否要求减弱动效。 */
function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * 一张卡片：一个沙箱 iframe，握手之后只经端口与组件说话（D3）。
 *
 * 位置与高度由看板给；组件报上来的内容高度转给看板，重新摆放不重建 iframe（D15）。
 */
export function WidgetCard({ instance, widget, metrics, placement, onHeight, controls }: WidgetCardProps): ReactNode {
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const portRef = useRef<MessagePort | null>(null)
  const readyRef = useRef(false)
  const [failure, setFailure] = useState<string | null>(null)
  const height = clampCardHeight(placement.height, metrics)
  const size = { w: Math.round(placement.width), h: Math.round(height), family: 'inline' as const, cols: 1, rows: 0 }
  const sizeRef = useRef(size)
  sizeRef.current = size
  const heightRef = useRef(onHeight)
  heightRef.current = onHeight
  const src = widgetDocumentPath(widget.hash)

  useEffect(() => {
    const frame = frameRef.current
    if (frame === null) return
    const channel = new MessageChannel()
    const port = channel.port1
    portRef.current = port
    port.start()
    const send = (message: ParentMessage): void => port.postMessage(message)
    port.onmessage = (event: MessageEvent) => {
      const message = event.data as WidgetMessage | undefined
      if (message === undefined || typeof message.type !== 'string') return
      if (!(WIDGET_MESSAGE_TYPES as readonly string[]).includes(message.type)) return
      if (!withinLimit(message)) {
        console.error('widget-board: 组件发来的消息超过长度上限，丢弃')
        return
      }
      if (message.type === 'height') heightRef.current(instance.id, message.height)
      if (message.type === 'error') setFailure(message.message)
    }
    const connect = (): void => {
      if (readyRef.current) return
      readyRef.current = true
      frame.contentWindow?.postMessage({ type: 'connect' }, '*', [channel.port2])
      send({
        type: 'init',
        lang: document.documentElement.lang || navigator.language,
        motion: reducedMotion() ? 'reduced' : 'full',
        size: sizeRef.current,
        props: instance.props ?? {},
        data: instance.data ?? null,
        state: instance.state ?? null,
        text: widget.text ?? {},
        tokens: resolveTokens(),
      })
    }
    // 两路触发同一处握手：宿主先到就等 ready，组件先到就等 load。
    const onReady = (event: MessageEvent): void => {
      if (event.source !== frame.contentWindow) return
      if ((event.data as { type?: string } | undefined)?.type !== 'ready') return
      connect()
    }
    window.addEventListener('message', onReady)
    frame.addEventListener('load', connect)
    // 监听器装好之后再开始加载：组件的 ready 可能比 effect 更早到，先挂载就会错过它。
    frame.src = src
    const dispose = controls.register(instance.id, {
      pause: () => { if (readyRef.current) send({ type: 'pause' }) },
      resume: () => { if (readyRef.current) send({ type: 'resume' }) },
    })
    return () => {
      dispose()
      window.removeEventListener('message', onReady)
      frame.removeEventListener('load', connect)
      port.close()
      portRef.current = null
      readyRef.current = false
    }
  }, [src, instance.id, instance.props, instance.data, instance.state, widget.text, controls])

  useEffect(() => {
    const port = portRef.current
    if (port === null || !readyRef.current) return
    port.postMessage({ type: 'size', size } satisfies ParentMessage)
  }, [size.w, size.h])

  return (
    <div
      className="dsh-widget-board__cell"
      data-instance={instance.id}
      style={{ left: placement.x, top: placement.y, width: placement.width, height }}
    >
      <iframe
        ref={frameRef}
        className="dsh-widget-board__frame"
        sandbox="allow-scripts"
        title={widget.title.zh}
      />
      {failure === null ? null : <p className="dsh-widget-board__failure-strip" role="status">{failure}</p>}
    </div>
  )
}
