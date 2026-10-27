/**
 * 标签的看板管理菜单（D21、B1）：更多按钮与标签右键打开的是同一个菜单。
 *
 * 菜单记着目标看板 id，不跟着当前选中走：从别的标签打开菜单不会顺手切过去。焦点进来落在第一项，
 * 关闭时由调用方还给触发按钮；Escape 与外部点击都只是关闭，不改动看板。
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode, RefObject } from 'react'
import type { Board } from '@dsh-widget-board/contracts'
import { t } from '../copy'

/** 菜单贴着触发器的那一侧。 */
export interface MenuAnchor {
  /** 视口坐标：按钮的左上角。 */
  left: number
  top: number
  /** 按钮的盒子，菜单据此翻到上方或左侧。 */
  right: number
  bottom: number
}

/** 管理菜单要画的东西。 */
export interface BoardMenuProps {
  /** 菜单对着哪一块看板；改名与删除都只作用于它。 */
  board: Board
  /** 触发按钮或右键落点。 */
  anchor: MenuAnchor
  /** 打开菜单的那枚按钮：菜单量完尺寸之前先把焦点留在这里。 */
  trigger: RefObject<HTMLElement | null>
  /** 选中「改名」。 */
  onRename: () => void
  /** 选中「删除」。 */
  onDelete: () => void
  /** 关闭菜单并把焦点还给触发按钮。 */
  onClose: () => void
}

/** 菜单与按钮之间留的空隙。 */
const GAP = 6

/** 菜单与视口边缘的最小距离。 */
const EDGE = 8

/**
 * 一块看板的管理菜单。
 *
 * @param props - 目标看板、落点与两个动作。
 * @returns 浮在看板页上的一张小菜单。
 */
export function BoardMenu({ board, anchor, trigger, onRename, onDelete, onClose }: BoardMenuProps): ReactNode {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [place, setPlace] = useState<{ left: number, top: number } | null>(null)
  /** 焦点只在菜单第一次放好时抢一次：之后窗口变化重排不再打断用户。 */
  const focused = useRef(false)

  // 先按落点画一次，再按菜单自己的尺寸决定翻到哪边：菜单在窄窗口里不会跑出视口。
  useLayoutEffect(() => {
    const menu = menuRef.current
    if (menu === null) return
    const box = menu.getBoundingClientRect()
    const below = anchor.bottom + GAP
    const above = anchor.top - GAP - box.height
    const top = below + box.height + EDGE <= window.innerHeight ? below : Math.max(EDGE, above)
    const left = Math.max(EDGE, Math.min(anchor.right - box.width, window.innerWidth - EDGE - box.width))
    setPlace({ left: Math.round(left), top: Math.round(top) })
  }, [anchor.bottom, anchor.right, anchor.top])

  // 焦点进第一项。菜单首帧还是隐藏的，放好之后才抢得到焦点，所以这件事跟着 place 走一次。
  useEffect(() => {
    if (place === null || focused.current) return
    focused.current = true
    const first = menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')
    first?.focus()
  }, [place])

  /** 外部点击：按下处不在菜单里也不在触发按钮上就关闭。 */
  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node | null
      const menu = menuRef.current
      if (menu !== null && target !== null && menu.contains(target)) return
      if (trigger.current !== null && target !== null && trigger.current.contains(target)) return
      onClose()
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [onClose, trigger])

  /** 菜单自己的键盘：上下移动、Escape 关闭、Tab 离开。 */
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])]
    const index = items.indexOf(document.activeElement as HTMLElement)
    if (event.key === 'Escape') {
      event.stopPropagation()
      onClose()
      return
    }
    if (event.key === 'Tab') {
      onClose()
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return
    event.preventDefault()
    const next = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? items.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    items[next]?.focus()
  }

  return (
    <div
      ref={menuRef}
      className="dsh-widget-board__board-menu"
      data-dsh-widget-board-board-menu={board.id}
      role="menu"
      aria-label={t('boardMenuTitle')}
      style={place === null ? { visibility: 'hidden' } : { left: `${String(place.left)}px`, top: `${String(place.top)}px` }}
      onKeyDown={onKeyDown}
      onContextMenu={(event) => { event.preventDefault() }}
    >
      <p className="dsh-widget-board__board-menu-title">{board.title}</p>
      <button
        type="button"
        role="menuitem"
        className="dsh-widget-board__board-menu-item"
        data-dsh-widget-board-board-menu-action="rename"
        onClick={onRename}
      >
        {t('rename')}
      </button>
      <button
        type="button"
        role="menuitem"
        className="dsh-widget-board__board-menu-item"
        data-dsh-widget-board-board-menu-action="remove"
        data-danger="true"
        onClick={onDelete}
      >
        {t('removeBoard')}
      </button>
    </div>
  )
}
