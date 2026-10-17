import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { BoardInstance, ParentMessage, WidgetMessage, WidgetSummary } from '@dsh-widget-board/contracts'
import { WIDGET_MESSAGE_TYPES, widgetDocumentPath, withinLimit } from '@dsh-widget-board/contracts'
import tokens from '@dsh-widget-board/contracts/tokens.json'
import type { FlowMetrics, FlowPlacement } from '@dsh-widget-board/model'
import { clampCardHeight } from '@dsh-widget-board/model'
import { resolveTokens } from './tokens'

/**
 * 卡片的圆角来自令牌。iframe 的文档画布在卡片自己的圆角之外是白的，外壳要把它裁掉：
 * `border-radius` 裁不动 iframe 的内容，只有 `clip-path` 才裁得动。裁剪的圆角比卡片自己的
 * 大一点，组件画出来的边因此完整落在裁剪之内，两个圆角的接缝不会露出画布。
 */
const CARD_RADIUS = (tokens as { radius: { card: string } }).radius.card
/** 裁剪用的圆角：比卡片自己的圆角大一点，接缝因此被组件自己的画面盖住。 */
const CARD_CLIP = `inset(0 round calc(${CARD_RADIUS} + 2px))`

/** 卡片这么久没有收到组件的任何一条消息，就重新连一次（D11）。 */
const ANSWER_TIMEOUT_MS = 6000

/** 重连次数上限：用完还在失败就把原因写在卡片上，等人来处理。 */
const RETRY_LIMIT = 3

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
  /** 组件交出来的界面状态，看板写给宿主（D5）。 */
  onState: (id: string, patch: unknown) => void
  controls: CardControls
}

/** 握手那一刻交给组件的那几样东西。 */
interface InitFace {
  props: Record<string, unknown>
  data: unknown
  state: unknown
  text: Record<string, { zh: string, en: string }>
}

/** 系统是否要求减弱动效。 */
function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * 一张卡片：一个沙箱 iframe，握手之后只经端口与组件说话（D3）。
 *
 * 连接只在组件版本变化时重建一次：props、data、state 的更新走各自的消息。把它们放进连接的依赖
 * 里会让每次快照刷新都拆一次端口，正在加载的组件文档就可能错过握手。
 */
export function WidgetCard({ instance, widget, metrics, placement, onHeight, onState, controls }: WidgetCardProps): ReactNode {
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const portRef = useRef<MessagePort | null>(null)
  const readyRef = useRef(false)
  const answeredRef = useRef(false)
  const [failure, setFailure] = useState<string | null>(null)
  /** 组件没应答时的重连次数：每次重来都换一条通道并重新导入文档。 */
  const [attempt, setAttempt] = useState(0)
  const height = clampCardHeight(placement.height, metrics)
  const size = { w: Math.round(placement.width), h: Math.round(height), family: 'inline' as const, cols: 1, rows: 0 }
  const sizeRef = useRef(size)
  sizeRef.current = size
  const heightRef = useRef(onHeight)
  heightRef.current = onHeight
  const stateRef = useRef(onState)
  stateRef.current = onState
  const initRef = useRef<InitFace>({ props: instance.props, data: instance.data, state: instance.state, text: widget.text ?? {} })
  initRef.current = { props: instance.props, data: instance.data, state: instance.state, text: widget.text ?? {} }
  const src = widgetDocumentPath(widget.hash)

  useEffect(() => {
    const frame = frameRef.current
    if (frame === null) return
    const channel = new MessageChannel()
    const port = channel.port1
    portRef.current = port
    readyRef.current = false
    answeredRef.current = false
    port.start()
    let live = true
    const send = (message: ParentMessage): void => {
      if (live) port.postMessage(message)
    }
    const watchdog = window.setTimeout(() => {
      if (!live || answeredRef.current) return
      // 通道是新建的，旧文档里握着的端口已经关了：重新导入一次再握手（D11 里可见的失败）。
      if (attempt < RETRY_LIMIT) {
        setAttempt(attempt + 1)
        return
      }
      setFailure('组件没有应答，切回看板重新加载这一张')
    }, ANSWER_TIMEOUT_MS)
    port.onmessage = (event: MessageEvent) => {
      const message = event.data as WidgetMessage | undefined
      if (message === undefined || typeof message.type !== 'string') return
      if (!(WIDGET_MESSAGE_TYPES as readonly string[]).includes(message.type)) return
      if (!withinLimit(message)) {
        console.error('widget-board: 组件发来的消息超过长度上限，丢弃')
        return
      }
      if (!answeredRef.current) {
        answeredRef.current = true
        window.clearTimeout(watchdog)
        setFailure(null)
      }
      if (message.type === 'height') heightRef.current(instance.id, message.height)
      if (message.type === 'error') setFailure(message.message)
      if (message.type === 'setState') stateRef.current(instance.id, message.patch)
    }
    const connect = (): void => {
      if (!live || readyRef.current) return
      readyRef.current = true
      frame.contentWindow?.postMessage({ type: 'connect' }, '*', [channel.port2])
      const { props, data, state, text } = initRef.current
      send({
        type: 'init',
        lang: document.documentElement.lang || navigator.language,
        motion: reducedMotion() ? 'reduced' : 'full',
        size: sizeRef.current,
        props: props ?? {},
        data: data ?? null,
        state: state ?? null,
        text,
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
    // 监听器装好之后再导入文档。每次都重新导入：端口是新建的，已经加载好的文档握着的还是关掉的端口。
    frame.src = src
    const dispose = controls.register(instance.id, {
      pause: () => { if (readyRef.current) send({ type: 'pause' }) },
      resume: () => { if (readyRef.current) send({ type: 'resume' }) },
    })
    return () => {
      live = false
      window.clearTimeout(watchdog)
      dispose()
      window.removeEventListener('message', onReady)
      frame.removeEventListener('load', connect)
      port.close()
      portRef.current = null
      readyRef.current = false
    }
  }, [src, instance.id, controls, attempt])

  // 连接之后的更新走各自的通道：连接不重建，组件文档也就不会错过 init。
  useEffect(() => {
    const port = portRef.current
    if (port === null || !readyRef.current) return
    port.postMessage({ type: 'props', props: instance.props ?? {} } satisfies ParentMessage)
  }, [instance.props])

  useEffect(() => {
    const port = portRef.current
    if (port === null || !readyRef.current) return
    port.postMessage({ type: 'data', data: instance.data ?? null } satisfies ParentMessage)
  }, [instance.data])

  useEffect(() => {
    const port = portRef.current
    if (port === null || !readyRef.current) return
    port.postMessage({ type: 'state', state: instance.state ?? null } satisfies ParentMessage)
  }, [instance.state])

  useEffect(() => {
    const port = portRef.current
    if (port === null || !readyRef.current) return
    port.postMessage({ type: 'size', size } satisfies ParentMessage)
  }, [size.w, size.h])

  return (
    <div
      className="dsh-widget-board__cell"
      data-instance={instance.id}
      style={{ left: placement.x, top: placement.y, width: placement.width, height, borderRadius: CARD_RADIUS }}
    >
      <iframe
        ref={frameRef}
        className="dsh-widget-board__frame"
        sandbox="allow-scripts"
        title={widget.title.zh}
        style={{ clipPath: CARD_CLIP }}
      />
      {failure === null ? null : <p className="dsh-widget-board__failure-strip" role="status">{failure}</p>}
    </div>
  )
}
