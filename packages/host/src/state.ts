/**
 * 看板的存储：`$DSH_HOME/widget-board/board.json`，宿主是唯一写入者（D5）。
 *
 * 第一次启动时写出一块看板加一张样例卡，让看板页不是空白。格式版本对不上、或某张卡引用了不在
 * 组件库里的组件时，启动直接报错并保留原文件（D11）。
 */
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Board } from '@dsh-widget-board/contracts'
import type { WidgetRecord } from './library'

/** 存储格式的版本。 */
export const BOARD_FORMAT = 1

/**
 * 第一次启动时的看板：组件库里的第一个组件一张卡。
 *
 * @param library - 已校验的组件库。
 * @returns 新的看板。
 */
function seed(library: Map<string, WidgetRecord>): Board {
  const [first] = [...library.keys()].sort()
  const record = library.get(first) as WidgetRecord
  return {
    version: BOARD_FORMAT,
    id: randomUUID(),
    title: '看板',
    instances: [{ id: randomUUID(), widget: record.manifest.id, hash: record.hash, props: {}, data: null, state: null }],
  }
}

/**
 * 读看板；文件不存在时写出一块新的。
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
  return board
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
