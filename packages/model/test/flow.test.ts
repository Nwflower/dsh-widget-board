/**
 * 信息流布局的单元测试（D15）：列数、位置与确定性。
 */
import { describe, expect, it } from 'vitest'
import { flowLayout, flowMetrics, GAP_REM, MAX_COLUMNS, MIN_COLUMN_REM } from '../src/flow'

describe('列数', () => {
  it('一列有最小宽度，放得下几列就是几列', () => {
    // 18rem + 0.75rem 的格子：宽度每跨过一个格距就多一列。
    expect(flowMetrics(280, 16).columns).toBe(1)
    expect(flowMetrics(300, 16).columns).toBe(1)
    expect(flowMetrics(620, 16).columns).toBe(2)
    expect(flowMetrics(920, 16).columns).toBe(3)
    expect(flowMetrics(1220, 16).columns).toBe(4)
  })

  it('不会超过最多列数，也不会少于 1 列', () => {
    expect(flowMetrics(4000, 16).columns).toBe(MAX_COLUMNS)
    expect(flowMetrics(1, 16).columns).toBe(1)
    expect(flowMetrics(0, 16).columns).toBe(1)
  })

  it('列宽吃掉间距，总宽与容器一致', () => {
    const metrics = flowMetrics(920, 16)
    const total = metrics.columns * metrics.columnWidth + (metrics.columns - 1) * metrics.gap
    expect(total).toBeCloseTo(920, 5)
    expect(metrics.gap).toBe(GAP_REM * 16)
    expect(metrics.columnWidth).toBeGreaterThanOrEqual(MIN_COLUMN_REM * 16)
  })

  it('根字号放大时一列的最小宽度跟着放大', () => {
    expect(flowMetrics(920, 20).columns).toBe(2)
  })
})

describe('摆放', () => {
  it('按阅读顺序放进最矮的一列', () => {
    // 三列，列宽 100，间距 10：每张 50 高。
    const metrics = { columns: 3, columnWidth: 100, gap: 10 }
    const layout = flowLayout([{ id: 'a', height: 50 }, { id: 'b', height: 50 }, { id: 'c', height: 50 }, { id: 'd', height: 50 }], metrics)
    // a、b、c 各占一列的第一行，d 回到最矮的第一列。
    expect(layout.placements.map((placement) => [placement.id, placement.x, placement.y])).toEqual([
      ['a', 0, 0],
      ['b', 110, 0],
      ['c', 220, 0],
      ['d', 0, 60],
    ])
    expect(layout.height).toBe(110)
  })

  it('高矮不同的卡片不会互相撑出一个空洞', () => {
    const metrics = { columns: 2, columnWidth: 100, gap: 10 }
    const layout = flowLayout([{ id: 'tall', height: 200 }, { id: 'short', height: 50 }, { id: 'next', height: 50 }], metrics)
    // tall 在左列；short 在右列；next 回到右列（左列 210、右列 60）。
    expect(layout.placements.map((placement) => [placement.id, placement.x, placement.y])).toEqual([
      ['tall', 0, 0],
      ['short', 110, 0],
      ['next', 110, 60],
    ])
    // 最高的一列是左列：200 加一次间距，内容高度不含末尾那一次间距。
    expect(layout.height).toBe(200)
  })

  it('同样的输入给出同样的位置', () => {
    const metrics = flowMetrics(920, 16)
    const items = [
      { id: 'a', height: 320 },
      { id: 'b', height: 210 },
      { id: 'c', height: 480 },
      { id: 'd', height: 150 },
    ]
    const first = flowLayout(items, metrics)
    for (let run = 0; run < 5; run += 1) expect(flowLayout(items, metrics)).toEqual(first)
  })

  it('空看板的高度是 0', () => {
    expect(flowLayout([], flowMetrics(920, 16))).toEqual({ placements: [], height: 0 })
  })
})
