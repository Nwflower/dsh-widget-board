import type { Context } from '@deepseek-ai/cordis'
import {
  MAIN_SLOT,
  PANEL_LABEL,
  PANEL_ORDER,
  SIDEBAR_PANELLIST_SLOT,
  WIDGET_BOARD_PANEL_ID,
  slotsOf,
} from '@dsh-widget-board/contracts'
import { BoardPage } from './board'
import { PanelIcon } from './panel-icon'

/**
 * 注册侧栏入口与中栏页面。
 *
 * 两次注册都经 `inject` 等宿主声明插槽：本插件与外壳的加载顺序因此不影响结果，宿主没有那个
 * 插槽时这一处不出现，界面照常启动。
 *
 * @param ctx - 浏览器半边的根上下文。
 * @returns 释放函数，随插件卸载解除两处注册。
 */
export function registerPanel(ctx: Context): () => void {
  const slots = slotsOf(ctx)
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
    }, BoardPage)),
  ]
  return () => {
    for (const dispose of disposers.splice(0)) dispose()
  }
}
