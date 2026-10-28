import ICAL from 'ical.js'
import Papa from 'papaparse'
import { DateTime } from 'luxon'
import type { CampusItem } from '@dsh-widget-board/contracts/campus'
import type { ImportFormat } from '@dsh-widget-board/contracts/item-import'
import { CSV_FIELDS } from './common'

export function exportItems(items: readonly CampusItem[], format: ImportFormat): { name: string, mime: string, text: string, count: number } {
  if (format === 'csv') {
    const data = items.map(item => [item.kind, item.title, item.category, item.due.kind === 'date' ? item.due.date : item.due.at,
      String(item.due.kind === 'date'), item.due.timeZone, item.status, item.url ?? '', item.note ?? '', `dsh-source:${item.sourceUid ?? JSON.stringify([item.id, 'local'])}`])
    return { name: 'campus.csv', mime: 'text/csv;charset=utf-8', text: '\ufeff' + Papa.unparse({ fields: CSV_FIELDS, data }, { escapeFormulae: true, newline: '\r\n' }), count: items.length }
  }
  const calendar = new ICAL.Component(['vcalendar', [], []])
  calendar.addPropertyWithValue('version', '2.0')
  calendar.addPropertyWithValue('prodid', '-//dsh-widget-board//Campus//EN')
  for (const item of items) {
    const component = new ICAL.Component('vevent')
    component.addPropertyWithValue('uid', `${item.id}@dsh-widget-board.local`)
    component.addPropertyWithValue('summary', item.title)
    component.addPropertyWithValue('description', item.note ?? '')
    if (item.url) component.addPropertyWithValue('url', item.url)
    component.addPropertyWithValue('dtstart', ICAL.Time.fromString(item.due.kind === 'date' ? item.due.date : DateTime.fromISO(item.due.at).toUTC().toFormat("yyyy-MM-dd'T'HH:mm:ss'Z'"), undefined))
    if (item.due.kind === 'date') component.addPropertyWithValue('dtend', ICAL.Time.fromDateString(DateTime.fromISO(item.due.date, { zone: item.due.timeZone }).plus({ days: 1 }).toISODate()!))
    component.addPropertyWithValue('status', item.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED')
    component.addPropertyWithValue('x-dsh-status', item.status)
    component.addPropertyWithValue('x-dsh-kind', item.kind)
    component.addPropertyWithValue('x-dsh-category', item.category)
    component.addPropertyWithValue('x-dsh-timezone', item.due.timeZone)
    component.addPropertyWithValue('x-dsh-source-uid', item.sourceUid ?? JSON.stringify([item.id, 'local']))
    calendar.addSubcomponent(component)
  }
  return { name: 'campus.ics', mime: 'text/calendar;charset=utf-8', text: calendar.toString() + '\r\n', count: items.length }
}

export function csvTemplate(): string {
  return '\ufeff' + Papa.unparse({ fields: CSV_FIELDS, data: [['deadline', '示例数据：请替换为你的事项', '示例', '2030-01-01', 'true', 'Asia/Shanghai', 'todo', '', '仅供演示，不是真实学校日程', 'demo-1']] }, { escapeFormulae: true })
}
