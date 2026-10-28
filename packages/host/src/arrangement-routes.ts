/** 看板排列偏好的提交，与自由布局共用修订号与字节上限。 */
import type { Arrangement, BoardArrangementRequest } from '@dsh-widget-board/contracts'
import { LAYOUT_LIMIT, boardById, type Route } from './routes'
import { isRecord } from './guards'
import { isArrangement, StaleRevisionError, withBoardArrangement } from './state'
import { readJson } from './body'
import { Refusal } from './refusal'
import { json } from './response'
import { workspaceSnapshot } from './snapshot'

/**
 * 一份排列偏好提交的外形：期望的布局修订号是非负整数，排列偏好由状态层逐项校验（D31）。
 *
 * @param value - 解出来的请求体。
 * @returns 可以当 `BoardArrangementRequest` 用时为真。
 */
function isBoardArrangementRequest(value: unknown): value is BoardArrangementRequest {
  if (!isRecord(value)) return false
  const { expectedLayoutRevision, arrangement } = value
  return Number.isSafeInteger(expectedLayoutRevision) && (expectedLayoutRevision as number) >= 0 && isArrangement(arrangement)
}

/** 每次请求构建路由表时读取共享上限。 */
export function arrangementRoutes(): Route[] {
  return [
  {
    method: 'POST',
    pattern: /^\/boards\/([^/]+)\/arrangement$/,
    limit: LAYOUT_LIMIT,
    async handle(context, request, response, match) {
      const id = decodeURIComponent(match[1] as string)
      boardById(context, id)
      const body = await readJson(request, LAYOUT_LIMIT)
      if (!isBoardArrangementRequest(body)) throw new Refusal(400, '排列提交的形状不对：需要 expectedLayoutRevision 与 arrangement')
      const wanted = body.arrangement
      try {
        let saved: Arrangement = wanted
        const next = await context.workspace.save(id, (current) => {
          const changed = withBoardArrangement(current, wanted)
          saved = changed.arrangement as Arrangement
          return changed
        }, {
          expectedLayoutRevision: body.expectedLayoutRevision,
          layoutChanged: true,
          event: (savedBoard, board) => ({ type: 'arrangement', board, layoutRevision: savedBoard.layoutRevision, arrangement: savedBoard.arrangement as Arrangement }),
        })
        json(response, 200, { layoutRevision: next.layoutRevision, arrangement: saved })
      } catch (error) {
        if (error instanceof StaleRevisionError) {
          json(response, 409, workspaceSnapshot(context))
          return
        }
        throw error
      }
    },
  },
  ]
}
