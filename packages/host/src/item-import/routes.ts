/** 文件仅在宿主内解析，预览不写磁盘；确认在同一工作区队列内再次检查修订号、schema与全部预算。 */
import type { ItemImportRequest, ItemImportCommit, ImportDecision, ItemImportPreview } from '@dsh-widget-board/contracts/item-import'
import type { CampusState } from '@dsh-widget-board/model/campus/types'
import { campusState, isCampusSchema } from '@dsh-widget-board/model/campus/model'
import { validZone } from '@dsh-widget-board/model/campus/time'
import type { Route, RouteContext } from '../routes'
import { isRecord } from '../guards'
import { locate } from '../lookup'
import { Refusal } from '../refusal'
import { readJson } from '../body'
import { json } from '../response'
import { contentIssues, checkContentBudget, handshakeBytes } from '../content/validate'
import { stateBytes } from '../state'
import { parseCsv } from './csv'
import { parseIcs } from './ics'
import { CSV_FIELDS, FILE_LIMIT } from './common'
import { matchRows, planImport } from './merge'
import { exportItems, csvTemplate } from './export'
import { releasePreview, retainPreview, storedPreview } from './store'

const PREVIEW_LIMIT = FILE_LIMIT * 6 + 64 * 1024
const COMMIT_LIMIT = 256 * 1024
function target(context: RouteContext, id: string) {
  const found = locate(context, id)
  const record = context.records.get(found.instance.widget)
  if (!record || !isCampusSchema(record.manifest.state)) throw new Refusal(400, '此实例没有声明校园事项结构')
  return { ...found, record }
}
function choices(raw: unknown): Record<string, ImportDecision> {
  if (!isRecord(raw) || Object.keys(raw).length > 10000 || Object.entries(raw).some(([key, value]) => !/^[1-9]\d{0,4}$/.test(key) || !['skip', 'keep', 'update'].includes(String(value)))) throw new Refusal(400, '逐行选择不合法')
  return raw as Record<string, ImportDecision>
}
function parseRequest(raw: unknown): ItemImportRequest {
  if (!isRecord(raw) || !['csv', 'ics'].includes(String(raw.format)) || typeof raw.text !== 'string' || typeof raw.timeZone !== 'string' || !validZone(raw.timeZone)) throw new Refusal(400, '需要CSV/ICS文本及有效IANA时区')
  if (Buffer.byteLength(raw.text) > FILE_LIMIT) throw new Refusal(413, '文件超过2MiB')
  if (raw.mapping !== undefined && (!isRecord(raw.mapping) || Object.entries(raw.mapping).some(([key, value]) => !CSV_FIELDS.includes(key as typeof CSV_FIELDS[number]) || typeof value !== 'string'))) throw new Refusal(400, '字段映射不合法')
  for (const key of ['mappingConfirmed', 'floatingConfirmed', 'unknownZoneConfirmed']) if (raw[key] !== undefined && typeof raw[key] !== 'boolean') throw new Refusal(400, `${key}必须是确认开关`)
  for (const key of ['rangeStart', 'rangeEnd']) if (raw[key] !== undefined && (typeof raw[key] !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw[key] as string))) throw new Refusal(400, '展开日期范围不合法')
  if (raw.edits !== undefined && (!isRecord(raw.edits) || Object.entries(raw.edits).some(([key, fields]) => !/^[1-9]\d{0,4}$/.test(key) || !isRecord(fields) || Object.entries(fields).some(([field, value]) => ![...CSV_FIELDS, 'offset'].includes(field) || typeof value !== 'string')))) throw new Refusal(400, '逐行修改不合法')
  if (raw.decisions !== undefined) choices(raw.decisions)
  return raw as unknown as ItemImportRequest
}
function budget(context: RouteContext, id: string, state: CampusState): void {
  const found = target(context, id)
  contentIssues('state', found.record.manifest.state, state)
  checkContentBudget(state, {
    requestBytes: 0, requestLimit: COMMIT_LIMIT,
    otherStateBytes: found.board.instances.reduce((sum, instance) => sum + (instance.id === id ? 0 : stateBytes(instance.state)), 0),
    handshakeBytes: handshakeBytes(found.record.manifest, { props: found.instance.props, data: found.instance.data, state }),
  })
}

