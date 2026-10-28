import { describe, expect, it } from 'vitest'
import { campusProps, campusState, EMPTY_CAMPUS_STATE } from '../src/campus/model'
import { reminderNodes, reminderPlan } from '../src/campus/reminders'
import type { CampusItem } from '../src/campus/types'

const item = (id = 'one', changes: Partial<CampusItem> = {}): CampusItem => ({ id, title: '提醒验收', kind: 'deadline', category: '', due: { kind: 'date', date: '2026-10-26', timeZone: 'Asia/Shanghai' }, status: 'todo', source: 'manual', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', ...changes })
const props = campusProps({})
const state = (items = [item()]) => campusState({ ...EMPTY_CAMPUS_STATE, items })
describe('校园提醒节点与去重', () => {
  it('默认开启，保留明确关闭，提前量只接受四个值', () => {
    expect(props.reminderEnabled).toBe(true)
    expect(campusProps({ reminderEnabled: false }).reminderEnabled).toBe(false)
    for (const hours of [0, 1, 24, 72]) expect(campusProps({ reminderLeadHours: hours }).reminderLeadHours).toBe(hours)
    expect(() => campusProps({ reminderLeadHours: 7 })).toThrow()
    expect(() => reminderNodes(item(), 7)).toThrow()
  })
  it('全天在事项时区前一天和当天09点提醒，边界没有提前触发', () => {
    expect(reminderNodes(item(), 24).map(node => new Date(node.at).toISOString())).toEqual(['2026-10-25T01:00:00.000Z', '2026-10-26T01:00:00.000Z'])
    expect(reminderPlan(props, state(), Date.parse('2026-10-25T00:59:59Z')).due).toHaveLength(0)
    expect(reminderPlan(props, state(), Date.parse('2026-10-25T01:00:00Z')).due).toHaveLength(1)
    expect(reminderNodes(item(), 0)).toHaveLength(1)
  })
  it('跨年、闰日和夏令时仍按日历日保持09点', () => {
    const summer = item('dst', { due: { kind: 'date', date: '2026-03-08', timeZone: 'America/New_York' } })
    expect(reminderNodes(summer, 24).map(node => new Date(node.at).toISOString())).toEqual(['2026-03-07T14:00:00.000Z', '2026-03-08T13:00:00.000Z'])
    expect(new Date(reminderNodes(item('year', { due: { kind: 'date', date: '2027-01-01', timeZone: 'Asia/Shanghai' } }), 24)[0]!.at).toISOString()).toBe('2026-12-31T01:00:00.000Z')
    expect(new Date(reminderNodes(item('leap', { due: { kind: 'date', date: '2028-03-01', timeZone: 'Asia/Shanghai' } }), 24)[0]!.at).toISOString()).toBe('2028-02-29T01:00:00.000Z')
  })
  it('精确时刻按实际小时计算，不依赖本机时区', () => {
    const precise = item('at', { due: { kind: 'instant', at: '2026-11-01T06:30:00.000Z', timeZone: 'America/New_York' } })
    for (const hours of [1, 24, 72]) {
      const nodes = reminderNodes(precise, hours)
      expect(nodes[1]!.at - nodes[0]!.at).toBe(hours * 3600000)
    }
  })
  it('一轮合并所有已到节点，普通刷新不会重复', () => {
    const original = state([item(), item('two')])
    const plan = reminderPlan(props, original, Date.parse('2026-10-27T00:00:00Z'))
    expect(plan.due).toHaveLength(2)
    expect(Object.keys(plan.ledger)).toHaveLength(4)
    expect(reminderPlan(props, { ...original, reminderLedger: plan.ledger }, Date.parse('2026-10-28T00:00:00Z'))).toMatchObject({ due: [], changed: false })
  })
  it('完成、取消、关闭提醒不产生新通知，删除与旧截止版本清理记录', () => {
    const original = state()
    const ledger = reminderPlan(props, original, Date.parse('2026-10-27T00:00:00Z')).ledger
    for (const status of ['done', 'cancelled'] as const) expect(reminderPlan(props, { ...original, items: [item('one', { status })], reminderLedger: ledger }, Date.now())).toMatchObject({ due: [], ledger: {} })
    expect(reminderPlan({ ...props, reminderEnabled: false }, original, Date.now()).due).toEqual([])
    expect(reminderPlan(props, { ...original, items: [], reminderLedger: ledger }, Date.now()).ledger).toEqual({})
    const changed = state([item('one', { due: { kind: 'date', date: '2026-10-27', timeZone: 'Asia/Shanghai' } })])
    const next = reminderPlan(props, { ...changed, reminderLedger: ledger }, Date.parse('2026-10-27T01:00:00Z'))
    expect(next.due).toHaveLength(1)
    expect(Object.keys(next.ledger).some(key => Object.hasOwn(ledger, key))).toBe(false)
  })
})
