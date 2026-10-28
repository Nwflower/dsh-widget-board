import { CLIENT_ROUTE } from '@dsh-widget-board/contracts'
import type { ItemImportPreview, ItemImportRequest, ImportDecision } from '@dsh-widget-board/contracts/item-import'

const path = (id: string): string => `${CLIENT_ROUTE}/instance/${encodeURIComponent(id)}/items`
async function result<T>(response: Response): Promise<T> {
  const value = await response.json()
  if (!response.ok) throw new Error(value.error || `HTTP ${response.status}`)
  return value as T
}
export async function previewItems(id: string, request: ItemImportRequest): Promise<ItemImportPreview> {
  return result(await fetch(`${path(id)}/import-preview`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) }))
}
export async function releaseItems(id: string, previewId: string): Promise<void> {
  const response = await fetch(`${path(id)}/import-preview/${encodeURIComponent(previewId)}`, { method: 'DELETE' })
  // 十分钟后宿主已经移除该预览，取消操作仍然完成；其余错误继续向用户显示。
  if (response.status !== 404) await result(response)
}
export async function commitItems(id: string, preview: ItemImportPreview, decisions: Record<string, ImportDecision>): Promise<void> {
  await result(await fetch(`${path(id)}/import-commit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ previewId: preview.previewId, expectedRevision: preview.revision, decisions }) }))
}
export interface Download { name: string, mime: string, text: string, count?: number }
export async function exportFile(id: string, format: string, filter: string): Promise<Download> {
  return result(await fetch(format === 'template' ? `${CLIENT_ROUTE}/items/csv-template` : `${path(id)}/export/${format}?${filter}`))
}
export function downloadFile(file: Download): void {
  const url = URL.createObjectURL(new Blob([file.text], { type: file.mime }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = file.name
  anchor.click()
  setTimeout(() => { URL.revokeObjectURL(url) }, 1000)
}
