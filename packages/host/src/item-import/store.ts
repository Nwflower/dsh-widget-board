import { randomUUID } from 'node:crypto'
import type { ItemImportRow } from '@dsh-widget-board/contracts/item-import'
import type { RouteContext } from '../routes'
import { Refusal } from '../refusal'

export interface ImportSession { target: string, hash: string, revision: number, rows: ItemImportRow[], expiresAt: number }
const sessions = new WeakMap<RouteContext, Map<string, ImportSession>>()
function live(context: RouteContext): Map<string, ImportSession> {
  let store = sessions.get(context)
  if (!store) { store = new Map(); sessions.set(context, store) }
  for (const [id, item] of store) if (item.expiresAt <= Date.now()) store.delete(id)
  return store
}
export function retainPreview(context: RouteContext, session: Omit<ImportSession, 'expiresAt'>): { previewId: string, expiresAt: number } {
  const store = live(context)
  if (store.size >= 8) throw new Refusal(429, '未确认预览达到8份，请取消旧预览或等待十分钟')
  const previewId = randomUUID()
  const expiresAt = Date.now() + 10 * 60 * 1000
  store.set(previewId, { ...session, expiresAt })
  return { previewId, expiresAt }
}
export function storedPreview(context: RouteContext, id: string, target: string): ImportSession {
  const item = live(context).get(id)
  if (!item || item.target !== target) throw new Refusal(404, '预览不存在、已过期或不属于此实例')
  return item
}
export function releasePreview(context: RouteContext, id: string, target: string): void {
  storedPreview(context, id, target)
  live(context).delete(id)
}
