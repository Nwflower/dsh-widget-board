/** 将另存的组件应用到当前实例；内容、实例标识和布局保持原值。 */
import { readJson } from '../body'
import { isRecord } from '../guards'
import { recordOf } from '../library'
import { Refusal } from '../refusal'
import { json } from '../response'
import type { Route } from '../routes'
import { checkContentBudget, contentIssues, handshakeBytes } from '../content/validate'
import { stateBytes } from '../state'

export function applySourceRoute(): Route {
  return {
    method: 'POST', pattern: /^\/instance\/([^/]+)\/source$/, limit: 16384,
    async handle(context, request, response, match) {
      const id = decodeURIComponent(match[1] as string)
      const body = await readJson(request, 16384)
      if (!isRecord(body) || typeof body.widget !== 'string' || !Number.isSafeInteger(body.expectedRevision)) throw new Refusal(400, '应用组件需要 widget、expectedHash 和 expectedRevision')
      const record = recordOf(context.records, body.widget)
      if (record.hash !== body.expectedHash) throw new Refusal(409, '组件版本已经变化', { code: 'stale-hash', current: record.hash })
      const found = context.workspace.findInstance(id)
      if (found === undefined) throw new Refusal(404, '目标卡片已不存在；可以另存组件并创建新卡片')
      await context.workspace.save(found.board.id, (board) => {
        if (board.revision !== body.expectedRevision) throw new Refusal(409, '卡片在别处改变过；请保留草稿并重新读取', { code: 'stale-revision' })
        const instance = board.instances.find((entry) => entry.id === id)
        if (instance === undefined) throw new Refusal(404, '目标卡片已不存在')
        contentIssues('props', record.manifest.props, instance.props)
        if (instance.data !== null) contentIssues('data', record.manifest.data, instance.data)
        if (instance.state !== null) contentIssues('state', record.manifest.state, instance.state)
        checkContentBudget(instance.state, { requestBytes: 0, requestLimit: 16384, otherStateBytes: board.instances.reduce((sum, entry) => entry.id === id ? sum : sum + stateBytes(entry.state), 0), handshakeBytes: handshakeBytes(record.manifest, instance) })
        return { ...board, instances: board.instances.map((entry) => entry.id === id ? { ...entry, widget: body.widget as string, hash: record.hash } : entry) }
      }, { event: () => ({ type: 'board' }) })
      json(response, 200, { id, widget: record.manifest.id, hash: record.hash })
    },
  }
}
