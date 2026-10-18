/**
 * 路由共用的定位与授权事实（D6、D21）。
 *
 * 卡片 id 全工作区唯一，所以按 id 找卡片不必先知道看板；能力、数据源、动作与设置几条路由都用同
 * 一份，免得各写一遍。
 */
import type { Board, BoardInstance, InstanceFace } from '@dsh-widget-board/contracts'
import type { GrantFacts } from './permissions'
import { Refusal } from './refusal'
import type { RouteContext } from './routes'

/**
 * 一张卡的数据源、动作或能力调用看到的那一面。
 *
 * @param board - 卡片所在的看板。
 * @param id - 卡片实例的 id。
 * @returns 卡片实例的公开面。
 * @throws {Refusal} 看板上没有这张卡。
 */
export function faceOf(board: Board, id: string): InstanceFace {
  const instance = board.instances.find((candidate) => candidate.id === id)
  if (instance === undefined) throw new Refusal(404, `看板上没有这张卡：${id}`)
  return { id: instance.id, widget: instance.widget, props: instance.props }
}

/**
 * 按卡片 id 找那张卡与它所在的看板。
 *
 * @param context - 路由上下文。
 * @param id - 卡片实例的 id。
 * @returns 那张卡与它所在的看板。
 * @throws {Refusal} 全工作区都没有这张卡。
 */
export function locate(context: RouteContext, id: string): { board: Board, instance: BoardInstance } {
  const found = context.workspace.findInstance(id)
  if (found === undefined) throw new Refusal(404, `看板上没有这张卡：${id}`)
  return found
}

/**
 * 把路由上下文里跟授权有关的那几项收成一份事实（D6）。
 *
 * @param context - 路由上下文。
 * @param board - 这张卡所在的看板；卡片 id 全工作区唯一，不能拿选中的看板代替（D21）。
 * @returns 看板、组件当前的版本哈希与授权表。
 */
export function grantFacts(context: RouteContext, board: Board): GrantFacts {
  const hashes = new Map<string, string>()
  for (const [id, record] of context.records) hashes.set(id, record.hash)
  return { board, hashes, grants: context.grants }
}
