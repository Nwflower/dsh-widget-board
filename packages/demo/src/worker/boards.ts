/**
 * 演示宿主的看板存储：默认看板来自构建时的快照，之后的每次写入落在 IndexedDB（D25）。
 *
 * 契约与真实宿主的工作区一致：写入串行，后一次看得到前一次的结果；每次写入让 `revision` 加一，
 * 卡片增删与布局提交才让 `layoutRevision` 加一，带着过期的布局修订号来的提交被拒绝。区别只在
 * 落点：真实宿主写磁盘上的文件，这里写浏览器里的一个键。
 */
import type { Board, BoardEvent, BoardInstance, WorkspaceSnapshot } from '@dsh-widget-board/contracts'
import { StaleRevisionError } from '../../../host/src/state'
import type { SaveOptions } from '../../../host/src/workspace'
import type { HostData } from '../data'
import { readStored, writeStored } from '../storage'
import type { StoredWorkspace } from '../storage'

/** 演示宿主上的看板存储。 */
export interface Boards {
  /** 整个工作区的快照：看板来自存储，组件信息与组件库来自构建时的快照。 */
  snapshot(): Promise<WorkspaceSnapshot>
  /** 有没有这块看板。 */
  has(id: string): Promise<boolean>
  /** 按卡片 id 找它所在的看板与那张卡。 */
  findInstance(id: string): Promise<{ board: Board, instance: BoardInstance } | undefined>
  /** 按组 id 找它所在的看板。 */
  findGroup(id: string): Promise<Board | undefined>
  /** 选中一块看板。 */
  setActive(id: string): Promise<void>
  /**
   * 改一块看板：写入存储、推一条通知。
   *
   * @param id - 看板 id。
   * @param change - 由当前的一份算出新的一份。
   * @param options - 期望的布局修订号、要不要动布局修订号、推哪条事件。
   * @returns 写入之后的那一份。
   * @throws {StaleRevisionError} 期望的布局修订号已经过期。
   */
  save(id: string, change: (current: Board) => Board, options: SaveOptions): Promise<Board>
}

/**
 * 建看板存储。
 *
 * @param data - 构建时写出的宿主数据。
 * @param notify - 推一条变更通知。
 * @returns 看板存储。
 */
export function createBoards(data: HostData, notify: (event: BoardEvent) => void): Boards {
  /** 写入队列：后一次看得到前一次的结果。 */
  let writing: Promise<unknown> = Promise.resolve()
  const queue = <T>(run: () => Promise<T>): Promise<T> => {
    const next = writing.then(run)
    writing = next.catch(() => undefined)
    return next
  }

  /** 存着的工作区；没有存过、或它来自另一份默认看板时回到默认看板。 */
  const load = async (): Promise<StoredWorkspace> => {
    const stored = await readStored()
    if (stored?.seed === data.seed) return stored
    return { seed: data.seed, active: data.snapshot.active, boards: data.snapshot.boards }
  }

  return {
    async snapshot() {
      const { active, boards } = await load()
      return { ...data.snapshot, active, boards }
    },
    async has(id) {
      return (await load()).boards.some((board) => board.id === id)
    },
    async findInstance(id) {
      for (const board of (await load()).boards) {
        const instance = board.instances.find((candidate) => candidate.id === id)
        if (instance !== undefined) return { board, instance }
      }
      return undefined
    },
    async findGroup(id) {
      return (await load()).boards.find((board) => board.instances.some((instance) => instance.group?.id === id))
    },
    async setActive(id) {
      await queue(async () => {
        const stored = await load()
        if (stored.active === id) return
        await writeStored({ ...stored, active: id })
        notify({ type: 'active', board: id })
      })
    },
    async save(id, change, options) {
      return await queue(async () => {
        const stored = await load()
        const before = stored.boards.find((board) => board.id === id)
        if (before === undefined) throw new Error(`没有这块看板：${id}`)
        if (options.expectedLayoutRevision !== undefined && options.expectedLayoutRevision !== before.layoutRevision) {
          throw new StaleRevisionError(options.expectedLayoutRevision, before.layoutRevision)
        }
        const after: Board = {
          ...change(before),
          revision: before.revision + 1,
          layoutRevision: before.layoutRevision + (options.layoutChanged === true ? 1 : 0),
        }
        await writeStored({ ...stored, boards: stored.boards.map((board) => (board.id === id ? after : board)) })
        notify(options.event(after, id))
        return after
      })
    },
  }
}
