/**
 * 中栏的看板页：顶部的看板标签条、每块看板的内容区与下方的菜单（D16、D21）。
 *
 * 页面持有整份工作区：选中哪一块、全部看板、组件元信息与组件库。度量（列宽与根字号）、卡片的
 * 暂停登记、退场与通知都在这里统一持有（D16 的整页唯一观察者、D7、D18）；每块看板自己的排布与
 * 拖动草稿在 `board-grid` 里。卡片的位置与尺寸由用户拖动和缩放，松手时带修订号提交给宿主；
 * 拖动期间只画本地预览，宿主仍然是唯一权威（D5）。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type {
  BoardEventFrame,
  BoardInstance,
  CardLayout,
  WidgetNotification,
  WidgetSummary,
  WorkspaceSnapshot,
} from '@dsh-widget-board/contracts'
import { FLIP_GROUP_ID, WIDGET_BOARD_PANEL_ID } from '@dsh-widget-board/contracts'
import tokens from '@dsh-widget-board/contracts/tokens.json'
import type { GridMetrics } from '@dsh-widget-board/model'
import { DEFAULT_HEIGHT_REM, gridMetrics, snapCardY } from '@dsh-widget-board/model'
import { BoardGrid } from './board-grid'
import { deleteBoardById, renameBoardTo } from './board-management/actions'
import type { CardControls } from './card'
import { CARD_CLIP_RADIUS } from './card-shell'
import { isChinese, t } from './copy'
import { CardEditorDialog } from './editor'
import type { EditorTarget } from './editor'
import { BoardDock } from './dock'
import { frameHostOf } from './page-frames'
import { FLIP_GROUP_ENTRY } from './group'
import { subscribeLive } from './live'
import { mergeEvent, mergeLayout, needsSnapshot } from './merge'
import { noticeOf, notificationStore } from './notifications'
import {
  activateBoard,
  addGroup,
  addInstance,
  createBoard,
  fetchWorkspace,
  refreshBoard,
  removeGroup,
  removeInstance,
  saveInstanceState,
} from './snapshot'
import { BoardTabs } from './tabs'
import type { ShellTheme } from './theme'
import { resolveTheme, watchTheme } from './theme'
import { createVisibilityReporting } from './visibility'

/** 根字号的像素值：列宽与卡片高度按它换算（D16）。 */
function rootFontSize(): number {
  return Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
}

/** 卡片移动与设置弹窗读令牌（D10）；外壳没有 `--w-*`，这里把令牌的字面值写在这一页的根上。 */
const MOTION = (tokens as { motion: Record<string, string> }).motion
const TYPE = (tokens as { type: Record<string, string> }).type
const RADIUS = (tokens as { radius: { card: string } }).radius.card
const SHELL_STYLE = {
  '--w-motion-fast': MOTION.fast,
  '--w-motion-base': MOTION.base,
  '--w-motion-ease-standard': MOTION['ease-standard'],
  '--w-motion-ease-decel': MOTION['ease-decel'],
  '--w-type-caption': TYPE.caption,
  '--w-type-body': TYPE.body,
  '--w-type-title': TYPE.title,
  '--w-type-heading': TYPE.heading,
  '--w-radius-card': RADIUS,
  '--w-radius-card-clip': CARD_CLIP_RADIUS,
} as CSSProperties

/** 卡片删掉的退场时长：与磁贴入场的 250ms 对齐，读令牌（D10）。 */
const EXIT_MS = Number.parseFloat(MOTION.base)

/**
 * 上一次读到的工作区。切到别的面板再切回看板时，页面会重挂，但卡片先用上一份内容画出来，不必对着
 * 「正在读看板…」等一次往返；随后仍然向宿主取最新的一份。
 */
let cachedWorkspace: WorkspaceSnapshot | null = null

/** 看板页要用的宿主上下文。 */
export interface BoardPageProps {
  /** 浏览器半边的根上下文，用来跟随宿主的主题（D10）。 */
  context: unknown
}

/**
 * 看板页：标签条、全部看板的内容区与下方菜单。
 *
 * @param props - 宿主上下文。
 * @returns 中栏这一页。
 */
