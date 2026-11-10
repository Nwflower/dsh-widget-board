/**
 * 顶部的看板标签条（D21、B1）：每块看板一个标签、一个更多按钮，加一个新建入口。
 *
 * 标签文字负责切换；更多按钮与标签右键打开同一个管理菜单，菜单记着目标看板 id，从别的标签打开
 * 也不会顺手切过去。活动标签下面那枚药丸靠 `transform` 与 `width` 的过渡滑过去（D10），首帧直接
 * 落位；结构照 transitions.dev 的 Tabs sliding。菜单按钮与标签是并排的两个焦点控件，标签里不再
 * 套按钮。标签条不在组件 iframe 里，令牌的字面值由这里写在自己的根节点上。Windows 桌面端让出
 * 标题栏时，标签条靠左挂进那一条（titlebar.ts 量位置）。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode } from 'react'
import type { Board } from '@dsh-widget-board/contracts'
import tokens from '@dsh-widget-board/contracts/tokens.json'
import { t } from './copy'
import { titlebarSeat } from './titlebar'
import { BoardMenu } from './board-management/menu'
import type { MenuAnchor } from './board-management/menu'
import { DeleteBoardDialog, RenameBoardDialog } from './board-management/dialogs'

/** 药丸读同一份动效令牌；标签条不在看板根节点下面，自己带一份（D10）。 */
const MOTION = (tokens as { motion: Record<string, string> }).motion
const TABS_STYLE = {
  '--w-motion-fast': MOTION.fast,
  '--w-motion-base': MOTION.base,
  '--w-motion-ease-smooth': MOTION['ease-smooth'],
} as CSSProperties

/** 打开着的那一层：菜单，或它下面的一个弹窗。 */
type Overlay =
  | { kind: 'menu', boardId: string, anchor: MenuAnchor }
  | { kind: 'rename', boardId: string }
  | { kind: 'delete', boardId: string }

/** 标签条要画的东西。 */
export interface BoardTabsProps {
  /** 全部看板，按索引里的次序。 */
  boards: readonly Board[]
  /** 当前选中的看板 id。 */
  active: string
  /** 正在写宿主：新建与两个管理动作暂时不可按。 */
  busy: boolean
  /** 看板页的根节点：弹窗按它的矩形定位，不盖宿主外壳（D1）。 */
  anchor: HTMLElement | null
  /** 选中一块看板。 */
  onSelect: (id: string) => void
  /** 新建一块看板。 */
  onCreate: () => void
  /** 改一块看板的名字；失败时抛出的原因写在弹窗里。 */
  onRename: (id: string, title: string) => Promise<void>
  /** 删除一块看板；失败时抛出的原因写在弹窗里。 */
  onDelete: (id: string) => Promise<void>
}

/**
 * 看板标签条。
 *
 * @param props - 看板、选中、管理动作与页面锚点。
 * @returns 顶部的一条标签。
 */
