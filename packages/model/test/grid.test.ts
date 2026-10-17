/**
 * 卡片栅格的单元测试（D16）：列数、位置、重叠推开与确定性。
 */
import { describe, expect, it } from 'vitest'
import type { CardLayout } from '@dsh-widget-board/contracts'
import {
  DEFAULT_HEIGHT_REM,
  GAP_REM,
  MAX_COLUMNS,
  MAX_HEIGHT_REM,
  MIN_COLUMN_REM,
  MIN_HEIGHT_REM,
  ceilCardY,
  gridMetrics,
  isCardLayout,
  nextCardLayout,
  normalizeCardLayout,
  resolveLayout,
  snapCardHeight,
  snapCardY,
  tidyLayout,
} from '../src/grid'

/** 一张卡片的布局。 */
function layout(x: number, y: number, w = 1, h = 10): CardLayout {
  return { x, y, w, h }
}

describe('列数', () => {
  it('一列有最小宽度，放得下几列就是几列', () => {
    expect(gridMetrics(280, 16).columns).toBe(1)
    expect(gridMetrics(300, 16).columns).toBe(1)
    expect(gridMetrics(620, 16).columns).toBe(2)
    expect(gridMetrics(920, 16).columns).toBe(3)
    expect(gridMetrics(1220, 16).columns).toBe(4)
  })

  it('不会超过最多列数，也不会少于 1 列', () => {
    expect(gridMetrics(4000, 16).columns).toBe(MAX_COLUMNS)
    expect(gridMetrics(1, 16).columns).toBe(1)
    expect(gridMetrics(0, 16).columns).toBe(1)
  })

  it('列宽吃掉间距，总宽与容器一致', () => {
    const metrics = gridMetrics(920, 16)
    const total = metrics.columns * metrics.columnWidth + (metrics.columns - 1) * metrics.gap
    expect(total).toBeCloseTo(920, 5)
    expect(metrics.gap).toBe(GAP_REM * 16)
    expect(metrics.columnWidth).toBeGreaterThanOrEqual(MIN_COLUMN_REM * 16)
  })

  it('根字号放大时一列的最小宽度跟着放大', () => {
    expect(gridMetrics(920, 20).columns).toBe(2)
  })
})

describe('位置档位', () => {
  it('纵向位置取最近的 2rem，自动堆叠向上取', () => {
    expect(snapCardY(0)).toBe(0)
    expect(snapCardY(1.2)).toBe(2)
    expect(snapCardY(4.5)).toBe(4)
    expect(snapCardY(5)).toBe(6)
    expect(snapCardY(-3)).toBe(0)
    expect(ceilCardY(4.5)).toBe(6)
    expect(ceilCardY(4)).toBe(4)
    expect(ceilCardY(0)).toBe(0)
  })

  it('归一化布局时把纵向位置收进 2rem', () => {
    expect(normalizeCardLayout(layout(0, 4.5, 1, 22))).toEqual({ x: 0, y: 4, w: 1, h: 22 })
  })
})

describe('高度档位', () => {
  it('取最接近的档位，中间值取高一档', () => {
    expect(snapCardHeight(1)).toBe(6)
    expect(snapCardHeight(9)).toBe(10)
    expect(snapCardHeight(11)).toBe(10)
    expect(snapCardHeight(12)).toBe(14)
    expect(snapCardHeight(20)).toBe(22)
    expect(snapCardHeight(24)).toBe(26)
    expect(snapCardHeight(99)).toBe(30)
  })

  it('归一化布局时把高度收进档位', () => {
    expect(normalizeCardLayout(layout(0, 0, 1, 23))).toEqual({ x: 0, y: 0, w: 1, h: 22 })
    expect(normalizeCardLayout(layout(0, 0, 1, 27))).toEqual({ x: 0, y: 0, w: 1, h: 26 })
  })
})

