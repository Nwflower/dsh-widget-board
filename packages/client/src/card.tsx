import { createElement, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import type { BoardInstance, ParentMessage, WidgetMessage, WidgetSummary } from '@dsh-widget-board/contracts'
import { MESSAGE_RATE_LIMIT, isWidgetMessage, widgetDocumentPath, withinLimit } from '@dsh-widget-board/contracts'
import tokens from '@dsh-widget-board/contracts/tokens.json'
import type { GridPlacement } from '@dsh-widget-board/model'
import { t } from './copy'
import type { FrameHost } from './frame-host'
import type { ShellTheme } from './theme'
import { sendInstanceAction } from './snapshot'
import { isChinese } from './copy'
import { useNativeWidget } from './native'
import { NativeBoundary } from './native-boundary'

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

/** 卡片向页面登记的暂停与恢复，由页面唯一的一个 IntersectionObserver 调用（D16）。 */
export interface CardControls {
  register(id: string, handlers: { pause: () => void, resume: () => void }): () => void
}

/** 一张卡片要画的东西。 */
export interface WidgetCardProps {
  instance: BoardInstance
  widget: WidgetSummary
  placement: GridPlacement
  /** 这张卡正在被拖动或缩放：指针事件归外壳，iframe 不接。 */
  gesture: 'move' | 'resize' | null
  /** 当前的主题；变化时推给组件（D10）。 */
  theme: ShellTheme
  /** 整页唯一的握手中心（D3）。 */
  frames: FrameHost
  /** 组件交出来的界面状态，看板写给宿主（D5）。 */
  onState: (id: string, patch: unknown) => void
  /** 把这张卡从看板上移除。 */
  onRemove: (id: string) => void
  controls: CardControls
  /** 按下拖动把手或缩放手柄；位移、松手与取消都由同一个把手接收。 */
  onDragStart: (event: ReactPointerEvent<HTMLElement>, id: string, kind: 'move' | 'resize') => void
  onDragMove: (event: ReactPointerEvent<HTMLElement>) => void
  onDragEnd: (event: ReactPointerEvent<HTMLElement>) => void
  onDragCancel: () => void
}

/** 握手那一刻交给组件的那几样东西。 */
interface InitFace {
  props: Record<string, unknown>
  data: unknown
  state: unknown
  text: Record<string, { zh: string, en: string }>
}

/**
 * 一张卡片：一个沙箱 iframe，握手之后只经端口与组件说话（D3）。
 *
 * 卡片的宽高由看板的布局给出，iframe 的视口就是卡片的内容盒；组件按这个盒子排版，不再上报
 * 高度来撑高卡片（D16）。连接只在组件版本变化时重建一次：props、data、state 与主题的更新走各自
 * 的消息。把它们放进连接的依赖里会让每次快照刷新都拆一次端口，正在加载的组件文档就会错过握手。
 */
export function WidgetCard({
  instance,
  widget,
  placement,
  gesture,
  theme,
  frames,
  onState,
  onRemove,
  controls,
  onDragStart,
  onDragMove,
  onDragEnd,
  onDragCancel,
}: WidgetCardProps): ReactNode {
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const portRef = useRef<MessagePort | null>(null)
  const readyRef = useRef(false)
  const answeredRef = useRef(false)
  const [failure, setFailure] = useState<string | null>(null)
  /** 这张卡不在视口里时为真；原生组件据此停下动画与计时（D16）。 */
  const [paused, setPaused] = useState(false)
  /** 提供方为这个组件登记了原生组件时，卡片不再取组件文档，直接画它（D17）。 */
  const native = useNativeWidget(instance.widget)
  /** 组件没应答时的重连次数：每次重来都换一条通道并重新导入文档。 */
  const [attempt, setAttempt] = useState(0)
  const size = {
    w: Math.round(placement.width),
    h: Math.round(placement.height),
    placement: 'board' as const,
    family: 'board' as const,
    cols: placement.columns,
  }
  const sizeRef = useRef(size)
  sizeRef.current = size
  const stateRef = useRef(onState)
  stateRef.current = onState
  const themeRef = useRef(theme)
  themeRef.current = theme
  const initRef = useRef<InitFace>({ props: instance.props, data: instance.data, state: instance.state, text: widget.text ?? {} })
  initRef.current = { props: instance.props, data: instance.data, state: instance.state, text: widget.text ?? {} }
  const src = widgetDocumentPath(widget.hash, theme.lang)

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
    let held: (() => void) | undefined
    /** 一秒窗口里收到的消息时刻，用来限流（D3）。 */
    const recent: number[] = []
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
      setFailure(t('noAnswer'))
    }, ANSWER_TIMEOUT_MS)
    port.onmessage = (event: MessageEvent) => {
      const message = event.data as WidgetMessage | undefined
      if (!isWidgetMessage(message)) return
      if (!withinLimit(message)) {
        console.error('widget-board: 组件发来的消息超过长度上限，丢弃')
        return
      }
      const now = Date.now()
      while (recent.length > 0 && now - (recent[0] as number) > 1000) recent.shift()
      recent.push(now)
      if (recent.length > MESSAGE_RATE_LIMIT) {
        console.error(`widget-board: 组件一秒内发了超过 ${String(MESSAGE_RATE_LIMIT)} 条消息，丢弃`)
        return
      }
      if (!answeredRef.current) {
        answeredRef.current = true
        window.clearTimeout(watchdog)
        setFailure(null)
      }
      // 高度由看板布局给出，组件上报的内容高度不参与（D16）；消息仍然合法，只是不用。
      if (message.type === 'error') setFailure(message.message)
      if (message.type === 'setState') stateRef.current(instance.id, message.patch)
      if (message.type === 'action') {
        sendInstanceAction(instance.id, message.id, message.payload).catch((error: Error) => { setFailure(error.message) })
      }
    }
    const connect = (): void => {
      if (!live || readyRef.current) return
      readyRef.current = true
      frame.contentWindow?.postMessage({ type: 'connect' }, '*', [channel.port2])
      held = frames.hold(port)
      const { props, data, state, text } = initRef.current
      const { tokens: themeTokens, lang, motion } = themeRef.current
      send({
        type: 'init',
        lang,
        motion,
        tokens: themeTokens,
        size: sizeRef.current,
        props: props ?? {},
        data: data ?? null,
        state: state ?? null,
        text,
      })
    }
    // 组件的 ready 与 iframe 的 load 都触发握手，谁先到谁算：整页的 message 监听在握手中心里。
    const detach = frames.attach(frame, connect)
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
      detach()
      held?.()
      frame.removeEventListener('load', connect)
      port.close()
      portRef.current = null
      readyRef.current = false
    }
  }, [src, instance.id, controls, frames, attempt])

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
    // size 每次渲染都是新对象，依赖写成它的三个字段，盒子没变就不发。
  }, [size.w, size.h, size.cols])

  // 原生组件没有端口，暂停与恢复直接落在它的参数上。
  useEffect(() => {
    if (native === undefined) return
    return controls.register(instance.id, {
      pause: () => setPaused(true),
      resume: () => setPaused(false),
    })
  }, [native, controls, instance.id])

  const dragProps = {
    onPointerMove: onDragMove,
    onPointerUp: onDragEnd,
    onPointerCancel: onDragCancel,
    onLostPointerCapture: onDragCancel,
  }

  return (
    <div
      className="dsh-widget-board__cell"
      data-instance={instance.id}
      data-gesture={gesture ?? undefined}
      style={{ left: placement.x, top: placement.y, width: placement.width, height: placement.height, borderRadius: CARD_RADIUS }}
    >
      {native === undefined
        ? (
          <iframe
            ref={frameRef}
            className="dsh-widget-board__frame"
            sandbox="allow-scripts"
            title={widget.title.zh}
            style={{ clipPath: CARD_CLIP }}
          />
        )
        : (
          <div className="dsh-widget-board__native" data-native-widget={native.provider}>
            <NativeBoundary label={t('unavailable')}>
              {createElement(native.component, {
                size,
                props: instance.props ?? {},
                data: instance.data ?? null,
                state: instance.state ?? null,
                paused,
                setState: (patch: unknown) => onState(instance.id, patch),
                action: (id: string, payload?: unknown) => {
                  sendInstanceAction(instance.id, id, payload).catch((error: Error) => { setFailure(error.message) })
                },
                t: (key: string) => {
                  const entry = widget.text?.[key]
                  if (entry === undefined) return key
                  return isChinese() ? entry.zh : entry.en
                },
              })}
            </NativeBoundary>
          </div>
        )}
      <div
        className="dsh-widget-board__grip"
        data-dsh-widget-board-handle="move"
        title={t('move')}
        onPointerDown={(event) => onDragStart(event, instance.id, 'move')}
        {...dragProps}
      />
      <button
        type="button"
        className="dsh-widget-board__remove"
        data-dsh-widget-board-handle="remove"
        title={t('remove')}
        aria-label={t('remove')}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => onRemove(instance.id)}
      >
        ×
      </button>
      <div
        className="dsh-widget-board__resize"
        data-dsh-widget-board-handle="resize"
        title={t('resize')}
        onPointerDown={(event) => onDragStart(event, instance.id, 'resize')}
        {...dragProps}
      />
      {gesture === null
        ? null
        : (
          <div className="dsh-widget-board__measure" data-dsh-widget-board-measure="" aria-hidden="true">
            <span className="dsh-widget-board__measure-size">
              {Math.round(placement.width)}
              <i> × </i>
              {Math.round(placement.height)}
            </span>
            <span className="dsh-widget-board__measure-hint">
              <span className="dsh-widget-board__dot" />
              {gesture === 'resize' ? t('resizeHint') : t('moveHint')}
            </span>
          </div>
        )}
      {failure === null ? null : <p className="dsh-widget-board__failure-strip" role="status">{failure}</p>}
    </div>
  )
}
