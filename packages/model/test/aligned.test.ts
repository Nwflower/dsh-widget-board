/**
 * 整齐行列的单元测试（D32）：逐行铺开、同排等高、跨列换行、不回填、动态根字号。
 *
 * 这里只测纯计算：给一串顺序与期望盒子，看它算出什么像素位置。自由布局的既有测试在 grid.test.ts，
 * 两种模式各自不变量、互不改写。
 */
import { describe, expect, it } from 'vitest'
import type { CardLayout } from '@dsh-widget-board/contracts'
import {
  displayColumns,
  fittedBox,
  normalizeAligned,
  orderFromFree,
  orderWith,
  placementOf,
  resolveAlignedLayout,
  rowHeightFor,
  withoutItems,
} from '../src/aligned'

/** 三列、列宽 100、间距 0.75rem（16px 下是 12）、根字号 16 的栅格。 */
const METRICS = { columns: 3, columnWidth: 100, gap: 12, rootFontSize: 16 }

/** 一张卡片的自由布局。 */
function layout(x: number, y: number, w = 1, h = 10): CardLayout {
  return { x, y, w, h }
}

describe('逐行铺开', () => {
  it('两列加一列同排，同排一样高', () => {
    const layoutResult = resolveAlignedLayout([
      { id: 'a', box: { w: 2, h: 18 } },
      { id: 'b', box: { w: 1, h: 14 } },
    ], METRICS)
    expect(layoutResult.placements.map((placement) => [placement.id, placement.x, placement.y, placement.width, placement.height])).toEqual([
      ['a', 0, 0, 212, 288],
      ['b', 224, 0, 100, 288],
    ])
  })

  it('第二行接在第一行下面，隔一个间距', () => {
    const layoutResult = resolveAlignedLayout([
      { id: 'a', box: { w: 2, h: 18 } },
      { id: 'b', box: { w: 1, h: 14 } },
      { id: 'c', box: { w: 1, h: 14 } },
    ], METRICS)
    expect(layoutResult.placements.map((placement) => [placement.id, placement.y, placement.height])).toEqual([
      ['a', 0, 288],
      ['b', 0, 288],
      ['c', 300, 224],
    ])
    expect(layoutResult.height).toBe(524)
  })

  it('跨列放不下就换行，不回填前一排剩下的空位', () => {
    const four = { columns: 4, columnWidth: 100, gap: 12, rootFontSize: 16 }
    const layoutResult = resolveAlignedLayout([
      { id: 'wide', box: { w: 2, h: 10 } },
      { id: 'one', box: { w: 1, h: 10 } },
      { id: 'next', box: { w: 2, h: 10 } },
    ], four)
    // 第一行放前两张，留一列；第三张要两列，只能另起一行。
    expect(layoutResult.placements.map((placement) => [placement.id, placement.x, placement.y])).toEqual([
      ['wide', 0, 0],
      ['one', 224, 0],
      ['next', 0, 172],
    ])
  })

  it('一列时每张卡片占一整行', () => {
    const one = { columns: 1, columnWidth: 320, gap: 12, rootFontSize: 16 }
    const layoutResult = resolveAlignedLayout([
      { id: 'a', box: { w: 3, h: 10 } },
      { id: 'b', box: { w: 1, h: 6 } },
    ], one)
    expect(layoutResult.placements.map((placement) => [placement.id, placement.x, placement.width, placement.columns])).toEqual([
      ['a', 0, 320, 1],
      ['b', 0, 320, 1],
    ])
  })

  it('空看板的高度是 0', () => {
    expect(resolveAlignedLayout([], METRICS)).toEqual({ placements: [], height: 0 })
  })

  it('同样的输入给出同样的排布', () => {
    const items = [
      { id: 'a', box: { w: 1, h: 18 } },
      { id: 'b', box: { w: 2, h: 14 } },
      { id: 'c', box: { w: 1, h: 10 } },
      { id: 'd', box: { w: 3, h: 6 } },
    ]
    const first = resolveAlignedLayout(items, METRICS)
    for (let run = 0; run < 5; run += 1) expect(resolveAlignedLayout(items, METRICS)).toEqual(first)
  })
})

describe('行高', () => {
  it('取这一排里最高的期望高度，不超过高度档', () => {
    const layoutResult = resolveAlignedLayout([
      { id: 'short', box: { w: 1, h: 6 } },
      { id: 'tall', box: { w: 1, h: 26 } },
    ], METRICS)
    expect(layoutResult.placements.map((placement) => placement.height)).toEqual([416, 416])
  })

  it('最小盒子把整排抬上去', () => {
    const layoutResult = resolveAlignedLayout([
      { id: 'a', box: { w: 1, h: 6 } },
      { id: 'b', box: { w: 1, h: 6 } },
    ], METRICS, (id) => id === 'b' ? { w: 1, h: 18 } : undefined)
    expect(layoutResult.placements.map((placement) => placement.height)).toEqual([288, 288])
  })

  it('宽度按列数截断，不能把卡片挤出看板', () => {
    const two = { columns: 2, columnWidth: 100, gap: 10, rootFontSize: 16 }
    const layoutResult = resolveAlignedLayout([{ id: 'wide', box: { w: 4, h: 10 } }], two)
    expect(layoutResult.placements[0]?.columns).toBe(2)
    expect(layoutResult.placements[0]?.width).toBe(210)
  })

  it('横向间距与纵向间距都是同一个 0.75rem，不经过 free 的 2rem 吸附', () => {
    const one = { columns: 1, columnWidth: 320, gap: 12, rootFontSize: 16 }
    const layoutResult = resolveAlignedLayout([
      { id: 'a', box: { w: 1, h: 10 } },
      { id: 'b', box: { w: 1, h: 10 } },
    ], one)
    // 高度 10rem = 160px，第二行 top 是 160 + 12，不是 2rem 的整数倍。
    expect(layoutResult.placements[1]?.y).toBe(160 + 12)
  })
})

