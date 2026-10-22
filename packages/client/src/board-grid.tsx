/**
 * 一块看板的卡片栅格（D16、D21）。
 *
 * 每块看板各自算自己的排布，各自拿住拖动与缩放期间的草稿：切换标签时两块看板的本地状态不会串。
 * 列宽与根字号（度量）、暂停、退场与通知由页面外壳统一持有（D16 的整页唯一观察者），这里只读它
 * 递下来的那一份；拖动、缩放与整理的结果按这块看板的 id 提交给宿主（D5）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import type {
  Board,
  BoardInstance,
  CardLayout,
  WidgetLibraryEntry,
  WidgetMinBox,
  WidgetNotification,
  WidgetSummary,
  WorkspaceSnapshot,
} from '@dsh-widget-board/contracts'
import type { GridLayout, GridMetrics, GridPlacement } from '@dsh-widget-board/model'
import {
  DEFAULT_HEIGHT_REM,
  clampCardLayout,
  normalizeCardLayout,
  resolveLayout,
  snapCardHeight,
  snapCardY,
  tidyLayout,
} from '@dsh-widget-board/model'
import type { CardControls } from './card'
import { WidgetCard } from './card'
import { CARD_RADIUS } from './card-shell'
import { t } from './copy'
import { FlipGroupCard } from './flip-group'
import type { FrameHost } from './frame-host'
import type { BoardCard } from './group'
import { cardId, cardLayout, groupCards, layoutItemsOf } from './group'
import { saveBoardLayouts } from './snapshot'
import type { ShellTheme } from './theme'

/** 把数字收进区间。 */
function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

/**
 * 一格卡片的最小盒子：组卡取正反两面的并集，普通卡取自己组件的那一份。
 *
 * @param card - 看板上的格子。
 * @param widgets - 快照里的组件元信息。
 * @returns 最小盒子；没有声明时是 `undefined`。
 */
function minBoxOfCard(card: BoardCard, widgets: Readonly<Record<string, WidgetSummary>>): WidgetMinBox | undefined {
  const instances = card.kind === 'group' ? [card.front, card.back] : [card.instance]
  let merged: WidgetMinBox | undefined
  for (const instance of instances) {
    const box = widgets[instance.widget]?.minBox
    if (box === undefined) continue
    merged = merged === undefined ? box : { w: Math.max(merged.w, box.w), h: Math.max(merged.h, box.h) }
  }
  return merged
}

/** 拖动时卡片跟手，自由宽度不低于这个像素值。 */
const MIN_FREE_WIDTH = 120

/** 正在拖动或缩放的是哪一张卡；`kind` 决定指针的位移怎么变成布局。 */
type DragKind = 'move' | 'resize'

interface DragState {
  id: string
  kind: DragKind
  pointerId: number
  startClientX: number
  startClientY: number
  /** 拖动开始时看板内容区的左上角：滚动之后指针相对内容区的位移仍然算得对。 */
  flowLeft: number
  flowTop: number
  /** 松手后卡片会落到的格子；虚影画在这里。 */
  layout: CardLayout
  /** 拖动开始时卡片在屏幕上的像素位置；自由跟随从它加上指针位移。 */
  startPlacement: GridPlacement
  /** 卡片当前跟着指针的像素盒子：它不受格子约束，落在虚影上方。 */
  free: { x: number, y: number, width: number, height: number }
  /** 页面读到的那一份的布局修订号；提交时带它，别的窗口已经改过就整份退回（D5）。 */
  layoutRevision: number
  /** 组件声明的最小盒子：缩放时不能把卡片压到它下面。 */
  minBox?: WidgetMinBox
  moved: boolean
}

