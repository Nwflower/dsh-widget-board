/**
 * 多块看板的工作区（D21）。
 *
 * `$DSH_HOME/widget-board/` 下两份东西：`boards.json` 是索引（次序与当前选中），`boards/<id>.json`
 * 是每块看板自己的一份，标题只写在看板里，索引不复制一遍。写入串行、先写临时文件再改名；索引只在
 * 新建、移除与切换选中时写。旧版本的单份 `board.json` 在第一次启动时搬成第一块看板，搬完才删掉
 * 原文件（D5 的重审条件）。
 */
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Board, BoardEvent, BoardInstance, WidgetMinBox } from '@dsh-widget-board/contracts'
import type { WidgetRecord } from './library'
import { seedBoards } from './default-boards'
import { StaleRevisionError, emptyBoard, readBoard, withLayouts, writeBoard } from './state'

/** 索引的格式版本。 */
export const INDEX_FORMAT = 1

/** 旧看板没有标题时给它起的名字。 */
const FIRST_TITLE = '看板'

/** 新建看板的标题前缀；重名时后面接一个序号。 */
const NEW_TITLE = '未命名看板'

/** `boards.json` 的形状：次序、当前选中，以及每块看板的文件名。 */
export interface BoardIndex {
  version: number
  /** 当前选中的看板 id。 */
  active: string
  /** 全部看板 id，按标签的次序。 */
  boards: string[]
}

/** 一次写入要带的选项：修订号、要不要动布局修订号、推给页面的是哪条事件。 */
export interface SaveOptions {
  expectedLayoutRevision?: number
  layoutChanged?: boolean
  event: (next: Board, id: string) => BoardEvent
}

/** 工作区：内存里的全部看板、索引，以及唯一的写入队列。 */
export interface Workspace {
  /** 当前选中的看板 id。 */
  activeId(): string
  /** 当前选中的看板。 */
  active(): Board
  /** 全部看板，按标签的次序。 */
  list(): Board[]
  /**
   * 一块看板。
   *
   * @param id - 看板 id。
   * @throws {Error} 没有这块看板。
   */
  board(id: string): Board
  /**
   * 有没有这块看板。
   *
   * @param id - 看板 id。
   * @returns 有这块看板时为真。
   */
  has(id: string): boolean
  /** 按卡片 id 找它所在的看板与那张卡；卡片 id 全工作区唯一。 */
  findInstance(id: string): { board: Board, instance: BoardInstance } | undefined
  /** 按组 id 找它所在的看板。 */
  findGroup(id: string): Board | undefined
  /**
   * 选中一块看板。
   *
   * @param id - 看板 id。
   */
  setActive(id: string): Promise<void>
  /**
   * 新建一块空看板并选中它。
   *
   * @param title - 标题；省略时起一个「未命名看板」。
   * @returns 新的看板。
   */
  create(title?: string): Promise<Board>
  /**
   * 改一块看板的标题。
   *
   * @param id - 看板 id。
   * @param title - 新标题。
   */
  rename(id: string, title: string): Promise<void>
  /**
   * 移除一块看板；移除最后一块时补一块空看板并选中它。
   *
   * @param id - 看板 id。
   */
  remove(id: string): Promise<void>
  /**
   * 改一块看板：写到磁盘、换掉内存里的那一份、推一条通知；写入串行，后一次看得到前一次的结果。
   *
   * @param id - 看板 id。
   * @param change - 由当前的一份算出新的一份。
   * @param options - 修订号、布局标记与要推的事件。
   * @returns 写入之后的那一份。
   * @throws {StaleRevisionError} 期望的布局修订号已经过期。
   */
  save(id: string, change: (current: Board) => Board, options: SaveOptions): Promise<Board>
  /**
   * 组件的最小盒子变了：把每块看板里低于下限的卡片抬上来。
   *
   * @param minBoxOf - 按组件 id 取最小盒子。
   * @returns 有没有任何一块看板被改过。
   */
  relayout(minBoxOf: (widget: string) => WidgetMinBox | undefined): Promise<boolean>
}

