/** 三个运行位置共用的纯数据校验与摘要；JSON Schema 只有组件 manifest 一份来源。 */
import { validateProps, validateState } from './validators.generated'
import type { ValidateFunction } from 'ajv'
import { dueDateTime, dueTone, validZone } from './time'
import type { CampusItem, CampusProps, CampusState, CampusStatus } from './types'

export const CAMPUS_SCHEMA_ID = 'https://dsh-widget-board.local/schema/campus-state-v1'
export const isCampusSchema = (schema: unknown): boolean => schema !== null && typeof schema === 'object' && '$id' in schema && schema.$id === CAMPUS_SCHEMA_ID

export const EMPTY_CAMPUS_STATE: CampusState = { schemaVersion: 1, items: [], links: [], customCategories: [], reminderLedger: {} }
export const DEFAULT_CAMPUS_PROPS: CampusProps = {
  schoolPreset: 'generic', degree: 'master', genericTheme: 'book', customSchool: { name: '', shortName: '', iconAlt: '' },
  backgroundPosition: { x: 50, y: 50 }, backgroundStrength: 12, timeZone: 'Asia/Shanghai', hasBackground: false, hasIcon: false, reminderEnabled: true, reminderLeadHours: 24,
}
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
export function safeLink(value: string): boolean {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password } catch { return false }
}
export function campusProps(value: unknown): CampusProps {
  if (value !== undefined && value !== null && !record(value)) throw new Error('校园配置必须是对象')
  const raw = (value ?? {}) as Partial<CampusProps>
  const props = { ...DEFAULT_CAMPUS_PROPS, ...raw, customSchool: { ...DEFAULT_CAMPUS_PROPS.customSchool, ...raw.customSchool }, backgroundPosition: { ...DEFAULT_CAMPUS_PROPS.backgroundPosition, ...raw.backgroundPosition } }
  if (!validateProps(props)) throw new Error(`校园配置不合法：${JSON.stringify((validateProps as ValidateFunction).errors)}`)
  if (!validZone(props.timeZone)) throw new Error('校园时区不合法')
  if (props.schoolPreset === 'custom' && !props.customSchool.name.trim()) throw new Error('请填写自定义学校名称')
  return props
}
export function campusState(value: unknown): CampusState {
  const state: unknown = value === null || value === undefined ? structuredClone(EMPTY_CAMPUS_STATE) : value
  if (!validateState(state)) throw new Error(`校园事项不合法：${JSON.stringify((validateState as ValidateFunction).errors)}`)
  const current = state as CampusState
  if (new TextEncoder().encode(JSON.stringify(current)).length > 64 * 1024) throw new Error('校园状态超过 64KiB，请减少事项或说明')
  const ids = new Set<string>()
  for (const item of current.items) {
    if (ids.has(item.id)) throw new Error('事项标识重复')
    ids.add(item.id)
    if (!item.title.trim()) throw new Error('事项标题不能为空')
    dueDateTime(item.due)
    if (item.url && !safeLink(item.url)) throw new Error('事项链接必须是无凭据的 http/https 地址')
    for (const timestamp of [item.createdAt, item.updatedAt]) if (!Number.isFinite(Date.parse(timestamp))) throw new Error('事项创建或更新时间不合法')
  }
  ids.clear()
  for (const link of current.links) {
    if (ids.has(link.id)) throw new Error('入口标识重复')
    ids.add(link.id)
    if (!link.title.trim() || !safeLink(link.url)) throw new Error('入口需要标题与有效的 http/https 地址')
  }
  return current
}
export function orderedOpen(items: readonly CampusItem[]): CampusItem[] {
  return items.filter(item => item.status === 'todo').map((item, index) => ({ item, index })).sort((a, b) => dueDateTime(a.item.due).toMillis() - dueDateTime(b.item.due).toMillis() || Date.parse(a.item.createdAt) - Date.parse(b.item.createdAt) || a.index - b.index).map(entry => entry.item)
}
export function campusSummary(state: CampusState, now: number) {
  const open = orderedOpen(state.items)
  const milestones = state.items.filter(item => item.kind === 'milestone' && item.status !== 'cancelled')
  return {
    open, overdue: open.filter(item => dueTone(item.due, now) === 'overdue').length,
    next: open.find(item => item.kind === 'milestone'), completed: milestones.filter(item => item.status === 'done').length,
    total: milestones.length,
  }
}
export function setCampusStatus(state: CampusState, id: string, status: CampusStatus, now: string): CampusState {
  if (!state.items.some(item => item.id === id)) throw new Error('事项已被移除，请重新读取')
  return campusState({ ...state, items: state.items.map(item => item.id === id ? { ...item, status, updatedAt: now } : item) })
}
