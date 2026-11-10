/**
 * 一块看板的排列偏好（D33）：形状校验、单元维护与提交写入。
 *
 * 这里只改 `arrangement` 字段，不碰实例的 `layout`；看板格式的读写留在 `state.ts`。
 */
import type { AlignedBox, Arrangement, Board, BoardInstance } from '@dsh-widget-board/contracts'
import { DEFAULT_HEIGHT_REM, MAX_COLUMNS, MAX_HEIGHT_REM, MIN_HEIGHT_REM, snapCardHeight } from '@dsh-widget-board/model'
import { isRecord } from './guards'

/** 排列单元 id 的合法形状：非空字符串。 */
function isUnitId(value: unknown): value is string {
  return typeof value === 'string' && value !== ''
}

/**
 * 一个高度是不是整齐排列接受的档位（D33、D16）：30rem 以内是固定档，超过之后按 2rem 延伸。
 *
 * @param value - 外来值。
 * @returns 可以写进整齐偏好时为真。
 */
function isAlignedHeight(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
    && value >= MIN_HEIGHT_REM && value <= MAX_HEIGHT_REM
    && snapCardHeight(value) === value
}

/** 一份盒子是不是合法的高度档与列数。 */
function isAlignedBox(value: unknown): value is AlignedBox {
  if (!isRecord(value)) return false
  const { w, h } = value
  return Number.isSafeInteger(w) && (w as number) >= 1 && (w as number) <= MAX_COLUMNS && isAlignedHeight(h)
}

/** 把写进来的盒子收进合法列数与高度档；默认盒子可能比整齐档位更自由（D33）。 */
function alignedBoxOf(box: AlignedBox): AlignedBox {
  return {
    w: Math.min(MAX_COLUMNS, Math.max(1, Math.round(box.w))),
    h: snapCardHeight(Number.isFinite(box.h) ? box.h : DEFAULT_HEIGHT_REM),
  }
}

/**
 * 一份排列偏好合不合法：模式认得，整齐模式带一份形状正确的顺序与盒子表（D33）。
 *
 * 顺序里不重复、不留空项，盒子表与顺序的键集合一致，每份盒子是 1—4 列的整数与合法高度档。
 *
 * @param value - 外来值。
 * @returns 可以当 `Arrangement` 用时为真。
 */
export function isArrangement(value: unknown): value is Arrangement {
  if (!isRecord(value)) return false
  if (value.mode !== 'free' && value.mode !== 'aligned') return false
  if (value.mode === 'free' && value.aligned === undefined) return true
  const aligned = value.aligned
  if (!isRecord(aligned)) return false
  const { order, boxes } = aligned
  if (!Array.isArray(order) || !order.every(isUnitId)) return false
  if (new Set(order).size !== order.length) return false
  if (!isRecord(boxes)) return false
  const keys = Object.keys(boxes)
  if (keys.length !== order.length) return false
  for (const id of order) {
    const box = boxes[id]
    if (!isRecord(box)) return false
    const { w, h } = box
    if (!Number.isSafeInteger(w) || (w as number) < 1 || (w as number) > MAX_COLUMNS) return false
    if (!isAlignedHeight(h)) return false
  }
  return true
}

/**
 * 一块看板上的排列单元：普通实例按自己的 id，翻面组按正面那张实例的 id（D33）。
 *
 * @param board - 看板。
 * @returns 排列单元 id，按实例顺序、每组只算一格。
 */
export function arrangementUnitsOf(board: Board): string[] {
  const seen = new Set<string>()
  const units: string[] = []
  for (const instance of board.instances) {
    if (instance.group === undefined) {
      units.push(instance.id)
      continue
    }
    if (seen.has(instance.group.id)) continue
    const groupId = instance.group.id
    seen.add(groupId)
    const front = board.instances.find((candidate) => candidate.group !== undefined && candidate.group.id === groupId && candidate.group.side === 'front')
    units.push((front ?? instance).id)
  }
  return units
}

/**
 * 把一块看板的排列偏好收进当前看板：清掉指向已不存在的单元的悬空引用（D33）。
 *
 * 形状本身不对的那一份不在这里修补——版本 3 的看板读到不合法的排列偏好属于损坏数据，由
 * `readBoard` 报错并保留原文件；这里只处理「形状对、但引用已经过时」的常态。
 *
 * @param board - 读出来的看板。
 * @returns 收好之后的看板，以及有没有改动。
 */
