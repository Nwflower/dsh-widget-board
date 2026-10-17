/**
 * 看板的存储：`$DSH_HOME/widget-board/board.json`，宿主是唯一写入者（D5）。
 *
 * 第一次启动时给组件库里的每个组件放一张卡。加入卡片的面板做出来之前，组件库里有、看板上还没有
 * 的组件也会补一张卡——否则新增的内置组件没有别的路径能出现在看板上。
 *
 * 格式版本对不上、或某张卡引用了不在组件库里的组件时，启动直接报错并保留原文件（D11）。
 */
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Board, BoardInstance } from '@dsh-widget-board/contracts'
import type { WidgetRecord } from './library'

/** 存储格式的版本。 */
export const BOARD_FORMAT = 1

/**
 * 一个组件的一张新卡。
 *
 * @param record - 组件记录。
 * @returns 卡片。
 */
function instanceOf(record: WidgetRecord): BoardInstance {
  return { id: randomUUID(), widget: record.manifest.id, hash: record.hash, props: {}, data: null, state: null }
}

/**
 * 第一次启动时的看板：组件库里的每个组件一张卡。
 *
 * @param library - 已校验的组件库。
 * @returns 新的看板。
 */
function seed(library: Map<string, WidgetRecord>): Board {
  const instances = [...library.keys()].sort().map((id) => instanceOf(library.get(id) as WidgetRecord))
  return { version: BOARD_FORMAT, id: randomUUID(), title: '看板', instances }
}

/**
 * 给组件库里新出现的组件补卡。
 *
 * 启动时读看板要补，热重载读到新组件时也要补：组件已经落到 `lib/widgets/` 里，看板上还没有它的
 * 卡，补一张比让人重启一次更接近“改了就看见”。加入卡片的面板做出来之后，这一条可以退成默认行为。
 *
 * @param board - 读出来的看板。
 * @param library - 已校验的组件库。
 * @returns 补过卡的看板；不需要补时是 null。
 */
export function withNewWidgets(board: Board, library: Map<string, WidgetRecord>): Board | null {
  const placed = new Set(board.instances.map((instance) => instance.widget))
  const missing = [...library.keys()].sort().filter((id) => !placed.has(id))
  if (missing.length === 0) return null
  return { ...board, instances: [...board.instances, ...missing.map((id) => instanceOf(library.get(id) as WidgetRecord))] }
}

/**
 * 读看板；文件不存在时写出一块新的，组件库里有新组件时补上它的卡。
 *
 * @param file - `board.json` 的路径。
 * @param library - 已校验的组件库。
 * @returns 看板。
 * @throws {Error} 格式版本不认识，或某张卡引用了组件库里没有的组件。
 */
export async function loadBoard(file: string, library: Map<string, WidgetRecord>): Promise<Board> {
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    const board = seed(library)
    await writeBoard(file, board)
    return board
  }
  const board = JSON.parse(raw) as Board
  if (board.version !== BOARD_FORMAT) {
    throw new Error(`${file} 的格式版本是 ${String(board.version)}，这个宿主只认 ${BOARD_FORMAT}；原文件保留`)
  }
  for (const instance of board.instances) {
    if (!library.has(instance.widget)) throw new Error(`${file} 里的卡片 ${instance.id} 引用了组件库里没有的组件 ${instance.widget}；原文件保留`)
  }
  const filled = withNewWidgets(board, library)
  if (filled === null) return board
  await writeBoard(file, filled)
  return filled
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
  const index = board.instances.findIndex((instance) => instance.id === id)
  if (index === -1) throw new Error(`看板上没有这张卡：${id}`)
  const instance = board.instances[index] as BoardInstance
  const state = isRecord(instance.state) && isRecord(patch) ? { ...instance.state, ...patch } : patch
  const instances = [...board.instances]
  instances[index] = { ...instance, state }
  return { ...board, instances }
}
