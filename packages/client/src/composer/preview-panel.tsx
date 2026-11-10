/**
 * 预览面板（技术契约 5、C6）。
 *
 * 预览用真实的组件文档、真实的运行时与真实的 CSP：它跑在一个独立的 iframe 里，与看板上的卡片
 * 同一个 `sandbox="allow-scripts"`，不给 same-origin，也不改 CSP（技术契约 5）。
 *
 * 预览与正式卡片的区别只有一处，但那一处是关键：预览里的动作、能力调用与通知不产生正式副作用。
 * 帧的标识在握手中心里明确分成 `preview` 与 `instance`，预览帧的端口走一条只提供状态、尺寸、主题
 * 与错误的通道：组件按下按钮时看到的是一句「预览里不能做这件事」，而不是真的去跑（C15）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { ParentMessage, WidgetMessage } from '@dsh-widget-board/contracts'
import { MESSAGE_RATE_LIMIT, isWidgetMessage, withinLimit } from '@dsh-widget-board/contracts'
import { t } from '../copy'
import type { FrameHost } from '../frame-host'
import type { ShellTheme } from '../theme'
import { resolveTheme } from '../theme'
import { createPreview, releasePreview } from './source-api'

/** 预览面板要画的东西。 */
export interface PreviewPanelProps {
  /** 组件目录里的文件，键是相对路径。 */
  files: Record<string, string>
  binaryFiles?: Record<string, string>
  autoRun?: boolean
  currentSize?: { width: number, height: number }
  /** 预览用的 props。 */
  props?: Record<string, unknown>
  /** 预览用的 data。 */
  data?: unknown
  /** 预览用的 state。 */
  state?: unknown
  /** 当前主题。 */
  theme: ShellTheme
  /** 整页唯一的握手中心（D3）。 */
  frames: FrameHost
}

/** 预览的尺寸档：宽度与高度各三档（C6）。 */
const WIDTHS = [
  { key: 'narrow', label: 'S', px: 300 },
  { key: 'regular', label: 'M', px: 420 },
  { key: 'wide', label: 'L', px: 620 },
] as const

/** 高度档。 */
const HEIGHTS = [
  { key: 'short', label: 'S', px: 240 },
  { key: 'regular', label: 'M', px: 360 },
  { key: 'tall', label: 'L', px: 520 },
] as const

/** 重建预览的防抖：三百毫秒（C6）。 */
const REBUILD_DEBOUNCE_MS = 300

/**
 * 预览面板。
 *
 * @param props - 文件、内容、主题与握手中心。
 * @returns 面板。
 */