describe('布局的形状', () => {
  it('收进列数与高度的范围', () => {
    expect(normalizeCardLayout(layout(-2, -1, 9, 1))).toEqual({ x: 0, y: 0, w: 4, h: MIN_HEIGHT_REM })
    expect(normalizeCardLayout(layout(3, 10, 4, 500))).toEqual({ x: 0, y: 10, w: 4, h: MAX_HEIGHT_REM })
    expect(normalizeCardLayout(layout(0, 0, 1, 10), 2)).toEqual({ x: 0, y: 0, w: 1, h: 10 })
  })

  it('列号与列跨度是整数，跨列不能越界', () => {
    expect(isCardLayout({ x: 0, y: 0, w: 1, h: 10 })).toBe(true)
    expect(isCardLayout({ x: 3, y: 0, w: 2, h: 10 })).toBe(false)
    expect(isCardLayout({ x: 0.5, y: 0, w: 1, h: 10 })).toBe(false)
    expect(isCardLayout({ x: 0, y: 0, w: 1, h: MIN_HEIGHT_REM - 1 })).toBe(false)
  })
})

describe('摆放', () => {
  it('每张卡片按自己的列号与高度落在像素位置上', () => {
    // 两列，列宽 100，间距 10，根字号 16。
    const metrics = { columns: 2, columnWidth: 100, gap: 10, rootFontSize: 16 }
    const result = resolveLayout([
      { id: 'a', layout: layout(0, 0, 1, 10) },
      { id: 'b', layout: layout(1, 2, 1, 6) },
    ], metrics)
    expect(result.placements.map((placement) => [placement.id, placement.x, placement.y])).toEqual([
      ['a', 0, 0],
      ['b', 110, 32],
    ])
    expect(result.placements[0]?.width).toBe(100)
    expect(result.placements[1]?.height).toBe(96)
    expect(result.height).toBe(160)
  })

  it('重叠的卡片往下推开，保留拖动那一张的目标位置', () => {
    const metrics = { columns: 2, columnWidth: 100, gap: 10, rootFontSize: 16 }
    const result = resolveLayout([
      { id: 'top', layout: layout(0, 0, 1, 10) },
      { id: 'moved', layout: layout(0, 0, 1, 10) },
    ], metrics, 'moved')
    expect(result.placements.map((placement) => [placement.id, placement.y])).toEqual([
      ['top', 192],
      ['moved', 0],
    ])
    expect(result.layouts.top?.y).toBe(12)
  })

  it('跨列的卡片占住所覆盖的每一列', () => {
    const metrics = { columns: 2, columnWidth: 100, gap: 10, rootFontSize: 16 }
    const result = resolveLayout([
      { id: 'wide', layout: layout(0, 0, 2, 10) },
      { id: 'next', layout: layout(0, 0, 1, 10) },
    ], metrics)
    expect(result.placements.map((placement) => [placement.id, placement.x, placement.y])).toEqual([
      ['wide', 0, 0],
      ['next', 0, 192],
    ])
    expect(result.placements[0]?.width).toBe(210)
  })

  it('列数变少时横向位置被截断，纵向位置保留', () => {
    const metrics = { columns: 2, columnWidth: 100, gap: 10, rootFontSize: 16 }
    const result = resolveLayout([
      { id: 'a', layout: layout(0, 0, 1, 10) },
      { id: 'b', layout: layout(3, 30, 1, 10) },
    ], metrics)
    expect(result.placements.map((placement) => [placement.id, placement.x, placement.y])).toEqual([
      ['a', 0, 0],
      ['b', 110, 480],
    ])
    expect(result.layouts.b?.x).toBe(1)
  })

  it('同样的输入给出同样的位置', () => {
    const metrics = gridMetrics(920, 16)
    const items = [
      { id: 'a', layout: layout(0, 0, 1, 12) },
      { id: 'b', layout: layout(1, 0, 1, 8) },
      { id: 'c', layout: layout(2, 0, 2, 6) },
      { id: 'd', layout: layout(0, 8, 1, 10) },
    ]
    const first = resolveLayout(items, metrics)
    for (let run = 0; run < 5; run += 1) expect(resolveLayout(items, metrics)).toEqual(first)
  })

  it('空看板的高度是 0', () => {
    expect(resolveLayout([], gridMetrics(920, 16))).toEqual({ placements: [], layouts: {}, height: 0 })
  })
})

