/**
 * 盒子档位的判定（D16）：宽度与高度各自取档，边界值归到更高的一档。
 */
import { describe, expect, it } from 'vitest'
import { BOX_HEIGHT_SHORT, BOX_HEIGHT_TALL, BOX_WIDTH_NARROW, BOX_WIDTH_WIDE, boxClassesOf } from '../src/widget'

describe('盒子档位', () => {
  it('看板上的常规卡片', () => {
    expect(boxClassesOf(365, 352)).toEqual({ width: 'regular', height: 'regular' })
  })

  it('窄列与矮盒子', () => {
    expect(boxClassesOf(288, 224)).toEqual({ width: 'narrow', height: 'short' })
  })

  it('两列宽的高卡片', () => {
    expect(boxClassesOf(743, 416)).toEqual({ width: 'wide', height: 'tall' })
  })

  it('边界值归到更高的一档', () => {
    expect(boxClassesOf(BOX_WIDTH_NARROW, BOX_HEIGHT_SHORT)).toEqual({ width: 'regular', height: 'regular' })
    expect(boxClassesOf(BOX_WIDTH_WIDE, BOX_HEIGHT_TALL)).toEqual({ width: 'wide', height: 'tall' })
  })

  it('窄而高的卡片两个方向分开判定', () => {
    expect(boxClassesOf(300, 480)).toEqual({ width: 'narrow', height: 'tall' })
  })
})
