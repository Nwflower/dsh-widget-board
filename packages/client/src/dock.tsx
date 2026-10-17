import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import type { WidgetLibraryEntry } from '@dsh-widget-board/contracts'
import tokens from '@dsh-widget-board/contracts/tokens.json'
import { isChinese, t } from './copy'
import { LibraryPanel } from './library'

/** 弹层与浮窗读同一份动效令牌；它们不在看板根节点下面，自己带一份。 */
const MOTION = (tokens as { motion: Record<string, string> }).motion
const LAYER_STYLE = {
  '--w-motion-fast': MOTION.fast,
  '--w-motion-base': MOTION.base,
  '--w-motion-ease-standard': MOTION['ease-standard'],
  '--w-motion-ease-pop': MOTION['ease-pop'],
  '--w-motion-goo-open': MOTION['goo-open'],
  '--w-motion-goo-close': MOTION['goo-close'],
  '--w-motion-goo-ease-open': MOTION['goo-ease-open'],
  '--w-motion-goo-ease-close': MOTION['goo-ease-close'],
  '--w-motion-goo-stagger': MOTION['goo-stagger'],
  '--w-motion-goo-icon': MOTION['goo-icon'],
  '--w-motion-goo-icon-close': MOTION['goo-icon-close'],
  '--w-motion-goo-icon-delay': MOTION['goo-icon-delay'],
  '--w-motion-goo-hover': MOTION['goo-hover'],
  '--w-motion-goo-rotate': MOTION['goo-rotate'],
  '--w-motion-goo-rotate-ease': MOTION['goo-rotate-ease'],
  '--w-motion-goo-turn': MOTION['goo-turn'],
  '--w-motion-goo-bounce': MOTION['goo-bounce'],
  '--w-motion-goo-bounce-distance': MOTION['goo-bounce-distance'],
} as CSSProperties

/** 拖放预览的弹簧：不追求物理准确，只要跟手、拖动时有速度感。 */
const SPRING = 0.22
const DAMPING = 0.72
/** 指针移动超过这个距离才算拖动，否则按轻点处理。 */
const DRAG_THRESHOLD = 5

/** 底板菜单要用的东西。 */
export interface BoardDockProps {
  /** 组件库的全部类型。 */
  entries: readonly WidgetLibraryEntry[]
  /** 组件库浮窗是否打开。 */
  libraryOpen: boolean
  /** 正在写宿主：按钮暂时不可按。 */
  busy: boolean
  /** 打开组件库浮窗。 */
  onOpenLibrary: () => void
  /** 关掉组件库浮窗。 */
  onCloseLibrary: () => void
  /** 轻点组件：加在末尾。 */
  onAdd: (id: string) => void
  /** 把组件放到看板的某个屏幕坐标上；不在看板上时返回 false。 */
  onAddAt: (id: string, clientX: number, clientY: number) => Promise<boolean>
  /** 密排全部卡片。 */
  onTidy: () => void
  /** 主动重读组件库与运行时。 */
  onRefresh: () => void
}

/** 一次从组件库开始的拖放。 */
interface AddDrag {
  entry: WidgetLibraryEntry
  pointerId: number
  startX: number
  startY: number
  targetX: number
  targetY: number
  active: boolean
}

/** 加号 / 整理 / 刷新三个图标。尺寸与线宽按参考的 16px 图标。 */
function ActionIcon({ kind }: { kind: 'add' | 'tidy' | 'refresh' }): ReactNode {
  if (kind === 'add') {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="4" />
        <path d="M12 8v8M8 12h8" />
      </svg>
    )
  }
  if (kind === 'tidy') {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="3" width="7" height="7" rx="1.8" />
        <rect x="14" y="3" width="7" height="7" rx="1.8" />
        <rect x="3" y="14" width="7" height="7" rx="1.8" />
        <rect x="14" y="14" width="7" height="7" rx="1.8" />
      </svg>
    )
  }
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 11a8 8 0 1 0-2.3 6.7" />
      <path d="M20 4v7h-7" />
    </svg>
  )
}

