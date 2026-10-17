/**
 * 卡片栅格（D16）：列宽随容器宽度连续变化，卡片的位置与尺寸由用户给出。
 *
 * 卡片用列号与列跨度表达横向位置，用根字号的倍数表达纵向位置与高度。列数变化时横向位置按当前
 * 列数截断，纵向位置保留；重叠的卡片按输入顺序往下推开，被拖动的那一张排在它自己的位置上。
 *
 * 纯逻辑：不碰 DOM，同样的输入总是同样的位置。
 */
import type { CardLayout, WidgetMinBox } from '@dsh-widget-board/contracts'

/** 一列的最小宽度，按根字号的倍数。 */
export const MIN_COLUMN_REM = 18

/** 列之间的间距，按根字号的倍数。 */
export const GAP_REM = 0.75

/** 最多几列。 */
export const MAX_COLUMNS = 4

/** 新卡片的高度，按根字号的倍数。 */
export const DEFAULT_HEIGHT_REM = 22

/** 卡片的高度档位，按根字号的倍数；缩放只在档位之间跳（D16）。 */
export const CARD_HEIGHT_TIERS_REM = [6, 10, 14, 18, 22, 26, 30] as const

/** 卡片的最小高度档位，按根字号的倍数。 */
export const MIN_HEIGHT_REM = CARD_HEIGHT_TIERS_REM[0]

/** 卡片的最大高度档位，按根字号的倍数。 */
export const MAX_HEIGHT_REM = CARD_HEIGHT_TIERS_REM[CARD_HEIGHT_TIERS_REM.length - 1] as number

/** 卡片顶部的纵向档位，按根字号的倍数；拖动、落点与自动堆叠都落在这张网格上（D16）。 */
export const POSITION_STEP_REM = 2

/**
 * 把纵向位置吸到最近的 2rem 档位。
 *
 * @param value - 以根字号为单位的位置。
 * @returns 档位里的位置，最小为 0。
 */
export function snapCardY(value: number): number {
  return Math.max(0, Math.round(value / POSITION_STEP_REM) * POSITION_STEP_REM)
}

/**
 * 把纵向位置向上吸到 2rem 档位，自动堆叠时不会压住上一张卡。
 *
 * @param value - 以根字号为单位的位置。
 * @returns 不小于输入值的档位。
 */
export function ceilCardY(value: number): number {
  return Math.max(0, Math.ceil(value / POSITION_STEP_REM) * POSITION_STEP_REM)
}

/**
 * 取最接近的高度档位；正好落在两档中间时取高的那一档。
 *
 * @param value - 以根字号为单位的高度。
 * @returns 档位里的高度。
 */
export function snapCardHeight(value: number): number {
  let best: number = CARD_HEIGHT_TIERS_REM[0]
  let distance = Math.abs(value - best)
  for (const tier of CARD_HEIGHT_TIERS_REM) {
    const next = Math.abs(value - tier)
    if (next < distance || (next === distance && tier > best)) {
      best = tier
      distance = next
    }
  }
  return best
}

/**
 * 取不小于给定值的最低高度档位；超过最高档时取最高档。
 *
 * @param minimum - 以根字号为单位的最小高度。
 * @returns 档位里的高度。
 */
export function minCardHeight(minimum: number): number {
  if (!Number.isFinite(minimum)) return MIN_HEIGHT_REM
  for (const tier of CARD_HEIGHT_TIERS_REM) {
    if (tier >= minimum) return tier
  }
  return MAX_HEIGHT_REM
}

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
  const y = snapCardY(Number.isFinite(layout.y) ? layout.y : 0)
  const h = snapCardHeight(Number.isFinite(layout.h) ? layout.h : DEFAULT_HEIGHT_REM)
  return { x, y, w, h }
}

/**
 * 把一份布局收进组件的 `minBox`：宽度至少占声明的列数，高度至少到声明的档位。
 *
 * 当前列数少于最小宽度时，宽度按当前列数截断；换到更宽的看板后仍按存下的布局显示。
 *
 * @param layout - 原始布局。
 * @param minBox - 组件声明的最小盒子；省略时只做常规归一化。
 * @param columns - 当前列数，默认最大列数。
 * @returns 可以摆放的布局。
 */
export function clampCardLayout(layout: CardLayout, minBox?: WidgetMinBox, columns = MAX_COLUMNS): CardLayout {
  const normalized = normalizeCardLayout(layout, columns)
  if (minBox === undefined) return normalized
  const usable = clamp(Math.round(columns), 1, MAX_COLUMNS)
  const w = clamp(Math.max(normalized.w, Math.round(minBox.w)), 1, usable)
  return {
    x: clamp(normalized.x, 0, usable - w),
    y: normalized.y,
    w,
    h: Math.max(normalized.h, minCardHeight(minBox.h)),
  }
}