/** 一块看板要用的东西。 */
export interface BoardGridProps {
  /** 这块看板。 */
  board: Board
  /** 是不是当前选中的那一块：只有它可见，也只有在它上面才拖得动。 */
  active: boolean
  /** 整页唯一的度量：列数、列宽、间距与根字号。 */
  metrics: GridMetrics | null
  /** 卡片要用的组件元信息，按组件 id 索引。 */
  widgets: Readonly<Record<string, WidgetSummary>>
  /** 组件库的全部类型，含读不出来的那些：不可用的卡片要写明原因。 */
  library: readonly WidgetLibraryEntry[]
  /** 当前主题（D10）。 */
  theme: ShellTheme
  /** 整页唯一的握手中心（D3）。 */
  frames: FrameHost
  /** 卡片的暂停与恢复登记（D16）。 */
  controls: CardControls
  /** 正在退场的卡片 id（D18）。 */
  exiting: ReadonlySet<string>
  /** 主动刷新一次就让每张卡换一个 key。 */
  refreshGeneration: number
  /** 页面正在写宿主：这段时间不接新的拖动。 */
  busy: boolean
  /** 把这块看板的内容区交给外壳：组件库的落点与滚动位置按它算。 */
  onFlow: (id: string, element: HTMLDivElement | null) => void
  /** 这块看板成为选中时把「整理」交给外壳，切走时收回。 */
  onTidyReady: (tidy: (() => void) | null) => void
  /** 宿主给了一份新的工作区（修订号过期时）。 */
  onSnapshot: (snapshot: WorkspaceSnapshot) => void
  /** 宿主存下了这次布局：只把这一块看板的盒子并回去。 */
  onLayouts: (boardId: string, layoutRevision: number, layouts: Record<string, CardLayout>) => void
  /** 记下或清掉一条失败提示。 */
  onFailure: (message: string | null) => void
  /** 这次写宿主要不要挡住菜单与拖动。 */
  onBusyChange: (busy: boolean) => void
  /** 打开一张卡或一组的设置（D27）；`button` 用来在关闭后还焦点。 */
  onSettings: (kind: 'instance' | 'group', id: string, button: HTMLButtonElement) => void
  /** 组件交出来的界面状态（D5）。 */
  onState: (id: string, patch: unknown) => Promise<void>
  /** 组件发来的一条通知（D7）。 */
  onNotify: (instance: BoardInstance, widget: WidgetSummary, notification: WidgetNotification) => void
  /** 移除一张卡。 */
  onRemove: (id: string) => void
  /** 移除一整组翻面卡（D19）。 */
  onRemoveGroup: (group: string) => void
  /** 按宿主的当前一份重画（D5）。 */
  onRefetch: () => void
}

/**
 * 一块看板的栅格：卡片按度量摆开，拖动与缩放只改这一块的本地草稿。
 *
 * @param props - 看板、度量、主题与各项回调。
 * @returns 这块看板的内容区。
 */
