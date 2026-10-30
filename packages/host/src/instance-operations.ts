/**
 * 卡片的数据读取与动作执行（D6、D31、D24）：路由只做 HTTP 适配，读、校验、写入与失败翻译都在这里。
 *
 * 定时刷新、手动读、工具读与加卡片时的第一次读走同一个 `loadData`：授权检查、schema 校验、超时与并
 * 发限制因此只有一处。超时与并发交给 `provider-health.ts` 的执行器；提供方的数据不合组件 schema 算它
 * 的一次失败，记在这条读取路径上，写入路径不再重复计数。
 */
import type { Board, BoardInstance } from '@dsh-widget-board/contracts'
import { faceOf, grantFacts, locate } from './lookup'
import { requireGrant } from './permissions'
import { ProviderCallError } from './provider-health'
import { Refusal } from './refusal'
import type { RouteContext } from './routes'
import { dataError } from './schema'
import { withInstanceData } from './state'

/**
 * 把执行器的拒绝翻成响应（D31）：超时 504、并发已满 429，其余原样抛出。
 *
 * `code` 与 `provider` 跟着响应回去：卡片照现有故障显示画出来，用户看得出是哪个提供方、等了多久。
 *
 * @param error - 执行器抛出的那一个。
 * @throws {Refusal} 执行器拒绝的那两种情形。
 */
export function refusalOf(error: unknown): never {
  if (error instanceof ProviderCallError) {
    throw new Refusal(error.code === 'provider-busy' ? 429 : 504, error.message, { code: error.code, provider: error.provider })
  }
  throw error
}

/**
 * 把已经核对过的数据交给唯一的写入者（D5）。
 *
 * 只给校验过的数据用：提供方的数据在 `loadData` 里核对过，push 的数据在 `saveData` 里核对过，所以这
 * 里不再看 schema——同一份数据在一处失败，不会在两处各记一次。
 *
 * @param context - 路由上下文。
 * @param id - 卡片实例的 id。
 * @param data - 已经核对过的数据。
 */
export async function storeData(context: RouteContext, id: string, data: unknown, signal?: AbortSignal): Promise<void> {
  const { board } = locate(context, id)
  await context.workspace.save(board.id, (current) => {
    signal?.throwIfAborted()
    return withInstanceData(current, id, data)
  }, {
    event: () => ({ type: 'instance', id, data }),
  })
}

/**
 * 把一份推给卡片的数据写进去：先按组件的 data schema 核对，再交给唯一的写入者（D6、D17）。
 *
 * push 的数据走这一条；提供方读出来的数据由 `loadData` 核对，不经过这里，因此不会被算成推数据的
 * 失败。卡片上存着的静态数据不经这条路径，同样不记到任何提供方名下。
 *
 * @param context - 路由上下文。
 * @param id - 卡片实例的 id。
 * @param data - 推给卡片的数据。
 * @throws {Refusal} 看板上没有这张卡，或数据与 schema 不符。
 */
export async function saveData(context: RouteContext, id: string, data: unknown): Promise<void> {
  const { instance } = locate(context, id)
  const problem = dataError(context.records.get(instance.widget)?.manifest.data, data)
  if (problem !== undefined) throw new Refusal(400, problem)
  await storeData(context, id, data)
}

/**
 * 读一张卡的数据，不写进看板：读、校验与写入分开，批量读取才能把同一块看板的几次写合成一次（D6）。
 *
 * @param context - 路由上下文。
 * @param id - 卡片实例的 id。
 * @param source - 数据源的名字；省略时用卡片绑定的那个。
 * @param signal - 连接断开时中止提供方；定时刷新没有这一项。
 * @returns 那张卡、它所在的看板与读出来的数据。
 * @throws {Refusal} 看板上没有这张卡、这张卡没有数据源、数据源不在、没有授权、读取超时、并发已满，或
 * 提供方交出来的数据与组件的 data schema 不符；最后这一种同时按提供方记一次失败（D31）。
 */
