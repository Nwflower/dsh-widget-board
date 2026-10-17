import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import type { BoardInstance, ParentMessage, WidgetFamily, WidgetSummary } from '@dsh-widget-board/contracts'
import { PLUGIN_ROUTE, widgetDocumentPath } from '@dsh-widget-board/contracts'
import type { FamilyBox, GridMetrics } from '@dsh-widget-board/model'
import { familyBox, resolveFamily } from '@dsh-widget-board/model'
import { resolveTokens } from './tokens'

/** 卡片向页面登记的暂停与恢复，由页面唯一的一个 IntersectionObserver 调用（D4）。 */
export interface CardControls {
  register(id: string, handlers: { pause: () => void, resume: () => void }): () => void
}

/** 一张卡片要画的东西。 */
export interface WidgetCardProps {
  instance: BoardInstance
  widget: WidgetSummary
  metrics: GridMetrics
  controls: CardControls
}

/** 这一帧的摆放：族、像素盒，或者卡片自己声明得不对的原因。 */
type CardLayout = { family: WidgetFamily, box: FamilyBox } | { failure: string }

/**
 * 算出这张卡这一帧占的位置。
 *
 * 一个组件的声明有问题不该让整块看板倒下，失败只落在这一张卡上（D11）。
 *
 * @param widget - 组件元信息。
 * @param metrics - 这一帧的网格量。
 * @returns 摆放，或失败原因。
 */
function layoutOf(widget: WidgetSummary, metrics: GridMetrics): CardLayout {
  try {
    const family = resolveFamily(widget.sizes, metrics)
    return { family, box: familyBox(family, metrics) }
  } catch (error) {
    return { failure: (error as Error).message }
  }
}

/** 系统是否要求减弱动效。 */
function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * 一张卡片：一个沙箱 iframe，握手之后只经端口与组件说话（D3）。
 *
 * 卡片自己的尺寸变化只更新数据属性，iframe 不重建；组件的版本变了才换一个 iframe（D4）。
 */
export function WidgetCard({ instance, widget, metrics, controls }: WidgetCardProps): ReactNode {
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const portRef = useRef<MessagePort | null>(null)
  const readyRef = useRef(false)
  const layout = layoutOf(widget, metrics)
  const size = 'box' in layout
    ? { w: Math.round(layout.box.w), h: Math.round(layout.box.h), family: layout.family, cols: layout.box.cols, rows: layout.box.rows }
    : null
  const sizeRef = useRef(size)
  sizeRef.current = size
  const src = `${PLUGIN_ROUTE}${widgetDocumentPath(widget.hash)}`

  useEffect(() => {
    const frame = frameRef.current
    if (frame === null) return
    const channel = new MessageChannel()
    const port = channel.port1
    portRef.current = port
    port.start()
    const send = (message: ParentMessage): void => port.postMessage(message)
    const connect = (): void => {
      const current = sizeRef.current
      if (readyRef.current || current === null) return
      readyRef.current = true
      frame.contentWindow?.postMessage({ type: 'connect' }, '*', [channel.port2])
      send({
        type: 'init',
        lang: document.documentElement.lang || navigator.language,
        motion: reducedMotion() ? 'reduced' : 'full',
        size: current,
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
    if (port === null || !readyRef.current || size === null) return
    port.postMessage({ type: 'size', size } satisfies ParentMessage)
  }, [size?.w, size?.h, size?.family])

  if (!('box' in layout)) {
    return (
      <div className="dsh-widget-board__cell" data-instance={instance.id} data-failure="">
        <div className="dsh-widget-board__failure">
          <p className="dsh-widget-board__failure-title">{widget.title.zh}</p>
          <p className="dsh-widget-board__failure-reason">{layout.failure}</p>
        </div>
      </div>
    )
  }
  return (
    <div
      className="dsh-widget-board__cell"
      data-instance={instance.id}
      data-family={layout.family}
      style={{ gridColumn: `span ${layout.box.cols}`, gridRow: `span ${layout.box.rows}` }}
    >
      <iframe
        ref={frameRef}
        className="dsh-widget-board__frame"
        sandbox="allow-scripts"
        title={widget.title.zh}
      />
    </div>
  )
}
