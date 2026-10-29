/**
 * 宿主能力的调用路由（D24）：组件经桥发来 `call`，宿主按注册表解析、鉴权、校验与回传。
 *
 * 这里没有按功能分支的代码：余额、回声或别的能力都走同一条路，形状由提供方注册的 schema 决定。
 * 超时与并发由 `provider-health.ts` 的执行器管——这一层只把连接断开的中止信号传下去，不再自己计时。
 */
import type { InstanceCallRequest } from '@dsh-widget-board/contracts'
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
 * 调一次能力：执行器的拒绝翻成状态码，提供方自己的异常回 502。
 *
 * @param context - 路由上下文。
 * @param capability - 能力的名字。
 * @param face - 发起调用的这张卡片。
 * @param args - 已经按 input schema 校验过的参数。
 * @param signal - 连接断开时中止提供方。
 * @returns 能力的返回值。
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
async function callOf(context: RouteContext, id: string, request: Parameters<Route['handle']>[1]): Promise<unknown> {
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
  const inputIssues = issuesOf(resolved.registration.input, wanted.args)
  if (inputIssues !== undefined) {
    // 参数是调用方写错的，提供方根本没有被调用：这一条不计提供方的失败（D31）。
    throw new Refusal(400, `调用 ${wanted.capability} 的参数与 input schema 不符`, { issues: inputIssues })
  }
  const controller = new AbortController()
  request.on?.('aborted', () => { controller.abort() })
  const result = await capabilityResult(context, wanted.capability, face, wanted.args, controller.signal)
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
        json(response, 200, { result: await callOf(context, id, request) })
      },
    },
  ]
}
