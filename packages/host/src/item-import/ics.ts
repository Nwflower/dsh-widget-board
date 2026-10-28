/** 标准解析与重复展开交给ical.js；Luxon负责IANA及DST歧义，外来时区注册只在本次同步解析期间生效。 */
import ICAL from 'ical.js'
import { DateTime } from 'luxon'
import type { Due } from '@dsh-widget-board/contracts/campus'
import type { ItemImportRequest, ItemImportRow } from '@dsh-widget-board/contracts/item-import'
import { dueFromInput, validZone } from '@dsh-widget-board/model/campus/time'
import { CANDIDATE_LIMIT, importRow, sourceKey } from './common'

type Component = InstanceType<typeof ICAL.Component>
type Time = InstanceType<typeof ICAL.Time>
const value = (component: Component, name: string): string => String(component.getFirstPropertyValue(name) ?? '')
function timeValue(component: Component, name: string): Time | undefined {
  const found = component.getFirstPropertyValue(name)
  return found instanceof ICAL.Time ? found : undefined
}
function normalize(component: Component): Component {
  const raw = structuredClone(component.toJSON())
  raw[0] = 'vevent'
  const normalized = new ICAL.Component(raw)
  if (component.name === 'vtodo') {
    const due = timeValue(component, 'due')
    if (due) {
      normalized.removeAllProperties('dtstart')
      const property = component.getFirstProperty('due')!
      const data = structuredClone(property.toJSON())
      data[0] = 'dtstart'
      normalized.addProperty(new ICAL.Property(data))
    } else normalized.removeAllProperties('dtstart')
  }
  if (!timeValue(normalized, 'dtstart') && value(normalized, 'status') === 'CANCELLED') {
    const recurrence = timeValue(normalized, 'recurrence-id')
    if (recurrence) normalized.updatePropertyWithValue('dtstart', recurrence)
  }
  return normalized
}
function resolveTime(component: Component, time: Time, request: ItemImportRequest, offset?: string): Due {
  const extensionZone = value(component, 'x-dsh-timezone')
  const property = component.getFirstProperty('dtstart')
  const tzid = String(property?.getParameter('tzid') || time.zone.tzid)
  const zone = validZone(extensionZone) ? extensionZone : validZone(tzid) ? tzid : request.timeZone
  if (time.isDate) return dueFromInput('date', time.toString().slice(0, 10), '', zone)
  if (tzid === 'UTC' || tzid === 'Z') return { kind: 'instant', at: DateTime.fromSeconds(time.toUnixTime(), { zone: 'utc' }).toISO()!, timeZone: zone }
  const local = time.toString().slice(0, 16)
  if (validZone(tzid) || tzid === 'floating' || tzid === 'local' || !ICAL.TimezoneService.has(tzid)) {
    if ((tzid === 'floating' || tzid === 'local') && !request.floatingConfirmed) throw new Error('浮动时间需要确认目标时区')
    if (!validZone(tzid) && tzid !== 'floating' && tzid !== 'local' && !request.unknownZoneConfirmed) throw new Error(`无法解释TZID ${tzid}，请明确指定时区`)
    const due = dueFromInput('instant', local.slice(0, 10), local.slice(11), zone, offset)
    if (due.kind !== 'instant') throw new Error('精确时刻解析失败')
    return { ...due, at: DateTime.fromISO(due.at).plus({ seconds: time.second }).toUTC().toISO()! }
  }
  return { kind: 'instant', at: DateTime.fromSeconds(time.toUnixTime(), { zone: 'utc' }).toISO()!, timeZone: zone }
}

