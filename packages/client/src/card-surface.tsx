import { createElement, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { BoardInstance, GrantKind, ParentMessage, WidgetMessage, WidgetNotification, WidgetSummary } from '@dsh-widget-board/contracts'
import { MESSAGE_RATE_LIMIT, isWidgetMessage, widgetDocumentPath, withinLimit } from '@dsh-widget-board/contracts'
import type { GridPlacement } from '@dsh-widget-board/model'
import { isChinese, t } from './copy'
import type { FrameHost } from './frame-host'
import type { ShellTheme } from './theme'
import { GrantRequiredError, grantInstance, sendInstanceAction } from './snapshot'
import { useNativeWidget } from './native'
import { NativeBoundary } from './native-boundary'
import { CARD_CLIP } from './card-shell'
import { createStateQueue } from './state-queue'

/** 卡片这么久没有收到组件的任何一条消息，就重新连一次（D11）。 */
const ANSWER_TIMEOUT_MS = 6000

/** 重连次数上限：用完还在失败就把原因写在卡片上，等人来处理。 */
const RETRY_LIMIT = 3

/** 一层组件画面要画的东西。 */
export interface CardSurfaceProps {
  instance: BoardInstance
  widget: WidgetSummary
  /** 这一层画面的像素盒子；组卡的正反两面都用组的内容盒。 */
  placement: GridPlacement
  /** 当前的主题；变化时推给组件（D10）。 */
  theme: ShellTheme
  /** 整页唯一的握手中心（D3）。 */
  frames: FrameHost
  /** 组件交出来的界面状态，看板写给宿主（D5）；缩略画面给一个空实现。 */
  onState: (id: string, patch: unknown) => void | Promise<void>
  /** 组件发到看板栏上的一条通知（D7）。 */
  onNotify: (instance: BoardInstance, widget: WidgetSummary, notification: WidgetNotification) => void
  /** 这一层画面是否暂停：组卡把藏起来的一面停住（D16）。 */
  paused: boolean
  /** 组件库里的缩略画面：组件据此换一套静态、不可交互的排版。 */
  preview?: boolean
}

/** 握手那一刻交给组件的那几样东西。 */
interface InitFace {
  props: Record<string, unknown>
  data: unknown
  state: unknown
  text: Record<string, { zh: string, en: string }>
}

/**
 * 一层组件画面：一个沙箱 iframe 或一个原生组件，握手之后只经端口与组件说话（D3）。
 *
 * 它不带卡片外壳，普通卡片与翻面组的两面都用它；宽高由外壳给出的盒子决定（D16）。
 *
 * @param props - 实例、组件、盒子、主题、握手中心与暂停状态。
 * @returns 画面与它的失败提示。
 */
export function CardSurface({
  instance,
  widget,
  placement,
  theme,
  frames,
  onState,
  onNotify,
  paused,
  preview = false,
}: CardSurfaceProps): ReactNode {
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const portRef = useRef<MessagePort | null>(null)
  const readyRef = useRef(false)
  const answeredRef = useRef(false)
  const [failure, setFailure] = useState<string | null>(null)
  /** 状态没写进宿主的原因；成功后收起（D23）。 */
  const [saveFailure, setSaveFailure] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  /** 宿主因为缺授权拒绝了上一次动作或读数据：卡片上画出「允许」按钮（D6）。 */
  const [asking, setAsking] = useState<{ kind: GrantKind, id: string } | null>(null)
  const native = useNativeWidget(instance.widget)
  const size = {
    w: Math.round(placement.width),
    h: Math.round(placement.height),
    placement: preview ? 'preview' as const : 'board' as const,
    family: preview ? 'preview' as const : 'board' as const,
    cols: placement.columns,
  }
  const sizeRef = useRef(size)
  sizeRef.current = size
  const stateRef = useRef(onState)
  stateRef.current = onState
  const notifyRef = useRef(onNotify)
  notifyRef.current = onNotify
  const themeRef = useRef(theme)
  themeRef.current = theme
  const pausedRef = useRef(paused)
  pausedRef.current = paused
  const initRef = useRef<InitFace>({ props: instance.props, data: instance.data, state: instance.state, text: widget.text ?? {} })
  initRef.current = { props: instance.props, data: instance.data, state: instance.state, text: widget.text ?? {} }
  const src = widgetDocumentPath(widget.hash, theme.lang)
  // 组件连续 setState 时由队列合并；暂停、页面隐藏与卸载时立即发送（D23）。
  const [queue] = useState(() => createStateQueue({
    send: async (patch) => { await Promise.resolve(stateRef.current(instance.id, patch)) },
    onError: (error) => { setSaveFailure(error.message) },
    onSaved: () => { setSaveFailure(null) },
  }))

  /**
   * 一次动作的结果落到卡片上：成功就收起要授权的那条提示，失败就把原因写出来；缺授权时另画出
   * 「允许」按钮（D6、D11）。
   *
   * @param error - 失败时的错误；成功时是 `undefined`。
   */
  const settleAction = (error?: Error): void => {
    if (error === undefined) {
      setAsking(null)
      return
    }
    setFailure(error.message)
    setAsking(error instanceof GrantRequiredError ? { kind: error.kind, id: error.id } : null)
  }

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
      if (message.type === 'setState') queue.push(message.patch)
      if (message.type === 'notify') notifyRef.current(instance, widget, message)
      if (message.type === 'action') {
        sendInstanceAction(instance.id, message.id, message.payload).then(() => { settleAction() }, settleAction)
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
      if (pausedRef.current) send({ type: 'pause' })
    }
    // 组件的 ready 与 iframe 的 load 都触发握手，谁先到谁算：整页的 message 监听在握手中心里。
    const detach = frames.attach(frame, connect)
    frame.addEventListener('load', connect)
    // 监听器装好之后再导入文档。每次都重新导入：端口是新建的，已经加载好的文档握着的还是关掉的端口。
    frame.src = src
    return () => {
      live = false
      window.clearTimeout(watchdog)
      detach()
      held?.()
      frame.removeEventListener('load', connect)
      port.close()
      portRef.current = null
      readyRef.current = false
    }
  }, [src, instance.id, frames, attempt])

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

  useEffect(() => {
    const port = portRef.current
    if (port === null || !readyRef.current) return
    port.postMessage({ type: paused ? 'pause' : 'resume' } satisfies ParentMessage)
    if (paused) void queue.flush()
  }, [paused, queue])

  // 卸下这张卡或整页离开时把最后一份状态送出去；页面隐藏也先冲一次（D23）。
  useEffect(() => {
    const flush = (): void => { void queue.flush() }
    const onVisibility = (): void => { if (document.visibilityState === 'hidden') flush() }
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', flush)
      document.removeEventListener('visibilitychange', onVisibility)
      queue.dispose()
    }
  }, [queue])

  return (
    <>
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
                setState: (patch: unknown) => { queue.push(patch) },
                action: (id: string, payload?: unknown) => {
                  sendInstanceAction(instance.id, id, payload).then(() => { settleAction() }, settleAction)
                },
                notify: (notification?: WidgetNotification) => {
                  notifyRef.current(instance, widget, notification ?? {})
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
      {failure === null && saveFailure === null ? null : (
        <p className="dsh-widget-board__failure-strip" role="status">{failure ?? saveFailure}</p>
      )}
      {asking === null ? null : (
        <button
          type="button"
          className="dsh-widget-board__grant"
          data-dsh-widget-board-grant={`${asking.kind}:${asking.id}`}
          onClick={() => {
            grantInstance(instance.id, asking.kind, asking.id).then(
              () => { setAsking(null); setFailure(null) },
              (error: Error) => { setFailure(error.message) },
            )
          }}
        >
          {t('allow')}
        </button>
      )}
    </>
  )
}
