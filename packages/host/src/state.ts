/**
 * 看板的存储：`$DSH_HOME/widget-board/board.json`，宿主是唯一写入者（D5）。
 *
 * 第一次启动时给组件库里的每个组件放一张卡；此后的组件增删都来自添加面板与工具，不再自动补卡。
 * 每张卡片带着自己的盒子（D16）。旧看板没有盒子时按最矮的一列补上默认位置；格式版本对不上时
 * 启动直接报错并保留原文件（D11）。卡片引用的组件不在组件库里不算错误：卡片保留，界面把它画成
 * 不可用的占位（D17）。
 */
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Board, BoardInstance, CardLayout } from '@dsh-widget-board/contracts'
import { isCardLayout, nextCardLayout } from '@dsh-widget-board/model'
import type { WidgetRecord } from './library'

/** 存储格式的版本。 */
export const BOARD_FORMAT = 1

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
 * 一个组件的一张新卡。
 *
 * @param record - 组件记录。
 * @param existing - 已经摆放好的卡片，用来找最矮的一列。
 * @param options - 数据源与 props。
 * @returns 卡片。
 */
export function instanceOf(
  record: WidgetRecord,
  existing: readonly BoardInstance[],
  options: { source?: string, props?: Record<string, unknown> } = {},
): BoardInstance {
  return {
    id: randomUUID(),
    widget: record.manifest.id,
    hash: record.hash,
    ...(options.source === undefined ? {} : { source: options.source }),
    props: options.props ?? {},
    data: null,
    state: null,
    layout: nextCardLayout(existing),
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
 * 旧看板补上修订号与卡片盒子。盒子缺失或形状不对时按最矮的一列放一张默认大小的卡。
 *
 * @param board - 从磁盘读出来的看板。
 * @returns 补齐后的看板，以及有没有改动。
 */
export function withLayouts(board: Board): { board: Board, changed: boolean } {
  let changed = false
  const instances: BoardInstance[] = []
  for (const instance of board.instances) {
    if (isCardLayout(instance.layout)) {
      instances.push(instance)
      continue
    }
    changed = true
    instances.push({ ...instance, layout: nextCardLayout(instances) })
  }
  const revision = Number.isSafeInteger(board.revision) ? board.revision : INITIAL_REVISION
  const layoutRevision = Number.isSafeInteger(board.layoutRevision) ? board.layoutRevision : INITIAL_LAYOUT_REVISION
  if (revision !== board.revision || layoutRevision !== board.layoutRevision) changed = true
  return { board: { ...board, revision, layoutRevision, instances }, changed }
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
  if (parsed.version !== BOARD_FORMAT) {
    throw new Error(`${file} 的格式版本是 ${String(parsed.version)}，这个宿主只认 ${BOARD_FORMAT}；原文件保留`)
  }
  const filled = withLayouts(parsed)
  if (filled.changed) await writeBoard(file, filled.board)
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
 * @param options - 数据源与 props。
 * @param id - 卡片的 id；省略时生成一个。路由先定下 id，才能在写入之后按它回话。
 * @returns 带新卡片的看板与新卡片的 id。
 */
export function withInstanceAdded(
  board: Board,
  record: WidgetRecord,
  options: { source?: string, props?: Record<string, unknown> } = {},
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
 * 把一次提交的布局写进对应的卡片。
 *
 * 提交里出现的每一张卡都必须在看板上，布局的四个数都要在合法范围内；不合法的提交整体拒绝，
 * 不留下半份新布局（D11）。
 *
 * @param board - 当前看板。
 * @param layouts - 卡片 id 到布局的映射。
 * @returns 换过布局的看板。
 * @throws {Error} 看板上没有某张卡，或某份布局不合法。
 */
export function withBoardLayouts(board: Board, layouts: Record<string, CardLayout>): Board {
  const known = new Set(board.instances.map((instance) => instance.id))
  for (const [id, layout] of Object.entries(layouts)) {
    if (!known.has(id)) throw new Error(`看板上没有这张卡：${id}`)
    if (!isCardLayout(layout)) throw new Error(`卡片 ${id} 的布局不合法`)
  }
  const instances = board.instances.map((instance) => {
    const layout = layouts[instance.id]
    return layout === undefined ? instance : { ...instance, layout }
  })
  return { ...board, instances }
}
