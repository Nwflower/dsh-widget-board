import { useSyncExternalStore } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import tokens from '@dsh-widget-board/contracts/tokens.json'
import { t } from './copy'
import { notificationStore } from './notifications'

/** 侧栏行图标收到的属性：外壳给边长与选中态。 */
export interface PanelIconProps {
  size: number
  active: boolean
}

/** 徽标的时长、距离、颜色与曲线读同一份令牌；外壳不在这条入口上，自己带一份（D10）。 */
const MOTION = (tokens as { motion: Record<string, string> }).motion
const COLOR = (tokens as { color: Record<string, string> }).color
const BADGE_STYLE = {
  '--w-motion-badge-slide': MOTION['badge-slide'],
  '--w-motion-badge-pop': MOTION['badge-pop'],
  '--w-motion-badge-pop-close': MOTION['badge-pop-close'],
  '--w-motion-badge-fade': MOTION['badge-fade'],
  '--w-motion-badge-fade-close': MOTION['badge-fade-close'],
  '--w-motion-badge-blur': MOTION['badge-blur'],
  '--w-motion-badge-offset-x': MOTION['badge-offset-x'],
  '--w-motion-badge-offset-y': MOTION['badge-offset-y'],
  '--w-motion-ease-smooth': MOTION['ease-smooth'],
  '--w-motion-ease-pop': MOTION['ease-pop'],
  '--w-motion-ease-standard': MOTION['ease-standard'],
  '--w-color-accent': COLOR.accent,
  '--w-color-on-accent': COLOR['on-accent'],
} as CSSProperties

/**
 * 侧栏行的图形：四块圆角卡片拼成一块看板，右上角挂未读通知的条数。
 *
 * 外壳负责行的盒子、标签、高亮与收起后的图标栏，这里只画图形与徽标（D1）。点一下这一行就算看过
 * 通知，未读随之清零；徽标本身不动入口的位置（D7）。
 */
export function PanelIcon({ size, active }: PanelIconProps): ReactNode {
  const unread = useSyncExternalStore(notificationStore.subscribe, notificationStore.unread)
  const open = unread > 0
  const latest = notificationStore.entries()[0]
  const summary = latest === undefined
    ? `${String(unread)} ${t('unread')}`
    : `${String(unread)} ${t('unread')}：${latest.title}${latest.body === undefined ? '' : ` · ${latest.body}`}`
  return (
    <span
      className="dsh-widget-board__panel-icon"
      style={BADGE_STYLE}
      data-dsh-widget-board-panel-icon=""
      title={open ? summary : undefined}
      onClick={() => { notificationStore.markAllRead() }}
    >
      <svg
        className="dsh-widget-board__icon"
        viewBox="0 0 16 16"
        width={size}
        height={size}
        fill="none"
        stroke="currentColor"
        strokeWidth={active ? 1.6 : 1.3}
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="1.8" y="2.2" width="5.7" height="4.5" rx="1.2" />
        <rect x="8.5" y="2.2" width="5.7" height="7.3" rx="1.2" />
        <rect x="1.8" y="8.7" width="5.7" height="5.1" rx="1.2" />
        <rect x="8.5" y="11.5" width="5.7" height="2.3" rx="1.2" />
      </svg>
      <span
        className="dsh-widget-board__badge"
        data-dsh-widget-board-badge=""
        data-open={open ? 'true' : 'false'}
        role="status"
        aria-live="polite"
        aria-label={open ? summary : undefined}
      >
        <span className="dsh-widget-board__badge-dot" aria-hidden="true">{open ? (unread > 99 ? '99+' : String(unread)) : ''}</span>
      </span>
    </span>
  )
}
