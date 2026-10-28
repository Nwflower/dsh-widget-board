import { describe, expect, it } from 'vitest'
import Papa from 'papaparse'
import { readFileSync } from 'node:fs'
import { PARENT_MESSAGE_LIMIT } from '@dsh-widget-board/contracts'
import { checkContentBudget, handshakeBytes } from '../src/content/validate'
import type { ItemImportRequest } from '@dsh-widget-board/contracts/item-import'
import { EMPTY_CAMPUS_STATE } from '@dsh-widget-board/model/campus/model'
import { parseCsv } from '../src/item-import/csv'
import { parseIcs } from '../src/item-import/ics'
import { csvTemplate, exportItems } from '../src/item-import/export'
import { duplicateKey } from '../src/item-import/common'
import { matchRows, planImport } from '../src/item-import/merge'

const now = '2026-10-26T00:00:00Z'
const mapping = Object.fromEntries('kind,title,category,due,dateOnly,timeZone,status,url,note,uid'.split(',').map(key => [key, key]))
const csv = (text: string, extra: Partial<ItemImportRequest> = {}) => parseCsv({ format: 'csv', text, timeZone: 'Asia/Shanghai', mapping: Object.fromEntries(Object.entries(mapping).filter(([key]) => Papa.parse<string[]>(text).data[0]?.includes(key))), mappingConfirmed: true, ...extra }, now)
const calendar = (body: string): string => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${body}\r\nEND:VCALENDAR`
const event = (body: string): string => `BEGIN:VEVENT\r\n${body}\r\nEND:VEVENT`
const ics = (text: string, extra: Partial<ItemImportRequest> = {}) => parseIcs({ format: 'ics', text, timeZone: 'Asia/Shanghai', ...extra }, now)
describe('校园文件交换', () => {
  it('VTIMEZONE夹具注册、重复例外和再次解析隔离', () => {
    const fixture = readFileSync(new URL('../../testing/fixtures/campus-recurring.ics', import.meta.url), 'utf8')
    const rows = ics(fixture, { rangeStart: '2030-01-01', rangeEnd: '2030-12-31', floatingConfirmed: true }).rows
    expect(rows).toHaveLength(7)
    expect(rows.every(row => !row.error)).toBe(true)
    expect(rows[0]?.item?.due).toMatchObject({ at: '2030-01-01T04:15:00.000Z' })
    expect(ics(calendar(event('SUMMARY:隔离\r\nDTSTART;TZID=Demo/Offset:20300101T100000'))).rows[0]?.error).toContain('TZID')
  })
  it('单卡容量合格时仍拒绝握手及全板额度超限', () => {
    const state = { ...EMPTY_CAMPUS_STATE, items: csv(csvTemplate()).rows.map(row => row.item!) }
    const manifest = JSON.parse(readFileSync(new URL('../../widgets/campus/widget.json', import.meta.url), 'utf8'))
    const bytes = handshakeBytes({ ...manifest, text: { zh: '中'.repeat(PARENT_MESSAGE_LIMIT) } }, { state })
    expect(() => checkContentBudget(state, { requestBytes: 0, requestLimit: 1, otherStateBytes: 0, handshakeBytes: bytes })).toThrow('握手')
    expect(() => checkContentBudget(state, { requestBytes: 0, requestLimit: 1, otherStateBytes: 0, handshakeBytes: PARENT_MESSAGE_LIMIT })).not.toThrow()
    expect(() => checkContentBudget(state, { requestBytes: 0, requestLimit: 1, otherStateBytes: 0, handshakeBytes: PARENT_MESSAGE_LIMIT + 1 })).toThrow('握手')
    expect(() => checkContentBudget(state, { requestBytes: 0, requestLimit: 1, otherStateBytes: 1024 * 1024, handshakeBytes: 0 })).toThrow('合计')
  })
  it('CSV模板BOM和全天日期往返，显式确认中文映射', () => {
    const original = csv(csvTemplate()).rows[0]!
    expect(original.error).toBeUndefined()
    expect(original.item?.due).toEqual({ kind: 'date', date: '2030-01-01', timeZone: 'Asia/Shanghai' })
    expect(csv(exportItems([original.item!], 'csv').text).rows[0]?.item).toMatchObject({ title: original.item!.title, due: original.item!.due, sourceUid: original.item!.sourceUid })
    const text = '标题,截止日期,全天\n闰日,2028-02-29,true'
    expect(csv(text, { mappingConfirmed: false }).rows).toHaveLength(0)
    expect(csv(text, { mapping: { title: '标题', due: '截止日期', dateOnly: '全天' } }).rows[0]?.error).toBeUndefined()
    expect(() => csv(text)).toThrow('映射')
  })
  it('引号、逗号、换行、公式逃逸和非法列保留', () => {
    const parsed = csv('title,due,dateOnly,note\n"标题,一",2026-12-31,true,"第一行\n第二行"')
    expect(parsed.rows[0]?.item).toMatchObject({ title: '标题,一', note: '第一行\n第二行' })
    expect(exportItems([{ ...parsed.rows[0]!.item!, title: '=1+1' }], 'csv').text).toContain("'=1+1")
    expect(csv('title,due\n缺列').rows[0]?.error).toContain('列数')
    expect(csv('title,due,dateOnly\n错误,2026-02-29,true').rows[0]?.error).toContain('不存在')
  })
  it('精确时刻、DST空缺和重复偏移', () => {
    expect(csv('title,due\n跨年,2027-01-01T00:00:00+08:00').rows[0]?.item?.due).toMatchObject({ at: '2026-12-31T16:00:00.000Z' })
    const text = 'title,due,timeZone\n夏令时,2026-03-08T02:30,America/New_York'
    expect(csv(text).rows[0]?.error).toContain('不存在')
    const ambiguous = text.replace('03-08T02:30', '11-01T01:30')
    expect(csv(ambiguous).rows[0]?.error).toContain('两次')
    expect(csv(ambiguous, { edits: { '1': { offset: '-05:00' } } }).rows[0]?.item?.due).toMatchObject({ at: '2026-11-01T06:30:00.000Z' })
  })
  it('重复默认跳过，更新保留标识和状态，保留两条生成不同标识', () => {
    const parsed = csv(csvTemplate())
    const item = { ...parsed.rows[0]!.item!, status: 'done' as const }
    const state = { ...EMPTY_CAMPUS_STATE, items: [item] }
    const rows = matchRows(csv(csvTemplate().replace('请替换为你的事项', '新的标题')).rows, state)
    expect(rows[0]?.duplicateId).toBe(item.id)
    expect(rows[0]?.changes?.join()).toContain('title')
    expect(planImport(rows, state, {}).total).toBe(1)
    expect(planImport(rows, state, { '1': 'update' }).state.items[0]).toMatchObject({ id: item.id, status: 'done' })
    const kept = planImport(rows, state, { '1': 'keep' })
    expect(kept.total).toBe(2)
    expect(kept.state.items[1]?.id).not.toBe(item.id)
    expect(duplicateKey({ ...item, sourceUid: undefined })).toBe(duplicateKey({ ...item, id: 'different', sourceUid: undefined }))
    const local = { ...item, sourceUid: undefined }
    const roundtrip = csv(exportItems([local], 'csv').text).rows
    expect(matchRows(roundtrip, { ...state, items: [local] })[0]?.duplicateId).toBe(local.id)
  })
  it('容量错误并列呈现，跳过错误行可恢复', () => {
    const bad = csv('title,due,dateOnly\n错误,2026-02-30,true').rows
    expect(planImport(bad, EMPTY_CAMPUS_STATE, {}).errors.length).toBeGreaterThan(0)
    expect(planImport(bad, EMPTY_CAMPUS_STATE, { '1': 'skip' }).errors).toEqual([])
    expect(() => csv('title,due\n' + '标题,2026-01-01\n'.repeat(10001))).toThrow('10000')
    const rows = Array.from({ length: 101 }, (_, index) => ({ ...csv(csvTemplate()).rows[0]!, row: index + 1 }))
    expect(planImport(rows, EMPTY_CAMPUS_STATE, {}).errors.length).toBeGreaterThan(0)
  })
  it('ICS UTC、浮动时间、未知时区、VTODO和缺少日期逐项可见', () => {
    const text = calendar(event('UID:utc\r\nSUMMARY:UTC\r\nDTSTART:20261027T100000Z') + '\r\n' + event('SUMMARY:浮动\r\nDTSTART:20261027T100000') + '\r\nBEGIN:VTODO\r\nSUMMARY:待办\r\nDUE;VALUE=DATE:20261028\r\nSTATUS:COMPLETED\r\nEND:VTODO\r\nBEGIN:VTODO\r\nSUMMARY:缺日期\r\nEND:VTODO')
    const rows = ics(text).rows
    expect(rows).toHaveLength(4)
    expect(rows[0]?.item?.due).toMatchObject({ at: '2026-10-27T10:00:00.000Z' })
    expect(rows[1]?.error).toContain('浮动')
    expect(rows[2]?.item?.status).toBe('done')
    expect(rows[3]?.error).toContain('DUE')
    expect(ics(text, { floatingConfirmed: true }).rows[1]?.error).toBeUndefined()
    const unknown = calendar(event('SUMMARY:未知\r\nDTSTART;TZID=Invalid/Zone:20261027T100000'))
    expect(ics(unknown).rows[0]?.error).toContain('TZID')
    expect(ics(unknown, { unknownZoneConfirmed: true }).rows[0]?.error).toBeUndefined()
  })
  it('RRULE、RDATE、EXDATE、改期与取消例外共同生效', () => {
    const text = calendar([
      event('UID:series\r\nSUMMARY:原事项\r\nDTSTART:20261026T100000Z\r\nRRULE:FREQ=DAILY;COUNT=4\r\nRDATE:20261031T100000Z\r\nEXDATE:20261027T100000Z'),
      event('UID:series\r\nRECURRENCE-ID:20261028T100000Z\r\nDTSTART:20261028T120000Z\r\nSUMMARY:改期'),
      event('UID:series\r\nRECURRENCE-ID:20261029T100000Z\r\nSTATUS:CANCELLED\r\nSUMMARY:取消'),
    ].join('\r\n'))
    const rows = ics(text).rows
    expect(rows.map(row => row.error)).toEqual([undefined, undefined, undefined, undefined])
    expect(rows.map(row => row.item?.title)).toEqual(['原事项', '改期', '取消', '原事项'])
    expect(rows[1]?.item?.due).toMatchObject({ at: '2026-10-28T12:00:00.000Z' })
    expect(rows[2]?.item?.status).toBe('cancelled')
    expect(ics(text, { rangeStart: '2026-10-28', rangeEnd: '2026-10-29' }).rows).toHaveLength(2)
    expect(() => ics(calendar(event('SUMMARY:过多\r\nDTSTART:19000101T000000Z\r\nRRULE:FREQ=DAILY')))).toThrow('10000')
  })
  it('ICS稳定UID、全天次日截止、扩展字段及精确时刻往返', () => {
    const item = { ...csv(csvTemplate()).rows[0]!.item!, kind: 'milestone' as const, status: 'done' as const }
    const file = exportItems([item], 'ics')
    expect(file.text).toContain('DTEND;VALUE=DATE:20300102')
    expect(file.text).toBe(exportItems([item], 'ics').text)
    expect(ics(file.text).rows[0]?.item).toMatchObject({ kind: 'milestone', status: 'done', due: item.due, note: item.note, sourceUid: item.sourceUid })
    const precise = csv('title,due\n精确,2027-01-01T00:00:00+08:00').rows[0]!.item!
    const exported = exportItems([precise], 'ics')
    expect(exported.text).not.toContain('DTEND')
    expect(ics(exported.text).rows[0]?.item?.due).toEqual(precise.due)
  })
})