export function BoardPage({ context }: BoardPageProps): ReactNode {
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(cachedWorkspace)
  const [failure, setFailure] = useState<string | null>(null)
  const [metrics, setMetrics] = useState<GridMetrics | null>(null)
  const [theme, setTheme] = useState<ShellTheme>(resolveTheme)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  /** 正在退场的卡片：请求与快照之间留出动画时间。卡片 id 全工作区唯一，一份集合就够。 */
  const [exiting, setExiting] = useState<ReadonlySet<string>>(() => new Set())
  /** 刷新一次就让每张卡换一个 key：卡片文档重新挂载，组件里的本地画面也跟着重来。 */
  const [refreshGeneration, setRefreshGeneration] = useState(0)
  /** 正在编辑的卡片或组；`null` 时弹窗关着（D27）。 */
  const [editor, setEditor] = useState<EditorTarget | null>(null)
  const shellRef = useRef<HTMLDivElement | null>(null)
  const boardsRef = useRef<HTMLDivElement | null>(null)
  /** 打开设置的那枚按钮：关掉弹窗之后把焦点还回去。 */
  const returnFocusRef = useRef<HTMLButtonElement | null>(null)
  const busyRef = useRef(false)
  /** 快照请求的序号：先发出、后返回的那一份不能盖掉更新的那一份。 */
  const fetchIdRef = useRef(0)
  /** 最近合并的事件帧：换上落后的快照之后按修订号把它们重放回去（D18）。 */
  const recentFramesRef = useRef<readonly BoardEventFrame[]>([])
  const exitingRef = useRef(new Set<string>())
  /** 退场期间收到的卡片增删通知：等最后一张退完再重取。 */
  const queuedRefetchRef = useRef(false)
  const cardControls = useRef(new Map<string, { pause: () => void, resume: () => void }>())
  /** 每块看板的内容区：组件库的落点按当前选中的那一块算。 */
  const flowRefs = useRef(new Map<string, HTMLDivElement>())
  /** 当前选中那块看板的「整理」：菜单上的按钮按它走。 */
  const tidyRef = useRef<(() => void) | null>(null)
  const frames = useMemo(() => frameHostOf(), [])
  /** 现在看得见的卡片：观察器每次回调都换成这一份，再交给宿主（D6 的单卡可见性）。 */
  const visibleIdsRef = useRef(new Set<string>())
  const reporting = useMemo(() => createVisibilityReporting(), [])

  const controls = useMemo<CardControls>(() => ({
    register(id, handlers) {
      cardControls.current.set(id, handlers)
      return () => { cardControls.current.delete(id) }
    },
  }), [])

  /**
   * 换上一份宿主刚给的快照，并把快照落后期内已合并的事件重放回去。
   *
   * 事件与快照响应走两条连接，没有先后保证：比快照新的事件先并进了旧快照，直接换上新的会把
   * 它们盖掉，直到下一条事件才回来。事件帧带修订号，比快照新的那几条在换上快照之后重放一遍。
   */
  const adopt = useCallback((next: WorkspaceSnapshot): WorkspaceSnapshot => {
    const missed = recentFramesRef.current.filter((frame) => frame.revision > next.revision)
    recentFramesRef.current = missed
    let merged = next
    for (const frame of missed) merged = mergeEvent(merged, frame)
    return merged
  }, [])

  /** 换上一份宿主刚给的快照：在途的重取作废，失败提示清掉（D5）。 */
  const apply = useCallback((next: WorkspaceSnapshot): void => {
    fetchIdRef.current += 1
    const merged = adopt(next)
    cachedWorkspace = merged
    setSnapshot(merged)
    setFailure(null)
  }, [adopt])

  /** 重取一次工作区：只有卡片与看板增删、组件库变化才走到这里（D18）。 */
  const refetch = useCallback(() => {
    const id = fetchIdRef.current + 1
    fetchIdRef.current = id
    fetchWorkspace().then((next) => {
      if (id !== fetchIdRef.current) return
      const merged = adopt(next)
      cachedWorkspace = merged
      setSnapshot(merged)
      setFailure(null)
    }, (error: Error) => {
      if (id === fetchIdRef.current) setFailure(error.message)
    })
  }, [adopt])

  /** 打开一张卡或一组的设置；记下按钮，关掉弹窗之后把焦点还回去（D27）。 */
  const openEditor = useCallback((kind: 'instance' | 'group', id: string, button: HTMLButtonElement | null): void => {
    returnFocusRef.current = button
    setLibraryOpen(false)
    setEditor({ kind, id })
  }, [])

  /** 关掉设置弹窗并把焦点还给打开它的按钮。 */
  const closeEditor = useCallback((): void => {
    setEditor(null)
    const button = returnFocusRef.current
    returnFocusRef.current = null
    window.setTimeout(() => { button?.focus() }, 0)
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
    // 状态、数据、布局与选中就地合并：番茄钟每秒写一次状态，重取整份快照会把开着的每个页面都放大一遍（D18）。
    recentFramesRef.current = [...recentFramesRef.current.slice(-63), frame]
    setSnapshot((previous) => {
      if (previous === null) return previous
      const next = mergeEvent(previous, frame)
      cachedWorkspace = next
      return next
    })
  }, [refetch])

  // 组件交出来的界面状态直接写给宿主；宿主是唯一权威，存下之后它自己会把改动推给所有在线页面（D5）。
  // 发送的合并与失败提示在每张卡的队列里（D23）。
  const onState = useCallback(async (id: string, patch: unknown) => {
    await saveInstanceState(id, patch)
  }, [])

  /** 布局提交成功：只把这一块看板的盒子并回去，不拿整份快照替换（D16、D18）。 */
  const onLayouts = useCallback((boardId: string, layoutRevision: number, layouts: Record<string, CardLayout>) => {
    setSnapshot((previous) => {
      if (previous === null) return previous
      const next = mergeLayout(previous, boardId, layoutRevision, layouts)
      cachedWorkspace = next
      return next
    })
  }, [])

  /** 组件发来一条通知：记成未读，侧栏入口的徽标读出条数（D7）。 */
  const onNotify = useCallback((instance: BoardInstance, widget: WidgetSummary, notification: WidgetNotification) => {
    const widgetTitle = isChinese() ? widget.title.zh : widget.title.en
    notificationStore.push({
      instanceId: instance.id,
      widgetId: instance.widget,
      widgetTitle,
      ...noticeOf(notification, widgetTitle),
    })
  }, [])

  const activeBoard = snapshot === null
    ? null
    : snapshot.boards.find((board) => board.id === snapshot.active) ?? snapshot.boards[0] ?? null

  /** 换一块看板：先按本地换过去，宿主的答复到了以它为准（D5）。 */
  const onSelectBoard = useCallback((id: string) => {
    if (snapshot === null || id === snapshot.active || busyRef.current) return
    if (editor !== null) closeEditor()
    setSnapshot((previous) => previous === null ? previous : { ...previous, active: id })
    activateBoard(id).then((next) => { apply(next) }, (error: Error) => {
      setFailure(error.message)
      refetch()
    })
  }, [apply, closeEditor, editor, refetch, snapshot])

  /** 新建一块看板：宿主起名字并把它选中（D21）。 */
  const onNewBoard = useCallback(() => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    createBoard().then(({ snapshot: next }) => {
      apply(next)
      setLibraryOpen(false)
    }, (error: Error) => { setFailure(error.message) })
      .finally(() => {
        busyRef.current = false
        setBusy(false)
      })
  }, [apply])

  /**
   * 改一块看板的名字（D21）：标签条那边的弹窗负责收回自己的忙碌与失败，这里只把宿主的答复换进快照。
   *
   * @param id - 看板 id。
   * @param title - 新标题。
   */
  const onRenameBoard = useCallback(async (id: string, title: string): Promise<void> => {
    apply(await renameBoardTo(id, title))
  }, [apply])

  /**
   * 删除一块看板（D21）：删掉的那块已经不在快照里；宿主决定之后哪一块是当前看板。
   *
   * @param id - 看板 id。
   */
  const onDeleteBoard = useCallback(async (id: string): Promise<void> => {
    if (editor !== null && (activeBoard?.id === id)) closeEditor()
    apply(await deleteBoardById(id))
  }, [activeBoard, apply, closeEditor, editor])

  /** 加一张翻面组（D19）：两张卡的落点相同；加完直接打开槽条，让用户挑两面（D27）。 */
  const addGroupCard = useCallback((layout?: CardLayout): Promise<string | null> => {
    if (busyRef.current || activeBoard === null) return Promise.resolve(null)
    busyRef.current = true
    setBusy(true)
    return addGroup(activeBoard.id, layout).then(({ id, snapshot: next }) => {
      apply(next)
      setLibraryOpen(false)
      returnFocusRef.current = null
      setEditor({ kind: 'group', id })
      return id
    }, (error: Error) => {
      setFailure(error.message)
      return null
    }).finally(() => {
      busyRef.current = false
      setBusy(false)
    })
  }, [activeBoard, apply])

  const onAdd = useCallback((id: string) => {
    if (id === FLIP_GROUP_ID) {
      void addGroupCard()
      return
    }
    if (activeBoard === null) return
    busyRef.current = true
    setBusy(true)
    // 先收起组件库，等宿主写完再加卡片：数据源读得慢时，晚收会把用户在这期间重新打开的库关掉。
    setLibraryOpen(false)
    addInstance(activeBoard.id, id).then((next) => {
      apply(next)
    }, (error: Error) => { setFailure(error.message) })
      .finally(() => {
        busyRef.current = false
        setBusy(false)
      })
  }, [activeBoard, addGroupCard, apply])

  /**
   * 把组件库的一格拖到看板上：按落点算出列与纵向位置，随添加请求一起交给宿主。
   *
   * 落点不在当前选中的那块看板的内容区（在面板、菜单或别的看板上）时不加卡片，返回 false 让拖放
   * 那边收尾。
   *
   * @param widget - 组件的 id。
   * @param clientX - 松手时的屏幕横坐标。
   * @param clientY - 松手时的屏幕纵坐标。
   * @returns 是否加进了看板。
   */
  const onAddAt = useCallback(async (widget: string, clientX: number, clientY: number): Promise<boolean> => {
    const board = activeBoard
    const flow = board === null ? undefined : flowRefs.current.get(board.id)
    if (board === null || flow === undefined || metrics === null || busyRef.current) return false
    const rect = flow.getBoundingClientRect()
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return false
    const step = metrics.columnWidth + metrics.gap
    const column = Math.min(metrics.columns - 1, Math.max(0, Math.floor((clientX - rect.left) / step)))
    const y = snapCardY((clientY - rect.top) / metrics.rootFontSize)
    if (widget === FLIP_GROUP_ID) return await addGroupCard({ x: column, y, w: 1, h: DEFAULT_HEIGHT_REM }) !== null
    busyRef.current = true
    setBusy(true)
    // 落点已经确定：先收起组件库，写入与数据读取在后台完成。
    setLibraryOpen(false)
    try {
      const next = await addInstance(board.id, widget, { x: column, y, w: 1, h: DEFAULT_HEIGHT_REM })
      apply(next)
      return true
    } catch (error) {
      setFailure((error as Error).message)
      return false
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }, [activeBoard, addGroupCard, apply, metrics])

  /** 主动热刷新：宿主重读组件库与运行时，然后让看板上的卡片重新挂载。 */
  const onRefresh = useCallback(() => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    refreshBoard().then((next) => {
      apply(next)
      setLibraryOpen(false)
      setRefreshGeneration((generation) => generation + 1)
    }, (error: Error) => {
      setFailure(error.message)
      refetch()
    }).finally(() => {
      busyRef.current = false
      setBusy(false)
    })
  }, [apply, refetch])

  /** 移除一张卡：先挂上退场标记，等动画与宿主的答复都到了再换快照，卡片不会闪回。 */
  const onRemove = useCallback((id: string) => {
    if (exitingRef.current.has(id)) return
    if (editor?.kind === 'instance' && editor.id === id) closeEditor()
    exitingRef.current.add(id)
    setExiting(new Set(exitingRef.current))
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const started = performance.now()
    removeInstance(id).then((next) => {
      const wait = reduced ? 0 : Math.max(0, EXIT_MS - (performance.now() - started))
      window.setTimeout(() => {
        apply(next)
        finishExit(id)
      }, wait)
    }, (error: Error) => {
      setFailure(error.message)
      finishExit(id)
    })
  }, [apply, closeEditor, editor, finishExit])

  const onRemoveGroup = useCallback((group: string) => {
    if (exitingRef.current.has(group)) return
    if (editor?.kind === 'group' && editor.id === group) closeEditor()
    exitingRef.current.add(group)
    setExiting(new Set(exitingRef.current))
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const started = performance.now()
    removeGroup(group).then((next) => {
      const wait = reduced ? 0 : Math.max(0, EXIT_MS - (performance.now() - started))
      window.setTimeout(() => {
        apply(next)
        finishExit(group)
      }, wait)
    }, (error: Error) => {
      setFailure(error.message)
      finishExit(group)
    })
  }, [apply, closeEditor, editor, finishExit])

  /** 菜单上的「整理」交给当前选中的那块看板：它自己拿着画面上那一份排布。 */
  const onTidy = useCallback(() => { tidyRef.current?.() }, [])

  /** 栅格提交布局的忙碌：两道闸门（`busy` 状态与 `busyRef`）一起走，加卡、刷新才看得见它。 */
  const onBusyChange = useCallback((next: boolean): void => {
    busyRef.current = next
    setBusy(next)
  }, [])

  const registerFlow = useCallback((id: string, element: HTMLDivElement | null): void => {
    if (element === null) flowRefs.current.delete(id)
    else flowRefs.current.set(id, element)
  }, [])

  const registerTidy = useCallback((tidy: (() => void) | null): void => {
    tidyRef.current = tidy
  }, [])

  // 重连之后宿主那边这页的可见集合已经清掉了：接上时重报一次，宿主不必把断线当成「还在看」。
  useEffect(() => subscribeLive(onEvent, () => { reporting.resend() }), [onEvent, reporting])

  // 离开看板时这一页再看不见任何卡片（D6）。
  useEffect(() => () => { reporting.dispose() }, [reporting])

  // 打开看板就算看过之前的通知。放在布局效果里：卡片 iframe 的握手要等这次提交之后，组件在
  // init 里发来的通知不会被这一下清掉（D7）。
  useLayoutEffect(() => { notificationStore.markAllRead() }, [])

  useEffect(() => {
    refetch()
    return () => { fetchIdRef.current += 1 }
  }, [refetch])

  useEffect(() => {
    const dispose = watchTheme(context, setTheme)
    return () => { dispose() }
  }, [context])

  // 主题一变就推给每张已握手的卡片：切浅色深色、换皮肤都不用重新加载（D10）。握手中心整页共用，
  // 它比这一页活得久，离开看板时不能摘掉它（D3）。
  useEffect(() => { frames.broadcast(theme) }, [frames, theme])

  // 只挂当前看板：度量按同一块看板的内容区算，切换时新的栅格拿到同一份列宽与根字号。
  useEffect(() => {
    const node = boardsRef.current
    if (node === null) return
    const update = (): void => setMetrics(gridMetrics(node.clientWidth, rootFontSize()))
    update()
    const observer = new ResizeObserver(update)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  // 观察器只随卡片名单重建：状态与布局的通知每秒都在改快照对象，观察器不能跟着每秒拆装一遍
  //（D18 的就地合并、页面级资源唯一拥有者）。同一批回调顺带把可见的卡片 id 报给宿主（D6）。
  const instanceIds = activeBoard === null ? '' : activeBoard.instances.map((instance) => instance.id).join(',')
  useEffect(() => {
    const node = boardsRef.current
    if (node === null) return
    const visible = visibleIdsRef.current
    const cells = [...node.querySelectorAll<HTMLElement>('[data-instance]')]
    // 组卡的两面共用一个盒子，观察节点上只带正面那张的 id（D19）：背面那张与它同进同出。
    const twins = new Map<string, string>()
    const groups = new Map<string, string[]>()
    for (const instance of activeBoard?.instances ?? []) {
      const group = instance.group?.id
      if (group === undefined) continue
      groups.set(group, [...(groups.get(group) ?? []), instance.id])
    }
    for (const members of groups.values()) {
      for (const id of members) {
        for (const other of members) {
          if (other !== id) twins.set(id, other)
        }
      }
    }
    const present = new Set<string>()
    for (const cell of cells) {
      const id = cell.dataset.instance
      if (id === undefined) continue
      present.add(id)
      const twin = twins.get(id)
      if (twin !== undefined) present.add(twin)
    }
    // 换到另一块看板时旧的一批 id 已经不在这块看板上了；观察器的第一次回调会补上新的那一批。
    for (const id of [...visible]) {
      if (!present.has(id)) visible.delete(id)
    }
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.instance
        if (id === undefined) continue
        const twin = twins.get(id)
        if (entry.isIntersecting) {
          visible.add(id)
          if (twin !== undefined) visible.add(twin)
        } else {
          visible.delete(id)
          if (twin !== undefined) visible.delete(twin)
        }
        const handlers = cardControls.current.get(id)
        if (handlers === undefined) continue
        if (entry.isIntersecting) handlers.resume()
        else handlers.pause()
      }
      reporting.report([...visible])
    }, { threshold: 0 })
    for (const cell of cells) observer.observe(cell)
    // 一块没有卡片的看板不会有回调：这一页看得见的是空集合。
    if (cells.length === 0) reporting.report([])
    return () => observer.disconnect()
    // 热刷新让每张卡换一个 key 重挂：节点换了，观察器也要重新登记。
  }, [activeBoard?.id, metrics, instanceIds, refreshGeneration, reporting])

  let body: ReactNode = null
  if (failure !== null) body = <div className="dsh-widget-board__notice">{failure}</div>
  else if (snapshot === null) body = <div className="dsh-widget-board__notice">{t('loading')}</div>

  return (
    <>
      <div
        ref={shellRef}
        className="dsh-widget-board"
        data-dsh-widget-board-view={WIDGET_BOARD_PANEL_ID}
        data-dsh-widget-board-columns={metrics?.columns ?? 0}
        style={SHELL_STYLE}
      >
        <BoardTabs
          boards={snapshot === null ? [] : snapshot.boards}
          active={snapshot?.active ?? ''}
          busy={busy || snapshot === null}
          anchor={shellRef.current}
          onSelect={onSelectBoard}
          onCreate={onNewBoard}
          onRename={onRenameBoard}
          onDelete={onDeleteBoard}
        />
        {body}
        <div ref={boardsRef} className="dsh-widget-board__boards">
          {activeBoard === null
            ? null
            : (
              <BoardGrid
                key={activeBoard.id}
                board={activeBoard}
                active
                metrics={metrics}
                widgets={snapshot === null ? {} : snapshot.widgets}
                library={snapshot === null ? [] : snapshot.library}
                theme={theme}
                frames={frames}
                controls={controls}
                exiting={exiting}
                refreshGeneration={refreshGeneration}
                busy={busy}
                onFlow={registerFlow}
                onTidyReady={registerTidy}
                onSnapshot={apply}
                onLayouts={onLayouts}
                onFailure={setFailure}
                onBusyChange={onBusyChange}
                onSettings={openEditor}
                onState={onState}
                onNotify={onNotify}
                onRemove={onRemove}
                onRemoveGroup={onRemoveGroup}
                onRefetch={refetch}
              />
            )}
        </div>
        {editor === null
          ? null
          : (
            <CardEditorDialog
              key={`${editor.kind}:${editor.id}`}
              target={editor}
              board={activeBoard}
              widgets={snapshot === null ? {} : snapshot.widgets}
              library={snapshot === null ? [] : snapshot.library}
              theme={theme}
              frames={frames}
              anchor={shellRef.current}
              onClose={closeEditor}
              onSnapshot={apply}
            />
          )}
      </div>
      <BoardDock
        anchor={shellRef}
        entries={snapshot === null ? [] : [FLIP_GROUP_ENTRY, ...snapshot.library]}
        widgets={snapshot === null ? {} : snapshot.widgets}
        theme={theme}
        frames={frames}
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