export function PreviewPanel({ files, binaryFiles, props, data, state, theme, frames, autoRun = true, currentSize }: PreviewPanelProps): ReactNode {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [width, setWidth] = useState<number>(WIDTHS[1].px)
  const [height, setHeight] = useState<number>(HEIGHTS[1].px)
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const portRef = useRef<MessagePort | null>(null)
  const activeId = useRef<string | null>(null)
  const generation = useRef(0)
  const current = useRef({ theme, width, height })
  current.current = { theme, width, height }
  /** 正在重建的计时器：内容变了之后等三百毫秒再动（D6 的防抖）。 */
  const timerRef = useRef<number | null>(null)

  const fingerprint = useMemo(() => JSON.stringify({ files, binaryFiles, props: props ?? {}, data: data ?? null, state: state ?? null }), [files, binaryFiles, props, data, state])

  /**
   * 开一个预览会话：文件留在宿主的内存里，不写正式的组件库（D5）。
   */
  const start = useCallback(async (): Promise<void> => {
    const ticket = ++generation.current
    setRunning(true)
    setFailure(null)
    try {
      const previous = activeId.current
      activeId.current = null
      setSessionId(null)
      if (previous !== null) await releasePreview(previous)
      if (ticket !== generation.current) return
      const session = await createPreview({ files, ...(binaryFiles === undefined ? {} : { binaryFiles }), ...(props === undefined ? {} : { props }), data: data ?? null, state: state ?? null })
      if (ticket !== generation.current) { await releasePreview(session.previewId); return }
      activeId.current = session.previewId
      setSessionId(session.previewId)
    } catch (caught) {
      if (ticket === generation.current) { setFailure((caught as Error).message); setSessionId(null) }
    } finally {
      if (ticket === generation.current) setRunning(false)
    }
  }, [binaryFiles, data, files, props, state])

  // 内容变了之后重建：防抖三百毫秒，尺寸与主题的变化不进这里（C6）。
  useEffect(() => {
    if (!autoRun) {
      ++generation.current
      setSessionId(null)
      const id = activeId.current
      activeId.current = null
      if (id !== null) void releasePreview(id).catch((error: Error) => { setFailure(error.message) })
      return
    }
    ++generation.current
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => { void start() }, REBUILD_DEBOUNCE_MS)
    return () => { if (timerRef.current !== null) window.clearTimeout(timerRef.current) }
  }, [autoRun, fingerprint])

  // 面板关掉时释放会话：端口、计时器与附件都收掉（D6）。
  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    ++generation.current
    const id = activeId.current
    activeId.current = null
    if (id !== null) void releasePreview(id).catch(() => undefined)
  }, [])

  // 预览帧的握手：端口只提供状态、尺寸与主题，动作、能力调用与通知一律拒绝（C15）。
  useEffect(() => {
    if (sessionId === null) return
    const frame = frameRef.current
    if (frame === null) return
    const channel = new MessageChannel()
    const port = channel.port1
    portRef.current = port
    port.start()
    let live = true
    let connected = false
    let unhold: (() => void) | undefined
    let previewState: unknown = state ?? null
    const recent: number[] = []
    const send = (message: ParentMessage): void => {
      if (!live) return
      try {
        port.postMessage(message)
      } catch {
        // 端口已经关了：这条消息发不出去，组件那边不会再有动静（D11）。
      }
    }
    const connect = (): void => {
      // 通道已经关掉时不再递端口：关掉的端口再递一次会抛「Port is neutered」。
      if (!live || connected || portRef.current === null) return
      connected = true
      unhold = frames.hold(port)
      frame.contentWindow?.postMessage({ type: 'connect' }, '*', [channel.port2])
      const resolved = resolveTheme()
      send({
        type: 'init',
        lang: resolved.lang,
        motion: resolved.motion,
        tokens: resolved.tokens,
        size: { w: current.current.width, h: current.current.height, placement: 'preview', family: 'preview', cols: 1 },
        props: props ?? {},
        data: data ?? null,
        state: state ?? null,
        text: (JSON.parse(files['widget.json'] ?? '{}') as { text?: Record<string, { zh: string, en: string }> }).text ?? {},
      })
    }
    const detach = frames.attach(frame, connect)
    const expiry = window.setTimeout(() => {
      live = false
      detach()
      unhold?.()
      port.close()
      portRef.current = null
      activeId.current = null
      setSessionId(null)
      setFailure('预览已过期，请重新运行')
      void releasePreview(sessionId).catch((error: Error) => { setFailure(error.message) })
    }, 10 * 60 * 1000)
    port.onmessage = (event: MessageEvent) => {
      const message = event.data as WidgetMessage | undefined
      if (!isWidgetMessage(message)) return
      if (!withinLimit(message)) return
      const now = Date.now()
      while (recent.length > 0 && now - (recent[0] as number) > 1000) recent.shift()
      recent.push(now)
      if (recent.length > MESSAGE_RATE_LIMIT) return
      if (message.type === 'error') setFailure(message.message)
      if (message.type === 'setState') {
        const patch = message.patch
        const next = patch !== null && typeof patch === 'object' && !Array.isArray(patch)
          ? { ...(previewState !== null && typeof previewState === 'object' && !Array.isArray(previewState) ? previewState : {}), ...patch }
          : patch
        const update: ParentMessage = { type: 'state', state: next }
        if (withinLimit(update)) { previewState = next; send(update) }
        else setFailure('预览状态超过桥额度')
      }
      if (message.type === 'height') {
        // 组件报上来的高度只改预览视口，不改面板的盒子（C6）。
        // 尺寸由用户控制，组件的高度报告不写入正式布局。
      }
      // 动作、能力调用与通知在预览里没有正式去处：给一句能看见的说法，不执行（D15、C16）。
      if (message.type === 'action') {
        send({ type: 'call-error', requestId: message.id, code: 'preview', message: t('previewNoEffect') })
        setFailure(t('previewNoEffect'))
      }
      if (message.type === 'call') {
        send({ type: 'call-error', requestId: message.requestId, code: 'preview', message: t('previewNoEffect') })
        setFailure(t('previewNoEffect'))
      }
      if (message.type === 'notify') {
        // 通知不进正式的未读列表（C6）。
        setFailure(t('previewNoEffect'))
      }
    }
    frame.src = `api/widget-board/preview/${encodeURIComponent(sessionId)}/document?lang=${encodeURIComponent(theme.lang)}`
    return () => {
      live = false
      window.clearTimeout(expiry)
      detach()
      unhold?.()
      frame.src = 'about:blank'
      // 端口可能已经被别的路径关掉：关两次不会出错，但递出去的端口就废了。
      try {
        port.close()
      } catch {
        // 端口已经关了：这里正是要做的释放（D11）。
      }
      portRef.current = null
    }
  }, [frames, sessionId])

  useEffect(() => {
    portRef.current?.postMessage({ type: 'size', size: { w: width, h: height, placement: 'preview', family: 'preview', cols: 1 } } satisfies ParentMessage)
  }, [width, height])

  // 主题变了推给预览里的组件：与正式卡片同一条路（D10）。
  useEffect(() => {
    let pending = 0
    // 宿主在配色事件后更新样式；样式完成后复用原解析器读取令牌。
    const refresh = (): void => {
      window.cancelAnimationFrame(pending)
      pending = window.requestAnimationFrame(() => {
        pending = window.requestAnimationFrame(() => {
          portRef.current?.postMessage({ type: 'theme', ...resolveTheme() } satisfies ParentMessage)
        })
      })
    }
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener('change', refresh)
    refresh()
    return () => { window.cancelAnimationFrame(pending); media.removeEventListener('change', refresh) }
  }, [theme])

  return (
    <div className="dsh-widget-board__preview" data-dsh-widget-board-preview="">
      <div className="dsh-widget-board__preview-bar">
        <span className="dsh-widget-board__preview-group" role="group" aria-label={t('previewWidth')}>
          {WIDTHS.map((entry) => (
            <button
              key={entry.key}
              type="button"
              className="dsh-widget-board__preview-size"
              data-dsh-widget-board-preview-width={entry.key}
              aria-pressed={width === entry.px}
              onClick={() => { setWidth(entry.px) }}
            >
              {entry.label}
            </button>
          ))}
        </span>
        <span className="dsh-widget-board__preview-group" role="group" aria-label={t('previewHeight')}>
          {HEIGHTS.map((entry) => (
            <button
              key={entry.key}
              type="button"
              className="dsh-widget-board__preview-size"
              data-dsh-widget-board-preview-height={entry.key}
              aria-pressed={height === entry.px}
              onClick={() => { setHeight(entry.px) }}
            >
              {entry.label}
            </button>
          ))}
        </span>
        <span className="dsh-widget-board__editor-spacer" />
        {currentSize === undefined ? null : <button type="button" className="dsh-widget-board__editor-ghost" data-dsh-widget-board-preview-current="" onClick={() => { setWidth(currentSize.width); setHeight(currentSize.height) }}>当前尺寸</button>}
        <span className="dsh-widget-board__source-note">主题随宿主切换</span>
        <button
          type="button"
          className="dsh-widget-board__editor-ghost"
          data-dsh-widget-board-preview-run=""
          disabled={running}
          onClick={() => { void start() }}
        >
          {running ? t('previewRunning') : t('previewRun')}
        </button>
      </div>
      <div className="dsh-widget-board__preview-stage">
        <iframe
          ref={frameRef}
          className="dsh-widget-board__preview-frame"
          data-dsh-widget-board-preview-frame=""
          sandbox="allow-scripts"
          title={t('preview')}
          style={{ width: `${String(width)}px`, height: `${String(height)}px` }}
        />
      </div>
      {failure === null ? null : <p className="dsh-widget-board__editor-error" role="status">{failure}</p>}
    </div>
  )
}
