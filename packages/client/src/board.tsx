import type { ReactNode } from 'react'
import { WIDGET_BOARD_PANEL_ID } from '@dsh-widget-board/contracts'

/**
 * 中栏的看板页面。
 *
 * 卡片、栅格与拖拽在 PLAN 步骤 6 接入；这一页眼下是一块空的看板面。根节点带语义属性
 * `data-dsh-widget-board-view`，供皮肤插件定位（D1）。
 */
export function BoardPage(): ReactNode {
  return (
    <div className="dsh-widget-board" data-dsh-widget-board-view={WIDGET_BOARD_PANEL_ID}>
      <div className="dsh-widget-board__empty" data-dsh-widget-board-empty="">
        <p className="dsh-widget-board__title">看板还没有卡片</p>
        <p className="dsh-widget-board__hint">卡片是小组件：一组数字、一张图表、一份清单。组件写好之后会出现在这里。</p>
      </div>
    </div>
  )
}
