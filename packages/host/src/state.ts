/**
 * 一块看板的内容与形状（D5、D21）：卡片、它们的盒子与修订号。
 *
 * 文件放在哪里、有几块看板由 `workspace.ts` 决定，这里只管一块看板的读写与纯函数式的改动。第一次
 * 启动的两块看板由 `default-boards.ts` 铺；此后的组件增删都来自添加面板与工具，不再自动补卡。
 * 每张卡片带着自己的盒子（D16）。旧看板没有盒子时按最矮的一列补上默认位置；版本 1 的看板升级时把原来的
 * 固定题头补成一张 `board-hero` 卡。格式版本对不上时启动直接报错并保留原文件（D11）。卡片引用的
 * 组件不在组件库里不算错误：卡片保留，界面把它画成不可用的占位（D17）。
 */
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Arrangement, AlignedBox, Board, BoardInstance, CardLayout, GroupSide, InstanceGroup, WidgetMinBox } from '@dsh-widget-board/contracts'
import { BOARD_HERO_ID, defaultArrangement } from '@dsh-widget-board/contracts'
import { CARD_HEIGHT_TIERS_REM, DEFAULT_HEIGHT_REM, MAX_COLUMNS, clampCardBox, clampCardLayout, isCardLayout, nextCardLayout, snapCardHeight } from '@dsh-widget-board/model'
import { BOARD_STATE_BYTES_LIMIT, STATE_BYTES_LIMIT } from './limits'
import { Refusal } from './refusal'
import { isRecord } from './guards'
import type { WidgetRecord } from './library'

/**
 * 存储格式的版本：2 把固定的题头换成了 `board-hero` 卡片；3 增加排列偏好与整齐顺序（D30）。
 */
export const BOARD_FORMAT = 3

/** 看板修订号从几开始。 */
export const INITIAL_REVISION = 0

/** 布局修订号从几开始。 */
export const INITIAL_LAYOUT_REVISION = 0

/**
 * 一次布局提交碰到的修订号已经过期。
 *
 * 宿主是唯一写入者；页面带着读到的修订号提交，轮到这次写入时修订号已经变了，就拒绝这次提交，
 * 让页面按宿主上的当前快照重画（D5、D16）。
 */
export class StaleRevisionError extends Error {
  constructor(expected: number, actual: number) {
    super(`看板的布局修订号已经变了：提交的是 ${expected}，现在是 ${actual}`)
    this.name = 'StaleRevisionError'
  }
}

/**
 * 一个组件的新卡片默认盒子：manifest 的 `defaultBox` 抬到 `minBox` 之上。
 *
 * @param record - 组件记录。
 * @returns 可以交给 `nextCardLayout` 的宽高。
 */
export function defaultBoxOf(record: WidgetRecord): { w: number, h: number } {
  return clampCardBox(record.manifest.defaultBox ?? { w: 1, h: DEFAULT_HEIGHT_REM }, record.manifest.minBox)
}

/**
 * 两组最小盒子取并集：组卡正反两面共用一个盒子，两边的最小值都要满足。
 *
 * @param left - 一侧的最小盒子。
 * @param right - 另一侧的最小盒子。
 * @returns 合并后的最小盒子；两边都没有时是 `undefined`。
 */
function mergeMinBox(left: WidgetMinBox | undefined, right: WidgetMinBox | undefined): WidgetMinBox | undefined {
  if (left === undefined) return right
  if (right === undefined) return left
  return { w: Math.max(left.w, right.w), h: Math.max(left.h, right.h) }
}

/**
 * 一个组件的一张新卡。
 *
 * 没有点名数据源时接上组件声明的默认源（D17），新加的卡片第一次画出来就有数据。
 *
 * @param record - 组件记录。
 * @param existing - 已经摆放好的卡片，用来找最矮的一列。
 * @param options - 数据源、props 与拖放落点。
 * @returns 卡片。
 */
export function instanceOf(
  record: WidgetRecord,
  existing: readonly BoardInstance[],
  options: { source?: string, props?: Record<string, unknown>, layout?: CardLayout } = {},
): BoardInstance {
  const source = options.source ?? record.manifest.source
  return {
    id: randomUUID(),
    widget: record.manifest.id,
    hash: record.hash,
    ...(source === undefined ? {} : { source }),
    props: options.props ?? {},
    data: null,
    state: null,
    layout: options.layout === undefined
      ? nextCardLayout(existing, defaultBoxOf(record))
      : clampCardLayout(options.layout, record.manifest.minBox),
  }
}

