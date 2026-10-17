/**
 * 三处注册（D1、D21）：侧栏入口、中栏页面与设置页里的那一节。
 *
 * 宿主的插槽服务用最小的替身：只记下每次注册的名字与选项，并交回释放函数。这一层判定的是本插件
 * 注册了什么形状；宿主怎么画由 docs/host-surfaces.md 记下的形状与真实宿主上的冒烟负责。
 */
import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import {
  MAIN_SLOT,
  PANEL_LABEL,
  PANEL_ORDER,
  SETTINGS_SECTION_ID,
  SETTINGS_SECTION_LABEL,
  SETTINGS_SECTION_ORDER,
  SETTINGS_SECTION_SLOT,
  SIDEBAR_PANELLIST_SLOT,
  WIDGET_BOARD_PANEL_ID,
} from '@dsh-widget-board/contracts'
import { registerPanel } from '../src/panel'

/** 一次注册留下的记录。 */
interface Registration {
  slot: string
  options: Record<string, unknown>
  component: unknown
}

/**
 * 一套替身插槽：`inject` 立刻回调，`register` 记下这一次注册。
 *
 * @returns 上下文、注册记录与每处注册的释放函数。
 */
function harness(): { ctx: Context, registrations: Registration[], released: () => number } {
  const registrations: Registration[] = []
  const releases: Array<() => void> = []
  const slots = {
    inject(_slot: string, callback: () => () => void): () => void {
      // 替身不等宿主声明：立刻回调，交回它给的释放函数。
      return callback()
    },
    register(options: Record<string, unknown>, component: unknown): () => void {
      registrations.push({ slot: String(options.name), options, component })
      const dispose = vi.fn()
      releases.push(dispose)
      return dispose
    },
  }
  return {
    ctx: { slots } as unknown as Context,
    registrations,
    released: () => releases.filter((release) => vi.isMockFunction(release) && release.mock.calls.length > 0).length,
  }
}

describe('面板注册', () => {
  it('注册侧栏入口、中栏页面与设置页里的一节，三处都等宿主声明插槽', () => {
    const test = harness()
    registerPanel(test.ctx)
    expect(test.registrations.map((entry) => entry.slot)).toEqual([SIDEBAR_PANELLIST_SLOT, MAIN_SLOT, SETTINGS_SECTION_SLOT])
  })

  it('侧栏行与中栏页面共用同一个面板 id', () => {
    const test = harness()
    registerPanel(test.ctx)
    const [row, page] = test.registrations
    expect(row?.options).toEqual({ name: SIDEBAR_PANELLIST_SLOT, id: WIDGET_BOARD_PANEL_ID, order: PANEL_ORDER, label: PANEL_LABEL })
    expect(page?.options).toEqual({ name: MAIN_SLOT, key: WIDGET_BOARD_PANEL_ID })
  })

  it('设置页里的一节用契约里的 id、排位与标签', () => {
    const test = harness()
    registerPanel(test.ctx)
    const section = test.registrations[2]
    expect(section?.options).toEqual({
      name: SETTINGS_SECTION_SLOT,
      id: SETTINGS_SECTION_ID,
      order: SETTINGS_SECTION_ORDER,
      label: SETTINGS_SECTION_LABEL,
    })
    expect(typeof section?.options.label).toBe('function')
    expect((section?.options.label as () => string)()).toBe('看板')
  })

  it('释放时把三处注册都解掉', () => {
    const test = harness()
    const dispose = registerPanel(test.ctx)
    dispose()
    expect(test.released()).toBe(3)
    // 再释放一次不会重复解：数组已经空了。
    dispose()
    expect(test.released()).toBe(3)
  })
})