export function withArrangement(board: Board): { board: Board, changed: boolean } {
  const arrangement = board.arrangement
  if (arrangement === undefined) return { board, changed: false }
  const aligned = arrangement.aligned
  if (aligned === undefined) return { board, changed: false }
  const units = arrangementUnitsOf(board)
  const known = new Set(units)
  const byId = new Map(board.instances.map((instance) => [instance.id, instance]))
  const kept: string[] = []
  for (const id of aligned.order) if (known.has(id) && !kept.includes(id)) kept.push(id)
  for (const id of units) if (!kept.includes(id)) kept.push(id)
  let changed = kept.length !== aligned.order.length
  const boxes: Record<string, AlignedBox> = {}
  for (const id of kept) {
    const instance = byId.get(id)
    const box = isAlignedBox(aligned.boxes[id])
      ? aligned.boxes[id]
      : instance === undefined ? { w: 1, h: DEFAULT_HEIGHT_REM } : { w: instance.layout.w, h: snapCardHeight(instance.layout.h) }
    if (boxes[id] === undefined && !isAlignedBox(aligned.boxes[id])) changed = true
    boxes[id] = box
  }
  if (Object.keys(aligned.boxes).length !== kept.length) changed = true
  if (!changed) return { board, changed: false }
  return { board: { ...board, arrangement: { mode: arrangement.mode, aligned: { order: kept, boxes } } }, changed: true }
}

/**
 * 一块看板的排列偏好里接上或去掉一个排列单元（D33）。
 *
 * 加卡片、加组、移除卡片与移除整组都走这一条：整齐模式的顺序与盒子表跟着实例一起变，不留指向
 * 已经不在看板上的单元的悬空引用。自由模式只把卡片留在原坐标上，不动偏好。
 *
 * @param board - 改过实例之后的看板。
 * @param removed - 刚刚离开看板的排列单元 id。
 * @param added - 刚刚加进来的单元：id 与它的初始盒子。
 * @returns 接好顺序与盒子的看板。
 */
export function withArrangementUnits(
  board: Board,
  gone: readonly string[],
  added: readonly { id: string, box: AlignedBox }[],
): Board {
  const arrangement = board.arrangement
  if (arrangement === undefined || (arrangement.mode === 'free' && arrangement.aligned === undefined)) return board
  const aligned = arrangement.aligned ?? { order: [], boxes: {} }
  const dropped = new Set(gone)
  const order: string[] = []
  const boxes: Record<string, AlignedBox> = {}
  for (const id of aligned.order) {
    if (dropped.has(id)) continue
    order.push(id)
    const box = aligned.boxes[id]
    if (box !== undefined) boxes[id] = box
  }
  for (const entry of added) {
    if (dropped.has(entry.id) || order.includes(entry.id)) continue
    order.push(entry.id)
    boxes[entry.id] = alignedBoxOf(entry.box)
  }
  return { ...board, arrangement: { mode: arrangement.mode, aligned: { order, boxes } } }
}

/** 一张卡片离开看板时，它代表的排列单元：普通卡是自己，组卡是整组（取正面那张的 id）。 */
export function arrangementUnitOf(board: Board, instance: BoardInstance): string {
  if (instance.group === undefined) return instance.id
  const front = board.instances.find((candidate) => candidate.group !== undefined && candidate.group.id === instance.group?.id && candidate.group.side === 'front')
  return (front ?? instance).id
}

/**
 * 组的排列单元：加完一组之后接进整齐偏好的那一份（D33）。
 *
 * 组在偏好里占一格，单元 id 是正面实例的 id，盒子取组的落点盒子。真实宿主与演示宿主的加组路由
 * 都走这一条，两边不会算出不同的单元。
 *
 * @param added - 刚加完组的看板。
 * @param groupId - 新组的 id。
 * @returns 要接进偏好的一个排列单元；找不到正面实例时是空表。
 */
export function groupUnitOf(added: Board, groupId: string): { id: string, box: AlignedBox }[] {
  const frontInstance = added.instances.find((instance) => instance.group?.id === groupId && instance.group.side === 'front')
  return frontInstance === undefined ? [] : [{ id: frontInstance.id, box: { w: frontInstance.layout.w, h: frontInstance.layout.h } }]
}

/**
 * 把一次排列偏好的提交写进看板（D33）：模式、整齐顺序与期望宽高一起换。
 *
 * 不合法的提交整体拒绝，不留下半份新偏好。盒子先收进合法列数与高度档。
 *
 * @param board - 当前看板。
 * @param arrangement - 提交来的排列偏好。
 * @returns 换过排列偏好的看板。
 * @throws {Error} 提交的形状不合法，或顺序里出现了看板上没有的单元。
 */
export function withBoardArrangement(board: Board, arrangement: Arrangement): Board {
  if (!isArrangement(arrangement)) throw new Error('排列偏好的形状不合法')
  if (arrangement.mode === 'free') return { ...board, arrangement: { ...board.arrangement, mode: 'free' } }
  const units = new Set(arrangementUnitsOf(board))
  const aligned = arrangement.aligned as NonNullable<Arrangement['aligned']>
  for (const id of aligned.order) {
    if (!units.has(id)) throw new Error(`看板上没有这个排列单元：${id}`)
  }
  if (aligned.order.length !== units.size) throw new Error('排列顺序漏掉了看板上的卡片')
  const boxes: Record<string, AlignedBox> = {}
  for (const id of aligned.order) boxes[id] = aligned.boxes[id] as AlignedBox
  return { ...board, arrangement: { mode: 'aligned', aligned: { order: [...aligned.order], boxes } } }
}