/**
 * 一块空看板。
 *
 * @param title - 标题。
 * @returns 没有卡片、用整齐行列排法的新看板（D30）。
 */
export function emptyBoard(title: string): Board {
  return {
    version: BOARD_FORMAT,
    id: randomUUID(),
    title,
    revision: INITIAL_REVISION,
    layoutRevision: INITIAL_LAYOUT_REVISION,
    arrangement: defaultArrangement(),
    instances: [],
  }
}

/**
 * 给没有绑数据源的卡片补上组件声明的默认数据源（D17）。
 *
 * 卡片可以显式绑一个别的源，也可以显式解绑——后一种在当前的写入面上表达不出来，所以没有源的卡片
 * 一律按「还没绑过」算。组件的新版本声明了默认源之后，旧卡片在这一次读盘时接上它。
 *
 * @param board - 从磁盘读出来的看板。
 * @param records - 已校验的组件。
 * @returns 补齐后的看板，以及有没有改动。
 */
export function withDefaultSources(board: Board, records: Map<string, WidgetRecord>): { board: Board, changed: boolean } {
  let changed = false
  const instances = board.instances.map((instance) => {
    if (instance.source !== undefined) return instance
    const source = records.get(instance.widget)?.manifest.source
    if (source === undefined) return instance
    changed = true
    return { ...instance, source }
  })
  return { board: changed ? { ...board, instances } : board, changed }
}

/**
 * 旧看板补上修订号与卡片盒子，并把盒子抬到组件的最小盒子。
 *
 * 盒子缺失或形状不对时按最矮的一列放一张默认大小的卡。
 *
 * @param board - 从磁盘读出来的看板。
 * @param minBoxOf - 按组件 id 取最小盒子；省略时不执行下限。
 * @returns 补齐后的看板，以及有没有改动。
 */
export function withLayouts(
  board: Board,
  minBoxOf?: (widget: string) => WidgetMinBox | undefined,
): { board: Board, changed: boolean } {
  let changed = false
  const instances: BoardInstance[] = []
  for (const instance of board.instances) {
    const minBox = minBoxOf?.(instance.widget)
    if (isCardLayout(instance.layout)) {
      const layout = minBoxOf === undefined ? instance.layout : clampCardLayout(instance.layout, minBox)
      if (layout.x !== instance.layout.x || layout.y !== instance.layout.y || layout.w !== instance.layout.w || layout.h !== instance.layout.h) {
        changed = true
        instances.push({ ...instance, layout })
      } else {
        instances.push(instance)
      }
      continue
    }
    changed = true
    instances.push({ ...instance, layout: nextCardLayout(instances, minBox === undefined ? undefined : clampCardBox({ w: 1, h: DEFAULT_HEIGHT_REM }, minBox)) })
  }
  const revision = Number.isSafeInteger(board.revision) ? board.revision : INITIAL_REVISION
  const layoutRevision = Number.isSafeInteger(board.layoutRevision) ? board.layoutRevision : INITIAL_LAYOUT_REVISION
  if (revision !== board.revision || layoutRevision !== board.layoutRevision) changed = true
  return { board: { ...board, revision, layoutRevision, instances }, changed }
}

/**
 * 版本 1 的看板升级：把原来固定在外壳里的题头补成一张 `board-hero` 卡，插到最前面。
 *
 * 这一张卡只补一次：看板版本随之变成 2，用户之后把题头卡移除也不会再次补回来。
 *
 * @param board - 版本 1 的看板。
 * @param records - 已校验的组件。
 * @returns 升级后的看板。
 */
function upgradeV1(board: Board, records: Map<string, WidgetRecord>): Board {
  const hero = records.get(BOARD_HERO_ID)
  if (hero === undefined || board.instances.some((instance) => instance.widget === BOARD_HERO_ID)) {
    return { ...board, version: BOARD_FORMAT }
  }
  const box = hero.manifest.defaultBox ?? { w: 2, h: 14 }
  const instance = instanceOf(hero, [], { layout: { x: 0, y: 0, w: box.w, h: box.h } })
  return {
    ...board,
    version: BOARD_FORMAT,
    revision: board.revision + 1,
    layoutRevision: board.layoutRevision + 1,
    instances: [instance, ...board.instances],
  }
}

