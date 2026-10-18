/**
 * 卡片状态的合并（D5）：组件送来的是补丁，宿主是唯一写入者。
 *
 * 状态存在宿主上，卡片重挂之后靠它把会话接回来；合并规则只有一条，所以由单元测试盯着。
 */
import { describe, expect, it } from 'vitest'
import type { Board, BoardInstance, WidgetMinBox } from '@dsh-widget-board/contracts'
import type { WidgetRecord } from '../src/library'
import { seedBoard, withBoardLayouts, withDefaultSources, withGroupAdded, withGroupRemoved, withInstanceAdded, withInstanceData, withInstanceRemoved, withInstanceState, withLayouts } from '../src/state'

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

/** 一个已经在校验过的组件记录。 */
function record(id: string, minBox?: WidgetMinBox): WidgetRecord {
  return {
    hash: id.padEnd(64, '0'),
    dir: `/widgets/${id}`,
    source: 'builtin',
    manifest: { id, title: { zh: id, en: id }, version: '0.1.0', sizes: ['s'], ...(minBox === undefined ? {} : { minBox }) },
    files: new Map(),
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
    expect(next.instances[1]?.layout).toEqual({ x: 0, y: 30, w: 2, h: 14 })
    expect(current.instances[1]?.layout).toEqual({ x: 1, y: 0, w: 1, h: 22 })
  })

  it('看板上没有这张卡时整份提交都拒绝', () => {
    expect(() => withBoardLayouts(board(), { missing: { x: 0, y: 0, w: 1, h: 10 } })).toThrow(/看板上没有这张卡/)
  })

  it('布局不合法时整份提交都拒绝', () => {
    expect(() => withBoardLayouts(board(), { first: { x: 3, y: 0, w: 2, h: 10 } })).toThrow(/布局不合法/)
    expect(() => withBoardLayouts(board(), { first: { x: 0, y: 0, w: 1, h: 1 } })).toThrow(/布局不合法/)
  })

  it('提交的布局低于最小盒子时抬到最小盒子', () => {
    const next = withBoardLayouts(board(), { first: { x: 0, y: 0, w: 1, h: 6 } }, () => ({ w: 2, h: 14 }))
    expect(next.instances[0]?.layout).toEqual({ x: 0, y: 0, w: 2, h: 14 })
  })

  it('载入看板时把低于最小盒子的盒子抬上来', () => {
    const result = withLayouts(board(), (widget) => widget === 'weather' ? { w: 2, h: 26 } : undefined)
    expect(result.changed).toBe(true)
    expect(result.board.instances[1]?.layout).toEqual({ x: 1, y: 0, w: 2, h: 26 })
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

describe('默认数据源', () => {
  it('第一次铺卡时接上组件声明的默认数据源', () => {
    const weather = record('weather')
    weather.manifest.source = 'http'
    const seeded = seedBoard(new Map([['weather', weather]]), '看板')
    expect(seeded.instances[0]?.source).toBe('http')
  })

  it('旧卡片没有数据源时补上组件声明的那个', () => {
    const weather = record('weather')
    weather.manifest.source = 'http'
    const result = withDefaultSources(board(), new Map([['weather', weather]]))
    expect(result.changed).toBe(true)
    expect(result.board.instances[1]?.source).toBe('http')
    expect(result.board.instances[0]?.source).toBeUndefined()
  })

  it('已经绑了数据源的卡片不动，组件没有默认源时也不动', () => {
    const current = board()
    current.instances[1] = { ...current.instances[1] as BoardInstance, source: 'demo:count' }
    const result = withDefaultSources(current, new Map([['weather', record('weather')]]))
    expect(result.changed).toBe(false)
    expect(result.board).toBe(current)
    expect(result.board.instances[1]?.source).toBe('demo:count')
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

  it('组件声明的默认盒子决定新卡片的宽高', () => {
    const hero = record('hero')
    hero.manifest.defaultBox = { w: 2, h: 14 }
    const instance = withInstanceAdded(board(), hero).board.instances[2]
    expect(instance?.layout).toEqual({ x: 2, y: 0, w: 2, h: 14 })
  })

  it('默认盒子与拖放落点都不低于最小盒子', () => {
    const sized = record('sized', { w: 2, h: 14 })
    sized.manifest.defaultBox = { w: 1, h: 6 }
    expect(withInstanceAdded(board(), sized).board.instances[2]?.layout).toEqual({ x: 2, y: 0, w: 2, h: 14 })
    expect(withInstanceAdded(board(), sized, { layout: { x: 0, y: 0, w: 1, h: 6 } }).board.instances[2]?.layout)
      .toEqual({ x: 0, y: 0, w: 2, h: 14 })
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

describe('翻面组', () => {
  it('一次加出正面与背面两张普通卡片，共用一个组 id 与盒子', () => {
    const added = withGroupAdded(board(), record('stat'), record('chart'))
    const [front, back] = added.board.instances.slice(2)
    expect(added.board.instances).toHaveLength(4)
    expect(front?.group?.id).toBe(added.id)
    expect(back?.group?.id).toBe(added.id)
    expect(front?.group?.side).toBe('front')
    expect(back?.group?.side).toBe('back')
    expect(front?.group?.template).toBe('flip')
    expect(front?.widget).toBe('stat')
    expect(back?.widget).toBe('chart')
    expect(front?.layout).toEqual({ x: 2, y: 0, w: 1, h: 22 })
    expect(back?.layout).toEqual(front?.layout)
  })

  it('拖动落点给两张卡用同一份', () => {
    const added = withGroupAdded(board(), record('stat'), record('chart'), { layout: { x: 1, y: 4.5, w: 2, h: 26 } })
    expect(added.board.instances.slice(2).map((instance) => instance.layout)).toEqual([
      { x: 1, y: 4, w: 2, h: 26 },
      { x: 1, y: 4, w: 2, h: 26 },
    ])
  })

  it('组卡的最小盒子取正反两面的并集', () => {
    const added = withGroupAdded(board(), record('stat', { w: 1, h: 10 }), record('chart', { w: 2, h: 14 }), { layout: { x: 0, y: 0, w: 1, h: 6 } })
    expect(added.board.instances.slice(2).map((instance) => instance.layout)).toEqual([
      { x: 0, y: 0, w: 2, h: 14 },
      { x: 0, y: 0, w: 2, h: 14 },
    ])
  })

  it('移除整组时两张卡一起离开', () => {
    const added = withGroupAdded(board(), record('stat'), record('chart'))
    const next = withGroupRemoved(added.board, added.id)
    expect(next.instances.map((instance) => instance.id)).toEqual(['first', 'second'])
  })

  it('只提交正面时，背面的盒子跟着换到同一份', () => {
    const added = withGroupAdded(board(), record('stat'), record('chart'))
    const front = added.board.instances[2] as BoardInstance
    const next = withBoardLayouts(added.board, { [front.id]: { x: 0, y: 30, w: 2, h: 12 } })
    expect(next.instances.slice(2).map((instance) => instance.layout)).toEqual([
      { x: 0, y: 30, w: 2, h: 14 },
      { x: 0, y: 30, w: 2, h: 14 },
    ])
  })

  it('移除看板上没有的组时报错', () => {
    expect(() => withGroupRemoved(board(), 'missing')).toThrow(/看板上没有这一组/)
  })
})
