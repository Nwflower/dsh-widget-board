/**
 * 变更通知与单卡可见性（D6、D18）：接通知的长连接，以及页面报回来的「我看得见哪几张卡」。
 *
 * 两条路由共用「观众是谁」这一个参数，所以放在一处；路由表本身留在 `routes.ts`（它还接近停止线，
 * 见 AGENTS.md 的 750 行）。通知的持有者仍是 `Live`，这里只做路由。
 */
import { EVENTS_PATH, VISIBILITY_LIMIT, VISIBILITY_MAX_ID_LENGTH, VISIBILITY_MAX_IDS, VISIBILITY_PATH, VIEWER_MAX_LENGTH, VIEWER_QUERY, isVisibilityReport } from '@dsh-widget-board/contracts'
import type { HostRequest } from '@dsh-widget-board/contracts'
import { readJson } from './body'
import { Refusal } from './refusal'
import { json } from './response'
import type { Route, RouteContext } from './routes'

/**
 * 这条请求的观众身份。
 *
 * @param request - 宿主的请求。
 * @returns 观众 id；没带或空串是老页面，宿主按「还没上报」算。
 * @throws {Refusal} 观众 id 超过上限（400）：与 POST 的上报同一个长度。
 */
function viewerOf(request: HostRequest): string | undefined {
  const url = new URL(request.url ?? '/', 'http://board.invalid')
  const viewer = url.searchParams.get(VIEWER_QUERY)
  if (viewer === null || viewer === '') return undefined
  if (viewer.length > VIEWER_MAX_LENGTH) throw new Refusal(400, `观众 id 最多 ${String(VIEWER_MAX_LENGTH)} 个字符`)
  return viewer
}

/**
 * 变更通知与可见性上报的路由。
 *
 * @returns 路由表。
 */
export function visibilityRoutes(): Route[] {
  return [
    {
      method: 'GET',
      pattern: new RegExp(`^${EVENTS_PATH}$`),
      limit: 0,
      async handle(context: RouteContext, request: HostRequest, response) {
        context.live.subscribe(response, viewerOf(request))
      },
    },
    {
      method: 'POST',
      pattern: new RegExp(`^${VISIBILITY_PATH}$`),
      limit: VISIBILITY_LIMIT,
      async handle(context: RouteContext, request: HostRequest, response) {
        const body = await readJson(request, VISIBILITY_LIMIT)
        if (!isVisibilityReport(body)) {
          throw new Refusal(400, `可见性上报的形状不对：需要 viewer 与 visible，visible 最多 ${String(VISIBILITY_MAX_IDS)} 个卡片 id，每个不超过 ${String(VISIBILITY_MAX_ID_LENGTH)} 个字符`)
        }
        // 连接已经断掉的上报不记：宿主按在线的观众算可见集合，重连的页面会自己再报一次（D6）。
        const accepted = context.live.reportVisible(body.viewer, body.visible)
        json(response, 200, { ok: true, accepted })
      },
    },
  ]
}