/** 一块看板的文件。 */
const boardFileOf = (home: string, id: string): string => join(home, 'boards', `${id}.json`)

/**
 * 读索引；文件不存在时是 `null`。
 *
 * @param file - `boards.json` 的路径。
 * @returns 索引。
 * @throws {Error} 格式版本不认识，或索引指向一块不存在的看板。
 */
async function readIndex(file: string): Promise<BoardIndex | null> {
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return null
  }
  const parsed = JSON.parse(raw) as BoardIndex
  if (parsed.version !== INDEX_FORMAT) {
    throw new Error(`${file} 的格式版本是 ${String(parsed.version)}，这个宿主只认 ${INDEX_FORMAT}；原文件保留`)
  }
  if (!Array.isArray(parsed.boards) || parsed.boards.length === 0 || !parsed.boards.every((id) => typeof id === 'string' && id !== '')) {
    throw new Error(`${file} 没有可用的看板清单`)
  }
  return parsed
}

/**
 * 写一份 JSON：先写临时文件再改名，读到一半的内容不会留在磁盘上。
 *
 * @param file - 目标路径。
 * @param value - 要写的内容。
 */
async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  const temporary = `${file}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temporary, file)
}

/**
 * 打开工作区：读索引与每块看板；没有索引时建出第一块。
 *
 * @param home - `$DSH_HOME/widget-board`。
 * @param records - 已校验的组件，用来铺第一块看板的卡片。
 * @param notify - 推一条变更通知。
 * @returns 工作区。
 * @throws {Error} 索引或某块看板的格式版本不认识。
 */
export async function openWorkspace(
  home: string,
  records: Map<string, WidgetRecord>,
  notify: (event: BoardEvent) => void,
): Promise<Workspace> {
  const indexFile = join(home, 'boards.json')
  const legacy = join(home, 'board.json')
  await mkdir(join(home, 'boards'), { recursive: true })
  const boards = new Map<string, Board>()
  let index = await readIndex(indexFile)
  if (index === null) {
    // 单一看板的时代留下的一份：搬成第一块看板，搬完才删掉原文件（D5 的重审条件）。没有旧文件时
    // 才是真正的第一次启动，铺两块默认看板（D17）。
    let first: Board[]
    try {
      first = [await readBoard(legacy, records)]
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      first = seedBoards(records)
    }
    first = first.map((entry) => typeof entry.title !== 'string' || entry.title.trim() === '' ? { ...entry, title: FIRST_TITLE } : entry)
    for (const entry of first) {
      await writeBoard(boardFileOf(home, entry.id), entry)
      boards.set(entry.id, entry)
    }
    index = { version: INDEX_FORMAT, active: (first[0] as Board).id, boards: first.map((entry) => entry.id) }
    await writeJson(indexFile, index)
    await rm(legacy, { force: true })
  } else {
    for (const id of index.boards) boards.set(id, await readBoard(boardFileOf(home, id), records))
    if (!index.boards.includes(index.active)) index = { ...index, active: index.boards[0] as string }
  }

  let current: BoardIndex = index
  /** 写入队列：后一次看得到前一次的结果。 */
  let writing: Promise<void> = Promise.resolve()
  const writeIndex = (): Promise<void> => writeJson(indexFile, current)

  /**
   * 排一次写入。
   *
   * @param run - 轮到它时执行的那件事。
   * @returns 那件事的结果。
   */
  const queue = <T>(run: () => Promise<T>): Promise<T> => {
    const next = writing.then(run)
    writing = next.then(() => undefined, () => undefined)
    return next
  }

  /** 一个还没被用过的「未命名看板」标题。 */
  const nextTitle = (): string => {
    const taken = new Set([...boards.values()].map((board) => board.title))
    if (!taken.has(NEW_TITLE)) return NEW_TITLE
    for (let at = 2; ; at += 1) {
      const candidate = `${NEW_TITLE} ${String(at)}`
      if (!taken.has(candidate)) return candidate
    }
  }

  const board = (id: string): Board => {
    const found = boards.get(id)
    if (found === undefined) throw new Error(`没有这块看板：${id}`)
    return found
  }

  /**
   * 改一块看板：排队、核对修订号、写盘、换内存、推通知。
   *
   * @param id - 看板 id。
   * @param change - 由当前的一份算出新的一份。
   * @param options - 修订号、布局标记与要推的事件。
   * @returns 写入之后的那一份。
   * @throws {StaleRevisionError} 期望的布局修订号已经过期。
   */
  const save = async (id: string, change: (current: Board) => Board, options: SaveOptions): Promise<Board> => {
    board(id)
    return await queue(async () => {
      const before = board(id)
      if (options.expectedLayoutRevision !== undefined && options.expectedLayoutRevision !== before.layoutRevision) {
        throw new StaleRevisionError(options.expectedLayoutRevision, before.layoutRevision)
      }
      const next = {
        ...change(before),
        revision: before.revision + 1,
        layoutRevision: before.layoutRevision + (options.layoutChanged === true ? 1 : 0),
      }
      await writeBoard(boardFileOf(home, id), next)
      boards.set(id, next)
      notify(options.event(next, id))
      return next
    })
  }

  return {
    activeId: () => current.active,
    active: () => board(current.active),
    list: () => current.boards.map((id) => board(id)),
    board,
    has: (id) => boards.has(id),
    findInstance(id) {
      for (const candidate of boards.values()) {
        const instance = candidate.instances.find((entry) => entry.id === id)
        if (instance !== undefined) return { board: candidate, instance }
      }
      return undefined
    },
    findGroup(id) {
      for (const candidate of boards.values()) {
        if (candidate.instances.some((instance) => instance.group?.id === id)) return candidate
      }
      return undefined
    },
    async setActive(id) {
      board(id)
      if (current.active === id) return
      await queue(async () => {
        current = { ...current, active: id }
        await writeIndex()
        notify({ type: 'active', board: id })
      })
    },
    async create(title) {
      const wanted = title?.trim()
      return await queue(async () => {
        // 标题在队列里才定：两次新建同时到来时不会撞上同一个名字。
        const next = emptyBoard(wanted === undefined || wanted === '' ? nextTitle() : wanted)
        await writeBoard(boardFileOf(home, next.id), next)
        boards.set(next.id, next)
        current = { version: INDEX_FORMAT, active: next.id, boards: [...current.boards, next.id] }
        await writeIndex()
        notify({ type: 'board' })
        return next
      })
    },
    async rename(id, title) {
      const wanted = title.trim()
      if (wanted === '') throw new Error('看板标题不能是空的')
      board(id)
      await queue(async () => {
        const currentBoard = board(id)
        const next = { ...currentBoard, title: wanted, revision: currentBoard.revision + 1 }
        await writeBoard(boardFileOf(home, id), next)
        boards.set(id, next)
        notify({ type: 'board' })
      })
    },
    async remove(id) {
      board(id)
      await queue(async () => {
        const rest = current.boards.filter((entry) => entry !== id)
        boards.delete(id)
        // 最后一块被移除时补一块空看板：看板页总得有一块可以显示（D21）。先写新看板的文件再写索引，
        // 两步之间停下来时磁盘上仍是原来那一份。
        const replacement = rest.length === 0 ? emptyBoard(nextTitle()) : undefined
        if (replacement !== undefined) {
          await writeBoard(boardFileOf(home, replacement.id), replacement)
          boards.set(replacement.id, replacement)
        }
        const kept = replacement === undefined ? rest : [replacement.id]
        current = {
          version: INDEX_FORMAT,
          active: kept.includes(current.active) ? current.active : kept[0] as string,
          boards: kept,
        }
        await writeIndex()
        await rm(boardFileOf(home, id), { force: true })
        notify({ type: 'board' })
      })
    },
    save,
    async relayout(minBoxOf) {
      let changed = false
      for (const id of current.boards) {
        if (!withLayouts(board(id), minBoxOf).changed) continue
        changed = true
        await save(id, (now) => withLayouts(now, minBoxOf).board, { layoutChanged: true, event: () => ({ type: 'board' }) })
      }
      return changed
    },
  }
}
