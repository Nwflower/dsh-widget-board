import { describe, expect, it } from 'vitest'
import { seatInTitlebar } from '../src/titlebar'

/** 一块 1440px 宽的桌面窗口：看板栏从侧栏右缘开始，窗口按钮占右端 140px，标签条宽 100px。 */
const WINDOW = {
  container: { left: 280, top: 40 },
  height: 40,
  controlsLeft: 1300,
  stripWidth: 100,
  windows: true,
}

describe('标题栏里的标签条位置', () => {
  it('Windows 桌面端让出标题栏时，标签条靠左放在菜单之后', () => {
    expect(seatInTitlebar(WINDOW)).toEqual({ height: 40, left: 300, right: 1288 })
  })

  it('其他平台没有这种标题栏', () => {
    expect(seatInTitlebar({ ...WINDOW, windows: false })).toBeNull()
  })

  it('宿主没有让出标题栏时不挂', () => {
    expect(seatInTitlebar({ ...WINDOW, container: { ...WINDOW.container, top: 0 } })).toBeNull()
  })

  it('侧栏更宽时跟着看板这一栏的左缘走', () => {
    expect(seatInTitlebar({ ...WINDOW, container: { left: 400, top: 40 } })).toEqual({
      height: 40,
      left: 412,
      right: 1288,
    })
  })

  it('窗口按钮把右侧推到菜单之前时不挂', () => {
    expect(seatInTitlebar({ ...WINDOW, controlsLeft: 240 })).toBeNull()
  })

  it('标签条比标题栏的可用区域宽时不挂', () => {
    expect(seatInTitlebar({ ...WINDOW, stripWidth: 1200 })).toBeNull()
  })

  it('还没有标签时不挂', () => {
    expect(seatInTitlebar({ ...WINDOW, stripWidth: 0 })).toBeNull()
  })
})