describe('紧凑排布', () => {
  it('按画面上的从上到下、从左到右重新放进最矮的列', () => {
    const metrics = { columns: 2, columnWidth: 100, gap: 10, rootFontSize: 16 }
    const result = tidyLayout([
      { id: 'lower', layout: layout(2, 30, 1, 10) },
      { id: 'upper', layout: layout(0, 10, 1, 10) },
    ], metrics)
    expect(result).toEqual({
      upper: { x: 0, y: 0, w: 1, h: 10 },
      lower: { x: 1, y: 0, w: 1, h: 10 },
    })
  })

  it('跨列卡片占住覆盖的列，后面的卡片落在它下面', () => {
    const metrics = { columns: 2, columnWidth: 100, gap: 10, rootFontSize: 16 }
    const result = tidyLayout([
      { id: 'wide', layout: layout(0, 0, 2, 10) },
      { id: 'next', layout: layout(0, 0, 1, 6) },
    ], metrics)
    expect(result.wide).toEqual({ x: 0, y: 0, w: 2, h: 10 })
    expect(result.next).toEqual({ x: 0, y: 12, w: 1, h: 6 })
  })

  it('高矮不同的卡片各自落在当前最矮的列，不留下大洞', () => {
    const metrics = { columns: 2, columnWidth: 100, gap: 10, rootFontSize: 16 }
    const result = tidyLayout([
      { id: 'tall', layout: layout(0, 0, 1, 22) },
      { id: 'short', layout: layout(1, 0, 1, 6) },
      { id: 'next', layout: layout(1, 8, 1, 6) },
    ], metrics)
    expect(result.tall).toEqual({ x: 0, y: 0, w: 1, h: 22 })
    expect(result.short).toEqual({ x: 1, y: 0, w: 1, h: 6 })
    expect(result.next).toEqual({ x: 1, y: 8, w: 1, h: 6 })
  })

  it('同样的输入给出同样的排布', () => {
    const metrics = gridMetrics(920, 16)
    const items = [
      { id: 'a', layout: layout(2, 20, 1, 8) },
      { id: 'b', layout: layout(0, 0, 2, 6) },
      { id: 'c', layout: layout(1, 9, 1, 10) },
    ]
    const first = tidyLayout(items, metrics)
    for (let run = 0; run < 5; run += 1) expect(tidyLayout(items, metrics)).toEqual(first)
  })

  it('空看板给出空表', () => {
    expect(tidyLayout([], gridMetrics(920, 16))).toEqual({})
  })
})

describe('新卡片的默认位置', () => {
  it('放进最矮的一列底部', () => {
    const first = nextCardLayout([])
    expect(first).toEqual({ x: 0, y: 0, w: 1, h: DEFAULT_HEIGHT_REM })
    const second = nextCardLayout([{ layout: first }])
    expect(second.x).toBe(1)
    expect(second.y).toBe(0)
  })

  it('底部算上跨列卡片占住的那几列', () => {
    const wide = layout(0, 0, 2, 20)
    const next = nextCardLayout([{ layout: wide }])
    expect(next.x).toBe(2)
    expect(next.y).toBe(0)
    const after = nextCardLayout([{ layout: wide }, { layout: next }])
    expect(after.x).toBe(3)
    expect(after.y).toBe(0)
  })

  it('四列都被占到之后，新卡片落在最矮的一列底部并隔一个间距', () => {
    const next = nextCardLayout([{ layout: layout(0, 0, 4, DEFAULT_HEIGHT_REM) }])
    expect(next).toEqual({ x: 0, y: 24, w: 1, h: DEFAULT_HEIGHT_REM })
  })

  it('组件声明的默认盒子决定新卡片的宽高', () => {
    const hero = nextCardLayout([], { w: 2, h: 14 })
    expect(hero).toEqual({ x: 0, y: 0, w: 2, h: 14 })
    expect(nextCardLayout([{ layout: hero }], { w: 1, h: 10 })).toEqual({ x: 2, y: 0, w: 1, h: 10 })
  })
})
