/**
 * 断点与尺寸族的单元测试（D4）：边界、像素盒与降级都要确定。
 */
import { describe, expect, it } from 'vitest'
import { BREAKPOINTS, breakpointOf, familyBox, metricsOf, resolveFamily } from '../src/grid'

describe('断点', () => {
  it('按容器宽度落在对的断点上', () => {
    for (const point of BREAKPOINTS) expect(breakpointOf(point.min).name).toBe(point.name)
  })

  it('边界的两侧', () => {
    expect(breakpointOf(559).name).toBe('xs')
    expect(breakpointOf(560).name).toBe('sm')
    expect(breakpointOf(899).name).toBe('sm')
    expect(breakpointOf(900).name).toBe('md')
    expect(breakpointOf(1759).name).toBe('lg')
    expect(breakpointOf(1760).name).toBe('xl')
  })
})

describe('网格量', () => {
  it('列宽按列数与间距算出来', () => {
    const metrics = metricsOf(1280, 16)
    // lg：12 列，间距 12px，列宽 (1280 - 11 × 12) / 12
    expect(metrics.breakpoint).toBe('lg')
    expect(metrics.columns).toBe(12)
    expect(metrics.gap).toBe(12)
    expect(metrics.rowHeight).toBe(100)
    expect(metrics.columnWidth).toBeCloseTo((1280 - 11 * 12) / 12, 5)
  })

  it('根字号放大时行高跟着放大', () => {
    expect(metricsOf(900, 20).rowHeight).toBe(125)
  })

  it('尺寸族的像素盒与跨的格一致', () => {
    const metrics = metricsOf(1280, 16)
    const small = familyBox('s', metrics)
    expect(small.cols).toBe(2)
    expect(small.rows).toBe(2)
    expect(small.w).toBeCloseTo(metrics.columnWidth * 2 + metrics.gap, 5)
    expect(small.h).toBe(2 * metrics.rowHeight + metrics.gap)
    expect(familyBox('hero', metrics).cols).toBe(metrics.columns)
    expect(familyBox('hero', metrics).rows).toBe(3)
  })
})

describe('尺寸族的选择', () => {
  it('放得下的族里取最大的一个', () => {
    expect(resolveFamily(['s', 'l'], metricsOf(1280, 16))).toBe('l')
    expect(resolveFamily(['s', 'm', 'l'], metricsOf(900, 16))).toBe('l')
  })

  it('一个都放不下时降级到最小的那个', () => {
    // xs 只有 2 列：l 与 m 都要 4 列，只剩 s。
    expect(resolveFamily(['s', 'l'], metricsOf(480, 16))).toBe('s')
  })

  it('只声明了位置族时抛出，由卡片自己显示失败', () => {
    expect(() => resolveFamily(['rail', 'inline'], metricsOf(1280, 16))).toThrow(/网格族/)
  })

  it('同样的输入给出同样的答案', () => {
    // md 有 8 列：wide 正好占满，面积最大。
    const metrics = metricsOf(1100, 16)
    const first = resolveFamily(['s', 'm', 'wide'], metrics)
    for (let run = 0; run < 5; run += 1) expect(resolveFamily(['s', 'm', 'wide'], metrics)).toBe(first)
    expect(first).toBe('wide')
  })
})
