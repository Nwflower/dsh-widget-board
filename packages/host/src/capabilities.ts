/**
 * 宿主能力的调用路由（D24）：组件经桥发来 `call`，宿主按注册表解析、鉴权、校验与回传。
 *
 * 这里没有按功能分支的代码：余额、回声或别的能力都走同一条路，形状由提供方注册的 schema 决定。
 */
import type { InstanceCallRequest } from '@dsh-widget-board/contracts'
import { readJson } from './body'
import { isRecord } from './guards'
import { faceOf, grantFacts, locate } from './lookup'
import { requireGrant } from './permissions'
import { Refusal } from './refusal'
import { json } from './response'
import type { Route, RouteContext } from './routes'
import { issuesOf } from './schema'

/** 一次能力调用的参数上限；桥上的消息上限是 64 KB，这里对齐。 */
export const CALL_LIMIT = 64 * 1024

/** 一次能力调用的最长等待；超时后中止提供方并回一条可见的错误（D24）。 */
export const CALL_TIMEOUT_MS = 15_000

/** 注册里 `timeoutMs` 的上限：再长就与浏览器半边的 30 秒等待撞上了。 */
export const CALL_TIMEOUT_MAX_MS = 25_000

/**
 * 这次调用等多久：注册声明的时长，缺省或越界时回到默认值。
 *
 * @param declared - 注册里的 `timeoutMs`。
 * @returns 毫秒。
 */
function waitOf(declared: unknown): number {
  if (typeof declared !== 'number' || !Number.isFinite(declared) || declared <= 0) return CALL_TIMEOUT_MS
  return Math.min(CALL_TIMEOUT_MAX_MS, Math.max(1_000, Math.round(declared)))
}

/**
 * 调用一张卡声明过的一个宿主能力。
 *
 * @param context - 路由上下文。
 * @param id - 卡片实例的 id。
 * @param request - 宿主的请求。
 * @returns 能力的返回值。
 * @throws {Refusal} 卡片、组件、声明、提供方、授权或参数/结果不一致。
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
    throw new Refusal(400, `调用 ${wanted.capability} 的参数与 input schema 不符`, { issues: inputIssues })
  }
  const controller = new AbortController()
  const onAborted = (): void => { controller.abort() }
  request.on?.('aborted', onAborted)
  const timer = setTimeout(() => { controller.abort() }, waitOf(resolved.registration.timeoutMs))
  let result: unknown
  try {
    result = await context.sources.callCapability(wanted.capability, face, wanted.args, controller.signal)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Refusal(
      controller.signal.aborted ? 504 : 502,
      controller.signal.aborted ? `调用 ${wanted.capability} 超时或被取消` : `能力 ${wanted.capability} 调用失败：${message}`,
    )
  } finally {
    clearTimeout(timer)
  }
  const outputIssues = issuesOf(resolved.registration.output, result)
  if (outputIssues !== undefined) {
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
