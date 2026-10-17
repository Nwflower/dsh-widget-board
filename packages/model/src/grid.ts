/**
 * 卡片栅格（D16）：列宽随容器宽度连续变化，卡片的位置与尺寸由用户给出。
 *
 * 卡片用列号与列跨度表达横向位置，用根字号的倍数表达纵向位置与高度。列数变化时横向位置按当前
 * 列数截断，纵向位置保留；重叠的卡片按输入顺序往下推开，被拖动的那一张排在它自己的位置上。
 *
 * 纯逻辑：不碰 DOM，同样的输入总是同样的位置。
 */
import type { CardLayout } from '@dsh-widget-board/contracts'

/** 一列的最小宽度，按根字号的倍数。 */
export const MIN_COLUMN_REM = 18

/** 列之间的间距，按根字号的倍数。 */
export const GAP_REM = 0.75

/** 最多几列。 */
export const MAX_COLUMNS = 4

/** 新卡片的高度，按根字号的倍数。 */
export const DEFAULT_HEIGHT_REM = 22

/** 卡片的最小高度，按根字号的倍数。 */
export const MIN_HEIGHT_REM = 6

/** 卡片的最大高度，按根字号的倍数；比这更高的提交按上限算。 */
export const MAX_HEIGHT_REM = 200

/** 拖动与缩放时高度的吸附步长，按根字号的倍数。 */
export const HEIGHT_STEP_REM = 0.5

/** 这一帧的栅格：列数、列宽、间距与根字号。 */
export interface GridMetrics {
  columns: number
  columnWidth: number
  gap: number
  rootFontSize: number
}

/** 一张待摆放的卡片：它自己的位置与尺寸。 */
export interface GridItem {
  id: string
  layout: CardLayout
}

/** 一张卡片落在哪里，单位是像素。 */
export interface GridPlacement {
  id: string
  x: number
  y: number
  width: number
  height: number
  /** 跨了几列；组件拿到的 `cols` 就是它。 */
  columns: number
}

/** 一次摆放的结果：每张卡片的位置、整理过的布局与内容总高度。 */
export interface GridLayout {
  placements: GridPlacement[]
  /** 按实际落点整理过的布局；拖动松手时提交的是这一份。 */
  layouts: Record<string, CardLayout>
  height: number
}

/** 把一个数限制在区间里。 */
function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

/**
 * 检查一份布局是不是四个有限的数字，并且落在列数与高度的范围内。
 *
 * @param value - 外来值。
 * @returns 可以当 `CardLayout` 用时为真。
 */
export function isCardLayout(value: unknown): value is CardLayout {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const { x, y, w, h } = value as Record<string, unknown>
  return Number.isSafeInteger(x) && Number.isSafeInteger(w)
    && Number.isFinite(y) && Number.isFinite(h)
    && (x as number) >= 0 && (w as number) >= 1
    && (x as number) + (w as number) <= MAX_COLUMNS
    && (y as number) >= 0 && (h as number) >= MIN_HEIGHT_REM && (h as number) <= MAX_HEIGHT_REM
}

/**
 * 把一份布局收进当前可用的列数与高度范围。横向取整，纵向保留拖动时的吸附值。
 *
 * @param layout - 原始布局。
 * @param columns - 当前列数，默认最大列数。
 * @returns 可以摆放的布局。
 */
export function normalizeCardLayout(layout: CardLayout, columns = MAX_COLUMNS): CardLayout {
  const usable = clamp(Math.round(columns), 1, MAX_COLUMNS)
  const w = clamp(Math.round(layout.w), 1, usable)
  const x = clamp(Math.round(layout.x), 0, usable - w)
  const y = Math.max(0, Number.isFinite(layout.y) ? layout.y : 0)
  const h = clamp(Number.isFinite(layout.h) ? layout.h : DEFAULT_HEIGHT_REM, MIN_HEIGHT_REM, MAX_HEIGHT_REM)
  return { x, y, w, h }
}

/**
 * 由容器宽度与根字号算出这一帧的列数与列宽。
 *
 * @param width - 看板容器的像素宽度。
 * @param rootFontSize - 根字号的像素值，默认 16。
 * @returns 列数、列宽、间距与根字号。
 */