export function BoardTabs({
  boards,
  active,
  busy,
  anchor,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: BoardTabsProps): ReactNode {
  const stripRef = useRef<HTMLDivElement | null>(null)
  const pillRef = useRef<HTMLSpanElement | null>(null)
  /** 首帧的药丸直接落位，不补间；之后的切换才滑过去。 */
  const firstPill = useRef(true)
  const [pill, setPill] = useState<{ left: number, width: number } | null>(null)
  /** 挂进 Windows 桌面端标题栏时的位置；`null` 时留在页面顶部。 */
  const [seat, setSeat] = useState<{ top: number, left: number } | null>(null)
  const [overlay, setOverlay] = useState<Overlay | null>(null)
  /** 打开管理界面的那枚按钮：关掉之后把焦点还回去。 */
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const focusGenerationRef = useRef(0)
  const [writing, setWriting] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  /** 量一次活动标签：药丸的位置与宽度按它的整组给，更多按钮也在药丸里。 */
  const measure = useCallback(() => {
    const strip = stripRef.current
    const group = strip === null ? null : strip.querySelector<HTMLElement>(`[data-dsh-widget-board-tab-group="${CSS.escape(active)}"]`)
    if (group === null) {
      setPill(null)
      return
    }
    setPill((previous) => previous !== null && previous.left === group.offsetLeft && previous.width === group.offsetWidth
      ? previous
      : { left: group.offsetLeft, width: group.offsetWidth })
  }, [active])

  /**
   * 量一次标题栏：Windows 桌面端让出那一条、并且标签条整个放得下时挂上去，否则留在页面里。
   */
  const fit = useCallback(() => {
    const strip = stripRef.current
    const root = strip === null ? null : strip.parentElement
    if (strip === null || root === null || boards.length === 0) {
      setSeat(null)
      return
    }
    const buttons = strip.querySelectorAll<HTMLElement>('[data-dsh-widget-board-tab-group], [data-dsh-widget-board-tab-new]')
    const last = buttons.item(buttons.length - 1)
    const paddingRight = Number.parseFloat(getComputedStyle(strip).paddingRight) || 0
    const width = last === null ? 0 : last.offsetLeft + last.offsetWidth + paddingRight
    const next = titlebarSeat(root, width)
    if (next === null) {
      setSeat(null)
      return
    }
    const top = next.height / 2
    const left = next.left
    setSeat((previous) => previous !== null && previous.top === top && previous.left === left ? previous : { top, left })
  }, [boards.length])

  // 选中变了、标签增减了、标题换过宽度了都重新量一次。
  useLayoutEffect(() => { measure() }, [measure, boards])

  // 标题栏的位置随窗口、侧栏与标签宽度变化，每一次都重新量。
  useLayoutEffect(() => { fit() }, [fit, boards])

  // transitions.dev 的 Tabs sliding 在首帧不补间：药丸先直接落在活动标签后面。
  useLayoutEffect(() => {
    const node = pillRef.current
    if (node === null || !firstPill.current) return
    firstPill.current = false
    node.style.transition = 'none'
    void node.offsetWidth
    requestAnimationFrame(() => { node.style.transition = '' })
  }, [pill])

  useEffect(() => {
    const strip = stripRef.current
    if (strip === null) return
    const observer = new ResizeObserver(() => { measure() })
    observer.observe(strip)
    for (const group of strip.querySelectorAll('[data-dsh-widget-board-tab-group]')) observer.observe(group)
    return () => observer.disconnect()
  }, [measure, boards])

  useEffect(() => {
    const strip = stripRef.current
    const root = strip === null ? null : strip.parentElement
    if (strip === null || root === null) return
    const observer = new ResizeObserver(() => { fit() })
    observer.observe(strip)
    observer.observe(root)
    for (const group of strip.querySelectorAll('[data-dsh-widget-board-tab-group]')) observer.observe(group)
    window.addEventListener('resize', fit)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', fit)
    }
  }, [fit, boards])

  // 标签条放不下而横向滚动时，把活动标签滚进看得见的那一段；页面滚动不跟着动。
  useEffect(() => {
    const strip = stripRef.current
    const group = strip === null ? null : strip.querySelector<HTMLElement>(`[data-dsh-widget-board-tab-group="${CSS.escape(active)}"]`)
    if (strip === null || group === null || strip.scrollWidth <= strip.clientWidth) return
    // 换算成滚动内容自己的坐标：盒子的位置减去标签条的位置，再加上已经滚过的那一段。
    const stripBox = strip.getBoundingClientRect()
    const groupBox = group.getBoundingClientRect()
    const left = groupBox.left - stripBox.left + strip.scrollLeft
    const right = groupBox.right - stripBox.left + strip.scrollLeft
    const view = strip.clientWidth
    if (left < strip.scrollLeft) strip.scrollLeft = Math.max(0, left - 8)
    else if (right > strip.scrollLeft + view) strip.scrollLeft = right - view + 8
  }, [active, boards])

  /** 关掉菜单或弹窗，把焦点还给打开它的那枚控件。 */
  const close = useCallback((): void => {
    const generation = ++focusGenerationRef.current
    setWriting(false)
    setOverlay(null)
    setFailure(null)
    const target = returnFocusRef.current
    returnFocusRef.current = null
    if (target === null) return
    target.focus()
    // 外部按下时浏览器会在这一下之后自己挪焦点（多半挪到 body）：等这一轮走完再确认一次。
    window.setTimeout(() => {
      if (!target.isConnected || generation !== focusGenerationRef.current) return
      target.focus()
    }, 0)
  }, [])

  /** 打开某块看板的菜单；落点取触发控件的盒子。 */
  const openMenu = useCallback((boardId: string, element: HTMLElement): void => {
    focusGenerationRef.current += 1
    setWriting(false)
    const box = element.getBoundingClientRect()
    returnFocusRef.current = element
    setFailure(null)
    setOverlay({ kind: 'menu', boardId, anchor: { left: box.left, top: box.top, right: box.right, bottom: box.bottom } })
  }, [])

  /** 右键标签与按更多按钮打开同一个菜单：都不切换看板。 */
  const onContextMenu = useCallback((event: ReactMouseEvent<HTMLElement>, boardId: string): void => {
    event.preventDefault()
    const trigger = event.currentTarget.querySelector<HTMLElement>('[data-dsh-widget-board-tab-more]')
    if (trigger !== null) openMenu(boardId, trigger)
  }, [openMenu])

  const menuBoard = overlay !== null && overlay.kind === 'menu' ? boards.find((board) => board.id === overlay.boardId) : undefined
  const target = overlay === null || overlay.kind === 'menu' ? undefined : boards.find((board) => board.id === overlay.boardId)

  /** 保存新名字：成功就关掉并让弹窗把焦点还回去；失败留在弹窗里。 */
  const submitRename = useCallback((id: string, title: string): void => {
    const generation = focusGenerationRef.current
    setWriting(true)
    setFailure(null)
    onRename(id, title).then(() => {
      if (generation !== focusGenerationRef.current) return
      setWriting(false)
      close()
    }, (error: Error) => {
      if (generation !== focusGenerationRef.current) return
      setWriting(false)
      setFailure(error.message)
    })
  }, [close, onRename])

  /** 确认删除：成功后那块看板已经不在了，焦点交给新的活动标签。 */
  const submitDelete = useCallback((id: string): void => {
    const generation = focusGenerationRef.current
    setWriting(true)
    setFailure(null)
    // 成功删除后触发器可能消失；失败时仍保留它供取消弹窗后归还焦点。
    const trigger = returnFocusRef.current
    onDelete(id).then(() => {
      if (generation !== focusGenerationRef.current) return
      returnFocusRef.current = null
      setWriting(false)
      setOverlay(null)
      setFailure(null)
      window.setTimeout(() => {
        if (generation !== focusGenerationRef.current) return
        if (trigger?.isConnected === true) { trigger.focus(); return }
        const strip = stripRef.current
        const selected = strip?.querySelector<HTMLElement>('[data-dsh-widget-board-tab][aria-selected="true"]')
        selected?.focus()
      }, 0)
    }, (error: Error) => {
      if (generation !== focusGenerationRef.current) return
      setWriting(false)
      setFailure(error.message)
    })
  }, [onDelete])

  const style = (seat === null
    ? TABS_STYLE
    : {
        ...TABS_STYLE,
        '--dsh-widget-board-tabs-top': `${String(seat.top)}px`,
        '--dsh-widget-board-tabs-left': `${String(seat.left)}px`,
      }) as CSSProperties

  return (
    <>
      <div
        ref={stripRef}
        className="dsh-widget-board__tabs"
        data-dsh-widget-board-tabs=""
        data-titlebar={seat === null ? undefined : 'true'}
        role="tablist"
        aria-label={t('boardTabs')}
        style={style}
        onScroll={() => { measure() }}
      >
        {pill === null
          ? null
          : (
            <span
              ref={pillRef}
              className="dsh-widget-board__tabs-pill"
              data-dsh-widget-board-tabs-pill=""
              aria-hidden="true"
              style={{ transform: `translateX(${String(pill.left)}px)`, width: `${String(pill.width)}px` }}
            />
          )}
        {boards.map((board) => (
          <div
            key={board.id}
            className="dsh-widget-board__tab-group"
            data-dsh-widget-board-tab-group={board.id}
            data-active={board.id === active ? 'true' : 'false'}
            onContextMenu={(event) => { onContextMenu(event, board.id) }}
          >
            <button
              type="button"
              role="tab"
              className="dsh-widget-board__tab"
              data-dsh-widget-board-tab={board.id}
              aria-selected={board.id === active}
              title={board.title}
              onClick={() => { onSelect(board.id) }}
            >
              {board.title}
            </button>
            <button
              type="button"
              className="dsh-widget-board__tab-more"
              data-dsh-widget-board-tab-more={board.id}
              aria-haspopup="menu"
              aria-expanded={overlay !== null && overlay.kind === 'menu' && overlay.boardId === board.id}
              title={t('boardMenuOpen')}
              aria-label={`${t('boardMenuOpen')}：${board.title}`}
              onClick={(event) => { openMenu(board.id, event.currentTarget) }}
            >
              ⋯
            </button>
          </div>
        ))}
        <button
          type="button"
          className="dsh-widget-board__tab-new"
          data-dsh-widget-board-tab-new=""
          title={t('newBoard')}
          aria-label={t('newBoard')}
          disabled={busy}
          onClick={onCreate}
        >
          +
        </button>
      </div>
      {overlay !== null && overlay.kind === 'menu' && menuBoard !== undefined
        ? (
          <BoardMenu
            board={menuBoard}
            anchor={overlay.anchor}
            trigger={returnFocusRef}
            onRename={() => { setOverlay({ kind: 'rename', boardId: menuBoard.id }) }}
            onDelete={() => { setOverlay({ kind: 'delete', boardId: menuBoard.id }) }}
            onClose={close}
          />
        )
        : null}
      {overlay !== null && overlay.kind === 'rename' && target !== undefined
        ? (
          <RenameBoardDialog
            key={`rename:${target.id}`}
            board={target}
            anchor={anchor}
            busy={writing}
            failure={failure}
            onConfirm={(title) => { submitRename(target.id, title) }}
            onCancel={close}
          />
        )
        : null}
      {overlay !== null && overlay.kind === 'delete' && target !== undefined
        ? (
          <DeleteBoardDialog
            key={`delete:${target.id}`}
            board={target}
            anchor={anchor}
            boardCount={boards.length}
            busy={writing}
            failure={failure}
            onConfirm={() => { submitDelete(target.id) }}
            onCancel={close}
          />
        )
        : null}
    </>
  )
}
