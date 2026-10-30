/**
 * 宿主能力的调用路由（D24）：组件经桥发来 `call`，宿主按注册表解析、鉴权、校验与回传。
 *
 * 这里没有按功能分支的代码：余额、回声或别的能力都走同一条路，形状由提供方注册的 schema 决定。
 * 超时与并发由 `provider-health.ts` 的执行器管——这一层只把连接断开的中止信号传下去，不再自己计时。
 */
import type { InstanceCallRequest } from '@dsh-widget-board/contracts'
import { withRequestSignal } from '@dsh-widget-board/contracts'
import { readJson } from './body'
import { isRecord } from './guards'
import { refusalOf } from './instance-operations'
import { faceOf, grantFacts, locate } from './lookup'
import { requireGrant } from './permissions'
import { ProviderCallError } from './provider-health'
import { Refusal } from './refusal'
import { json } from './response'
import type { Route, RouteContext } from './routes'
import { issuesOf } from './schema'

/** 一次能力调用的参数上限；桥上的消息上限是 64 KB，这里对齐。 */
export const CALL_LIMIT = 64 * 1024

/**
 * 调一次能力：执行器的拒绝翻成状态码，宿主自己的拒绝原样透出，提供方自己的异常回 502。
 *
 * @param context - 路由上下文。
 * @param capability - 能力的名字。
 * @param face - 发起调用的这张卡片。
 * @param args - 已经按 input schema 校验过的参数。
 * @param signal - 连接断开时中止提供方。
 * @returns 能力的返回值。
 * @throws {Refusal} 执行器的拒绝（504、429）、宿主自己的拒绝（400、403 等），或提供方的异常（502）。
 */
async function capabilityResult(
  context: RouteContext,
  capability: string,
  face: ReturnType<typeof faceOf>,
  args: unknown,
  signal: AbortSignal,
): Promise<unknown> {
  try {
    return await context.sources.callCapability(capability, face, args, signal)
  } catch (error) {
    // 宿主自己的拒绝（源不在白名单、缺授权、组件不在库里、数据不合 schema）是调用方或请求的问题：
    // 它带着自己的状态码与原因码原样回去，只有提供方真正抛出来的异常才翻成 502（D31）。
    if (error instanceof Refusal) throw error
    if (error instanceof ProviderCallError) refusalOf(error)
    throw new Refusal(502, `能力 ${capability} 调用失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * 调用一张卡声明过的一个宿主能力。
 *
 * @param context - 路由上下文。
 * @param id - 卡片实例的 id。
 * @param request - 宿主的请求。
 * @returns 能力的返回值。
 * @throws {Refusal} 卡片、组件、声明、提供方、授权、参数/结果不一致，或超时与并发已满。
 */
async function callOf(context: RouteContext, id: string, request: Parameters<Route['handle']>[1], response: Parameters<Route['handle']>[2]): Promise<unknown> {
  const found = locate(context, id)
  const face = faceOf(found.board, id)
  const body = await readJson(request, CALL_LIMIT)
  if (!isRecord(body) || typeof body.capability !== 'string' || body.capability === '') {
    throw new Refusal(400, '调用要写明 capability')
  }
  const wanted = body as unknown as InstanceCallRequest
  const record = context.records.get(face.widget)
  if (record === undefined) throw new Refusal(400, '这张卡的组件不在组件库里，先把它装回来')
  if (record.manifest.capabilities?.includes(wanted.capability) !== true) {
    throw new Refusal(400, `组件没有声明能力 ${wanted.capability}`)
  }
  const resolved = context.sources.resolveCapability(wanted.capability)
  if (resolved === undefined) throw new Refusal(400, `没有能力 ${wanted.capability}，提供它的插件可能没有安装`)
  requireGrant(grantFacts(context, found.board), id, 'capability', wanted.capability, resolved.registration.permission, resolved.provider)
  // 桥上的 args 是可选的（contracts 的 call 签名）：声明了 input schema 时，没给按一个空对象校验与
  // 执行，于是不声明参数的能力可以整个省略，声明了必填项的按缺项拒绝；没声明 schema 的能力保持收到
  // undefined，既有提供方按「没有参数」写的那种行为不变。
  const args = wanted.args ?? (resolved.registration.input === undefined ? undefined : {})
  const inputIssues = issuesOf(resolved.registration.input, args)
  if (inputIssues !== undefined) {
    // 参数是调用方写错的，提供方根本没有被调用：这一条不计提供方的失败（D31）。
    throw new Refusal(400, `调用 ${wanted.capability} 的参数与 input schema 不符`, { issues: inputIssues })
  }
  const result = await withRequestSignal(request, response, async signal => await capabilityResult(context, wanted.capability, face, args, signal))
  const outputIssues = issuesOf(resolved.registration.output, result)
  if (outputIssues !== undefined) {
    // 提供方跑完了但交出来的东西不合 schema：这是它的一次失败，记一次，不再叠加（D31）。
    context.sources.health.failed(resolved.provider, 'provider-output', `能力 ${wanted.capability} 的结果与 output schema 不符`)
    throw new Refusal(502, `能力 ${wanted.capability} 的结果与 output schema 不符`, { issues: outputIssues })
  }
  return result ?? null
}

/**
 * 能力调用路由。
 *
 * @returns 路由表。
 */
export function capabilityRoutes(): Route[] {
  return [
    {
      method: 'POST',
      pattern: /^\/instance\/([^/]+)\/call$/,
      limit: CALL_LIMIT,
      async handle(context, request, response, match) {
        const id = decodeURIComponent(match[1] as string)
        json(response, 200, { result: await callOf(context, id, request, response) })
      },
    },
  ]
}
