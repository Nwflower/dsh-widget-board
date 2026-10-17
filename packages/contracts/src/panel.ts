import type { SlotLabel } from './slots'

/** 侧栏面板行与中栏页面共用的面板 id：行的 `id` 与页面的 `key` 是同一个值。 */
export const WIDGET_BOARD_PANEL_ID = 'widget-board'

/** 侧栏里的排位。已占用的：插件页 0、定时任务 10、任务看板 20。 */
export const PANEL_ORDER = 30

/**
 * 侧栏行的标签。外壳每次读它都重新调用，所以语言切换不需要重新注册。
 *
 * 目前只有中文：宿主的多语言服务接入在 PLAN 步骤 6 与页面文案一起做。
 */
export const PANEL_LABEL: SlotLabel = () => '看板'
