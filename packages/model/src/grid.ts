/**
 * 断点、列数与尺寸族（D4）：看板容器的宽度决定断点，断点决定列数，尺寸族按列与行跨出像素盒。
 *
 * 纯逻辑：不碰 DOM，宿主算得出没有浏览器在线时的布局。行高与间距按根字号换算，宿主的字号设置
 * 让整张看板一起缩放。
 */
import type { WidgetFamily } from '@dsh-widget-board/contracts'

/** 一个断点：名字、容器宽度的下界、列数。 */
export interface Breakpoint {
  name: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  min: number
  columns: number
}

/** 断点表：一列大约 100 到 150 像素（D4）。 */
export const BREAKPOINTS: readonly Breakpoint[] = [
  { name: 'xs', min: 0, columns: 2 },
  { name: 'sm', min: 560, columns: 4 },
  { name: 'md', min: 900, columns: 8 },
  { name: 'lg', min: 1280, columns: 12 },
  { name: 'xl', min: 1760, columns: 16 },
]

/** 网格族占的列与行；`hero` 占满整行（D4）。 */
export const FAMILY_SPANS: Readonly<Record<string, { cols: number | 'full', rows: number }>> = {
  s: { cols: 2, rows: 2 },
  m: { cols: 4, rows: 2 },
  l: { cols: 4, rows: 4 },
  wide: { cols: 8, rows: 2 },
  xl: { cols: 8, rows: 4 },
  hero: { cols: 'full', rows: 3 },
}

/** 行高，按根字号的倍数。 */
export const ROW_REM = 6.25

/** 网格间距，按根字号的倍数。 */
export const GAP_REM = 0.75

/** 一套网格量：列数、列宽、间距、行高，都是像素。 */
export interface GridMetrics {
  breakpoint: Breakpoint['name']
  columns: number
  columnWidth: number
  gap: number
  rowHeight: number
}

/** 一个尺寸族在网格上的像素盒。 */
export interface FamilyBox {
  cols: number
  rows: number
  w: number
  h: number
}

/**
 * 容器宽度落在哪个断点。
 *
 * @param width - 看板容器的像素宽度。
 * @returns 断点；宽度为负时按 `xs`。
 */
export function breakpointOf(width: number): Breakpoint {
  let found = BREAKPOINTS[0]
  for (const candidate of BREAKPOINTS) if (width >= candidate.min) found = candidate
  return found
}

/**
 * 由容器宽度与根字号算出这一帧的网格量。
 *
 * @param width - 看板容器的像素宽度。
 * @param rootFontSize - 根字号的像素值，默认 16。
 * @returns 列数、列宽、间距与行高。
 */
export function metricsOf(width: number, rootFontSize = 16): GridMetrics {
  const breakpoint = breakpointOf(width)
  const gap = GAP_REM * rootFontSize
  const columnWidth = (width - gap * (breakpoint.columns - 1)) / breakpoint.columns
  return { breakpoint: breakpoint.name, columns: breakpoint.columns, columnWidth, gap, rowHeight: ROW_REM * rootFontSize }
}

/**
 * 一个网格族在给定的网格量下的像素盒。
 *
 * @param family - 网格族。
 * @param metrics - 这一帧的网格量。
 * @returns 列数、行数与像素宽高。
 */
export function familyBox(family: WidgetFamily, metrics: GridMetrics): FamilyBox {
  const span = FAMILY_SPANS[family]
  if (span === undefined) throw new Error(`model: ${family} 不是网格族（D4）`)
  const cols = span.cols === 'full' ? metrics.columns : span.cols
  const rows = span.rows
  return {
    cols,
    rows,
    w: cols * metrics.columnWidth + (cols - 1) * metrics.gap,
    h: rows * metrics.rowHeight + (rows - 1) * metrics.gap,
  }
}

/** 网格族：能按列与行摆放的那些。 */
const gridFamilies = (families: readonly WidgetFamily[]): WidgetFamily[] => families.filter((family) => FAMILY_SPANS[family] !== undefined)

/**
 * 组件在这一帧该用哪个尺寸族：声明过的网格族里放得下的最大一个；一个都放不下时取最小的那个。
 *
 * 同样的输入总是给出同样的族（D4）。
 *
 * @param declared - manifest 声明的尺寸族（D7）。
 * @param metrics - 这一帧的网格量。
 * @returns 选中的网格族。
 * @throws {Error} 组件一个网格族都没有声明。
 */
export function resolveFamily(declared: readonly WidgetFamily[], metrics: GridMetrics): WidgetFamily {
  const candidates = gridFamilies(declared)
  if (candidates.length === 0) throw new Error('model: 组件没有声明任何网格族，看板放不下它（D4）')
  const area = (family: WidgetFamily): number => {
    const span = FAMILY_SPANS[family]
    return (span.cols === 'full' ? metrics.columns : span.cols) * span.rows
  }
  const fits = candidates.filter((family) => {
    const span = FAMILY_SPANS[family]
    return (span.cols === 'full' ? metrics.columns : span.cols) <= metrics.columns
  })
  const pool = fits.length > 0 ? fits : candidates
  return pool.reduce((best, family) => (area(family) > area(best) ? family : best), pool[0])
}