/** 排列单元 id 的合法形状：非空字符串。 */
function isUnitId(value: unknown): value is string {
  return typeof value === 'string' && value !== ''
}

/**
 * 一份排列偏好合不合法：模式认得，整齐模式带一份形状正确的顺序与盒子表（D30）。
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
    if (typeof h !== 'number' || CARD_HEIGHT_TIERS_REM.includes(h as never) === false) return false
  }
  return true
}

/**
 * 一块看板上的排列单元：普通实例按自己的 id，翻面组按正面那张实例的 id（D30）。
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
 * 把一块看板的排列偏好收进当前看板：清掉指向已不存在的单元的悬空引用（D30）。
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

/** 一份盒子是不是合法的高度档与列数。 */
function isAlignedBox(value: unknown): value is AlignedBox {
  if (!isRecord(value)) return false
  const { w, h } = value
  return Number.isSafeInteger(w) && (w as number) >= 1 && (w as number) <= MAX_COLUMNS
    && typeof h === 'number' && CARD_HEIGHT_TIERS_REM.includes(h as never)
}

/**
 * 读一块看板；旧格式在这一步补齐。
 *
 * 版本 1 的看板升级时把原来的固定题头补成一张 `board-hero` 卡；版本 2 的看板补一份 `free` 排列
 * 偏好，原实例 `layout` 不动（D30）；盒子缺失或形状不对的卡片按最矮的一列补上默认位置，并把盒子
 * 抬到组件的最小盒子。补过的那一份写回磁盘。
 *
 * @param file - 这一块看板的文件。
 * @param records - 已校验的组件。
 * @returns 看板。
 * @throws {Error} 文件不存在，或格式版本不认识。
 */
export async function readBoard(file: string, records: Map<string, WidgetRecord>): Promise<Board> {
  const parsed = JSON.parse(await readFile(file, 'utf8')) as Board
  if (parsed.version !== 1 && parsed.version !== 2 && parsed.version !== BOARD_FORMAT) {
    throw new Error(`${file} 的格式版本是 ${String(parsed.version)}，这个宿主只认 1、2 或 ${BOARD_FORMAT}；原文件保留`)
  }
  const upgraded = parsed.version === 1 ? upgradeV1(parsed, records) : { ...parsed, version: BOARD_FORMAT }
  // 版本 3 才自带排列偏好：更早的看板读成 free，原实例 layout 不动（D30）。版本 3 缺少合法的一份
  // 属于损坏数据，报错并保留原文件，不替它重建一份新的顺序。
  let board = upgraded
  if (parsed.version !== BOARD_FORMAT) {
    board = { ...upgraded, arrangement: { mode: 'free' } }
  } else if (!isArrangement(upgraded.arrangement)) {
    throw new Error(`${file} 的排列偏好缺失或不合法；原文件保留`)
  }
  const filled = withLayouts(board, (widget) => records.get(widget)?.manifest.minBox)
  const sourced = withDefaultSources(filled.board, records)
  const arranged = withArrangement(sourced.board)
  const changed = parsed.version !== BOARD_FORMAT || filled.changed || sourced.changed || arranged.changed
  if (changed) await writeBoard(file, arranged.board)
  return arranged.board
}

/**
 * 写看板：先写临时文件再改名，读到一半的内容不会留在磁盘上。
 *
 * @param file - `board.json` 的路径。
 * @param board - 要写的看板。
 */
export async function writeBoard(file: string, board: Board): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  const temporary = `${file}.tmp`
  await writeFile(temporary, `${JSON.stringify(board, null, 2)}\n`, 'utf8')
  await rename(temporary, file)
}

/**
 * 找一张卡。
 *
 * @param board - 当前看板。
 * @param id - 卡片实例的 id。
 * @returns 卡片在数组里的下标。
 * @throws {Error} 看板上没有这张卡。
 */
function indexOf(board: Board, id: string): number {
  const index = board.instances.findIndex((instance) => instance.id === id)
  if (index === -1) throw new Error(`看板上没有这张卡：${id}`)
  return index
}

