import type { CampusItem } from './campus'

export type ImportFormat = 'csv' | 'ics'
export type ImportDecision = 'skip' | 'update' | 'keep'
export type ImportField = 'kind' | 'title' | 'category' | 'due' | 'dateOnly' | 'timeZone' | 'status' | 'url' | 'note' | 'uid' | 'offset'
export interface ItemImportRequest {
  format: ImportFormat
  text: string
  mapping?: Partial<Record<ImportField, string>>
  mappingConfirmed?: boolean
  timeZone: string
  floatingConfirmed?: boolean
  unknownZoneConfirmed?: boolean
  rangeStart?: string
  rangeEnd?: string
  edits?: Record<string, Partial<Record<ImportField, string>>>
  decisions?: Record<string, ImportDecision>
}
export interface ItemImportRow {
  row: number
  fields: Partial<Record<ImportField, string>>
  item?: CampusItem
  error?: string
  duplicateId?: string
  changes?: string[]
}
export interface ItemImportPreview {
  previewId?: string
  revision: number
  headers: string[]
  rows: ItemImportRow[]
  warnings: string[]
  selected: number
  total: number
  stateBytes: number
  errors: string[]
  expiresAt?: number
}
export interface ItemImportCommit {
  previewId: string
  expectedRevision: number
  decisions: Record<string, ImportDecision>
}
