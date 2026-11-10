/** 日期、时区和夏令时交给Luxon；ledger只保留当前事项的节点。 */
import { DateTime } from 'luxon'
import type { CampusItem, CampusProps, CampusState } from './types'

export const REMINDER_LEADS = [0, 1, 24, 72] as const
export function reminderNodes(item: CampusItem, lead: number): { key: string, at: number }[] {
  if (!(REMINDER_LEADS as readonly number[]).includes(lead)) throw new Error('提醒提前量只能为0、1、24或72小时')
  const due = item.due
  const at = due.kind === 'date' ? DateTime.fromISO(due.date, { zone: due.timeZone }).set({ hour: 9 }).startOf('hour') : DateTime.fromISO(due.at, { zone: 'utc' })
  if (!at.isValid) throw new Error('提醒时间不合法')
  const key = (node: string): string => JSON.stringify([item.id, due.kind, due.kind === 'date' ? due.date : due.at, due.timeZone, node])
  const nodes = [{ key: key('due'), at: at.toMillis() }]
  if (lead) {
    const early = due.kind === 'date' && lead >= 24 ? at.minus({ days: lead / 24 }) : at.minus({ hours: lead })
    nodes.unshift({ key: key(`lead:${lead}`), at: early.toMillis() })
  }
  return nodes
}
export function reminderVersion(props: CampusProps, state: CampusState): string {
  return JSON.stringify([props.reminderEnabled, props.reminderLeadHours, state.items.map(item => [item.id, item.due, item.status, item.title])])
}
export function reminderPlan(props: CampusProps, state: CampusState, now: number): { ledger: Record<string, string>, due: CampusItem[], changed: boolean } {
  const ledger: Record<string, string> = {}
  const due: CampusItem[] = []
  const stamp = new Date(now).toISOString()
  for (const item of state.items) {
    if (item.status !== 'todo') continue
    let reached = false
    for (const node of reminderNodes(item, props.reminderLeadHours)) {
      if (Object.hasOwn(state.reminderLedger, node.key)) ledger[node.key] = state.reminderLedger[node.key]!
      else if (props.reminderEnabled && node.at <= now) { ledger[node.key] = stamp; reached = true }
    }
    if (reached) due.push(item)
  }
  const keys = Object.keys(state.reminderLedger)
  return { ledger, due, changed: keys.length !== Object.keys(ledger).length || keys.some(key => state.reminderLedger[key] !== ledger[key]) }
}
