/** 文件内容始终按数据处理；解析错误逐行保留，正式写入仍由共享校园模型校验。 */
import { createHash, randomUUID } from 'node:crypto'
import { DateTime } from 'luxon'
import type { CampusItem, Due } from '@dsh-widget-board/contracts/campus'
import type { ImportField, ItemImportRequest, ItemImportRow } from '@dsh-widget-board/contracts/item-import'
import { campusState, EMPTY_CAMPUS_STATE } from '@dsh-widget-board/model/campus/model'
import { dueFromInput, validZone } from '@dsh-widget-board/model/campus/time'

export const FILE_LIMIT = 2 * 1024 * 1024
export const CANDIDATE_LIMIT = 10000
export const CSV_FIELDS: ImportField[] = ['kind', 'title', 'category', 'due', 'dateOnly', 'timeZone', 'status', 'url', 'note', 'uid']
export function sourceKey(uid: string, occurrence: string): string | undefined {
  return uid ? uid.startsWith('dsh-source:') ? uid.slice(11) : JSON.stringify([uid, occurrence]) : undefined
}
export function importDue(fields: Partial<Record<ImportField, string>>, fallback: string): Due {
  const zone = fields.timeZone || fallback
  const value = fields.due ?? ''
  if (!validZone(zone)) throw new Error('需要有效的 IANA 时区')
  if (fields.dateOnly === 'true') return dueFromInput('date', value, '', zone)
  if (fields.dateOnly && fields.dateOnly !== 'false') throw new Error('dateOnly 只能是 true 或 false')
  if (/([zZ]|[+-]\d{2}:\d{2})$/.test(value)) {
    const time = DateTime.fromISO(value, { setZone: true })
    if (!time.isValid) throw new Error('精确时刻不合法')
    return { kind: 'instant', at: time.toUTC().toISO() as string, timeZone: zone }
  }
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})$/.exec(value)
  if (!match) throw new Error('精确时刻需要日期、小时和分钟；全天请设置 dateOnly=true')
  return dueFromInput('instant', match[1]!, match[2]!, zone, fields.offset)
}
export function importRow(row: number, original: Partial<Record<ImportField, string>>, request: ItemImportRequest, now: string, source: string, sourceUid?: string, error?: string): ItemImportRow {
  const fields = { ...original, ...request.edits?.[String(row)] }
  try {
    if (error) throw new Error(error)
    const due = importDue(fields, request.timeZone)
    const item = {
      id: randomUUID(), kind: fields.kind || 'deadline', title: fields.title ?? '', category: fields.category ?? '', due,
      status: fields.status || 'todo', url: fields.url || undefined, note: fields.note || undefined,
      source, sourceUid: sourceUid ?? sourceKey(fields.uid ?? '', due.kind === 'date' ? due.date : due.at), createdAt: now, updatedAt: now,
    } as CampusItem
    campusState({ ...EMPTY_CAMPUS_STATE, items: [item] })
    return { row, fields, item }
  } catch (caught) {
    // 无效候选必须留在预览中，由用户修正或明确取消选中。
    return { row, fields, error: (caught as Error).message }
  }
}
export function duplicateKey(item: CampusItem): string {
  if (item.sourceUid) return `uid:${item.sourceUid}`
  return createHash('sha256').update(JSON.stringify([item.kind, item.title.trim().normalize('NFKC').replace(/\s+/g, ' '), item.due, item.url ?? ''])).digest('hex')
}