/** 菜单的三个动作：位置照参考的扇面，i 决定展开的先后。 */
const GOO_ACTIONS = [
  { kind: 'add' as const, fx: '0px', fy: '-64px', i: 1 },
  { kind: 'tidy' as const, fx: '-54px', fy: '-34px', i: 0 },
  { kind: 'refresh' as const, fx: '54px', fy: '-34px', i: 2 },
]

/**
 * 下方菜单：一个加号化开成扇面的三个动作。
 *
 * 底色、桥接与投影都画在同一张 SVG 的 goo 滤镜里：先用高斯模糊与色阶把四个圆连成一片，
 * 再按参考的三层阴影把合并后的剪影投下来。图标与按钮是压在上面的清晰层，滤镜不碰文字。
 */
function DockMenu({ busy, onAdd, onTidy, onRefresh }: {
  busy: boolean
  onAdd: () => void
  onTidy: () => void
  onRefresh: () => void
}): ReactNode {
  const [open, setOpen] = useState(false)
  const [anticipating, setAnticipating] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const openRef = useRef(false)
  const timer = useRef<number | null>(null)
  openRef.current = open

  const clearTimer = useCallback(() => {
    if (timer.current === null) return
    window.clearTimeout(timer.current)
    timer.current = null
  }, [])

  const close = useCallback(() => {
    if (!openRef.current) return
    setOpen(false)
    setAnticipating(true)
    clearTimer()
    timer.current = window.setTimeout(() => {
      setAnticipating(false)
      timer.current = null
    }, 750)
  }, [clearTimer])

  const toggle = useCallback(() => {
    if (openRef.current) {
      close()
      return
    }
    clearTimer()
    setAnticipating(false)
    setOpen(true)
  }, [clearTimer, close])

  useEffect(() => () => clearTimer(), [clearTimer])

  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) close()
    }
    const key = (event: KeyboardEvent): void => { if (event.key === 'Escape') close() }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', key)
    }
  }, [close, open])

  const runs = {
    add: onAdd,
    tidy: onTidy,
    refresh: onRefresh,
  }

  return (
    <div
      className={`dsh-widget-board__dock${anticipating ? ' is-anticipating' : ''}`}
      ref={rootRef}
      data-open={open ? 'true' : 'false'}
    >
      <svg className="dsh-widget-board__goo-svg" viewBox="0 0 200 140" aria-hidden="true" focusable="false">
        <defs>
          <filter
            id="dsh-widget-board-goo"
            filterUnits="userSpaceOnUse"
            x="-85"
            y="-85"
            width="370"
            height="310"
            colorInterpolationFilters="sRGB"
          >
            <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur" />
            <feColorMatrix
              in="blur"
              type="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7"
              result="goo"
            />
            <feComposite in="SourceGraphic" in2="goo" operator="atop" result="shape" />
            <feColorMatrix
              in="shape"
              type="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 60 -29.5"
              result="ring-solid"
            />
            <feMorphology in="ring-solid" operator="dilate" radius="1" result="ring-a" />
            <feFlood floodColor="#000000" floodOpacity="0.06" result="ring-c" />
            <feComposite in="ring-c" in2="ring-a" operator="in" result="ring" />
            <feGaussianBlur in="shape" stdDeviation="3" result="s2-b" />
            <feOffset in="s2-b" dy="2" result="s2-o" />
            <feFlood floodColor="#000000" floodOpacity="0.05" result="s2-c" />
            <feComposite in="s2-c" in2="s2-o" operator="in" result="s2" />
            <feGaussianBlur in="shape" stdDeviation="21" result="s3-b" />
            <feOffset in="s3-b" dy="4" result="s3-o" />
            <feFlood floodColor="#000000" floodOpacity="0.06" result="s3-c" />
            <feComposite in="s3-c" in2="s3-o" operator="in" result="s3" />
            <feMerge>
              <feMergeNode in="s3" />
              <feMergeNode in="s2" />
              <feMergeNode in="ring" />
              <feMergeNode in="shape" />
            </feMerge>
          </filter>
        </defs>
        <g filter="url(#dsh-widget-board-goo)">
          {GOO_ACTIONS.map((action) => (
            <circle
              key={action.kind}
              className="dsh-widget-board__goo-circle"
              cx="100"
              cy="100"
              r="20"
              style={{ '--fx': action.fx, '--fy': action.fy, '--i': action.i } as CSSProperties}
            />
          ))}
          <circle className="dsh-widget-board__goo-circle dsh-widget-board__goo-circle--trigger" cx="100" cy="100" r="20" />
        </g>
      </svg>
      {GOO_ACTIONS.map((action) => (
        <button
          key={action.kind}
          type="button"
          className="dsh-widget-board__dock-action"
          data-dsh-widget-board-dock-action={action.kind}
          style={{ '--fx': action.fx, '--fy': action.fy, '--i': action.i } as CSSProperties}
          title={t(action.kind)}
          aria-label={t(action.kind)}
          tabIndex={open ? 0 : -1}
          disabled={busy}
          onClick={() => {
            close()
            runs[action.kind]()
          }}
        >
          <ActionIcon kind={action.kind} />
        </button>
      ))}
      <button
        type="button"
        className="dsh-widget-board__dock-trigger"
        data-dsh-widget-board-dock-toggle=""
        aria-label={open ? t('closeMenu') : t('menu')}
        aria-expanded={open}
        title={open ? t('closeMenu') : t('menu')}
        onClick={toggle}
      >
        <span className="dsh-widget-board__dock-trigger-icon" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
            <path d="M10 4V16M4 10H16" />
          </svg>
        </span>
      </button>
    </div>
  )
}

