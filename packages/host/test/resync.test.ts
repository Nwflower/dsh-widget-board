/**
 * 生产接线上的重算条件（D6、D32）：一条通知除了推给在线页面，还要决定定时链与订阅表要不要重算。
 *
 * 组件的 props 是订阅身份的一部分（D32）：设置弹窗改完 props 发的是 `{ type: 'instance', id, props }`，
 * 少了这一步，订阅会一直按改之前的 props 读下去。状态、数据与布局的写入不该触发重算——番茄钟每秒
 * 写一次状态，带上它就是把全部看板的卡片表重算一遍。
 */
import { describe, expect, it } from 'vitest'
import type { BoardEvent } from '@dsh-widget-board/contracts'
import { resyncsSources } from '../src/index'

describe('变更通知驱动的重算', () => {
  it('带 props 的 instance 事件要重算', () => {
    expect(resyncsSources({ type: 'instance', id: 'card', props: { title: 'y' } })).toBe(true)
    expect(resyncsSources({ type: 'instance', id: 'card', props: {} })).toBe(true)
    // 与状态一起发出来的 props 同样要重算：判定看的是这一条里有没有 props。
    expect(resyncsSources({ type: 'instance', id: 'card', state: { n: 1 }, props: { title: 'y' } })).toBe(true)
  })

  it('看板增删与组件库变化照旧要重算', () => {
    expect(resyncsSources({ type: 'board' })).toBe(true)
  })

  it('状态、数据、补丁、布局与换看板都不重算', () => {
    const quiet: BoardEvent[] = [
      { type: 'instance', id: 'card', state: { minutes: 25 } },
      { type: 'instance', id: 'card', patch: { minutes: 5 } },
      { type: 'instance', id: 'card', data: { temperature: 21 } },
      { type: 'layout', board: 'board-first', layoutRevision: 2, layouts: {} },
      { type: 'active', board: 'board-second' },
    ]
    for (const event of quiet) expect(resyncsSources(event)).toBe(false)
  })
})