describe('动态根字号', () => {
  it('14px 的根字号下横纵间距一起变小', () => {
    const small = { columns: 1, columnWidth: 90, gap: 0.75 * 14, rootFontSize: 14 }
    const layoutResult = resolveAlignedLayout([
      { id: 'a', box: { w: 1, h: 10 } },
      { id: 'b', box: { w: 1, h: 10 } },
    ], small)
    expect(layoutResult.placements[0]?.height).toBe(140)
    expect(layoutResult.placements[1]?.y).toBe(140 + 10.5)
  })

  it('20px 的根字号下高度按档位放大', () => {
    const large = { columns: 2, columnWidth: 120, gap: 15, rootFontSize: 20 }
    const layoutResult = resolveAlignedLayout([{ id: 'a', box: { w: 1, h: 18 } }], large)
    expect(layoutResult.placements[0]?.height).toBe(360)
  })
})

describe('盒子拟合', () => {
  it('期望的列数与高度被收进合法档位', () => {
    expect(fittedBox({ w: 9, h: 11 }, undefined, 3)).toEqual({ w: 3, h: 10 })
    expect(fittedBox({ w: 0, h: 100 }, undefined, 3)).toEqual({ w: 1, h: 30 })
  })

  it('最小盒子把宽度与高度抬上去', () => {
    expect(fittedBox({ w: 1, h: 6 }, { w: 2, h: 14 }, 3)).toEqual({ w: 2, h: 14 })
  })

  it('当前列数装不下最小宽度时按列数截断', () => {
    expect(fittedBox({ w: 1, h: 6 }, { w: 3, h: 10 }, 2)).toEqual({ w: 2, h: 10 })
  })

  it('显示宽度与摆放用的是同一条规则', () => {
    const minBox = { w: 2, h: 14 }
    expect(displayColumns({ w: 1, h: 6 }, minBox, 3)).toBe(fittedBox({ w: 1, h: 6 }, minBox, 3).w)
  })
})

describe('排列偏好', () => {
  it('规范化去掉重复与空 id，只留顺序里有的盒子', () => {
    expect(normalizeAligned(['a', 'a', '', 'b'], { a: { w: 1, h: 10 }, b: { w: 3, h: 26 }, c: { w: 1, h: 6 } }))
      .toEqual({ order: ['a', 'b'], boxes: { a: { w: 1, h: 10 }, b: { w: 3, h: 26 } } })
  })

  it('新卡片接在末尾，已经在顺序里的不重复', () => {
    expect(orderWith(['a'], 'b')).toEqual(['a', 'b'])
    expect(orderWith(['a', 'b'], 'a')).toEqual(['a', 'b'])
  })

  it('移除卡片时顺序与盒子一起清掉', () => {
    expect(withoutItems(['a', 'b', 'c'], { a: { w: 1, h: 10 }, b: { w: 1, h: 10 }, c: { w: 1, h: 10 } }, ['b']))
      .toEqual({ order: ['a', 'c'], boxes: { a: { w: 1, h: 10 }, c: { w: 1, h: 10 } } })
  })

  it('第一次切到整齐时按屏幕上从上到下、从左到右取顺序', () => {
    expect(orderFromFree([
      { id: 'lower', layout: layout(0, 30) },
      { id: 'upper-right', layout: layout(2, 0) },
      { id: 'upper-left', layout: layout(0, 0) },
    ])).toEqual(['upper-left', 'upper-right', 'lower'])
  })

  it('同一个位置的两张卡片按原来的输入次序', () => {
    expect(orderFromFree([
      { id: 'first', layout: layout(0, 0) },
      { id: 'second', layout: layout(0, 0) },
    ])).toEqual(['first', 'second'])
  })

  it('行高取这一排里最高的那个档', () => {
    expect(rowHeightFor([{ w: 1, h: 6 }, { w: 1, h: 22 }], [undefined, undefined])).toBe(22)
    expect(rowHeightFor([{ w: 1, h: 6 }, { w: 1, h: 6 }], [undefined, { w: 1, h: 14 }])).toBe(14)
  })
})

describe('按 id 取摆放', () => {
  it('摆放结果按 id 找得到，找不到时是 undefined', () => {
    const layoutResult = resolveAlignedLayout([{ id: 'a', box: { w: 1, h: 10 } }], METRICS)
    expect(placementOf(layoutResult.placements, 'a')?.columns).toBe(1)
    expect(placementOf(layoutResult.placements, 'ghost')).toBeUndefined()
  })
})