/**
 * 把新卡片的默认盒子收进组件的 `minBox`。
 *
 * @param box - manifest 的 `defaultBox` 或调用方给的落点尺寸。
 * @param minBox - 组件声明的最小盒子。
 * @returns 不小于最小盒子的默认尺寸。
 */
export function clampCardBox(box: { w: number, h: number }, minBox?: WidgetMinBox): { w: number, h: number } {
  const w = clamp(Math.round(box.w), 1, MAX_COLUMNS)
  const h = snapCardHeight(box.h)
  if (minBox === undefined) return { w, h }
  return {
    w: clamp(Math.max(w, Math.round(minBox.w)), 1, MAX_COLUMNS),
    h: Math.max(h, minCardHeight(minBox.h)),
  }
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
      // 推开后的位置也落在 2rem 档位上，卡片顶部与拖动时的虚影一致。
      y = ceilCardY(below / metrics.rootFontSize) * metrics.rootFontSize
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
 * 紧密排布：按当前画面上的阅读顺序，把每张卡片放进连续列里最低的位置。
 *
 * 先按当前的 `y`、再按 `x` 排，顺序与用户看到的从上到下、从左到右一致；跨列卡片占住它覆盖的
 * 每一列。结果只改位置，宽度与高度保持原样。
 *
 * @param items - 卡片与它们当前的布局。
 * @param metrics - 这一帧的栅格。
 * @returns 每张卡片整理后的布局。
 */
export function tidyLayout(items: readonly GridItem[], metrics: GridMetrics): Record<string, CardLayout> {
  const ordered = items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const y = left.item.layout.y - right.item.layout.y
      if (y !== 0) return y
      const x = left.item.layout.x - right.item.layout.x
      return x !== 0 ? x : left.index - right.index
    })
  const levels = Array.from({ length: metrics.columns }, () => 0)
  const layouts: Record<string, CardLayout> = {}
  for (const { item } of ordered) {
    const layout = normalizeCardLayout(item.layout, metrics.columns)
    const height = layout.h * metrics.rootFontSize
    let column = 0
    let top = Number.POSITIVE_INFINITY
    for (let candidate = 0; candidate <= metrics.columns - layout.w; candidate += 1) {
      let y = 0
      for (let index = candidate; index < candidate + layout.w; index += 1) y = Math.max(y, levels[index] as number)
      if (y < top) {
        top = y
        column = candidate
      }
    }
    const y = ceilCardY(top / metrics.rootFontSize) * metrics.rootFontSize
    layouts[item.id] = { x: column, y: y / metrics.rootFontSize, w: layout.w, h: layout.h }
    for (let index = column; index < column + layout.w; index += 1) {
      levels[index] = y + height + metrics.gap
    }
  }
  return layouts
}

/**
 * 新卡片放在最矮的一列底部，与其他卡片隔一个间距。
 *
 * @param instances - 已经摆放好的卡片。
 * @param box - 新卡片的宽高；省略时是一列宽、`DEFAULT_HEIGHT_REM` 高。组件可以在 manifest 里
 * 声明自己的 `defaultBox`，看板按它找最矮的位置。
 * @returns 新卡片的布局。
 */
export function nextCardLayout(
  instances: readonly { layout: CardLayout }[],
  box: { w: number, h: number } = { w: 1, h: DEFAULT_HEIGHT_REM },
): CardLayout {
  const width = Math.max(1, Math.min(MAX_COLUMNS, Math.round(box.w)))
  const height = snapCardHeight(box.h)
  const bottoms = Array.from({ length: MAX_COLUMNS }, () => 0)
  for (const instance of instances) {
    const layout = normalizeCardLayout(instance.layout)
    const bottom = layout.y + layout.h
    for (let column = layout.x; column < layout.x + layout.w; column += 1) {
      bottoms[column] = Math.max(bottoms[column], bottom)
    }
  }
  let column = 0
  let lowest = Number.POSITIVE_INFINITY
  for (let candidate = 0; candidate <= MAX_COLUMNS - width; candidate += 1) {
    let bottom = 0
    for (let index = candidate; index < candidate + width; index += 1) bottom = Math.max(bottom, bottoms[index] as number)
    if (bottom < lowest) {
      lowest = bottom
      column = candidate
    }
  }
  return { x: column, y: lowest === 0 ? 0 : ceilCardY(lowest + GAP_REM), w: width, h: height }
}