export async function loadData(
  context: RouteContext,
  id: string,
  source?: string,
  signal?: AbortSignal,
): Promise<{ board: Board, instance: BoardInstance, data: unknown }> {
  const { board, instance } = locate(context, id)
  const face = faceOf(board, id)
  const asked = source ?? instance.source
  if (asked === undefined || asked === '') throw new Refusal(400, `这张卡没有数据源：${id}`)
  const resolved = context.sources.resolveDataSource(asked)
  if (resolved === undefined) throw new Refusal(400, `没有数据源 ${asked}，提供它的插件可能没有安装`)
  requireGrant(grantFacts(context, board), id, 'source', asked, resolved.registration.permission, resolved.provider)
  let data: unknown
  try {
    data = await context.sources.readSource(asked, face, signal)
  } catch (error) {
    return refusalOf(error)
  }
  // 提供方交出来的数据先按组件的 data schema 核对（D6）：不合格算它的一次失败，只在这一处记。
  const problem = dataError(context.records.get(instance.widget)?.manifest.data, data)
  if (problem !== undefined) {
    // dataError 交出来的已经是一整句「数据与组件的 data schema 不符：…」：两处都直接用这一句，卡片与
    // 设置页各自读到一遍，同一句话不在文案里出现两次。
    context.sources.health.failed(resolved.provider, 'provider-output', `数据源 ${asked} 交出来的数据不合格：${problem}`)
    throw new Refusal(400, problem)
  }
  return { board, instance, data }
}

/**
 * 让一张卡按绑定的数据源读一次，把数据写进卡片（D6、D17）。
 *
 * 手动读、工具读与加卡片时的第一次读走这一条；定时刷新共用同一段读取与校验，再把同一块看板的结果
 * 合成一次写入（`batch-reads.ts`）。校验已经在 `loadData` 里做过，写入这一步不再看 schema。
 *
 * @param context - 路由上下文。
 * @param id - 卡片实例的 id。
 * @param source - 数据源的名字；省略时用卡片绑定的那个。
 * @param signal - 连接断开时中止提供方。
 * @returns 读回来的数据。
 * @throws {Refusal} 读不出来的那几种情形，与 `loadData` 相同。
 */
export async function readInto(context: RouteContext, id: string, source?: string, signal?: AbortSignal): Promise<unknown> {
  const { data } = await loadData(context, id, source, signal)
  await storeData(context, id, data, signal)
  return data
}

/**
 * 执行一张卡声明过的一个动作（D6）。
 *
 * 组件没声明、提供方不在、缺授权都拒绝；提供方跑失败时原因原样回给卡片，用户不必去翻日志（D11）。
 *
 * @param context - 路由上下文。
 * @param id - 卡片实例的 id。
 * @param actionId - 动作的名字。
 * @param payload - 组件送来的值，原样转给动作。
 * @param signal - 连接断开时中止提供方。
 * @returns 动作的结果。
 * @throws {Refusal} 组件没声明这个动作、提供方不在、没有授权，或超时、并发已满。
 */
export async function runAction(
  context: RouteContext,
  id: string,
  actionId: string,
  payload: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  const found = locate(context, id)
  const face = faceOf(found.board, id)
  const declared = context.records.get(face.widget)?.manifest.actions?.some((action) => action.id === actionId) === true
  if (!declared) throw new Refusal(400, `组件没有声明动作 ${actionId}`)
  const resolved = context.sources.resolveAction(actionId)
  if (resolved === undefined) throw new Refusal(400, `没有动作 ${actionId}，提供它的插件可能没有安装`)
  requireGrant(grantFacts(context, found.board), id, 'action', actionId, resolved.registration.permission, resolved.provider)
  try {
    return await context.sources.runAction(actionId, face, payload, signal)
  } catch (error) {
    return refusalOf(error)
  }
}