/**
 * 看板下方的浮层：菜单、组件库浮窗与拖放预览。
 *
 * 菜单与浮窗固定在看板内容之上，不参与卡片排版。组件库的一行按下后由这里接收指针移动，预览卡片用
 * 弹簧跟手；松手时把屏幕坐标交给看板，由看板算落点并写宿主（D17、D5）。
 *
 * @param props - 组件库、打开状态与四个动作。
 * @returns 浮层。
 */
export function BoardDock({
  entries,
  libraryOpen,
  busy,
  onOpenLibrary,
  onCloseLibrary,
  onAdd,
  onAddAt,
  onTidy,
  onRefresh,
}: BoardDockProps): ReactNode {
  const dragRef = useRef<AddDrag | null>(null)
  const [session, setSession] = useState<{ entry: WidgetLibraryEntry, pointerId: number } | null>(null)
  const [proxy, setProxy] = useState<WidgetLibraryEntry | null>(null)
  const proxyRef = useRef<HTMLDivElement | null>(null)
  const currentRef = useRef({ x: 0, y: 0 })
  const velocityRef = useRef({ x: 0, y: 0 })
  const libraryRef = useRef<HTMLDivElement | null>(null)
  const dockRef = useRef<HTMLDivElement | null>(null)

  const beginDrag = useCallback((entry: WidgetLibraryEntry, event: ReactPointerEvent<HTMLElement>) => {
    if (busy || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    dragRef.current = {
      entry,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      targetX: event.clientX,
      targetY: event.clientY,
      active: false,
    }
    setSession({ entry, pointerId: event.pointerId })
  }, [busy])

  // 拖放期间铺一层透明的接住层：指针在 iframe、浮窗或菜单上方松开时也仍然回到这里。
  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (drag === null || event.pointerId !== drag.pointerId) return
    drag.targetX = event.clientX
    drag.targetY = event.clientY
    if (!drag.active && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > DRAG_THRESHOLD) {
      drag.active = true
      setProxy(drag.entry)
    }
  }

  const finishDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (drag === null || event.pointerId !== drag.pointerId) return
    dragRef.current = null
    setSession(null)
    setProxy(null)
    if (!drag.active) {
      onAdd(drag.entry.id)
      return
    }
    // 落回浮窗或菜单上不算放进看板；接住层盖住一切，这里按矩形判断。
    const over = (node: Element | null | undefined): boolean => {
      const rect = node?.getBoundingClientRect()
      return rect !== undefined && event.clientX >= rect.left && event.clientX <= rect.right
        && event.clientY >= rect.top && event.clientY <= rect.bottom
    }
    const library = libraryRef.current?.querySelector('[data-dsh-widget-board-library]')
    const dock = dockRef.current?.querySelector('.dsh-widget-board__dock')
    if (over(library) || over(dock)) return
    onAddAt(drag.entry.id, event.clientX, event.clientY).catch((error: Error) => {
      console.error(`widget-board: 拖放没有完成：${error.message}`)
    })
  }

  const cancelDrag = (): void => {
    dragRef.current = null
    setSession(null)
    setProxy(null)
  }

  // 预览卡的弹簧：目标是指针，当前位置与速度留在 ref 里，逐帧写 transform，不触发 React 重绘。
  useEffect(() => {
    if (proxy === null) return
    const drag = dragRef.current
    if (drag === null) return
    currentRef.current = { x: drag.startX, y: drag.startY }
    velocityRef.current = { x: 0, y: 0 }
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let frame = 0
    const tick = (): void => {
      const active = dragRef.current
      if (active === null) return
      if (reduced) {
        currentRef.current = { x: active.targetX, y: active.targetY }
      } else {
        velocityRef.current.x = (velocityRef.current.x + (active.targetX - currentRef.current.x) * SPRING) * DAMPING
        velocityRef.current.y = (velocityRef.current.y + (active.targetY - currentRef.current.y) * SPRING) * DAMPING
        currentRef.current.x += velocityRef.current.x
        currentRef.current.y += velocityRef.current.y
      }
      const rotation = reduced ? 0 : Math.max(-7, Math.min(7, velocityRef.current.x * 0.25))
      if (proxyRef.current !== null) {
        proxyRef.current.style.transform = `translate3d(${currentRef.current.x}px, ${currentRef.current.y}px, 0) translate(-50%, -50%) rotate(${rotation.toFixed(2)}deg)`
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [proxy])

  // 浮窗打开时，点在看板或别处就关掉；正在拖放时不能关。
  useEffect(() => {
    if (!libraryOpen) return
    const outside = (event: PointerEvent): void => {
      if (dragRef.current !== null) return
      const target = event.target as Node
      if (libraryRef.current?.contains(target) === true) return
      if (dockRef.current?.contains(target) === true) return
      onCloseLibrary()
    }
    const key = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && dragRef.current === null) onCloseLibrary()
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', key)
    }
  }, [libraryOpen, onCloseLibrary])

  return (
    <div className="dsh-widget-board__dock-layer" style={LAYER_STYLE}>
      <div ref={dockRef}>
        <DockMenu
          busy={busy}
          onAdd={() => { setProxy(null); onOpenLibrary() }}
          onTidy={onTidy}
          onRefresh={onRefresh}
        />
      </div>
      {libraryOpen
        ? (
          <div ref={libraryRef}>
            <LibraryPanel
              entries={entries}
              busy={busy}
              onAdd={onAdd}
              onBeginDrag={beginDrag}
              onClose={onCloseLibrary}
            />
          </div>
        )
        : null}
      {session === null
        ? null
        : (
          <div
            className="dsh-widget-board__drag-shield"
            data-dsh-widget-board-drag-shield=""
            onPointerMove={moveDrag}
            onPointerUp={finishDrag}
            onPointerCancel={cancelDrag}
          />
        )}
      {proxy === null
        ? null
        : (
          <div className="dsh-widget-board__drag-proxy" ref={proxyRef} data-dsh-widget-board-drag-proxy="">
            <span className="dsh-widget-board__drag-proxy-kicker">{proxy.source === 'builtin' ? t('builtin') : proxy.source === 'user' ? t('user') : t('plugin')}</span>
            <span className="dsh-widget-board__drag-proxy-title">{isChinese() ? proxy.title.zh : proxy.title.en}</span>
            <span className="dsh-widget-board__drag-proxy-hint">
              <span className="dsh-widget-board__dot" aria-hidden="true" />
              {t('dropHint')}
            </span>
          </div>
        )}
    </div>
  )
}
