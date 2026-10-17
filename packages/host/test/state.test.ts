/**
 * 卡片状态的合并（D5）：组件送来的是补丁，宿主是唯一写入者。
 *
 * 状态存在宿主上，卡片重挂之后靠它把会话接回来；合并规则只有一条，所以由单元测试盯着。
 */
import { describe, expect, it } from 'vitest'
import type { Board } from '@dsh-widget-board/contracts'
import type { WidgetRecord } from '../src/library'
import { withBoardLayouts, withInstanceAdded, withInstanceData, withInstanceRemoved, withInstanceState, withLayouts } from '../src/state'

/** 一块带两张卡的看板。 */
function board(): Board {
  return {
    version: 1,
    id: 'board',
    title: '看板',
    revision: 3,
    layoutRevision: 1,
    instances: [
      { id: 'first', widget: 'pomodoro', hash: 'a'.repeat(64), props: {}, data: null, state: { minutes: 25, endsAt: 0 }, layout: { x: 0, y: 0, w: 1, h: 22 } },
      { id: 'second', widget: 'weather', hash: 'b'.repeat(64), props: {}, data: null, state: null, layout: { x: 1, y: 0, w: 1, h: 22 } },
    ],
  }
}

describe('卡片状态', () => {
  it('补丁合并进已有的状态', () => {
    const next = withInstanceState(board(), 'first', { minutes: 40 })
    expect(next.instances[0]?.state).toEqual({ minutes: 40, endsAt: 0 })
  })

  it('原来没有状态时补丁就是全部', () => {
    const next = withInstanceState(board(), 'second', { day: 3 })
    expect(next.instances[1]?.state).toEqual({ day: 3 })
  })

  it('补丁不是普通对象时整体替换', () => {
    expect(withInstanceState(board(), 'first', null).instances[0]?.state).toBeNull()
    expect(withInstanceState(board(), 'first', [1, 2]).instances[0]?.state).toEqual([1, 2])
  })

  it('只动给定的那张卡，也不改原来的看板', () => {
    const current = board()
    const next = withInstanceState(current, 'second', { day: 1 })
    expect(next).not.toBe(current)
    expect(next.instances[0]).toEqual(current.instances[0])
    expect(current.instances[1]?.state).toBeNull()
  })

  it('看板上没有这张卡时报错', () => {
    expect(() => withInstanceState(board(), 'missing', {})).toThrow(/看板上没有这张卡/)
  })
})

describe('卡片布局', () => {
  it('一次提交只换给定的卡片，其余卡片原样保留', () => {
    const current = board()
    const next = withBoardLayouts(current, { second: { x: 0, y: 30, w: 2, h: 12 } })
    expect(next.instances[0]).toBe(current.instances[0])
    expect(next.instances[1]?.layout).toEqual({ x: 0, y: 30, w: 2, h: 12 })
    expect(current.instances[1]?.layout).toEqual({ x: 1, y: 0, w: 1, h: 22 })
  })

  it('看板上没有这张卡时整份提交都拒绝', () => {
    expect(() => withBoardLayouts(board(), { missing: { x: 0, y: 0, w: 1, h: 10 } })).toThrow(/看板上没有这张卡/)
  })

  it('布局不合法时整份提交都拒绝', () => {
    expect(() => withBoardLayouts(board(), { first: { x: 3, y: 0, w: 2, h: 10 } })).toThrow(/布局不合法/)
    expect(() => withBoardLayouts(board(), { first: { x: 0, y: 0, w: 1, h: 1 } })).toThrow(/布局不合法/)
  })

  it('旧看板补上修订号与缺失的卡片盒子', () => {
    const legacy = board() as unknown as Record<string, unknown>
    delete legacy.revision
    delete legacy.layoutRevision
    const instances = legacy.instances as Array<Record<string, unknown>>
    delete instances[1]?.layout
    const result = withLayouts(legacy as unknown as Board)
    expect(result.changed).toBe(true)
    expect(result.board.revision).toBe(0)
    expect(result.board.layoutRevision).toBe(0)
    expect(result.board.instances[1]?.layout).toEqual({ x: 1, y: 0, w: 1, h: 22 })
  })

  it('已经完整的看板不改动', () => {
    expect(withLayouts(board())).toEqual({ board: board(), changed: false })
  })
})

describe('卡片的数据', () => {
  it('换掉给定卡片的数据，其余卡片原样保留', () => {
    const current = board()
    const next = withInstanceData(current, 'second', { place: 'Shanghai' })
    expect(next.instances[1]?.data).toEqual({ place: 'Shanghai' })
    expect(next.instances[0]).toBe(current.instances[0])
  })

  it('看板上没有这张卡时报错', () => {
    expect(() => withInstanceData(board(), 'missing', null)).toThrow(/看板上没有这张卡/)
  })
})

describe('加卡片与移除卡片', () => {
  /** 一个已经在校验过的组件记录，只添加卡片用得上的字段。 */
  function record(id: string): WidgetRecord {
    return {
      hash: id.padEnd(64, '0'),
      dir: `/widgets/${id}`,
      source: 'builtin',
      manifest: { id, title: { zh: id, en: id }, version: '0.1.0', sizes: ['s'] },
      files: new Map(),
    }
  }

  it('新卡片放在最矮的一列底部，带组件当前的哈希', () => {
    const added = withInstanceAdded(board(), record('todo'))
    const instance = added.board.instances[2]
    expect(added.board.instances).toHaveLength(3)
    expect(instance?.id).toBe(added.id)
    expect(instance?.widget).toBe('todo')
    expect(instance?.hash).toBe('todo'.padEnd(64, '0'))
    expect(instance?.state).toBeNull()
    expect(instance?.layout).toEqual({ x: 2, y: 0, w: 1, h: 22 })
  })

  it('新卡片能带上数据源的名字与 props', () => {
    const added = withInstanceAdded(board(), record('usage'), { source: 'claude-style.usage', props: { days: 30 } })
    expect(added.board.instances[2]?.source).toBe('claude-style.usage')
    expect(added.board.instances[2]?.props).toEqual({ days: 30 })
  })

  it('移除只去掉那一张卡', () => {
    const next = withInstanceRemoved(board(), 'first')
    expect(next.instances.map((instance) => instance.id)).toEqual(['second'])
  })

  it('移除看板上没有的卡片时报错', () => {
    expect(() => withInstanceRemoved(board(), 'missing')).toThrow(/看板上没有这张卡/)
  })
})
