import Papa from 'papaparse'
import type { ItemImportRequest, ItemImportRow } from '@dsh-widget-board/contracts/item-import'
import { CANDIDATE_LIMIT, CSV_FIELDS, importRow } from './common'

export function parseCsv(request: ItemImportRequest, now: string): { headers: string[], rows: ItemImportRow[], warnings: string[] } {
  const parsed = Papa.parse<string[]>(request.text, { skipEmptyLines: 'greedy', preview: CANDIDATE_LIMIT + 2 })
  const headers = parsed.data[0] ?? []
  if (!headers.length || new Set(headers).size !== headers.length) throw new Error('CSV 表头为空或重复')
  if (parsed.meta.truncated || parsed.data.length - 1 > CANDIDATE_LIMIT) throw new Error('CSV 超过10000个候选，请拆分文件')
  if (!request.mappingConfirmed) return { headers, rows: [], warnings: ['请确认字段映射；title 和 due 必需'] }
  const mapping = request.mapping ?? {}
  if (!mapping.title || !mapping.due || !headers.includes(mapping.title) || !headers.includes(mapping.due)) throw new Error('必须明确映射 title 和 due')
  const targets = Object.values(mapping).filter(Boolean)
  if (new Set(targets).size !== targets.length || targets.some(value => !headers.includes(value!))) throw new Error('映射列不可重复且必须存在')
  const rows = parsed.data.slice(1).map((values, index) => {
    const fields = Object.fromEntries(CSV_FIELDS.map(key => [key, mapping[key] ? values[headers.indexOf(mapping[key]!)] ?? '' : '']))
    const errors = parsed.errors.filter(error => error.row === index + 1 || error.row === undefined).map(error => error.message)
    if (values.length !== headers.length) errors.push('列数与表头不一致')
    return importRow(index + 1, fields, request, now, 'csv', undefined, errors.length ? errors.join('；') : undefined)
  })
  return { headers, rows, warnings: [] }
}
