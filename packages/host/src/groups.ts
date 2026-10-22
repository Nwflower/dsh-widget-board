/**
 * 组卡换槽（D27）：把一个槽里的组件换成组件库里的另一个，另一个槽不动。
 *
 * 组卡仍是两条普通实例共享一个盒子（D19）；换槽只改其中一条的组件、版本、props、数据、状态与数据源，
 * 再按两个槽当前组件的最小盒子把共享盒子抬一次。写入走工作区唯一的写入链，推一整份新快照。
 */
import type { GroupSide, GroupSlotRequest } from '@dsh-widget-board/contracts'
import { GROUP_SIDES } from '@dsh-widget-board/contracts'
import { readJson } from './body'
import { isRecord } from './guards'
import { Refusal } from './refusal'
import { json } from './response'
import type { Route, RouteContext } from './routes'
import { workspaceSnapshot } from './snapshot'
import { withGroupSlotReplaced } from './state'

/** 换槽请求上限：一个组件 id 与一个侧别。 */
const SLOT_LIMIT = 4 * 1024

/**
 * 组卡换槽的路由。
 *
 * @returns 路由表。
 */
export function groupRoutes(): Route[] {
  return [
    {
      method: 'POST',
      pattern: /^\/group\/([^/]+)\/slot$/,
      limit: SLOT_LIMIT,
      async handle(context: RouteContext, request, response, match) {
        const id = decodeURIComponent(match[1] as string)
        const body = await readJson(request, SLOT_LIMIT)
        if (!isRecord(body) || typeof body.side !== 'string' || typeof body.widget !== 'string' || body.widget === '') {
          throw new Refusal(400, '换槽要写明 side（front 或 back）与 widget')
        }
        const wanted = body as unknown as GroupSlotRequest
        if (!(GROUP_SIDES as readonly string[]).includes(wanted.side)) {
          throw new Refusal(400, `side 只能是 ${GROUP_SIDES.join(' 或 ')}`)
        }
        const board = context.workspace.findGroup(id)
        if (board === undefined) throw new Refusal(404, `看板上没有这一组：${id}`)
        const side: GroupSide = wanted.side
        const slot = board.instances.some((instance) => instance.group?.id === id && instance.group.side === side)
        if (!slot) throw new Refusal(404, `看板上没有这一组的 ${side} 槽：${id}`)
        const record = context.records.get(wanted.widget)
        if (record === undefined) throw new Refusal(400, `组件库里没有可用的组件 ${wanted.widget}`)
        await context.workspace.save(board.id, (current) => withGroupSlotReplaced(
          current,
          id,
          side,
          record,
          (widget) => context.records.get(widget)?.manifest.minBox,
        ), { layoutChanged: true, event: () => ({ type: 'board' }) })
        json(response, 200, { snapshot: workspaceSnapshot(context) })
      },
    },
  ]
}
