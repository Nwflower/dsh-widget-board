import { describe, expect, it } from 'vitest'
import { campusProps, campusState, campusSummary, EMPTY_CAMPUS_STATE, setCampusStatus } from '../src/campus/model'
import { dueDateTime, dueFromInput, dueTone } from '../src/campus/time'
import type { CampusItem } from '../src/campus/types'

const makeItem = (id: string, changes: Partial<CampusItem> = {}): CampusItem => ({
  id, title: '用户录入的事项', kind: 'deadline', category: '作业', status: 'todo',
  due: { kind: 'date', date: '2026-10-25', timeZone: 'Asia/Shanghai' },
  source: 'manual', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', ...changes,
})
describe('校园卡真实日期边界', () => {
  it('全天事项在当地下一天零点才超期', () => {
    const due = makeItem('a').due
    expect(dueDateTime(due).toUTC().toISO()).toBe('2026-10-25T16:00:00.000Z')
    expect(dueTone(due, Date.parse('2026-10-25T15:59:59Z'))).toBe('near')
    expect(dueTone(due, Date.parse('2026-10-25T16:00:00Z'))).toBe('overdue')
  })
  it('拒绝不存在的日期及 DST 跳跃时刻', () => {
    expect(() => dueFromInput('date', '2026-02-30', '', 'Asia/Shanghai')).toThrow()
    expect(() => dueFromInput('instant', '2026-03-08', '02:30', 'America/New_York')).toThrow()
    expect(() => dueFromInput('date', '2026-01-01', '', 'Invalid/Zone')).toThrow()
  })
  it('DST 重复时刻必须明确选择偏移，两个选择保存为不同 UTC', () => {
    expect(() => dueFromInput('instant', '2026-11-01', '01:30', 'America/New_York')).toThrow()
    expect(dueFromInput('instant', '2026-11-01', '01:30', 'America/New_York', '-04:00')).toMatchObject({ at: '2026-11-01T05:30:00.000Z' })
    expect(dueFromInput('instant', '2026-11-01', '01:30', 'America/New_York', '-05:00')).toMatchObject({ at: '2026-11-01T06:30:00.000Z' })
  })
})
describe('校园卡实例约束', () => {
  it('默认没有虚构的日期或进度', () => {
    expect(campusState(null).items).toEqual([])
    expect(campusSummary(campusState(null), Date.now())).toMatchObject({ total: 0, completed: 0, next: undefined })
    expect(campusProps({}).backgroundStrength).toBe(12)
  })
  it('一百条和 64KiB 同时约束，不接受重复标识或危险 URL', () => {
    const items = Array.from({ length: 100 }, (_, i) => makeItem(String(i)))
    expect(campusState({ ...EMPTY_CAMPUS_STATE, items }).items).toHaveLength(100)
    expect(() => campusState({ ...EMPTY_CAMPUS_STATE, items: [...items, makeItem('101')] })).toThrow()
    expect(() => campusState({ ...EMPTY_CAMPUS_STATE, items: items.map(item => ({ ...item, note: '中'.repeat(500) })) })).toThrow(/64KiB/)
    expect(() => campusState({ ...EMPTY_CAMPUS_STATE, items: [makeItem('a'), makeItem('a')] })).toThrow(/重复/)
    expect(() => campusState({ ...EMPTY_CAMPUS_STATE, items: [makeItem('a', { url: 'javascript:alert(1)' })] })).toThrow()
  })
  it('保留超期里程碑，分母排除取消，完成只修改目标实例', () => {
    const original = campusState({ ...EMPTY_CAMPUS_STATE, items: [makeItem('past', { kind: 'milestone' }), makeItem('done', { kind: 'milestone', status: 'done' }), makeItem('cancelled', { kind: 'milestone', status: 'cancelled' })] })
    expect(campusSummary(original, Date.parse('2026-11-01T00:00:00Z'))).toMatchObject({ next: { id: 'past' }, completed: 1, total: 2, overdue: 1 })
    const next = setCampusStatus(original, 'past', 'done', '2026-11-01T00:00:00Z')
    expect(next.items[0]?.status).toBe('done')
    expect(original.items[0]?.status).toBe('todo')
    expect(() => setCampusStatus(original, 'missing', 'done', '2026-11-01T00:00:00Z')).toThrow()
  })
})
