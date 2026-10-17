/**
 * 看板的存储：`$DSH_HOME/widget-board/board.json`，宿主是唯一写入者（D5）。
 *
 * 第一次启动时给组件库里的每个组件放一张卡；此后的组件增删都来自添加面板与工具，不再自动补卡。
 * 每张卡片带着自己的盒子（D16）。旧看板没有盒子时按最矮的一列补上默认位置；版本 1 的看板升级时
 * 把原来的固定题头补成一张 `board-hero` 卡。格式版本对不上时启动直接报错并保留原文件（D11）。卡片
 * 引用的组件不在组件库里不算错误：卡片保留，界面把它画成不可用的占位（D17）。
 */
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Board, BoardInstance, CardLayout, InstanceGroup, WidgetMinBox } from '@dsh-widget-board/contracts'
import { BOARD_HERO_ID } from '@dsh-widget-board/contracts'
import { DEFAULT_HEIGHT_REM, clampCardBox, clampCardLayout, isCardLayout, nextCardLayout } from '@dsh-widget-board/model'
import type { WidgetRecord } from './library'

/** 存储格式的版本：2 把固定的题头换成了 `board-hero` 卡片。 */
export const BOARD_FORMAT = 2

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
function defaultBoxOf(record: WidgetRecord): { w: number, h: number } {
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
  return {
    id: randomUUID(),
    widget: record.manifest.id,
    hash: record.hash,
    ...(options.source === undefined ? {} : { source: options.source }),
    props: options.props ?? {},
    data: null,
    state: null,
    layout: options.layout === undefined
      ? nextCardLayout(existing, defaultBoxOf(record))
      : clampCardLayout(options.layout, record.manifest.minBox),
  }
}

/**
 * 第一次启动时的看板：内置组件每个一张卡，按组件 id 排好，依次放进最矮的列。
 *
 * 用户与插件来源的组件不铺卡：它们从添加面板加入，装了插件不该顺带改变别人的看板（D17）。
 *
 * @param records - 已校验的组件。
 * @returns 新的看板。
 */
function seed(records: Map<string, WidgetRecord>): Board {
  const instances: BoardInstance[] = []
  const builtin = [...records.values()].filter((record) => record.source === 'builtin')
  for (const record of builtin.sort((left, right) => left.manifest.id.localeCompare(right.manifest.id))) {
    instances.push(instanceOf(record, instances))
  }
  return {
    version: BOARD_FORMAT,
    id: randomUUID(),
    title: '看板',
    revision: INITIAL_REVISION,
    layoutRevision: INITIAL_LAYOUT_REVISION,
    instances,
  }
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

/**
 * 读看板；文件不存在时写出一块新的。
 *
 * @param file - `board.json` 的路径。
 * @param records - 已校验的组件，只在第一次启动时用来铺初始的卡片。
 * @returns 看板。
 * @throws {Error} 格式版本不认识。
 */
export async function loadBoard(file: string, records: Map<string, WidgetRecord>): Promise<Board> {
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    const board = seed(records)
    await writeBoard(file, board)
    return board
  }
  const parsed = JSON.parse(raw) as Board
  if (parsed.version !== 1 && parsed.version !== BOARD_FORMAT) {
    throw new Error(`${file} 的格式版本是 ${String(parsed.version)}，这个宿主只认 1 或 ${BOARD_FORMAT}；原文件保留`)
  }
  const upgraded = parsed.version === 1 ? upgradeV1(parsed, records) : parsed
  const filled = withLayouts(upgraded, (widget) => records.get(widget)?.manifest.minBox)
  const changed = parsed.version === 1 || filled.changed
  if (changed) await writeBoard(file, filled.board)
  return filled.board
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

/** 普通的 JSON 对象：可以当补丁合并。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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
  return { board: { ...board, instances: [...board.instances, instance] }, id }
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
  return { board: { ...board, instances: [...board.instances, frontInstance, backInstance] }, id }
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
  return { ...board, instances }
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
