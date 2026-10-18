/**
 * 会话里内联显示的一张组件（D9）。
 *
 * 工具视图按线上工具名分派；本视图认 `widget_show`，从这次结果的 `meta` 里读宿主投影的载荷，用
 * 看板卡片同一套画面（`CardSurface`）把它画出来：看板上的卡写回状态、动作走向那个实例；一次性
 * 快照只把状态留在页面上，动作没有去处，按下时把原因写在画面上。
 *
 * 高度：组件的文档里 `100vh` 就是这一块盒子，所以先按尺寸族给一档初始高度，组件报上来的内容高度
 * 更大时再长（`height` 消息，D16）。
 */
import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { BoardInstance, WidgetNotification, WidgetSummary } from '@dsh-widget-board/contracts'
import tokens from '@dsh-widget-board/contracts/tokens.json'
import { CardSurface } from './card-surface'
import { CARD_CLIP } from './card-shell'
import { isChinese, t } from './copy'
import { createFrameHost } from './frame-host'
import { showOf, textOf } from './inline-value'
import { notificationStore, noticeOf } from './notifications'
import { saveInstanceState } from './snapshot'
import { mergeState } from './state-merge'
import type { ShellTheme } from './theme'
import { resolveTheme, watchTheme } from './theme'

/** 内联盒子的初始高度，按尺寸族给一档像素。 */
const START_HEIGHT: Record<string, number> = { s: 170, m: 200, l: 240, wide: 260, xl: 300 }

/** 尺寸族认不出来时的初始高度。 */
const DEFAULT_HEIGHT = 220

/** 内联盒子的高度上下限：太矮排不下，太高把回答撑开。 */
const MIN_HEIGHT = 120
const MAX_HEIGHT = 480

/** 报上来的高度与当前值差不到这么多就不动，免得组件与盒子互相追着改。 */
const HEIGHT_SLACK = 8

/** 视图自己带的令牌：它与看板根节点不在同一棵子树里（D10）。 */
const TOKENS = tokens as { radius: { card: string }, motion: { fast: string, 'ease-standard': string } }

/** 一次工具调用视图收到的属性（D9）：只写本视图用到的几项。 */
export interface ToolViewProps {
  phase: 'preparing' | 'start' | 'result'
  block: {
    /** 模型看到的内容块；没有可画的载荷时退回它。 */
    content?: readonly { type?: string, text?: string }[]
    isError?: boolean
    /** 工具经 `presentationMeta` 投影的载荷。 */
    meta?: unknown
  }
}

/** 内联视图的属性：上下文用来跟随宿主主题。 */
export interface InlineViewProps extends ToolViewProps {
  context: unknown
}

/**
 * 会话里内联显示的一张组件。
 *
 * @param props - 阶段、这次调用的块与浏览器半边的上下文。
 * @returns 一张组件的画面，或一句说明。
 */
export function InlineWidget({ context, phase, block }: InlineViewProps): ReactNode {
  const [theme, setTheme] = useState<ShellTheme>(resolveTheme)
  const [height, setHeight] = useState(DEFAULT_HEIGHT)
  const [width, setWidth] = useState(0)
  /** 一次性快照的状态只留在页面上：它在宿主上没有对应的卡片。 */
  const [local, setLocal] = useState<{ id: string, value: unknown } | null>(null)
  const boxRef = useRef<HTMLDivElement | null>(null)
  const frames = useMemo(() => createFrameHost(), [])

  useEffect(() => watchTheme(context, setTheme), [context])
  useEffect(() => {
    frames.broadcast(theme)
  }, [frames, theme])
  useEffect(() => () => { frames.dispose() }, [frames])

  const shown = phase === 'result' && block.isError !== true ? showOf(block.meta) : undefined
  const detached = shown !== undefined && shown.board === undefined

  // 组件的视口就是这一块盒子：宽度按它排版（组件里的 vw 也读它）。
  useEffect(() => {
    const box = boxRef.current
    if (box === null) return
    const observer = new ResizeObserver(() => { setWidth(box.getBoundingClientRect().width) })
    observer.observe(box)
    return () => { observer.disconnect() }
  }, [shown?.id])

  // 换一张快照时回到那一族的初始高度。
  useEffect(() => {
    if (shown === undefined) return
    setHeight(START_HEIGHT[shown.family] ?? DEFAULT_HEIGHT)
  }, [shown?.id, shown?.family])

  const onHeight = useCallback((next: number): void => {
    if (!Number.isFinite(next) || next <= 0) return
    setHeight((current) => {
      const wanted = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.ceil(next)))
      return Math.abs(wanted - current) < HEIGHT_SLACK ? current : wanted
    })
  }, [])

  const onState = useCallback(async (id: string, patch: unknown): Promise<void> => {
    if (detached) {
      // 组件连着的这张快照不在宿主上：状态在页面上合并，看板上的那一份不动（D11 的可见说法）。
      setLocal((previous) => ({
        id,
        value: mergeState(previous !== null && previous.id === id ? previous.value : shown?.state, patch),
      }))
      return
    }
    await saveInstanceState(id, patch)
  }, [detached, shown?.state])

  const onNotify = useCallback((instance: BoardInstance, widget: WidgetSummary, notification: WidgetNotification): void => {
    const widgetTitle = isChinese() ? widget.title.zh : widget.title.en
    notificationStore.push({
      instanceId: instance.id,
      widgetId: instance.widget,
      widgetTitle,
      ...noticeOf(notification, widgetTitle),
    })
  }, [])

  if (shown === undefined) {
    const text = phase === 'result' ? textOf(block.content) : undefined
    return createElement('p', { className: 'dsh-widget-board__inline-note' }, text ?? (phase === 'result' ? t('inlineEmpty') : t('inlinePreparing')))
  }

  const instance: BoardInstance = {
    id: shown.id,
    widget: shown.widget,
    hash: shown.hash,
    ...(shown.source === undefined ? {} : { source: shown.source }),
    props: shown.props,
    data: shown.data,
    state: detached && local !== null && local.id === shown.id ? local.value : shown.state,
    layout: { x: 0, y: 0, w: 1, h: 10 },
  }
  const style = {
    height: `${String(height)}px`,
    '--w-radius-card': TOKENS.radius.card,
    '--w-motion-fast': TOKENS.motion.fast,
    '--w-motion-ease-standard': TOKENS.motion['ease-standard'],
  } as CSSProperties

  return createElement(
    'div',
    {
      ref: boxRef,
      className: 'dsh-widget-board__inline',
      'data-dsh-widget-board-inline': shown.widget,
      style,
    },
    createElement(
      'div',
      { className: 'dsh-widget-board__inline-box', style: { clipPath: CARD_CLIP } },
      createElement(CardSurface, {
        instance,
        widget: shown.summary,
        placement: { id: shown.id, x: 0, y: 0, width: width === 0 ? 360 : width, height, columns: 1 },
        theme,
        frames,
        onState,
        onNotify,
        paused: false,
        inline: { family: shown.family, detached },
        onHeight,
      }),
    ),
  )
}
