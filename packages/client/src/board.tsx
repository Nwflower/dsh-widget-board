import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import type { BoardEventFrame, BoardSnapshot, CardLayout, WidgetMinBox, WidgetSummary } from '@dsh-widget-board/contracts'
import { FLIP_GROUP_ID, WIDGET_BOARD_PANEL_ID } from '@dsh-widget-board/contracts'
import tokens from '@dsh-widget-board/contracts/tokens.json'
import type { GridLayout, GridMetrics, GridPlacement } from '@dsh-widget-board/model'
import {
  DEFAULT_HEIGHT_REM,
  clampCardLayout,
  gridMetrics,
  normalizeCardLayout,
  resolveLayout,
  snapCardHeight,
  snapCardY,
  tidyLayout,
} from '@dsh-widget-board/model'
import type { CardControls } from './card'
import { WidgetCard } from './card'
import { CARD_CLIP_RADIUS } from './card-shell'
import { t } from './copy'
import { BoardDock } from './dock'
import { FlipGroupCard } from './flip-group'
import { createFrameHost } from './frame-host'
import type { BoardCard } from './group'
import { FLIP_GROUP_ENTRY, cardId, cardLayout, groupCards, layoutItemsOf } from './group'
import { subscribeLive } from './live'
import { mergeEvent, needsSnapshot } from './merge'
import { addGroup, addInstance, fetchSnapshot, refreshBoard, removeGroup, removeInstance, saveBoardLayouts, saveInstanceState } from './snapshot'
import type { ShellTheme } from './theme'
import { resolveTheme, watchTheme } from './theme'

/** 根字号的像素值：列宽与卡片高度按它换算（D16）。 */
function rootFontSize(): number {
  return Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
}

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

/** 卡片移动的过渡读令牌（D10）；外壳没有 `--w-*`，这里把令牌的字面值写在这一页的根上。 */
const MOTION = (tokens as { motion: Record<string, string> }).motion
const RADIUS = (tokens as { radius: { card: string } }).radius.card
const SHELL_STYLE = {
  '--w-motion-fast': MOTION.fast,
  '--w-motion-base': MOTION.base,
  '--w-motion-ease-standard': MOTION['ease-standard'],
  '--w-motion-ease-decel': MOTION['ease-decel'],
  '--w-radius-card': RADIUS,
  '--w-radius-card-clip': CARD_CLIP_RADIUS,
} as CSSProperties

/** 卡片删掉的退场时长：与磁贴入场的 250ms 对齐，读令牌（D10）。 */
const EXIT_MS = Number.parseFloat(MOTION.base)

/** 拖动时卡片跟手，自由宽度不低于这个像素值。 */
const MIN_FREE_WIDTH = 120

/**
 * 上一次读到的快照。切到别的面板再切回看板时，页面会重挂，但卡片先用上一份内容画出来，不必对着
 * 「正在读看板…」等一次往返；随后仍然向宿主取最新的一份。
 */
let cachedSnapshot: BoardSnapshot | null = null

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

/** 看板页要用的宿主上下文。 */
export interface BoardPageProps {
  /** 浏览器半边的根上下文，用来跟随宿主的主题（D10）。 */
  context: unknown
}

/**
 * 中栏的看板页：一张列宽随容器宽度连续变化的卡片栅格（D16）。
 *
 * 列数按这块容器的宽度判定，整页只有一个 ResizeObserver；离开视口的卡片由整页唯一的一个
 * IntersectionObserver 暂停，握手消息由唯一的一个 message 监听器分派（D3）。卡片的位置与尺寸由
 * 用户拖动和缩放，松手时带修订号整体提交给宿主；拖动期间只画本地预览，宿主仍然是唯一权威（D5）。
 */
