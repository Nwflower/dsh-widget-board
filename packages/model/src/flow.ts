/**
 * 信息流布局（D15）：卡片按列往下排，列的多少跟着看板容器的宽度走，每张卡片的高度由它自己
 * 上报。
 *
 * 纯逻辑：不碰 DOM，同样的输入总是同样的位置。
 */

/** 一列的最小宽度，按根字号的倍数。 */
export const MIN_COLUMN_REM = 18

/** 列之间的间距，按根字号的倍数。 */
export const GAP_REM = 0.75

/** 最多几列。 */
export const MAX_COLUMNS = 4

/** 组件上报高度之前，卡片按列宽的这个比例占位。 */
export const PENDING_RATIO = 0.66

/** 这一帧的信息流网格：列数、列宽与间距，都是像素。 */
export interface FlowMetrics {
  columns: number
  columnWidth: number
  gap: number
}

/** 一张待摆放的卡片：内容已经量出来的高度。 */
export interface FlowItem {
  id: string
  height: number
}

/** 一张卡片落在哪里。 */
export interface FlowPlacement {
  id: string
  x: number
  y: number
  width: number
  height: number
}

/** 一次摆放的结果，以及内容的总高度。 */
export interface FlowLayout {
  placements: FlowPlacement[]
  height: number
}

/**
 * 由容器宽度与根字号算出这一帧的列数与列宽。
 *
 * @param width - 看板容器的像素宽度。
 * @param rootFontSize - 根字号的像素值，默认 16。
 * @returns 列数、列宽与间距。
 */
export function flowMetrics(width: number, rootFontSize = 16): FlowMetrics {
  const gap = GAP_REM * rootFontSize
  const minimum = MIN_COLUMN_REM * rootFontSize
  if (width <= 0) return { columns: 1, columnWidth: 0, gap }
  const fitting = Math.floor((width + gap) / (minimum + gap))
  const columns = Math.min(MAX_COLUMNS, Math.max(1, fitting))
  return { columns, columnWidth: (width - gap * (columns - 1)) / columns, gap }
}

/**
 * 组件上报的高度限制在列宽的 0.5 到 4 倍之间：越界按边界算，一个量错的组件不至于把整列拉塌。
 *
 * @param height - 组件上报的像素高度。
 * @param metrics - 这一帧的网格。
 * @returns 落在区间里的高度。
 */
export function clampCardHeight(height: number, metrics: FlowMetrics): number {
  const minimum = metrics.columnWidth * 0.5
  const maximum = metrics.columnWidth * 4
  if (!Number.isFinite(height) || height <= 0) return Math.round(minimum)
  return Math.round(Math.min(maximum, Math.max(minimum, height)))
}

/**
 * 按阅读顺序把卡片放进当前最矮的一列。
 *
 * 同高时取靠前的那一列，所以结果与输入一一对应，不会因为排序的细节抖动。
 *
 * @param items - 按阅读顺序排好的卡片与它们的高度。
 * @param metrics - 这一帧的网格。
 * @returns 每张卡片的位置，与内容的总高度。
 */
export function flowLayout(items: readonly FlowItem[], metrics: FlowMetrics): FlowLayout {
  const levels = Array.from({ length: metrics.columns }, () => 0)
  const placements: FlowPlacement[] = []
  for (const item of items) {
    let column = 0
    for (let index = 1; index < levels.length; index += 1) {
      if (levels[index] < levels[column]) column = index
    }
    const y = levels[column]
    placements.push({
      id: item.id,
      x: column * (metrics.columnWidth + metrics.gap),
      y,
      width: metrics.columnWidth,
      height: item.height,
    })
    levels[column] = y + item.height + metrics.gap
  }
  const height = placements.length === 0 ? 0 : Math.max(...levels) - metrics.gap
  return { placements, height }
}
