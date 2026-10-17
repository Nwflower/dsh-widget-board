/**
 * 顶部的看板标签条（D21）：每块看板一个标签，加一个新建入口。
 *
 * 改名、移除与选中之外的设置动作收在设置页，这里只留切换与新建。活动标签下面那枚药丸靠
 * `transform` 与 `width` 的过渡滑过去（D10）；标签条不在组件 iframe 里，令牌的字面值由这里写在
 * 自己的根节点上。减弱动效时只换位置，不做过渡。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { Board } from '@dsh-widget-board/contracts'
import tokens from '@dsh-widget-board/contracts/tokens.json'
import { t } from './copy'

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
  const [pill, setPill] = useState<{ left: number, width: number } | null>(null)

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

  // 选中变了、标签增减了、标题换过宽度了都重新量一次。
  useLayoutEffect(() => { measure() }, [measure, boards])

  useEffect(() => {
    const strip = stripRef.current
    if (strip === null) return
    const observer = new ResizeObserver(() => { measure() })
    observer.observe(strip)
    for (const button of strip.querySelectorAll('[data-dsh-widget-board-tab]')) observer.observe(button)
    return () => observer.disconnect()
  }, [measure, boards])

  return (
    <div
      ref={stripRef}
      className="dsh-widget-board__tabs"
      data-dsh-widget-board-tabs=""
      role="tablist"
      aria-label={t('boardTabs')}
      style={TABS_STYLE}
    >
      {pill === null
        ? null
        : (
          <span
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
