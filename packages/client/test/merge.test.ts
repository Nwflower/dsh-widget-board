/**
 * 变更通知的合并（D18、D21）：状态与数据就地合并，布局按看板换掉，换选中只改一个字段，卡片与
 * 看板增删才重取。
 *
 * 合并只认通知里带来的字段：一条状态通知不该把 data 清掉，一条数据通知也不该把 state 清掉。
 * 卡片 id 全工作区唯一，所以状态与数据的事件要在全部看板里找那张卡。
 */
import { describe, expect, it } from 'vitest'
import type { WorkspaceSnapshot } from '@dsh-widget-board/contracts'
import { mergeEvent, mergeLayout, needsSnapshot } from '../src/merge'

/** 一份两块看板的工作区：第一块两张卡，第二块一张卡。 */
function workspace(): WorkspaceSnapshot {
  return {
    active: 'first-board',
    boards: [
      {
        version: 1,
        id: 'first-board',
        title: '看板',
        revision: 1,
        layoutRevision: 3,
        instances: [
          { id: 'first', widget: 'weather', hash: 'a'.repeat(64), props: {}, data: { n: 1 }, state: { day: 0 }, layout: { x: 0, y: 0, w: 1, h: 22 } },
          { id: 'second', widget: 'todo', hash: 'b'.repeat(64), props: {}, data: null, state: null, layout: { x: 1, y: 0, w: 1, h: 22 } },
        ],
      },
      {
        version: 1,
        id: 'second-board',
        title: '另一块',
        revision: 1,
        layoutRevision: 1,
        instances: [
          { id: 'third', widget: 'todo', hash: 'b'.repeat(64), props: {}, data: null, state: null, layout: { x: 0, y: 0, w: 1, h: 22 } },
        ],
      },
    ],
    widgets: {},
    library: [],
  }
}

describe('合并通知', () => {
  it('状态通知只换 state', () => {
    const before = workspace()
    const next = mergeEvent(before, { revision: 2, event: { type: 'instance', id: 'first', state: { day: 3 } } })
    expect(next.boards[0]?.instances[0]?.state).toEqual({ day: 3 })
    expect(next.boards[0]?.instances[0]?.data).toEqual({ n: 1 })
    expect(next.boards[0]?.instances[1]).toBe(before.boards[0]?.instances[1])
  })

  it('数据通知只换 data', () => {
    const next = mergeEvent(workspace(), { revision: 2, event: { type: 'instance', id: 'first', data: { n: 2 } } })
    expect(next.boards[0]?.instances[0]?.data).toEqual({ n: 2 })
    expect(next.boards[0]?.instances[0]?.state).toEqual({ day: 0 })
  })

  it('状态补丁按一层合并进页面上的那一份', () => {
    const next = mergeEvent(workspace(), { revision: 2, event: { type: 'instance', id: 'first', patch: { hour: 8 } } })
    expect(next.boards[0]?.instances[0]?.state).toEqual({ day: 0, hour: 8 })
    expect(next.boards[0]?.instances[0]?.data).toEqual({ n: 1 })
  })

  it('props 通知只换 props', () => {
    const before = workspace()
    const next = mergeEvent(before, { revision: 2, event: { type: 'instance', id: 'first', props: { title: 'x' } } })
    expect(next.boards[0]?.instances[0]?.props).toEqual({ title: 'x' })
    expect(next.boards[0]?.instances[0]?.data).toEqual({ n: 1 })
    expect(next.boards[0]?.instances[0]?.state).toEqual({ day: 0 })
  })

  it('状态通知在别的看板里也找得到那张卡', () => {
    const before = workspace()
    const next = mergeEvent(before, { revision: 2, event: { type: 'instance', id: 'third', state: { done: true } } })
    expect(next.boards[1]?.instances[0]?.state).toEqual({ done: true })
    expect(next.boards[0]).toBe(before.boards[0])
  })

  it('布局通知只换那一块看板的修订号与盒子', () => {
    const before = workspace()
    const next = mergeEvent(before, {
      revision: 2,
      event: { type: 'layout', board: 'second-board', layoutRevision: 4, layouts: { third: { x: 0, y: 40, w: 2, h: 12 } } },
    })
    expect(next.boards[1]?.layoutRevision).toBe(4)
    expect(next.boards[1]?.instances[0]?.layout).toEqual({ x: 0, y: 40, w: 2, h: 12 })
    expect(next.boards[0]).toBe(before.boards[0])
  })

  it('布局提交的答复与布局通知走同一条合并', () => {
    const before = workspace()
    const next = mergeLayout(before, 'first-board', 4, { first: { x: 1, y: 20, w: 1, h: 18 } })
    expect(next.boards[0]?.layoutRevision).toBe(4)
    expect(next.boards[0]?.instances[0]?.layout).toEqual({ x: 1, y: 20, w: 1, h: 18 })
    expect(next.boards[0]?.instances[1]).toBe(before.boards[0]?.instances[1])
    expect(next.boards[1]).toBe(before.boards[1])
  })

  it('换选中的通知只改 active', () => {
    const before = workspace()
    const next = mergeEvent(before, { revision: 2, event: { type: 'active', board: 'second-board' } })
    expect(next.active).toBe('second-board')
    expect(next.boards).toBe(before.boards)
  })

  it('不认识的卡片 id 不动任何一处', () => {
    const before = workspace()
    const next = mergeEvent(before, { revision: 2, event: { type: 'instance', id: 'ghost', state: {} } })
    expect(next).toBe(before)
  })

  it('卡片增删与组件库变化要重取', () => {
    expect(needsSnapshot({ revision: 2, event: { type: 'board' } })).toBe(true)
    expect(needsSnapshot({ revision: 2, event: { type: 'layout', board: 'first-board', layoutRevision: 4, layouts: {} } })).toBe(false)
    expect(needsSnapshot({ revision: 2, event: { type: 'instance', id: 'first' } })).toBe(false)
    expect(needsSnapshot({ revision: 2, event: { type: 'active', board: 'second-board' } })).toBe(false)
  })
})
