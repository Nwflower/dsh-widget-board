import { describe, expect, it } from 'vitest'
import type { Board } from '@dsh-widget-board/contracts'
import { gridMetrics } from '@dsh-widget-board/model'
import { nextArrangementOf } from '../src/board-arrangement'

const metrics = gridMetrics(1000, 16)
const board: Board = {
  version: 3, id: 'board', title: '看板', revision: 1, layoutRevision: 1,
  arrangement: { mode: 'free' },
  instances: ['one', 'two', 'three'].map((id, index) => ({
    id, widget: 'demo', hash: 'a'.repeat(64), props: {}, state: null, data: null,
    layout: { x: index === 2 ? 1 : 0, y: 0, w: 1, h: 22 },
  })),
}

describe('排列模式切换', () => {
  it('首次切换采用碰撞处理后的屏幕阅读顺序', () => {
    expect(nextArrangementOf(board, metrics).aligned?.order).toEqual(['one', 'three', 'two'])
  })
  it('切回整齐模式保留用户顺序与期望尺寸', () => {
    const arrangement = { mode: 'aligned' as const, aligned: { order: ['three', 'two', 'one'], boxes: { three: { w: 2, h: 26 }, two: { w: 1, h: 26 }, one: { w: 1, h: 14 } } } }
    const free = nextArrangementOf({ ...board, arrangement }, metrics)
    expect(free.mode).toBe('free')
    expect(nextArrangementOf({ ...board, arrangement: free }, metrics)).toEqual(arrangement)
  })
})