export function BoardPage({ context }: BoardPageProps): ReactNode {
  const [snapshot, setSnapshot] = useState<BoardSnapshot | null>(cachedSnapshot)
  const [failure, setFailure] = useState<string | null>(null)
  const [metrics, setMetrics] = useState<GridMetrics | null>(null)
  const [theme, setTheme] = useState<ShellTheme>(resolveTheme)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [draft, setDraft] = useState<Record<string, CardLayout> | null>(null)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  /** 正在退场的卡片：请求与快照之间留出动画时间。 */
  const [exiting, setExiting] = useState<ReadonlySet<string>>(() => new Set())
  /** 刷新一次就让每张卡换一个 key：卡片文档重新挂载，组件里的本地画面也跟着重来。 */
  const [refreshGeneration, setRefreshGeneration] = useState(0)
  const flowRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const draftRef = useRef<Record<string, CardLayout> | null>(null)
  const busyRef = useRef(false)
  /** 快照请求的序号：先发出、后返回的那一份不能盖掉更新的那一份。 */
  const fetchIdRef = useRef(0)
  const exitingRef = useRef(new Set<string>())
  /** 退场期间收到的卡片增删通知：等最后一张退完再重取。 */
  const queuedRefetchRef = useRef(false)
  const cardControls = useRef(new Map<string, { pause: () => void, resume: () => void }>())
  const frames = useMemo(() => createFrameHost(), [])

  const controls = useMemo<CardControls>(() => ({
    register(id, handlers) {
      cardControls.current.set(id, handlers)
      return () => { cardControls.current.delete(id) }
    },
  }), [])

  /** 重取一次快照：只有卡片增删与组件库变化才走到这里（D18）。 */
  const refetch = useCallback(() => {
    const id = fetchIdRef.current + 1
    fetchIdRef.current = id
    fetchSnapshot().then((next) => {
      if (id !== fetchIdRef.current) return
      cachedSnapshot = next
      setSnapshot(next)
      setFailure(null)
    }, (error: Error) => {
      if (id === fetchIdRef.current) setFailure(error.message)
    })
  }, [])

  /** 一张卡退场结束：收起退场标记；退场期间攒下的增删通知这时才去重取（D18）。 */
  const finishExit = useCallback((id: string): void => {
    exitingRef.current.delete(id)
    setExiting(new Set(exitingRef.current))
    if (exitingRef.current.size === 0 && queuedRefetchRef.current) {
      queuedRefetchRef.current = false
      refetch()
    }
  }, [refetch])

  const onEvent = useCallback((frame: BoardEventFrame) => {
    if (needsSnapshot(frame)) {
      // 退场动画还在放：等最后一张退完再重取，别让广播把卡片提前抽走。
      if (exitingRef.current.size > 0) {
        queuedRefetchRef.current = true
        return
      }
      refetch()
      return
    }
    // 状态与数据就地合并：番茄钟每秒写一次状态，重取整份快照会把开着的每个页面都放大一遍（D18）。
    setSnapshot((previous) => {
      if (previous === null) return previous
      const next = mergeEvent(previous, frame)
      cachedSnapshot = next
      return next
    })
  }, [refetch])

  // 组件交出来的界面状态直接写给宿主；宿主是唯一权威，存下之后它自己会把改动推给所有在线页面（D5）。
  const onState = useCallback((id: string, patch: unknown) => {
    saveInstanceState(id, patch).catch((error: Error) => {
      console.error(`widget-board: ${t('saveFailed')}（${id}）：${error.message}`)
    })
  }, [])

  /** 加一张固定的翻面组（D19）：两张卡的落点相同，之后整组一起拖动。 */
  const addGroupCard = useCallback((layout?: CardLayout): Promise<boolean> => {
    if (busyRef.current) return Promise.resolve(false)
    busyRef.current = true
    setBusy(true)
    return addGroup(layout).then((next) => {
      fetchIdRef.current += 1
      cachedSnapshot = next
      setSnapshot(next)
      setFailure(null)
      setLibraryOpen(false)
      return true
    }, (error: Error) => {
      setFailure(error.message)
      return false
    }).finally(() => {
      busyRef.current = false
      setBusy(false)
    })
  }, [])

  const onAdd = useCallback((id: string) => {
    if (id === FLIP_GROUP_ID) {
      void addGroupCard()
      return
    }
    busyRef.current = true
    setBusy(true)
    addInstance(id).then((next) => {
      fetchIdRef.current += 1
      cachedSnapshot = next
      setSnapshot(next)
      setFailure(null)
      setLibraryOpen(false)
    }, (error: Error) => { setFailure(error.message) })
      .finally(() => {
        busyRef.current = false
        setBusy(false)
      })
  }, [addGroupCard])

  /**
   * 把组件库的一行拖到看板上：按落点算出列与纵向位置，随添加请求一起交给宿主。
   *
   * 落点不在看板内容区（在浮窗、菜单或题头上）时不加卡片，返回 false 让拖放那边收尾。
   *
   * @param widget - 组件的 id。
   * @param clientX - 松手时的屏幕横坐标。
   * @param clientY - 松手时的屏幕纵坐标。
   * @returns 是否加进了看板。
   */
  const onAddAt = useCallback(async (widget: string, clientX: number, clientY: number): Promise<boolean> => {
    const flow = flowRef.current
    if (flow === null || snapshot === null || metrics === null || busyRef.current) return false
    const rect = flow.getBoundingClientRect()
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return false
    const step = metrics.columnWidth + metrics.gap
    const column = clamp(Math.floor((clientX - rect.left) / step), 0, metrics.columns - 1)
    const y = snapCardY((clientY - rect.top) / metrics.rootFontSize)
    if (widget === FLIP_GROUP_ID) return await addGroupCard({ x: column, y, w: 1, h: DEFAULT_HEIGHT_REM })
    busyRef.current = true
    setBusy(true)
    try {
      const next = await addInstance(widget, { x: column, y, w: 1, h: DEFAULT_HEIGHT_REM })
      fetchIdRef.current += 1
      cachedSnapshot = next
      setSnapshot(next)
      setFailure(null)
      setLibraryOpen(false)
      return true
    } catch (error) {
      setFailure((error as Error).message)
      return false
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }, [addGroupCard, metrics, snapshot])

  /** 主动热刷新：宿主重读组件库与运行时，然后让看板上的卡片重新挂载。 */
  const onRefresh = useCallback(() => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    refreshBoard().then((next) => {
      fetchIdRef.current += 1
      cachedSnapshot = next
      setSnapshot(next)
      setFailure(null)
      setLibraryOpen(false)
      setRefreshGeneration((generation) => generation + 1)
    }, (error: Error) => {
      setFailure(error.message)
      refetch()
    }).finally(() => {
      busyRef.current = false
      setBusy(false)
    })
  }, [refetch])

  /** 移除一张卡：先挂上退场标记，等动画与宿主的答复都到了再换快照，卡片不会闪回。 */
  const onRemove = useCallback((id: string) => {
    if (exitingRef.current.has(id)) return
    exitingRef.current.add(id)
    setExiting(new Set(exitingRef.current))
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const started = performance.now()
    removeInstance(id).then((next) => {
      const wait = reduced ? 0 : Math.max(0, EXIT_MS - (performance.now() - started))
      window.setTimeout(() => {
        cachedSnapshot = next
        setSnapshot(next)
        setFailure(null)
        finishExit(id)
      }, wait)
    }, (error: Error) => {
      setFailure(error.message)
      finishExit(id)
    })
  }, [finishExit])

  const onRemoveGroup = useCallback((group: string) => {
    if (exitingRef.current.has(group)) return
    exitingRef.current.add(group)
    setExiting(new Set(exitingRef.current))
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const started = performance.now()
    removeGroup(group).then((next) => {
      const wait = reduced ? 0 : Math.max(0, EXIT_MS - (performance.now() - started))
      window.setTimeout(() => {
        cachedSnapshot = next
        setSnapshot(next)
        setFailure(null)
        finishExit(group)
      }, wait)
    }, (error: Error) => {
      setFailure(error.message)
      finishExit(group)
    })
  }, [finishExit])

  useEffect(() => subscribeLive(onEvent), [onEvent])

  useEffect(() => {
    refetch()
    return () => { fetchIdRef.current += 1 }
  }, [refetch])

  useEffect(() => {
    const dispose = watchTheme(context, setTheme)
    return () => { dispose() }
  }, [context])

  // 主题一变就推给每张已握手的卡片：切浅色深色、换皮肤都不用重新加载（D10）。
  useEffect(() => { frames.broadcast(theme) }, [frames, theme])
  useEffect(() => () => frames.dispose(), [frames])

  useEffect(() => {
    const node = flowRef.current
    if (node === null) return
    const update = (): void => setMetrics(gridMetrics(node.clientWidth, rootFontSize()))
    update()
    const observer = new ResizeObserver(update)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const flow = flowRef.current
    if (flow === null) return
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.instance
        const handlers = id === undefined ? undefined : cardControls.current.get(id)
        if (handlers === undefined) continue
        if (entry.isIntersecting) handlers.resume()
        else handlers.pause()
      }
    }, { threshold: 0 })
    for (const node of flow.querySelectorAll('[data-instance]')) observer.observe(node)
    return () => observer.disconnect()
  }, [metrics, snapshot])

  const cards = useMemo(() => groupCards(snapshot?.board.instances ?? []), [snapshot])
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
    if (snapshot === null || metrics === null || layout === null || dragRef.current !== null || busyRef.current) return
    const tidied = tidyLayout(
      Object.entries(layout.layouts).map(([id, next]) => ({ id, layout: next })),
      metrics,
    )
    busyRef.current = true
    setBusy(true)
    saveBoardLayouts(snapshot.board.layoutRevision, tidied).then((next) => {
      fetchIdRef.current += 1
      cachedSnapshot = next
      setSnapshot(next)
      setFailure(null)
    }, (error: Error) => {
      setFailure(error.message)
      refetch()
    }).finally(() => {
      busyRef.current = false
      setBusy(false)
    })
  }, [layout, metrics, refetch, snapshot])

  const cancelDrag = useCallback(() => {
    // 指针捕获在松手之后还会丢一次；提交还在路上时不能把本地预览一起清掉。
    if (dragRef.current === null) return
    dragRef.current = null
    draftRef.current = null
    setDrag(null)
    setDraft(null)
  }, [])

  const beginDrag = useCallback((event: ReactPointerEvent<HTMLElement>, id: string, kind: DragKind) => {
    if (snapshot === null || metrics === null || dragRef.current !== null || busyRef.current) return
    const dragCards = groupCards(snapshot.board.instances)
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
    const minBox = minBoxOfCard(dragCards[index] as BoardCard, snapshot.widgets)
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
      layoutRevision: snapshot.board.layoutRevision,
      ...(minBox === undefined ? {} : { minBox }),
      moved: false,
    }
    dragRef.current = started
    draftRef.current = resolved.layouts
    setDraft(resolved.layouts)
    setDrag(started)
  }, [snapshot, metrics])

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
    saveBoardLayouts(current.layoutRevision, resolved.layouts).then((next) => {
      busyRef.current = false
      draftRef.current = null
      setDraft(null)
      fetchIdRef.current += 1
      cachedSnapshot = next
      setSnapshot(next)
      setFailure(null)
    }, (error: Error) => {
      // 提交没成：按宿主的当前的一份重画，不把本地预览留在屏幕上（D5）。
      busyRef.current = false
      draftRef.current = null
      setDraft(null)
      console.error(`widget-board: ${t('layoutFailed')}：${error.message}`)
      refetch()
    })
  }, [cancelDrag, metrics, refetch])

  useEffect(() => {
    if (drag === null) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') cancelDrag()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drag, cancelDrag])

  let body: ReactNode = null
  if (failure !== null) body = <div className="dsh-widget-board__notice">{failure}</div>
  else if (snapshot === null) body = <div className="dsh-widget-board__notice">{t('loading')}</div>
  else if (cards.length === 0) body = <div className="dsh-widget-board__notice">{t('empty')}</div>

  // 松手后的落点画成虚影；卡片自己用 free 的像素盒子跟手。
  const ghost = drag === null || layout === null ? undefined : layout.placements.find((placement) => placement.id === drag.id)

  return (
    <>
      <div
        className="dsh-widget-board"
        data-dsh-widget-board-view={WIDGET_BOARD_PANEL_ID}
        data-dsh-widget-board-columns={metrics?.columns ?? 0}
        data-dragging={drag === null ? undefined : 'true'}
        style={SHELL_STYLE}
      >
        {body}
      <div ref={flowRef} className="dsh-widget-board__flow" style={layout === null ? undefined : { height: layout.height }}>
        {ghost === undefined
          ? null
          : (
            <div
              className="dsh-widget-board__ghost"
              data-dsh-widget-board-ghost=""
              style={{ left: ghost.x, top: ghost.y, width: ghost.width, height: ghost.height }}
            />
          )}
        {snapshot === null || layout === null || metrics === null
          ? null
          : cards.map((card, index) => {
              const target = layout.placements[index]
              if (target === undefined) return null
              const cardKey = cardId(card)
              const placement = drag !== null && drag.id === cardKey
                ? { ...target, x: drag.free.x, y: drag.free.y, width: drag.free.width, height: drag.free.height }
                : target
              if (card.kind === 'group') {
                const frontWidget = snapshot.widgets[card.front.widget]
                const backWidget = snapshot.widgets[card.back.widget]
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
              const widget = snapshot.widgets[instance.widget]
              if (widget === undefined) {
                const entry = snapshot.library.find((candidate) => candidate.id === instance.widget)
                return (
                  <div
                    key={instance.id}
                    className="dsh-widget-board__cell dsh-widget-board__cell--missing"
                    data-instance={instance.id}
                    data-unavailable={instance.widget}
                    data-exiting={exiting.has(instance.id) ? 'true' : undefined}
                    style={{ left: target.x, top: target.y, width: target.width, height: target.height, borderRadius: RADIUS }}
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
      </div>
      <BoardDock
        entries={snapshot === null ? [] : [FLIP_GROUP_ENTRY, ...snapshot.library]}
        libraryOpen={libraryOpen}
        busy={busy}
        onOpenLibrary={() => setLibraryOpen(true)}
        onCloseLibrary={() => setLibraryOpen(false)}
        onAdd={onAdd}
        onAddAt={onAddAt}
        onTidy={onTidy}
        onRefresh={onRefresh}
      />
    </>
  )
}