export function itemImportRoutes(context: RouteContext): Route[] {
  return [
    {
      method: 'POST', pattern: /^\/instance\/([^/]+)\/items\/import-preview$/, limit: PREVIEW_LIMIT,
      async handle(_context, request, response, match) {
        const id = decodeURIComponent(match[1]!)
        const found = target(context, id)
        const raw = parseRequest(await readJson(request, PREVIEW_LIMIT))
        let parsed: ReturnType<typeof parseCsv>
        try { parsed = raw.format === 'csv' ? parseCsv(raw, new Date().toISOString()) : parseIcs(raw, new Date().toISOString()) } catch (error) {
          // 整个文件不能解析时仍向导入表面返回原因，不进入正式保存队列。
          throw new Refusal(400, (error as Error).message)
        }
        const state = campusState(found.instance.state)
        const rows = matchRows(parsed.rows, state)
        const plan = planImport(rows, state, raw.decisions ?? {})
        try { budget(context, id, plan.state) } catch (error) {
          // 预览并列展示所有行与容量错误；确认接口仍会独立拒绝同一错误。
          plan.errors.push((error as Error).message)
        }
        const session = rows.length ? retainPreview(context, { target: id, hash: found.record.hash, revision: found.board.revision, rows }) : {}
        const result: ItemImportPreview = { ...session, revision: found.board.revision, ...parsed, rows, selected: plan.selected, total: plan.total, stateBytes: plan.stateBytes, errors: [...new Set(plan.errors)] }
        json(response, 200, result)
      },
    },
    {
      method: 'DELETE', pattern: /^\/instance\/([^/]+)\/items\/import-preview\/([^/]+)$/, limit: 0,
      async handle(_context, _request, response, match) {
        releasePreview(context, decodeURIComponent(match[2]!), decodeURIComponent(match[1]!))
        json(response, 200, { removed: true })
      },
    },
    {
      method: 'POST', pattern: /^\/instance\/([^/]+)\/items\/import-commit$/, limit: COMMIT_LIMIT,
      async handle(_context, request, response, match) {
        const id = decodeURIComponent(match[1]!)
        const raw = await readJson(request, COMMIT_LIMIT)
        if (!isRecord(raw) || typeof raw.previewId !== 'string' || !Number.isSafeInteger(raw.expectedRevision) || Object.keys(raw).some(key => !['previewId', 'expectedRevision', 'decisions'].includes(key))) throw new Refusal(400, '确认只接受预览标识、修订号和逐行选择')
        const decision = choices(raw.decisions)
        const wanted = raw as unknown as ItemImportCommit
        const session = storedPreview(context, wanted.previewId, id)
        const found = target(context, id)
        if (Object.keys(decision).some(row => !session.rows.some(item => item.row === Number(row)))) throw new Refusal(400, '选择引用了不存在的候选')
        let finalState: CampusState | undefined
        const saved = await context.workspace.save(found.board.id, current => {
          if (current.revision !== wanted.expectedRevision || wanted.expectedRevision !== session.revision || found.record.hash !== session.hash) throw new Refusal(409, '内容或组件已改变，请保留预览并重新匹配后再次确认', { code: 'stale-revision', revision: current.revision })
          const instance = current.instances.find(entry => entry.id === id)
          if (!instance) throw new Refusal(404, '目标实例已被删除')
          const plan = planImport(session.rows, campusState(instance.state), decision)
          if (!plan.selected) throw new Refusal(400, '没有选中任何候选')
          if (plan.errors.length) throw new Refusal(plan.total > 100 || plan.stateBytes > 64 * 1024 ? 413 : 400, plan.errors.join('；'))
          campusState(plan.state)
          budget(context, id, plan.state)
          finalState = plan.state
          return { ...current, instances: current.instances.map(entry => entry.id === id ? { ...entry, state: finalState } : entry) }
        }, { event: () => ({ type: 'instance', id, state: finalState }) })
        releasePreview(context, wanted.previewId, id)
        json(response, 200, { revision: saved.revision, state: finalState })
      },
    },
    {
      method: 'GET', pattern: /^\/instance\/([^/]+)\/items\/export\/(csv|ics)$/, limit: 0,
      async handle(_context, request, response, match) {
        const found = target(context, decodeURIComponent(match[1]!))
        const params = new URL(request.url ?? '/', 'http://localhost').searchParams
        const kind = params.get('kind') ?? 'all'
        if (!['all', 'deadline', 'milestone'].includes(kind)) throw new Refusal(400, '导出筛选不合法')
        const items = campusState(found.instance.state).items.filter(item => (kind === 'all' || item.kind === kind) && (item.status === 'todo' || params.get(item.status) === 'true'))
        json(response, 200, exportItems(items, match[2] as 'csv' | 'ics'))
      },
    },
    { method: 'GET', pattern: /^\/items\/csv-template$/, limit: 0, async handle(_context, _request, response) { json(response, 200, { name: 'campus-template.csv', mime: 'text/csv;charset=utf-8', text: csvTemplate() }) } },
  ]
}
