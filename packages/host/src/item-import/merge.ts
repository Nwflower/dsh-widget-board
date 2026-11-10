import type { CampusItem } from '@dsh-widget-board/contracts/campus'
import type { ImportDecision, ItemImportRow } from '@dsh-widget-board/contracts/item-import'
import type { CampusState } from '@dsh-widget-board/model/campus/types'
import { campusState } from '@dsh-widget-board/model/campus/model'
import { duplicateKey } from './common'

export function matchRows(rows: ItemImportRow[], state: CampusState): ItemImportRow[] {
  const existing = new Map(state.items.map(item => [duplicateKey(item), item]))
  for (const item of state.items) if (!item.sourceUid) existing.set(`uid:${JSON.stringify([item.id, 'local'])}`, item)
  return rows.map(row => {
    if (!row.item) return row
    const key = duplicateKey(row.item)
    const previous = existing.get(key)
    if (!previous) { existing.set(key, row.item); return row }
    const changes = (['kind', 'title', 'category', 'due', 'url', 'note'] as const)
      .filter(field => JSON.stringify(previous[field]) !== JSON.stringify(row.item![field]))
      .map(field => `${field}: ${JSON.stringify(previous[field] ?? '')} → ${JSON.stringify(row.item![field] ?? '')}`)
    return { ...row, duplicateId: previous.id, changes }
  })
}
export function planImport(rows: ItemImportRow[], current: CampusState, decisions: Record<string, ImportDecision>) {
  const items: CampusItem[] = [...current.items]
  const errors: string[] = []
  let selected = 0
  for (const row of rows) {
    const mode = decisions[String(row.row)] ?? (row.duplicateId ? 'skip' : 'keep')
    if (mode === 'skip') continue
    selected += 1
    if (!row.item || row.error) { errors.push(`第${row.row}项：${row.error ?? '内容不合法'}`); continue }
    const at = items.findIndex(item => item.id === row.duplicateId || duplicateKey(item) === duplicateKey(row.item!))
    if (mode === 'update' && at >= 0) {
      const previous = items[at]!
      items[at] = { ...row.item, id: previous.id, status: previous.status, createdAt: previous.createdAt }
    } else items.push(row.item)
  }
  const state: CampusState = { ...current, items }
  const bytes = Buffer.byteLength(JSON.stringify(state))
  try { campusState(state) } catch (error) {
    // 预览需要同时呈现容量和逐行错误；此处不进行任何持久写入。
    errors.push((error as Error).message)
  }
  return { state, errors, selected, total: items.length, stateBytes: bytes }
}
