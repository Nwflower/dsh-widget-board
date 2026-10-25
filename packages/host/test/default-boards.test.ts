/**
 * 第一次启动的两块看板（D17）：清单的顺序与位置、确定性，以及写入的内容通过组件自己的 schema。
 *
 * 组件库读的是 `packages/widgets` 里的真实内置组件，清单与组件的 manifest 对不上时这里先失败。
 */
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Board, BoardInstance, CardLayout } from '@dsh-widget-board/contracts'
import { gridMetrics, isCardLayout, resolveLayout } from '@dsh-widget-board/model'
import { GALLERY_BOARD_TITLE, MY_BOARD_TITLE, seedBoards } from '../src/default-boards'
import { loadLibrary } from '../src/library'
import type { WidgetRecord } from '../src/library'
import { dataError, propsError } from '../src/schema'

const WIDGETS = fileURLToPath(new URL('../../widgets', import.meta.url))

let records: Map<string, WidgetRecord>

beforeAll(async () => {
  records = (await loadLibrary([{ dir: WIDGETS, source: 'builtin' }])).records
})

/** 一块看板上每张卡的组件 id，按存放的先后。 */
const widgetsOf = (board: Board): string[] => board.instances.map((instance) => instance.widget)

/** 看板的形状：忽略每次新生成的 id。 */
const shapeOf = (board: Board): unknown => ({
  title: board.title,
  instances: board.instances.map(({ id: _id, group, ...rest }) => ({ ...rest, group: group === undefined ? undefined : { ...group, id: '' } })),
})