export function parseIcs(request: ItemImportRequest, now: string): { headers: string[], rows: ItemImportRow[], warnings: string[] } {
  const root = new ICAL.Component(ICAL.parse(request.text))
  if (root.name !== 'vcalendar') throw new Error('文件需要VCALENDAR')
  const restored = new Map<string, InstanceType<typeof ICAL.Timezone> | undefined>()
  try {
    for (const zone of root.getAllSubcomponents('vtimezone')) {
      const id = value(zone, 'tzid')
      if (!id || restored.has(id) || id === 'UTC' || id === 'Z') throw new Error('VTIMEZONE标识为空、重复或占用UTC')
      restored.set(id, ICAL.TimezoneService.has(id) ? ICAL.TimezoneService.get(id) : undefined)
      ICAL.TimezoneService.register(new ICAL.Timezone({ component: zone }), id)
    }
    const rangeStart = DateTime.fromISO(request.rangeStart || DateTime.fromISO(now).setZone(request.timeZone).toISODate()!, { zone: request.timeZone })
    const rangeEnd = DateTime.fromISO(request.rangeEnd || rangeStart.plus({ years: 1 }).toISODate()!, { zone: request.timeZone }).endOf('day')
    if (!rangeStart.isValid || !rangeEnd.isValid || rangeEnd < rangeStart) throw new Error('重复展开的日期范围不合法')
    const components = root.getAllSubcomponents().filter(component => component.name === 'vevent' || component.name === 'vtodo').map(normalize)
    const rows: ItemImportRow[] = []
    const warnings: string[] = []
    const seen = new Set<Component>()
    let computations = 0
    const append = (component: Component, time?: Time, occurrence?: Time, recurring = false): void => {
      if (rows.length >= CANDIDATE_LIMIT) throw new Error('ICS超过10000个候选，请缩小范围')
      const row = rows.length + 1
      let due: Due | undefined
      let failure: string | undefined
      try {
        if (!time) throw new Error('VEVENT缺少DTSTART或VTODO缺少DUE')
        due = resolveTime(component, time, request, request.edits?.[String(row)]?.offset)
        const millis = due.kind === 'date' ? DateTime.fromISO(due.date, { zone: due.timeZone }).toMillis() : DateTime.fromISO(due.at).toMillis()
        if (recurring && (millis < rangeStart.toMillis() || millis > rangeEnd.toMillis())) return
      } catch (error) {
        // 每个有错误的事件仍占一条预览，不影响其它事件的错误可见性。
        failure = (error as Error).message
      }
      const end = value(component, 'dtend')
      const note = value(component, 'description') + (end && !component.hasProperty('x-dsh-kind') ? `\nDTEND: ${end}` : '')
      const uid = value(component, 'x-dsh-source-uid') || sourceKey(value(component, 'uid'), occurrence?.toString() ?? time?.toString() ?? '')
      rows.push(importRow(row, {
        title: value(component, 'summary'), kind: value(component, 'x-dsh-kind') || 'deadline',
        category: value(component, 'x-dsh-category') || value(component, 'categories'),
        note, url: value(component, 'url'),
        status: value(component, 'x-dsh-status') || (value(component, 'status') === 'CANCELLED' ? 'cancelled' : value(component, 'status') === 'COMPLETED' ? 'done' : 'todo'),
        due: due ? due.kind === 'date' ? due.date : due.at : time?.toString() ?? '',
        dateOnly: String(due?.kind === 'date' || time?.isDate === true), timeZone: due?.timeZone ?? request.timeZone,
      }, request, now, 'ics', uid, request.edits?.[String(row)]?.due ? undefined : failure))
    }
    for (const component of components.filter(entry => !entry.hasProperty('recurrence-id'))) {
      seen.add(component)
      const start = timeValue(component, 'dtstart')
      if (!start) { append(component); continue }
      const exceptions = components.filter(entry => entry.hasProperty('recurrence-id') && value(entry, 'uid') === value(component, 'uid'))
      const event = new ICAL.Event(component, { exceptions, strictExceptions: true })
      if (!event.isRecurring()) { append(component, start); continue }
      const iterator = event.iterator()
      const used = new Set<string>()
      for (;;) {
        if (++computations > CANDIDATE_LIMIT) throw new Error('重复展开超过10000次计算，请缩小范围或调整过早的开始日期')
        const occurrence = iterator.next()
        if (!occurrence) break
        if (DateTime.fromISO(occurrence.toString(), { zone: request.timeZone }).toMillis() > rangeEnd.toMillis() + 2 * 86400000) break
        const details = event.getOccurrenceDetails(occurrence)
        used.add(occurrence.toString())
        append(details.item.component, details.startDate, occurrence, true)
      }
      for (const exception of exceptions) {
        seen.add(exception)
        const recurrence = timeValue(exception, 'recurrence-id')!
        if (!used.has(recurrence.toString())) append(exception, timeValue(exception, 'dtstart'), recurrence, true)
      }
    }
    for (const exception of components.filter(entry => !seen.has(entry))) {
      warnings.push('发现没有主事件的RECURRENCE-ID，按独立发生时间预览')
      append(exception, timeValue(exception, 'dtstart'), timeValue(exception, 'recurrence-id'))
    }
    if (!components.length) throw new Error('没有可导入的VEVENT或VTODO')
    return { headers: [], rows, warnings }
  } finally {
    for (const [id, previous] of restored) {
      ICAL.TimezoneService.remove(id)
      if (previous) ICAL.TimezoneService.register(previous, id)
    }
  }
}