/**
 * 把一张卡的状态换成打了补丁的那份。
 *
 * 组件送来的是补丁：两边都是普通对象时合并一层，其余情况整体替换。卡片自己的 props 与 data 由
 * 宿主或工具写入，这里只动 state。
 *
 * @param board - 当前看板。
 * @param id - 卡片实例的 id。
 * @param patch - 组件送来的补丁。
 * @returns 换过这张卡状态的看板。
 * @throws {Error} 看板上没有这张卡。
 */
export function withInstanceState(board: Board, id: string, patch: unknown): Board {
  const index = indexOf(board, id)
  const instance = board.instances[index] as BoardInstance
  const state = isRecord(instance.state) && isRecord(patch) ? { ...instance.state, ...patch } : patch
  const instances = [...board.instances]
  instances[index] = { ...instance, state }
  return { ...board, instances }
}

/** 状态超过额度（D23）；路由把它翻成 413。 */
export class StateLimitError extends Refusal {
  constructor(message: string) {
    super(413, message, { code: 'state-too-large' })
  }
}

/** 一份状态序列化之后的字节数；`null` 与 `undefined` 按 0 算。 */
export function stateBytes(value: unknown): number {
  if (value === undefined || value === null) return 0
  const text = JSON.stringify(value)
  return text === undefined ? 0 : Buffer.byteLength(text, 'utf8')
}

/**
 * 把补丁并进状态，并核对额度（D23）。
 *
 * 单张卡的额度与整块看板的合计各有一道；超出时抛出 {@link StateLimitError}，调用方据此回 413，
 * 不留下写了一半的状态。
 *
 * @param board - 当前看板。
 * @param id - 卡片实例的 id。
 * @param patch - 组件送来的补丁。
 * @returns 换过这张卡状态的看板。
 * @throws {StateLimitError} 超过单卡或整块看板的额度。
 * @throws {Error} 看板上没有这张卡。
 */
export function withInstanceStateChecked(board: Board, id: string, patch: unknown): Board {
  const next = withInstanceState(board, id, patch)
  const instance = next.instances.find((candidate) => candidate.id === id)
  const own = stateBytes(instance?.state)
  if (own > STATE_BYTES_LIMIT) {
    throw new StateLimitError(`这张卡的状态超过 ${String(STATE_BYTES_LIMIT)} 字节：${String(own)} 字节`)
  }
  const total = next.instances.reduce((sum, candidate) => sum + stateBytes(candidate.state), 0)
  if (total > BOARD_STATE_BYTES_LIMIT) {
    throw new StateLimitError(`这块看板的状态合计超过 ${String(BOARD_STATE_BYTES_LIMIT)} 字节：${String(total)} 字节`)
  }
  return next
}

/**
 * 换一张卡的数据。
 *
 * @param board - 当前看板。
 * @param id - 卡片实例的 id。
 * @param data - 数据源读出来的数据。
 * @returns 换过这张卡数据的看板。
 * @throws {Error} 看板上没有这张卡。
 */
export function withInstanceData(board: Board, id: string, data: unknown): Board {
  const index = indexOf(board, id)
  const instance = board.instances[index] as BoardInstance
  const instances = [...board.instances]
  instances[index] = { ...instance, data }
  return { ...board, instances }
}

/**
 * 往看板上加一张卡。
 *
 * @param board - 当前看板。
 * @param record - 组件记录。
 * @param options - 数据源、props 与拖放落点。
 * @param id - 卡片的 id；省略时生成一个。路由先定下 id，才能在写入之后按它回话。
 * @returns 带新卡片的看板与新卡片的 id。
 */
export function withInstanceAdded(
  board: Board,
  record: WidgetRecord,
  options: { source?: string, props?: Record<string, unknown>, layout?: CardLayout } = {},
  id: string = randomUUID(),
): { board: Board, id: string } {
  const instance = { ...instanceOf(record, board.instances, options), id }
  return { board: withArrangement({ ...board, instances: [...board.instances, instance] }).board, id }
}

/**
 * 从看板上移除一张卡。
 *
 * @param board - 当前看板。
 * @param id - 卡片实例的 id。
 * @returns 少了这张卡的看板。
 * @throws {Error} 看板上没有这张卡。
 */
export function withInstanceRemoved(board: Board, id: string): Board {
  const index = indexOf(board, id)
  const instances = [...board.instances]
  instances.splice(index, 1)
  return withArrangement({ ...board, instances }).board
}

