/**
 * 整齐行列（D32）：卡片按保存的顺序逐行铺开，同一排的格子一样高。
 *
 * 这里只有纯计算：给一串按顺序排好的排列单元与它们期望的宽高，算出每张卡片落在哪个像素盒子里。
 * 它不读 DOM，也不碰自由布局存在 `layout` 里的坐标——整齐模式的盒子是每次画的时候现算的，磁盘上
 * 只留顺序与期望宽高。
 *
 * 与自由布局的两处关键区别：纵向位置不用 2rem 吸附（行高由卡片自己的高度档决定），横向不回填前
 * 一排剩下的空位（阅读顺序就是保存顺序）。
 */
import type { CardLayout, WidgetMinBox } from '@dsh-widget-board/contracts'
import type { GridMetrics } from './grid'
import { MAX_COLUMNS, clampCardBox, readOrderOf, snapCardHeight } from './grid'

/** 一个排列单元要摆多大：宽度按列，高度按根字号的倍数（高度档）。 */
export interface AlignedBox {
  w: number
  h: number
}

/** 一个排列单元：普通卡片或一组卡片的 id，加上它想占的盒子。 */
export interface AlignedItem {
  id: string
  box: AlignedBox
}

/** 一个排列单元落在哪里，单位是像素；与自由布局的摆放结果同形。 */
export interface AlignedPlacement {
  id: string
  x: number
  y: number
  width: number
  height: number
  /** 跨了几列；窄屏下会比期望的少。 */
  columns: number
}

/** 一次整齐排布的结果。 */
export interface AlignedLayout {
  placements: AlignedPlacement[]
  /** 内容总高度，单位像素。 */
  height: number
}

/** 一枚格子想要多大：先收进 1—4 列的整数与合法高度档。 */
function wantedBox(box: AlignedBox): AlignedBox {
  const w = Math.min(MAX_COLUMNS, Math.max(1, Math.round(box.w)))
  const h = snapCardHeight(box.h)
  return { w, h }
}

/**
 * 一个格子实际占几列、多高：期望宽度受当前列数限制，同时满足组件最小盒子。
 *
 * 最小盒子比当前列数还宽时按当前列数截断——窄屏装不下就少占几列，不把卡片挤到看板外面。
 *
 * @param box - 期望盒子。
 * @param minBox - 组件声明的最小盒子；省略时只做常规限制。
 * @param columns - 当前列数。
 * @returns 收进当前栅格的列数与高度档。
 */
export function fittedBox(box: AlignedBox, minBox: WidgetMinBox | undefined, columns: number): AlignedBox {
  const usable = Math.min(MAX_COLUMNS, Math.max(1, Math.round(columns)))
  const wanted = wantedBox(box)
  const floor = minBox === undefined
    ? { w: 1, h: wanted.h }
    : clampCardBox({ w: 1, h: wanted.h }, minBox)
  return {
    w: Math.min(usable, Math.max(wanted.w, Math.min(floor.w, usable))),
    h: Math.max(wanted.h, floor.h),
  }
}

/**
 * 按顺序逐行铺开卡片。
 *
 * 规则（B3）：
 * 1. 显示宽度是期望跨列数受当前列数限制之后的值，同时满足当前能满足的最小盒子；
 * 2. 依次装进当前行，剩余空间不足时开下一行，禁止回填更前面的空位；
 * 3. 行高是这一行里所有卡片期望高度与最小高度的最大值，取最高的那个合法档；
 * 4. 同一行的格子 top 与 height 相同；
 * 5. 第一行 top=0，后面每行 top = 上一行 top + 行高 + 间距；
 * 6. 横向位置按列宽与间距算，纵向位置直接用派生值，不经过 2rem 吸附。
 *
 * @param items - 按阅读顺序排好的排列单元。
 * @param metrics - 这一帧的栅格：列数、列宽、间距与根字号。
 * @param minBoxOf - 按排列单元 id 取组件的最小盒子；省略时不执行下限。
 * @returns 每个格子的像素位置、总高度。
 */
export function resolveAlignedLayout(
  items: readonly AlignedItem[],
  metrics: GridMetrics,
  minBoxOf?: (id: string) => WidgetMinBox | undefined,
): AlignedLayout {
  if (items.length === 0) return { placements: [], height: 0 }
  const columns = Math.max(1, Math.min(MAX_COLUMNS, Math.round(metrics.columns)))
  const columnStep = metrics.columnWidth + metrics.gap
  const rows: { boxes: { item: AlignedItem, box: AlignedBox }[], height: number }[] = []
  let row: { item: AlignedItem, box: AlignedBox }[] = []
  let used = 0
  for (const item of items) {
    const box = fittedBox(item.box, minBoxOf?.(item.id), columns)
    if (row.length > 0 && used + box.w > columns) {
      rows.push({ boxes: row, height: rowHeight(row) })
      row = []
      used = 0
    }
    row.push({ item, box })
    used += box.w
  }
  if (row.length > 0) rows.push({ boxes: row, height: rowHeight(row) })

  const placements: AlignedPlacement[] = []
  let top = 0
  for (const entry of rows) {
    let column = 0
    for (const { item, box } of entry.boxes) {
      placements.push({
        id: item.id,
        x: column * columnStep,
        y: top,
        width: box.w * metrics.columnWidth + (box.w - 1) * metrics.gap,
        height: entry.height * metrics.rootFontSize,
        columns: box.w,
      })
      column += box.w
    }
    top += entry.height * metrics.rootFontSize + metrics.gap
  }
  return { placements, height: Math.max(0, top - metrics.gap) }
}

