/**
 * 会话里的工具视图（D9）：`widget_show` 的结果画成一张内联组件。
 *
 * 注册经 `slots.inject` 等宿主声明那个插槽：宿主没有它时这一处不出现，界面照常启动。视图由工厂
 * 造出来——它要拿浏览器半边的上下文去跟随宿主主题（D10）。
 */
import { createElement } from 'react'
import type { ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { TOOL_VIEW_SLOT, WIDGET_TOOL_NAMES, slotsOf } from '@dsh-widget-board/contracts'
import type { InlineViewProps } from './inline'
import { InlineWidget } from './inline'

/**
 * 注册 `widget_show` 的工具视图。
 *
 * @param ctx - 浏览器半边的根上下文。
 * @returns 释放函数，随插件卸载解除注册。
 */
export function registerToolView(ctx: Context): () => void {
  const slots = slotsOf(ctx)
  const View = (props: Omit<InlineViewProps, 'context'>): ReactNode => createElement(InlineWidget, { ...props, context: ctx })
  return slots.inject(TOOL_VIEW_SLOT, () => slots.register({ name: TOOL_VIEW_SLOT, key: WIDGET_TOOL_NAMES.show }, View))
}
