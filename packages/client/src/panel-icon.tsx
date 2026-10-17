import type { ReactNode } from 'react'

/** 侧栏行图标收到的属性：外壳给边长与选中态。 */
export interface PanelIconProps {
  size: number
  active: boolean
}

/**
 * 侧栏行的图形：四块圆角卡片拼成一块看板。
 *
 * 外壳负责行的盒子、标签、高亮与收起后的图标栏，这里只画图形（D1）。
 */
export function PanelIcon({ size, active }: PanelIconProps): ReactNode {
  return (
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
  )
}