describe('第一次启动的看板', () => {
  it('两块：「我的看板」在前，「组件画廊」在后', () => {
    const [mine, gallery] = seedBoards(records)
    expect(mine.title).toBe(MY_BOARD_TITLE)
    expect(gallery.title).toBe(GALLERY_BOARD_TITLE)
    expect(mine.id).not.toBe(gallery.id)
  })

  it('「我的看板」按清单的顺序与位置铺卡：前两行各三张，日历组与余额卡在第三行，热力图在第四列', () => {
    const [mine] = seedBoards(records)
    expect(widgetsOf(mine)).toEqual(['board-hero', 'weather', 'pomodoro', 'todo', 'clock', 'calendar', 'fortune', 'dsh-balance', 'heatmap'])
    expect(mine.instances.map((instance) => instance.layout)).toEqual([
      { x: 0, y: 0, w: 2, h: 18 },
      { x: 2, y: 0, w: 1, h: 18 },
      { x: 0, y: 20, w: 1, h: 14 },
      { x: 1, y: 20, w: 1, h: 14 },
      { x: 2, y: 20, w: 1, h: 14 },
      { x: 0, y: 36, w: 2, h: 22 },
      { x: 0, y: 36, w: 2, h: 22 },
      { x: 2, y: 36, w: 1, h: 22 },
      { x: 3, y: 0, w: 1, h: 18 },
    ])
    const [front, back] = mine.instances.filter((instance) => instance.group !== undefined)
    expect(front?.widget).toBe('calendar')
    expect(back?.widget).toBe('fortune')
    expect(front?.group).toMatchObject({ template: 'flip', side: 'front' })
    expect(back?.group).toMatchObject({ template: 'flip', side: 'back' })
    expect(front?.group?.id).toBe(back?.group?.id)
  })

  it('「我的看板」每行同高、卡片之间互不重叠，四列与三列的窗口里前三行都不被推乱', () => {
    const [mine] = seedBoards(records)
    const cards = mine.instances.filter((instance) => instance.group?.side !== 'back')
    const rows = Map.groupBy(cards, (instance) => instance.layout.y)
    for (const row of rows.values()) expect(new Set(row.map((instance) => instance.layout.h)).size).toBe(1)
    for (const [index, first] of cards.entries()) {
      for (const second of cards.slice(index + 1)) {
        const apart = first.layout.x + first.layout.w <= second.layout.x || second.layout.x + second.layout.w <= first.layout.x
          || first.layout.y + first.layout.h <= second.layout.y || second.layout.y + second.layout.h <= first.layout.y
        expect(apart, `${first.widget} 与 ${second.widget} 重叠`).toBe(true)
      }
    }
    // 三列的窗口：三列之内的盒子留在原位，第四列的热力图上落到第三列的底部（组卡的两面是同一个盒子）。
    const placed = resolveLayout(cards.map((instance) => ({ id: instance.id, layout: instance.layout })), gridMetrics(1120)).layouts
    expect(gridMetrics(1120).columns).toBe(3)
    for (const instance of cards.filter((card) => card.layout.x + card.layout.w <= 3)) {
      expect(placed[instance.id]?.y, `${instance.widget} 在三列里被推开`).toBe(instance.layout.y)
    }
    for (const instance of cards.filter((card) => card.layout.x === 3)) {
      expect((placed[instance.id] as CardLayout).y).toBeGreaterThanOrEqual(20)
    }
  })

  it('画廊把每个内置组件各铺一张，类别的次序固定', () => {
    const [, gallery] = seedBoards(records)
    const builtin = [...records.values()].filter((record) => record.source === 'builtin').map((record) => record.manifest.id)
    expect(widgetsOf(gallery).sort()).toEqual([...builtin].sort())
    expect(widgetsOf(gallery)).toEqual([
      'stat', 'gauge', 'progress', 'chart', 'heatmap', 'table', 'kv', 'list', 'timeline', 'image', 'markdown', 'json', 'diff', 'dsh-balance', 'github-issues',
      'board-hero', 'clock', 'calendar', 'fortune', 'year-progress', 'weather', 'pomodoro', 'todo', 'links', 'light-switch',
      'flip-card', 'holographic-card', 'magnetic-card', 'system-metrics',
    ])
  })

  it('画廊的卡片都在三列之内，同一行同高，每一行从上到下排开', () => {
    const [, gallery] = seedBoards(records)
    for (const instance of gallery.instances) expect(isCardLayout(instance.layout)).toBe(true)
    const rows = Map.groupBy(gallery.instances, (instance) => instance.layout.y)
    const tops = [...rows.keys()]
    expect(tops).toEqual([...tops].sort((left, right) => left - right))
    for (const row of rows.values()) {
      expect(new Set(row.map((instance) => instance.layout.h)).size).toBe(1)
      expect(row.reduce((sum, instance) => sum + instance.layout.w, 0)).toBeLessThanOrEqual(3)
    }
  })

  it('画廊里表格与键值写入了自己的内容，不再露出样例里的故障状态', () => {
    const [, gallery] = seedBoards(records)
    const text = JSON.stringify(gallery.instances.filter((instance) => instance.widget === 'table' || instance.widget === 'kv'))
    for (const word of ['重连中', '未绑定', '0.0.0']) expect(text).not.toContain(word)
  })

  it('卡片带着组件当前的哈希，天气卡接上默认数据源', () => {
    const [mine, gallery] = seedBoards(records)
    for (const instance of [...mine.instances, ...gallery.instances]) {
      expect(instance.hash).toBe(records.get(instance.widget)?.hash)
    }
    const weather = (board: Board): BoardInstance | undefined => board.instances.find((instance) => instance.widget === 'weather')
    expect(weather(mine)?.source).toBe(records.get('weather')?.manifest.source)
    expect(weather(gallery)?.source).toBe(records.get('weather')?.manifest.source)
  })

  it('写入的 props 与 data 都通过组件自己的 schema', () => {
    for (const board of seedBoards(records)) {
      for (const instance of board.instances) {
        const manifest = records.get(instance.widget)?.manifest
        expect(propsError(manifest?.props, instance.props), `${board.title} 的 ${instance.widget} props`).toBeUndefined()
        if (instance.data !== null) expect(dataError(manifest?.data, instance.data), `${board.title} 的 ${instance.widget} data`).toBeUndefined()
      }
    }
  })

  it('重复生成得到同样的内容，只有看板与卡片的 id 不同', () => {
    const first = seedBoards(records)
    const second = seedBoards(records)
    expect(first.map(shapeOf)).toEqual(second.map(shapeOf))
    expect(first[0].id).not.toBe(second[0].id)
  })

  it('用户与插件来源的组件不铺卡', () => {
    const extra: WidgetRecord = { ...(records.get('stat') as WidgetRecord), source: 'user', manifest: { ...(records.get('stat') as WidgetRecord).manifest, id: 'mine-extra' } }
    const [, gallery] = seedBoards(new Map([...records, ['mine-extra', extra]]))
    expect(widgetsOf(gallery)).not.toContain('mine-extra')
  })

  it('清单里的内置组件不在组件库里时抛出', () => {
    const partial = new Map(records)
    partial.delete('heatmap')
    expect(() => seedBoards(partial)).toThrow(/heatmap/)
  })

  it('内置组件库多出清单没有列出的组件时，放在画廊末尾', () => {
    const base = records.get('stat') as WidgetRecord
    const added: WidgetRecord = { ...base, manifest: { ...base.manifest, id: 'zeta' } }
    const [, gallery] = seedBoards(new Map([...records, ['zeta', added]]))
    expect(widgetsOf(gallery).at(-1)).toBe('zeta')
  })
})
