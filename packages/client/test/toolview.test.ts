/**
 * 内联视图（D9）：工具视图的注册形状与载荷的判定。
 *
 * 宿主的插槽服务用最小的替身，只记下这一次注册；画出来什么样由真实宿主上的冒烟与人工核对负责。
 * 载荷的判定是纯函数，直接判。
 */
import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { TOOL_VIEW_SLOT, WIDGET_TOOL_NAMES } from '@dsh-widget-board/contracts'
import { showOf, textOf } from '../src/inline-value'
import { registerToolView } from '../src/toolview'

/** 一份完整的载荷：看板上的一张卡。 */
function payload(): Record<string, unknown> {
  return {
    id: 'card-1',
    widget: 'stat',
    hash: 'a'.repeat(64),
    source: 'demo:count',
    props: { title: '本周' },
    data: { n: 7 },
    state: { page: 1 },
    family: 'l',
    summary: {
      hash: 'a'.repeat(64),
      title: { zh: '数字', en: 'Stat' },
      sizes: ['s', 'l'],
      source: 'builtin',
    },
    board: { id: 'board', title: '看板' },
  }
}

describe('工具视图的注册', () => {
  it('按 widget_show 这个名字注册在会话工具视图插槽上', () => {
    const registrations: Array<{ slot: string, options: Record<string, unknown> }> = []
    const dispose = vi.fn()
    const ctx = {
      slots: {
        inject: (_slot: string, callback: () => () => void) => callback(),
        register: (options: Record<string, unknown>) => {
          registrations.push({ slot: String(options.name), options })
          return dispose
        },
      },
    } as unknown as Context
    const release = registerToolView(ctx)
    expect(registrations).toHaveLength(1)
    expect(registrations[0]?.slot).toBe(TOOL_VIEW_SLOT)
    expect(registrations[0]?.options).toEqual({ name: TOOL_VIEW_SLOT, key: WIDGET_TOOL_NAMES.show })
    release()
    expect(dispose).toHaveBeenCalledTimes(1)
  })
})

describe('内联载荷的判定', () => {
  it('看板上的卡带着它的位置与组件元信息', () => {
    const shown = showOf(payload())
    expect(shown).toMatchObject({ id: 'card-1', widget: 'stat', family: 'l', board: { id: 'board', title: '看板' } })
    expect(shown?.summary.title.zh).toBe('数字')
  })

  it('一次性快照没有看板位置', () => {
    const value = payload()
    delete value.board
    expect(showOf(value)?.board).toBeUndefined()
  })

  it('形状不对时给 undefined', () => {
    expect(showOf(undefined)).toBeUndefined()
    expect(showOf('nope')).toBeUndefined()
    expect(showOf([])).toBeUndefined()
    expect(showOf({ ...payload(), id: '' })).toBeUndefined()
    expect(showOf({ ...payload(), family: '' })).toBeUndefined()
    expect(showOf({ ...payload(), props: [] })).toBeUndefined()
    expect(showOf({ ...payload(), summary: { title: { en: 'Stat' } } })).toBeUndefined()
  })
})

describe('结果里的文字', () => {
  it('拼起文字块，忽略别的块', () => {
    expect(textOf([{ type: 'text', text: '第一行' }, { type: 'image' }, { text: '第二行' }])).toBe('第一行\n第二行')
  })

  it('没有文字时给 undefined', () => {
    expect(textOf(undefined)).toBeUndefined()
    expect(textOf([{ type: 'text', text: '  ' }])).toBeUndefined()
  })
})