/**
 * 改一张已有的卡：盒子、props、数据源与数据（D9、D16）。
 *
 * 只改给出的那几项，其余保持原样。给了盒子时抬到组件的最小盒子；卡片属于一个组时，盒子写给整组
 * （D19）。`source` 给成空串表示解绑数据源。
 *
 * @param board - 当前看板。
 * @param id - 卡片实例的 id。
 * @param patch - 要改的那几项。
 * @param minBoxOf - 按组件 id 取最小盒子；省略时不执行下限。
 * @returns 改过之后的看板。
 * @throws {Error} 看板上没有这张卡。
 */
export function withInstancePatched(
  board: Board,
  id: string,
  patch: { layout?: Partial<CardLayout>, props?: Record<string, unknown>, source?: string, data?: unknown },
  minBoxOf?: (widget: string) => WidgetMinBox | undefined,
): Board {
  const index = indexOf(board, id)
  const current = board.instances[index] as BoardInstance
  const layout = patch.layout === undefined ? undefined : clampCardLayout({ ...current.layout, ...patch.layout }, minBoxOf?.(current.widget))
  const next: BoardInstance = {
    ...current,
    ...(patch.props === undefined ? {} : { props: patch.props }),
    ...(patch.data === undefined ? {} : { data: patch.data }),
  }
  if (patch.source !== undefined) {
    if (patch.source === '') delete next.source
    else next.source = patch.source
  }
  const instances = board.instances.map((instance) => {
    if (layout === undefined) return instance.id === id ? next : instance
    // 组卡的两张卡共用同一个盒子：改一侧就是改整组（D19）。
    if (current.group !== undefined && instance.group?.id === current.group.id) return { ...instance, layout }
    return instance.id === id ? { ...next, layout } : instance
  })
  return { ...board, instances }
}

/**
 * 往看板上加一张固定的翻面组（D19）：正面一张卡、背面一张卡，共用一个组 id 与同一个盒子。
 *
 * 两张卡都是普通卡片，各自有 props、data、state 和实例路由；组只多一层标记，不在组件库里占一个
 * 组件类型。原型阶段正反两面的组件由调用方固定，之后再把选择权交给界面。
 *
 * @param board - 当前看板。
 * @param front - 正面的组件记录。
 * @param back - 背面的组件记录。
 * @param options - 拖动落点。
 * @returns 加了这一组的看板与组 id。
 */
export function withGroupAdded(
  board: Board,
  front: WidgetRecord,
  back: WidgetRecord,
  options: { layout?: CardLayout } = {},
): { board: Board, id: string } {
  const id = randomUUID()
  const minBox = mergeMinBox(front.manifest.minBox, back.manifest.minBox)
  const layout = options.layout === undefined
    ? nextCardLayout(board.instances, clampCardBox({ w: 1, h: DEFAULT_HEIGHT_REM }, minBox))
    : clampCardLayout(options.layout, minBox)
  const base = { template: 'flip' as const }
  const frontInstance: BoardInstance = {
    ...instanceOf(front, board.instances, { layout }),
    group: { ...base, id, side: 'front' } satisfies InstanceGroup,
  }
  const backInstance: BoardInstance = {
    ...instanceOf(back, [...board.instances, frontInstance], { layout }),
    group: { ...base, id, side: 'back' } satisfies InstanceGroup,
  }
  return { board: withArrangement({ ...board, instances: [...board.instances, frontInstance, backInstance] }).board, id }
}

/**
 * 按组 id 移除整组（D19）：正反两张卡一起离开看板，不留下只有一侧的半个组。
 *
 * @param board - 当前看板。
 * @param id - 组 id。
 * @returns 少了这一组的看板。
 * @throws {Error} 看板上没有这个组。
 */
export function withGroupRemoved(board: Board, id: string): Board {
  const instances = board.instances.filter((instance) => instance.group?.id !== id)
  if (instances.length === board.instances.length) throw new Error(`看板上没有这一组：${id}`)
  return withArrangement({ ...board, instances }).board
}

/**
 * 换掉组卡一个槽里的组件（D27）：槽还是同一条实例，组件、版本、props、数据、状态与数据源一起换。
 *
 * 另一个槽不动。组卡盒子共享，换完之后按两个槽当前组件的最小盒子重新抬一次，两张实例写同一个盒子。
 *
 * @param board - 当前看板。
 * @param groupId - 组 id。
 * @param side - 换哪一侧。
 * @param record - 新组件的记录。
 * @param minBoxOf - 按组件 id 取最小盒子；省略时不执行下限。
 * @returns 换过之后的看板。
 * @throws {Error} 看板上没有这一组、这个槽，或组只剩一个槽。
 */
