/** 日历日期与 IANA 时区交给 Luxon；不自行计算时区偏移。 */
import { DateTime, Info } from 'luxon'
import type { Due } from './types'

export function validZone(zone: string): boolean { return Info.isValidIANAZone(zone) }

export function dueFromInput(kind: 'date' | 'instant', date: string, time: string, timeZone: string, offset?: string): Due {
  if (!validZone(timeZone)) throw new Error('请选择有效的 IANA 时区')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('请输入完整日期')
  const calendar = DateTime.fromISO(date, { zone: timeZone })
  if (!calendar.isValid || calendar.toISODate() !== date) throw new Error('日期不存在')
  if (kind === 'date') return { kind, date, timeZone }
  const local = `${date}T${time}`
  if (!/^\d{2}:\d{2}$/.test(time)) throw new Error('请输入小时和分钟')
  const parsed = DateTime.fromISO(local, { zone: timeZone })
  if (!parsed.isValid || parsed.toFormat("yyyy-MM-dd'T'HH:mm") !== local) throw new Error('该时区不存在这个本地时刻（夏令时切换）')
  const candidates = parsed.getPossibleOffsets()
  if (candidates.length > 1 && !offset) throw new Error('该本地时刻出现两次，请选择明确偏移')
  const selected = offset ? candidates.find(candidate => candidate.toFormat('ZZ') === offset) : parsed
  if (!selected) throw new Error('所选偏移与该时区不一致')
  return { kind, at: selected.toUTC().toISO() as string, timeZone }
}

export function localOffsets(date: string, time: string, zone: string): string[] {
  if (!validZone(zone)) return []
  const value = DateTime.fromISO(`${date}T${time}`, { zone })
  return value.isValid && value.toFormat("yyyy-MM-dd'T'HH:mm") === `${date}T${time}` ? value.getPossibleOffsets().map(candidate => candidate.toFormat('ZZ')) : []
}

export function dueDateTime(due: Due): DateTime {
  if (!validZone(due.timeZone)) throw new Error('事项时区不合法')
  if (due.kind === 'date') {
    const value = DateTime.fromISO(due.date, { zone: due.timeZone })
    if (!/^\d{4}-\d{2}-\d{2}$/.test(due.date) || !value.isValid || value.toISODate() !== due.date) throw new Error('事项日期不合法')
    return value.plus({ days: 1 }).startOf('day')
  }
  const value = DateTime.fromISO(due.at, { setZone: true })
  if (!due.at.endsWith('Z') || !value.isValid) throw new Error('事项时刻必须是有效的 UTC ISO 时刻')
  return value.setZone(due.timeZone)
}

export function dueInput(due: Due): { date: string, time: string, offset: string } {
  const value = due.kind === 'date' ? DateTime.fromISO(due.date, { zone: due.timeZone }) : dueDateTime(due)
  return { date: value.toISODate() as string, time: value.toFormat('HH:mm'), offset: value.toFormat('ZZ') }
}

export function dueLabel(due: Due, zh = true): string {
  const value = dueInput(due)
  return due.kind === 'date' ? `${value.date} · ${zh ? '全天' : 'all day'}` : `${value.date} ${value.time} · ${due.timeZone}`
}

export function dueTone(due: Due, now: number): 'overdue' | 'near' | 'open' {
  const end = dueDateTime(due)
  if (now >= end.toMillis()) return 'overdue'
  return end.toMillis() <= DateTime.fromMillis(now, { zone: due.timeZone }).plus({ days: 7 }).toMillis() ? 'near' : 'open'
}
