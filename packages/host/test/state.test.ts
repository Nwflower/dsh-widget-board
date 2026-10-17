/**
 * 卡片状态的合并（D5）：组件送来的是补丁，宿主是唯一写入者。
 *
 * 状态存在宿主上，卡片重挂之后靠它把会话接回来；合并规则只有一条，所以由单元测试盯着。
 */
import { describe, expect, it } from 'vitest'
import type { Board } from '@dsh-widget-board/contracts'
import type { WidgetRecord } from '../src/library'
import { withInstanceState, withNewWidgets } from '../src/state'

/** 一块带两张卡的看板。 */
function board(): Board {
  return {
    version: 1,
    id: 'board',
    title: '看板',
    instances: [
      { id: 'first', widget: 'pomodoro', hash: 'a'.repeat(64), props: {}, data: null, state: { minutes: 25, endsAt: 0 } },
      { id: 'second', widget: 'weather', hash: 'b'.repeat(64), props: {}, data: null, state: null },
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

describe('新组件的补卡', () => {
  /** 一个已经在校验过的组件记录，只填补卡用得上的字段。 */
  function record(id: string): WidgetRecord {
    return { hash: id.padEnd(64, '0'), dir: `/widgets/${id}`, manifest: { id, title: { zh: id, en: id }, version: '0.1.0', sizes: ['s'] } } as WidgetRecord
  }

  it('组件库里有、看板上没有的组件补一张卡', () => {
    const library = new Map([['pomodoro', record('pomodoro')], ['weather', record('weather')], ['third', record('third')]])
    const next = withNewWidgets(board(), library)
    expect(next?.instances.map((instance) => instance.widget)).toEqual(['pomodoro', 'weather', 'third'])
  })

  it('补进来的卡按组件 id 排序', () => {
    const library = new Map([
      ['pomodoro', record('pomodoro')],
      ['weather', record('weather')],
      ['zeta', record('zeta')],
      ['alpha', record('alpha')],
    ])
    const next = withNewWidgets(board(), library)
    expect(next?.instances.map((instance) => instance.widget)).toEqual(['pomodoro', 'weather', 'alpha', 'zeta'])
  })

  it('没有新组件时什么都不做', () => {
    const library = new Map([['pomodoro', record('pomodoro')], ['weather', record('weather')]])
    expect(withNewWidgets(board(), library)).toBeNull()
  })

  it('补进来的卡带自己的 id 与组件库里的哈希', () => {
    const library = new Map([['pomodoro', record('pomodoro')], ['weather', record('weather')], ['third', record('third')]])
    const instance = withNewWidgets(board(), library)?.instances[2]
    expect(instance?.id).not.toBe('')
    expect(instance?.widget).toBe('third')
    expect(instance?.hash).toBe('third'.padEnd(64, '0'))
    expect(instance?.state).toBeNull()
  })
})