export function gridMetrics(width: number, rootFontSize = 16): GridMetrics {
  const gap = GAP_REM * rootFontSize
  const minimum = MIN_COLUMN_REM * rootFontSize
  if (width <= 0) return { columns: 1, columnWidth: 0, gap, rootFontSize }
  const fitting = Math.floor((width + gap) / (minimum + gap))
  const columns = Math.min(MAX_COLUMNS, Math.max(1, fitting))
  return { columns, columnWidth: (width - gap * (columns - 1)) / columns, gap, rootFontSize }
}

/** 两张卡片的横向区间是否相交。 */
function overlapsX(left: number, width: number, other: GridPlacement): boolean {
  return left < other.x + other.width && other.x < left + width
}

/**
 * 按给定的布局摆放卡片：被拖动的一张先占住目标位置，其余重叠的卡片依次往下推开。
 *
 * @param items - 按阅读顺序排好的卡片与它们的布局。
 * @param metrics - 这一帧的栅格。
 * @param priority - 正在拖动或缩放的卡片；它先于其他卡片占据目标位置。
 * @returns 每张卡片的像素位置、整理过的布局与内容总高度。
 */
export function resolveLayout(items: readonly GridItem[], metrics: GridMetrics, priority?: string): GridLayout {
  if (items.length === 0) return { placements: [], layouts: {}, height: 0 }
  const ordered = [...items]
  if (priority !== undefined) {
    const index = ordered.findIndex((item) => item.id === priority)
    if (index > 0) ordered.unshift(ordered.splice(index, 1)[0] as GridItem)
  }
  const placed: GridPlacement[] = []
  const byId = new Map<string, GridPlacement>()
  for (const item of ordered) {
    const layout = normalizeCardLayout(item.layout, metrics.columns)
    const width = layout.w * metrics.columnWidth + (layout.w - 1) * metrics.gap
    const height = layout.h * metrics.rootFontSize
    const x = layout.x * (metrics.columnWidth + metrics.gap)
    let y = layout.y * metrics.rootFontSize
    // 与已放好的卡片重叠时移到它下面，再检查一次新位置；每推一次都往下走，循环必然结束。
    for (;;) {
      let below = -1
      for (const other of placed) {
        if (!overlapsX(x, width, other)) continue
        if (y < other.y + other.height + metrics.gap && other.y < y + height + metrics.gap) {
          below = Math.max(below, other.y + other.height + metrics.gap)
        }
      }
      if (below < 0) break
      y = below
    }
    const placement: GridPlacement = { id: item.id, x, y, width, height, columns: layout.w }
    placed.push(placement)
    byId.set(item.id, placement)
  }
  const placements = items.map((item) => byId.get(item.id) as GridPlacement)
  const layouts: Record<string, CardLayout> = {}
  for (const placement of placements) {
    layouts[placement.id] = {
      x: Math.round(placement.x / (metrics.columnWidth + metrics.gap)),
      y: placement.y / metrics.rootFontSize,
      w: placement.columns,
      h: placement.height / metrics.rootFontSize,
    }
  }
  const height = Math.max(...placements.map((placement) => placement.y + placement.height))
  return { placements, layouts, height }
}

/**
 * 新卡片放在最矮的一列底部，与其他卡片隔一个间距。
 *
 * @param instances - 已经摆放好的卡片。
 * @returns 一张一列宽的新卡片的布局。
 */
export function nextCardLayout(instances: readonly { layout: CardLayout }[]): CardLayout {
  const bottoms = Array.from({ length: MAX_COLUMNS }, () => 0)
  for (const instance of instances) {
    const layout = normalizeCardLayout(instance.layout)
    const bottom = layout.y + layout.h
    for (let column = layout.x; column < layout.x + layout.w; column += 1) {
      bottoms[column] = Math.max(bottoms[column], bottom)
    }
  }
  let column = 0
  for (let index = 1; index < bottoms.length; index += 1) {
    if (bottoms[index] < bottoms[column]) column = index
  }
  const bottom = bottoms[column]
  return { x: column, y: bottom === 0 ? 0 : bottom + GAP_REM, w: 1, h: DEFAULT_HEIGHT_REM }
}
