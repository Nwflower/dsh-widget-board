/**
 * 会话里的只读快照画面（D9）：把一张卡、或一份一次性的 props 与 data，画进会话正文或自检用的画廊。
 *
 * 它与看板上的卡片走同一套握手（D3）：按内容哈希取组件文档，递一个端口，推 init、尺寸与主题。
 * 区别在写：会话里没有一张要写到宿主上的卡，组件写的状态只留在这一帧的内存里（切走再回来会丢），
 * 动作、能力调用与通知一律拒绝并说明原因——会话里的画面是只读的。
 */
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { ParentMessage, WidgetMessage, WidgetSize } from '@dsh-widget-board/contracts'
import { MESSAGE_LIMIT, isWidgetMessage, widgetDocumentPath, withinLimit } from '@dsh-widget-board/contracts'
import type { FrameHost } from './frame-host'
import type { ShellTheme } from './theme'
import { openInNewTab } from './open-url'

/** 快照画面要画的东西。 */
export interface SnapshotSurfaceProps {
  /** 组件内容的哈希：画的是调用那一刻的版本（D7）。 */
  hash: string
  /** 组件的标题，给 iframe 的 `title` 用。 */
  title: string
  props: Record<string, unknown>
  data: unknown
  state: unknown
  /** manifest 里的文案，按语言取。 */
  text: Record<string, { zh: string, en: string }>
  /** 画出来的实际像素盒。 */
  size: WidgetSize
  /** 会话正文里的快照是 `inline`，自检的画廊是 `board` 的盒子。 */
  placement: 'inline' | 'board' | 'preview'
  theme: ShellTheme
  frames: FrameHost
  /** 组件报上来的内容高度（内联显示按它定高）。 */
  onHeight?: (height: number) => void
  /** 组件报了错、或没在时限内应答时调用，交给调用方显示。 */
  onFailure?: (message: string) => void
  /** 自检画廊里：不可交互，也不接收指针。 */
  inert?: boolean
}

/** 握手这么久没有收到组件的任何一条消息，就报没应答。 */
const ANSWER_TIMEOUT_MS = 8000

/**
 * 一层只读的快照画面。
 *
 * @param props - 要画的版本、数据、盒子、主题与握手中心。
 * @returns iframe 与它的失败提示。
 */
export function SnapshotSurface({
  hash,
  title,
  props: instanceProps,
  data,
  state,
  text,
  size,
  placement,
  theme,
  frames,
  onHeight,
  onFailure,
  inert = false,
}: SnapshotSurfaceProps): ReactNode {
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  /** 组件写在会话里的状态：只活在这一帧的内存里，面板关掉就没了。 */
  const localState = useRef<unknown>(state)
  const initRef = useRef({ props: instanceProps, data, state, text })
  initRef.current = { props: instanceProps, data, state, text }
  const sizeRef = useRef(size)
  sizeRef.current = size
  const themeRef = useRef(theme)
  themeRef.current = theme
  const heightRef = useRef(onHeight)
  heightRef.current = onHeight
  const failureRef = useRef(onFailure)
  failureRef.current = onFailure
  const src = widgetDocumentPath(hash, theme.lang)

  useEffect(() => {
    const frame = frameRef.current
    if (frame === null) return
    const channel = new MessageChannel()
    const port = channel.port1
    let live = true
    let ready = false
    let answered = false
    let held: (() => void) | undefined
    let detach: (() => void) | undefined
    const fail = (message: string): void => {
      setFailure(message)
      failureRef.current?.(message)
    }
    const watchdog = window.setTimeout(() => {
      if (live && !answered) fail('组件没有应答')
    }, ANSWER_TIMEOUT_MS)
    const send = (message: ParentMessage): void => {
      if (live) port.postMessage(message)
    }
    port.start()
    const connect = (): void => {
      if (!live || ready) return
      ready = true
      frame.contentWindow?.postMessage({ type: 'connect' }, '*', [channel.port2])
      held = frames.hold(port)
      const { props, data: initialData, state: initialState, text: initialText } = initRef.current
      const { tokens, lang, motion } = themeRef.current
      send({
        type: 'init',
        lang,
        motion,
        tokens,
        size: sizeRef.current,
        props: props ?? {},
        data: initialData ?? null,
        state: (localState.current ?? initialState) ?? null,
        text: initialText,
      })
    }
    port.onmessage = (event: MessageEvent) => {
      const message = event.data as WidgetMessage | undefined
      if (!isWidgetMessage(message)) return
      if (!withinLimit(message)) {
        console.error(`widget-board: 组件发来的消息超过 ${String(MESSAGE_LIMIT)} 字节，丢弃`)
        return
      }
      if (!answered) {
        answered = true
        window.clearTimeout(watchdog)
        setFailure(null)
      }
      switch (message.type) {
        case 'ready':
          return
        case 'height':
          if (heightRef.current !== undefined) heightRef.current(message.height)
          return
        case 'error':
          fail(message.message)
          return
        case 'setState':
          // 只读的快照：状态留在这一帧里，不回写宿主（D5 的唯一写入者是看板）。
          localState.current = mergeState(localState.current, message.patch)
          return
        case 'open':
          // 跳转不需要宿主，快照里的卡片也能把链接开出去（D26）。
          openInNewTab(message.url)
          return
        case 'action':
        case 'call':
          // 会话里的快照没有可以执行的宿主动作与能力（D6、D24）。
          if (message.type === 'call') {
            send({ type: 'call-error', requestId: message.requestId, code: 'snapshot', message: '会话里的组件是只读快照，不能调用宿主能力' })
          }
          return
        default:
          // cancel 与 notify：没有在途的调用，也没有看板栏可记。
          return
      }
    }
    detach = frames.attach(frame, connect)
    frame.addEventListener('load', connect)
    frame.src = src
    return () => {
      live = false
      window.clearTimeout(watchdog)
      detach?.()
      held?.()
      frame.removeEventListener('load', connect)
      port.close()
    }
  }, [src, frames, attempt])

  useEffect(() => {
    const frame = frameRef.current
    if (frame === null) return
    // 超时没应答时换一个端口再来一次；重试次数与看板卡片一致（D11）。
    if (failure === '组件没有应答' && attempt < 3) {
      const timer = window.setTimeout(() => { setAttempt(attempt + 1) }, 600)
      return () => { window.clearTimeout(timer) }
    }
  }, [failure, attempt])

  return (
    <>
      <iframe
        ref={frameRef}
        className="dsh-widget-board__snapshot-frame"
        sandbox="allow-scripts"
        title={title}
        data-placement={placement}
        style={{ width: `${String(size.w)}px`, height: `${String(size.h)}px` }}
        {...(inert ? { inert: '' } : {})}
      />
      {failure === null ? null : <p className="dsh-widget-board__snapshot-failure" role="status">{failure}</p>}
    </>
  )
}

/**
 * 把一份局部状态并到上一份上；两份都不是普通对象时直接换掉。
 *
 * 与宿主上看板卡片的状态合并同一条规则：只换带来的字段，缺的字段保留（D18）。
 *
 * @param current - 上一份状态。
 * @param patch - 组件送来的补丁。
 * @returns 合并之后的状态。
 */
function mergeState(current: unknown, patch: unknown): unknown {
  const isPlain = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
  if (!isPlain(current) || !isPlain(patch)) return patch
  return { ...current, ...patch }
}