export function withGroupSlotReplaced(
  board: Board,
  groupId: string,
  side: GroupSide,
  record: WidgetRecord,
  minBoxOf?: (widget: string) => WidgetMinBox | undefined,
): Board {
  const slot = board.instances.find((instance) => instance.group?.id === groupId && instance.group.side === side)
  if (slot === undefined) throw new Error(`看板上没有这一组的 ${side} 槽：${groupId}`)
  const other = board.instances.find((instance) => instance.group?.id === groupId && instance.id !== slot.id)
  if (other === undefined) throw new Error(`这一组缺少另一个槽：${groupId}`)
  const minBox = mergeMinBox(minBoxOf?.(record.manifest.id), minBoxOf?.(other.widget))
  const layout = clampCardLayout(slot.layout, minBox)
  const instances = board.instances.map((instance) => {
    if (instance.group?.id !== groupId) return instance
    if (instance.id !== slot.id) return { ...instance, layout }
    const next: BoardInstance = {
      ...instance,
      widget: record.manifest.id,
      hash: record.hash,
      props: {},
      data: null,
      state: null,
      layout,
    }
    if (record.manifest.source === undefined) delete next.source
    else next.source = record.manifest.source
    return next
  })
  return { ...board, instances }
}

/**
 * 一块看板的排列偏好里接上或去掉一个排列单元（D30）。
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
    boxes[entry.id] = entry.box
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
 * 组的排列单元：加完一组之后接进整齐偏好的那一份（D30）。
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
 * 把一次排列偏好的提交写进看板（D30）：模式、整齐顺序与期望宽高一起换。
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

/**
 * 把一次提交的布局写进对应的卡片。
 *
 * 提交里出现的每一张卡都必须在看板上，布局的四个数都要在合法范围内；不合法的提交整体拒绝，
 * 不留下半份新布局（D11）。给了 `minBoxOf` 时，每份布局先抬到组件的最小盒子。
 *
 * @param board - 当前看板。
 * @param layouts - 卡片 id 到布局的映射。
 * @param minBoxOf - 按组件 id 取最小盒子；省略时不执行下限。
 * @returns 换过布局的看板。
 * @throws {Error} 看板上没有某张卡，或某份布局不合法。
 */
export function withBoardLayouts(
  board: Board,
  layouts: Record<string, CardLayout>,
  minBoxOf?: (widget: string) => WidgetMinBox | undefined,
): Board {
  const known = new Map(board.instances.map((instance) => [instance.id, instance]))
  /** 组卡的两张卡共用同一个盒子：提交里出现任意一侧，整组都换到这一份（D19）。 */
  const groupMin = new Map<string, WidgetMinBox>()
  for (const instance of board.instances) {
    if (instance.group === undefined) continue
    const minBox = minBoxOf?.(instance.widget)
    if (minBox === undefined) continue
    const previous = groupMin.get(instance.group.id)
    groupMin.set(instance.group.id, previous === undefined ? minBox : { w: Math.max(previous.w, minBox.w), h: Math.max(previous.h, minBox.h) })
  }
  const direct = new Map<string, CardLayout>()
  const groupLayouts = new Map<string, CardLayout>()
  for (const [id, layout] of Object.entries(layouts)) {
    const instance = known.get(id)
    if (instance === undefined) throw new Error(`看板上没有这张卡：${id}`)
    if (!isCardLayout(layout)) throw new Error(`卡片 ${id} 的布局不合法`)
    const minBox = instance.group === undefined ? minBoxOf?.(instance.widget) : groupMin.get(instance.group.id)
    const next = clampCardLayout(layout, minBox)
    if (instance.group === undefined) direct.set(id, next)
    else groupLayouts.set(instance.group.id, next)
  }
  const instances = board.instances.map((instance) => {
    const layout = direct.get(instance.id) ?? (instance.group === undefined ? undefined : groupLayouts.get(instance.group.id))
    return layout === undefined ? instance : { ...instance, layout }
  })
  return { ...board, instances }
}
