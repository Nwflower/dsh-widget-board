/**
 * 顶部的看板标签条（D21）：每块看板一个标签，加一个新建入口。
 *
 * 改名、移除与选中之外的设置动作收在设置页，这里只留切换与新建。活动标签下面那枚药丸靠
 * `transform` 与 `width` 的过渡滑过去（D10），首帧直接落位；结构照 transitions.dev 的 Tabs
 * sliding。标签条不在组件 iframe 里，令牌的字面值由这里写在自己的根节点上。Windows 桌面端让出
 * 标题栏时，标签条靠左挂进那一条（titlebar.ts 量位置）。减弱动效时只换位置，不做过渡。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { Board } from '@dsh-widget-board/contracts'
import tokens from '@dsh-widget-board/contracts/tokens.json'
import { t } from './copy'
import { titlebarSeat } from './titlebar'

/** 药丸读同一份动效令牌；标签条不在看板根节点下面，自己带一份（D10）。 */
const MOTION = (tokens as { motion: Record<string, string> }).motion
const TABS_STYLE = {
  '--w-motion-fast': MOTION.fast,
  '--w-motion-base': MOTION.base,
  '--w-motion-ease-smooth': MOTION['ease-smooth'],
} as CSSProperties

/** 标签条要画的东西。 */
export interface BoardTabsProps {
  /** 全部看板，按索引里的次序。 */
  boards: readonly Board[]
  /** 当前选中的看板 id。 */
  active: string
  /** 正在写宿主：新建暂时不可按。 */
  busy: boolean
  /** 选中一块看板。 */
  onSelect: (id: string) => void
  /** 新建一块看板。 */
  onCreate: () => void
}

/**
 * 看板标签条。
 *
 * @param props - 看板、选中与两个动作。
 * @returns 顶部的一条标签。
 */
export function BoardTabs({ boards, active, busy, onSelect, onCreate }: BoardTabsProps): ReactNode {
  const stripRef = useRef<HTMLDivElement | null>(null)
  const pillRef = useRef<HTMLSpanElement | null>(null)
  /** 首帧的药丸直接落位，不补间；之后的切换才滑过去。 */
  const firstPill = useRef(true)
  const [pill, setPill] = useState<{ left: number, width: number } | null>(null)
  /** 挂进 Windows 桌面端标题栏时的位置；`null` 时留在页面顶部。 */
  const [seat, setSeat] = useState<{ top: number, left: number } | null>(null)

  /** 量一次活动标签：药丸的位置与宽度按它给。 */
  const measure = useCallback(() => {
    const strip = stripRef.current
    const button = strip === null ? null : strip.querySelector<HTMLElement>(`[data-dsh-widget-board-tab="${CSS.escape(active)}"]`)
    if (button === null) {
      setPill(null)
      return
    }
    setPill((previous) => previous !== null && previous.left === button.offsetLeft && previous.width === button.offsetWidth
      ? previous
      : { left: button.offsetLeft, width: button.offsetWidth })
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
    const buttons = strip.querySelectorAll<HTMLElement>('[data-dsh-widget-board-tab], [data-dsh-widget-board-tab-new]')
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
    for (const button of strip.querySelectorAll('[data-dsh-widget-board-tab]')) observer.observe(button)
    return () => observer.disconnect()
  }, [measure, boards])

  useEffect(() => {
    const strip = stripRef.current
    const root = strip === null ? null : strip.parentElement
    if (strip === null || root === null) return
    const observer = new ResizeObserver(() => { fit() })
    observer.observe(strip)
    observer.observe(root)
    for (const button of strip.querySelectorAll('[data-dsh-widget-board-tab]')) observer.observe(button)
    window.addEventListener('resize', fit)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', fit)
    }
  }, [fit, boards])

  const style = (seat === null
    ? TABS_STYLE
    : {
        ...TABS_STYLE,
        '--dsh-widget-board-tabs-top': `${String(seat.top)}px`,
        '--dsh-widget-board-tabs-left': `${String(seat.left)}px`,
      }) as CSSProperties

  return (
    <div
      ref={stripRef}
      className="dsh-widget-board__tabs"
      data-dsh-widget-board-tabs=""
      data-titlebar={seat === null ? undefined : 'true'}
      role="tablist"
      aria-label={t('boardTabs')}
      style={style}
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
        <button
          key={board.id}
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
  )
}
