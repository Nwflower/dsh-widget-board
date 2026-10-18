/**
 * 定时刷新的一批读取（D6）：同一块看板的到期卡一次写入。
 *
 * 单张卡的读取在 `routes.ts` 的 `loadData` 里；这里只负责把一批结果按看板分组、校验并合成
 * 一次 `workspace.save`，读失败的卡只影响自己。放进单独的文件，路由表不再跟着批处理变长。
 */
import type { Board } from '@dsh-widget-board/contracts'
import type { ReadOutcome } from './refresh'
import type { RouteContext } from './routes'
import { loadData } from './routes'
import { dataError } from './schema'
import { withInstanceData } from './state'

/**
 * 让一批到期的卡各读一次，按看板把写入合成一次（D6）。
 *
 * 同一块看板的成功结果一次落盘，其余卡各推一条 `instance` 事件；写入失败时那几张卡都报同一个
 * 原因，其他看板照常写。
 *
 * @param context - 路由上下文。
 * @param ids - 到期的卡片实例 id。
 * @returns 每张卡的结果；失败的那几张带原因。
 */
export async function readManyInto(context: RouteContext, ids: readonly string[]): Promise<readonly ReadOutcome[]> {
  const loaded = await Promise.all(ids.map(async (id) => {
    try {
      const value = await loadData(context, id)
      const problem = dataError(context.records.get(value.instance.widget)?.manifest.data, value.data)
      if (problem !== undefined) throw new Error(problem)
      return { id, value }
    } catch (error) {
      return { id, error }
    }
  }))

  const failures: ReadOutcome[] = []
  const failed = new Set<string>()
  const successes: { id: string, value: { board: Board, data: unknown } }[] = []
  for (const entry of loaded) {
    if ('error' in entry) failures.push({ id: entry.id, error: entry.error })
    else successes.push(entry)
  }

  const groups = new Map<string, { id: string, data: unknown }[]>()
  for (const { id, value } of successes) {
    const list = groups.get(value.board.id) ?? []
    list.push({ id, data: value.data })
    groups.set(value.board.id, list)
  }

  for (const [boardId, cards] of groups) {
    const first = cards[0]
    if (first === undefined) continue
    try {
      await context.workspace.save(
        boardId,
        (current) => cards.reduce((next, card) => withInstanceData(next, card.id, card.data), current),
        { event: () => ({ type: 'instance', id: first.id, data: first.data }) },
      )
      for (const card of cards.slice(1)) context.live.notify({ type: 'instance', id: card.id, data: card.data })
    } catch (error) {
      for (const card of cards) {
        failed.add(card.id)
        failures.push({ id: card.id, error })
      }
    }
  }

  return [...failures, ...successes.filter(({ id }) => !failed.has(id)).map(({ id }) => ({ id }))]
}