/** 一行的高度：这一行里所有卡片期望高度的最大值。 */
function rowHeight(row: readonly { box: AlignedBox }[]): number {
  return Math.max(...row.map((entry) => entry.box.h))
}

/**
 * 由期望盒子算出卡片在这些列数下的显示宽度。
 *
 * 拖动与缩放要按它换算指针落进了哪一列；与 {@link fittedBox} 用同一条规则，两处不会算出不同的宽度。
 *
 * @param box - 期望盒子。
 * @param minBox - 组件的最小盒子。
 * @param columns - 当前列数。
 * @returns 显示时占几列。
 */
export function displayColumns(box: AlignedBox, minBox: WidgetMinBox | undefined, columns: number): number {
  return fittedBox(box, minBox, columns).w
}

/**
 * 把一份整齐偏好收进当前能显示的范围：顺序去重、盒子收进 1—4 列与合法高度档。
 *
 * 只做形状上的纠正，不增删排列单元——哪些单元该在顺序里由调用方按看板上的卡片决定。
 *
 * @param order - 排列顺序。
 * @param boxes - 每个单元的期望盒子。
 * @returns 收好的一份偏好。
 */
export function normalizeAligned(order: readonly string[], boxes: Readonly<Record<string, AlignedBox>>): { order: string[], boxes: Record<string, AlignedBox> } {
  const kept: string[] = []
  const seen = new Set<string>()
  for (const id of order) {
    if (id === '' || seen.has(id)) continue
    seen.add(id)
    kept.push(id)
  }
  const next: Record<string, AlignedBox> = {}
  for (const id of kept) {
    next[id] = wantedBox(boxes[id] ?? { w: 1, h: 10 })
  }
  return { order: kept, boxes: next }
}

/**
 * 把新卡片接在顺序末尾。
 *
 * @param order - 现有顺序。
 * @param id - 新排列单元的 id。
 * @returns 接上之后的顺序。
 */
export function orderWith(order: readonly string[], id: string): string[] {
  return order.includes(id) ? [...order] : [...order, id]
}

/**
 * 从顺序与盒子表里去掉一批排列单元（移除卡片或整组时用）。
 *
 * @param order - 现有顺序。
 * @param boxes - 现有盒子。
 * @param ids - 要移除的排列单元。
 * @returns 去掉之后的顺序与盒子。
 */
export function withoutItems(
  order: readonly string[],
  boxes: Readonly<Record<string, AlignedBox>>,
  ids: readonly string[],
): { order: string[], boxes: Record<string, AlignedBox> } {
  const dropped = new Set(ids)
  const nextOrder = order.filter((id) => !dropped.has(id))
  const nextBoxes: Record<string, AlignedBox> = {}
  for (const id of nextOrder) nextBoxes[id] = wantedBox(boxes[id] ?? { w: 1, h: 10 })
  return { order: nextOrder, boxes: nextBoxes }
}

/**
 * 按卡片当前的自由位置给出一份整齐顺序：先按 y、再按 x，同一位置按原顺序（B2）。
 *
 * 第一次切到整齐模式时用它，把屏幕上已经排好的样子按阅读顺序留成顺序；之后不再重新生成。
 * 排序规则与自由布局「整理」的是同一条，抽在 `grid` 的 `readOrderOf` 里。
 *
 * @param items - 卡片 id 与它们此刻的自由布局。
 * @returns 顺序。
 */
export function orderFromFree(items: readonly { id: string, layout: CardLayout }[]): string[] {
  return readOrderOf(items.map((item) => ({ id: item.id, layout: item.layout }))).map((item) => item.id)
}

/**
 * 一行里最高的期望高度：缩放把整行抬到同一个高度时用。
 *
 * @param boxes - 这一行里各张卡片的期望盒子。
 * @param minBoxes - 与之一一对应的最小盒子。
 * @returns 行高的合法档。
 */
export function rowHeightFor(boxes: readonly AlignedBox[], minBoxes: readonly (WidgetMinBox | undefined)[]): number {
  let height = 0
  boxes.forEach((box, index) => {
    const minBox = minBoxes[index]
    const wanted = minBox === undefined ? wantedBox(box).h : clampCardBox(wantedBox(box), minBox).h
    height = Math.max(height, wanted)
  })
  return height
}

/** 一个排列单元在派生结果里有位置时把它取出来；找不到是 `undefined`。 */
export function placementOf(placements: readonly AlignedPlacement[], id: string): AlignedPlacement | undefined {
  return placements.find((placement) => placement.id === id)
}
