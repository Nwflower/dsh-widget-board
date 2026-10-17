/**
 * 变更通知的合并（D18）：状态与数据就地合并，布局就地换掉，卡片增删才重取。
 *
 * 合并只认通知里带来的字段：一条状态通知不该把 data 清掉，一条数据通知也不该把 state 清掉。
 */
import { describe, expect, it } from 'vitest'
import type { BoardSnapshot } from '@dsh-widget-board/contracts'
import { mergeEvent, needsSnapshot } from '../src/merge'

/** 一份两张卡的快照。 */
function snapshot(): BoardSnapshot {
  return {
    board: {
      version: 1,
      id: 'board',
      title: '看板',
      revision: 1,
      layoutRevision: 3,
      instances: [
        { id: 'first', widget: 'weather', hash: 'a'.repeat(64), props: {}, data: { n: 1 }, state: { day: 0 }, layout: { x: 0, y: 0, w: 1, h: 22 } },
        { id: 'second', widget: 'todo', hash: 'b'.repeat(64), props: {}, data: null, state: null, layout: { x: 1, y: 0, w: 1, h: 22 } },
      ],
    },
    widgets: {},
    library: [],
  }
}

describe('合并通知', () => {
  it('状态通知只换 state', () => {
    const before = snapshot()
    const next = mergeEvent(before, { revision: 2, event: { type: 'instance', id: 'first', state: { day: 3 } } })
    expect(next.board.instances[0]?.state).toEqual({ day: 3 })
    expect(next.board.instances[0]?.data).toEqual({ n: 1 })
    expect(next.board.instances[1]).toBe(before.board.instances[1])
  })

  it('数据通知只换 data', () => {
    const next = mergeEvent(snapshot(), { revision: 2, event: { type: 'instance', id: 'first', data: { n: 2 } } })
    expect(next.board.instances[0]?.data).toEqual({ n: 2 })
    expect(next.board.instances[0]?.state).toEqual({ day: 0 })
  })

  it('布局通知换掉布局修订号与卡片盒子', () => {
    const next = mergeEvent(snapshot(), {
      revision: 2,
      event: { type: 'layout', layoutRevision: 4, layouts: { second: { x: 0, y: 40, w: 2, h: 12 } } },
    })
    expect(next.board.layoutRevision).toBe(4)
    expect(next.board.instances[1]?.layout).toEqual({ x: 0, y: 40, w: 2, h: 12 })
    expect(next.board.instances[0]?.layout).toEqual({ x: 0, y: 0, w: 1, h: 22 })
  })

  it('不认识的卡片 id 不动任何卡片', () => {
    const before = snapshot()
    const next = mergeEvent(before, { revision: 2, event: { type: 'instance', id: 'ghost', state: {} } })
    expect(next.board.instances).toEqual(before.board.instances)
  })

  it('卡片增删与组件库变化要重取', () => {
    expect(needsSnapshot({ revision: 2, event: { type: 'board' } })).toBe(true)
    expect(needsSnapshot({ revision: 2, event: { type: 'layout', layoutRevision: 4, layouts: {} } })).toBe(false)
    expect(needsSnapshot({ revision: 2, event: { type: 'instance', id: 'first' } })).toBe(false)
  })
})
