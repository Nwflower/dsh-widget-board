/**
 * 卡片状态的合并（D5）：组件送来的是补丁，宿主是唯一写入者。
 *
 * 状态存在宿主上，卡片重挂之后靠它把会话接回来；合并规则只有一条，所以由单元测试盯着。
 */
import { describe, expect, it } from 'vitest'
import type { Board } from '@dsh-widget-board/contracts'
import { withInstanceState } from '../src/state'

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
