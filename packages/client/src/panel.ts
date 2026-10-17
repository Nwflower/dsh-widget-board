import { createElement } from 'react'
import type { ReactNode } from 'react'
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
  slotsOf,
} from '@dsh-widget-board/contracts'
import { BoardPage } from './board'
import { PanelIcon } from './panel-icon'
import { BoardSettings } from './settings'

/**
 * 注册侧栏入口、中栏页面与设置页里的那一节（D21）。
 *
 * 三次注册都经 `inject` 等宿主声明插槽：本插件与外壳的加载顺序因此不影响结果，宿主没有那个
 * 插槽时这一处不出现，界面照常启动。
 *
 * @param ctx - 浏览器半边的根上下文。
 * @returns 释放函数，随插件卸载解除三处注册。
 */
export function registerPanel(ctx: Context): () => void {
  const slots = slotsOf(ctx)
  /** 看板页要跟随宿主的主题，所以把上下文原样交给它（D10）。 */
  const Page = (): ReactNode => createElement(BoardPage, { context: ctx })
  const disposers = [
    slots.inject(SIDEBAR_PANELLIST_SLOT, () => slots.register({
      name: SIDEBAR_PANELLIST_SLOT,
      id: WIDGET_BOARD_PANEL_ID,
      order: PANEL_ORDER,
      label: PANEL_LABEL,
    }, PanelIcon)),
    slots.inject(MAIN_SLOT, () => slots.register({
      name: MAIN_SLOT,
      key: WIDGET_BOARD_PANEL_ID,
    }, Page)),
    // 看板的改名、移除与选中收在设置页（D21）；标签条上只留切换与新建。
    slots.inject(SETTINGS_SECTION_SLOT, () => slots.register({
      name: SETTINGS_SECTION_SLOT,
      id: SETTINGS_SECTION_ID,
      order: SETTINGS_SECTION_ORDER,
      label: SETTINGS_SECTION_LABEL,
    }, BoardSettings)),
  ]
  return () => {
    for (const dispose of disposers.splice(0)) dispose()
  }
}