export function BoardGrid({
  board,
  active,
  metrics,
  widgets,
  library,
  theme,
  frames,
  controls,
  exiting,
  refreshGeneration,
  busy,
  onFlow,
  onTidyReady,
  onSnapshot,
  onLayouts,
  onFailure,
  onBusyChange,
  onSettings,
  onState,
  onNotify,
  onRemove,
  onRemoveGroup,
  onRefetch,
}: BoardGridProps): ReactNode {
  const [drag, setDrag] = useState<DragState | null>(null)
  const [draft, setDraft] = useState<Record<string, CardLayout> | null>(null)
  const flowRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const draftRef = useRef<Record<string, CardLayout> | null>(null)
  const busyRef = useRef(false)

  const setFlow = useCallback((element: HTMLDivElement | null): void => {
    flowRef.current = element
    onFlow(board.id, element)
  }, [board.id, onFlow])

  const cards = useMemo(() => groupCards(board.instances), [board.instances])
  const items = cards.map((card) => ({
    id: cardId(card),
    layout: normalizeCardLayout(
      draft?.[cardId(card)] ?? cardLayout(card) ?? { x: 0, y: 0, w: 1, h: DEFAULT_HEIGHT_REM },
      metrics?.columns,
    ),
  }))
  const layout: GridLayout | null = metrics === null ? null : resolveLayout(items, metrics, drag?.id)

  /** 密排：按当前画面上的阅读顺序把每张卡放进最低的列。 */
  const onTidy = useCallback(() => {
    if (metrics === null || layout === null || dragRef.current !== null || busyRef.current) return
    const tidied = tidyLayout(
      Object.entries(layout.layouts).map(([id, next]) => ({ id, layout: next })),
      metrics,
    )
    busyRef.current = true
    onBusyChange(true)
    saveBoardLayouts(board.id, board.layoutRevision, tidied).then((result) => {
      if (result.kind === 'stale') onSnapshot(result.snapshot)
      else onLayouts(board.id, result.layout.layoutRevision, result.layout.layouts)
    }, (error: Error) => {
      onFailure(error.message)
      onRefetch()
    }).finally(() => {
      busyRef.current = false
      onBusyChange(false)
    })
  }, [board.id, board.layoutRevision, layout, metrics, onBusyChange, onFailure, onLayouts, onRefetch, onSnapshot])

  // 菜单上的「整理」按当前选中的那一块走：注册一次，取用时读最新的那一份闭包。
  const tidyRef = useRef(onTidy)
  tidyRef.current = onTidy
  useEffect(() => {
    if (!active) return
    onTidyReady(() => { tidyRef.current() })
    return () => { onTidyReady(null) }
  }, [active, onTidyReady])

  const cancelDrag = useCallback(() => {
    // 指针捕获在松手之后还会丢一次；提交还在路上时不能把本地预览一起清掉。
    if (dragRef.current === null) return
    dragRef.current = null
    draftRef.current = null
    setDrag(null)
    setDraft(null)
  }, [])

  const beginDrag = useCallback((event: ReactPointerEvent<HTMLElement>, id: string, kind: DragKind) => {
    if (metrics === null || dragRef.current !== null || busy) return
    const dragCards = groupCards(board.instances)
    const index = dragCards.findIndex((card) => cardId(card) === id)
    if (index === -1) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    // 从屏幕上正在显示的那一份开始拖：存储里的布局在窄列里可能被推开过，直接用它会跳一下。
    const resolved = resolveLayout(layoutItemsOf(dragCards), metrics)
    const placement = resolved.placements[index]
    if (placement === undefined) return
    const flow = flowRef.current?.getBoundingClientRect()
    const minBox = minBoxOfCard(dragCards[index] as BoardCard, widgets)
    const started: DragState = {
      id,
      kind,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      flowLeft: flow?.left ?? 0,
      flowTop: flow?.top ?? 0,
      layout: resolved.layouts[id] as CardLayout,
      startPlacement: placement,
      free: { x: placement.x, y: placement.y, width: placement.width, height: placement.height },
      layoutRevision: board.layoutRevision,
      ...(minBox === undefined ? {} : { minBox }),
      moved: false,
    }
    dragRef.current = started
    draftRef.current = resolved.layouts
    setDraft(resolved.layouts)
    setDrag(started)
  }, [board.instances, board.layoutRevision, busy, metrics, widgets])

  const moveDrag = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const current = dragRef.current
    const currentDraft = draftRef.current
    if (current === null || currentDraft === null || metrics === null) return
    if (event.pointerId !== current.pointerId) return
    const flow = flowRef.current
    const rect = flow?.getBoundingClientRect()
    // 指针相对内容区的位移：看板滚动时内容区在屏幕上的位置变了，卡片仍然跟着指针。
    const dx = (event.clientX - (rect?.left ?? current.flowLeft)) - (current.startClientX - current.flowLeft)
    const dy = (event.clientY - (rect?.top ?? current.flowTop)) - (current.startClientY - current.flowTop)
    if (!current.moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return
    const columnStep = metrics.columnWidth + metrics.gap
    const flowWidth = flow?.clientWidth
      ?? metrics.columns * metrics.columnWidth + (metrics.columns - 1) * metrics.gap
    let free = current.free
    let next: CardLayout
    if (current.kind === 'move') {
      const x = clamp(current.startPlacement.x + dx, 0, Math.max(0, flowWidth - current.startPlacement.width))
      const y = Math.max(0, current.startPlacement.y + dy)
      free = { ...current.free, x, y }
      const targetX = clamp(Math.round(current.layout.x + dx / columnStep), 0, metrics.columns - current.layout.w)
      const targetY = snapCardY(current.layout.y + dy / metrics.rootFontSize)
      next = { ...current.layout, x: targetX, y: targetY }
    } else {
      const minW = current.minBox?.w ?? 1
      const minWidthPx = minW * metrics.columnWidth + (minW - 1) * metrics.gap
      const minimumWidth = Math.min(Math.max(MIN_FREE_WIDTH, minWidthPx), flowWidth - current.startPlacement.x)
      const width = clamp(current.startPlacement.width + dx, minimumWidth, Math.max(minimumWidth, flowWidth - current.startPlacement.x))
      next = clampCardLayout({
        ...current.layout,
        w: clamp(Math.round(current.layout.w + dx / columnStep), 1, metrics.columns - current.layout.x),
        h: snapCardHeight((current.startPlacement.height + dy) / metrics.rootFontSize),
      }, current.minBox, metrics.columns)
      free = { ...current.free, width, height: next.h * metrics.rootFontSize }
    }
    const nextDraft = { ...currentDraft, [current.id]: next }
    const nextDrag = { ...current, free, moved: true }
    dragRef.current = nextDrag
    draftRef.current = nextDraft
    setDraft(nextDraft)
    setDrag(nextDrag)
  }, [metrics])

  const endDrag = useCallback(() => {
    const current = dragRef.current
    const currentDraft = draftRef.current
    if (current === null || currentDraft === null || metrics === null) {
      cancelDrag()
      return
    }
    const resolved = resolveLayout(Object.entries(currentDraft).map(([id, layout]) => ({ id, layout })), metrics, current.id)
    const moved = current.moved
    dragRef.current = null
    setDrag(null)
    if (!moved) {
      draftRef.current = null
      setDraft(null)
      return
    }
    // 提交在路上时保持整理过的本地预览，等宿主的答复到了再换；松手瞬间不闪回旧位置。
    draftRef.current = resolved.layouts
    setDraft(resolved.layouts)
    busyRef.current = true
    onBusyChange(true)
    saveBoardLayouts(board.id, current.layoutRevision, resolved.layouts).then((result) => {
      busyRef.current = false
      draftRef.current = null
      setDraft(null)
      onBusyChange(false)
      if (result.kind === 'stale') onSnapshot(result.snapshot)
      else onLayouts(board.id, result.layout.layoutRevision, result.layout.layouts)
    }, (error: Error) => {
      // 提交没成：按宿主的当前的一份重画，不把本地预览留在屏幕上（D5）。
      busyRef.current = false
      draftRef.current = null
      setDraft(null)
      onBusyChange(false)
      console.error(`widget-board: ${t('layoutFailed')}：${error.message}`)
      onRefetch()
    })
  }, [board.id, cancelDrag, metrics, onBusyChange, onLayouts, onRefetch, onSnapshot])

  useEffect(() => {
    if (drag === null) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') cancelDrag()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drag, cancelDrag])

  // 松手后的落点画成虚影；卡片自己用 free 的像素盒子跟手。
  const ghost = drag === null || layout === null ? undefined : layout.placements.find((placement) => placement.id === drag.id)

  return (
    <div
      ref={setFlow}
      className="dsh-widget-board__flow"
      data-dsh-widget-board-board={board.id}
      data-active={active ? 'true' : 'false'}
      data-dragging={drag === null ? undefined : 'true'}
      style={layout === null || cards.length === 0 ? undefined : { height: layout.height }}
    >
      {cards.length === 0 ? <div className="dsh-widget-board__notice">{t('empty')}</div> : null}
      {ghost === undefined
        ? null
        : (
          <div
            className="dsh-widget-board__ghost"
            data-dsh-widget-board-ghost=""
            style={{ left: ghost.x, top: ghost.y, width: ghost.width, height: ghost.height }}
          />
        )}
      {layout === null || metrics === null
        ? null
        : cards.map((card, index) => {
            const target = layout.placements[index]
            if (target === undefined) return null
            const cardKey = cardId(card)
            const placement = drag !== null && drag.id === cardKey
              ? { ...target, x: drag.free.x, y: drag.free.y, width: drag.free.width, height: drag.free.height }
              : target
            if (card.kind === 'group') {
              const frontWidget = widgets[card.front.widget]
              const backWidget = widgets[card.back.widget]
              return (
                <FlipGroupCard
                  key={`${card.id}@${frontWidget?.hash ?? 'missing'}@${backWidget?.hash ?? 'missing'}@${refreshGeneration}`}
                  front={card.front}
                  back={card.back}
                  frontWidget={frontWidget}
                  backWidget={backWidget}
                  placement={placement}
                  gesture={drag !== null && drag.id === cardKey ? drag.kind : null}
                  exiting={exiting.has(card.id)}
                  theme={theme}
                  frames={frames}
                  onState={onState}
                  onNotify={onNotify}
                  // 组卡总有槽条可换，不跟着某一面的 props 走（D27）。
                  onSettings={(button: HTMLButtonElement) => { onSettings('group', card.id, button) }}
                  onRemoveGroup={() => onRemoveGroup(card.id)}
                  controls={controls}
                  onDragStart={beginDrag}
                  onDragMove={moveDrag}
                  onDragEnd={endDrag}
                  onDragCancel={cancelDrag}
                />
              )
            }
            const instance = card.instance
            const widget = widgets[instance.widget]
            if (widget === undefined) {
              const entry = library.find((candidate) => candidate.id === instance.widget)
              return (
                <div
                  key={instance.id}
                  className="dsh-widget-board__cell dsh-widget-board__cell--missing"
                  data-instance={instance.id}
                  data-unavailable={instance.widget}
                  data-exiting={exiting.has(instance.id) ? 'true' : undefined}
                  style={{ left: target.x, top: target.y, width: target.width, height: target.height, borderRadius: CARD_RADIUS }}
                >
                  <p className="dsh-widget-board__missing-title">{t('unavailable')}</p>
                  <p className="dsh-widget-board__missing-name">{instance.widget}</p>
                  {entry?.error === undefined ? null : <p className="dsh-widget-board__missing-reason">{entry.error}</p>}
                  <button type="button" className="dsh-widget-board__missing-remove" onClick={() => onRemove(instance.id)}>
                    {t('remove')}
                  </button>
                </div>
              )
            }
            return (
              <WidgetCard
                // 只有组件版本变了或用户主动刷新才换一张卡：卡片状态存进宿主之后，修订号变动不该把计时重置掉。
                key={`${instance.id}@${widget.hash}@${refreshGeneration}`}
                instance={instance}
                widget={widget}
                placement={placement}
                gesture={drag !== null && drag.id === instance.id ? drag.kind : null}
                exiting={exiting.has(instance.id)}
                theme={theme}
                frames={frames}
                onState={onState}
                onNotify={onNotify}
                {...(widget.settings === true || instance.source !== undefined
                  ? { onSettings: (button: HTMLButtonElement) => { onSettings('instance', instance.id, button) } }
                  : {})}
                onRemove={onRemove}
                controls={controls}
                onDragStart={beginDrag}
                onDragMove={moveDrag}
                onDragEnd={endDrag}
                onDragCancel={cancelDrag}
              />
            )
          })}
    </div>
  )
}
