/**
 * 会话里的工具视图（D9）：`widget_show` 的结果画成一张内联组件，`widget_define` 的视图替宿主做
 * 自检、再把结论与预览画出来。
 *
 * 注册经 `slots.inject` 等宿主声明那个插槽：宿主没有它时这一处不出现，界面照常启动。视图由工厂
 * 造出来——它要拿浏览器半边的上下文去跟随宿主主题（D10）。
 */
import { createElement } from 'react'
import type { ComponentType, ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolViewProps } from '@dsh-widget-board/contracts'
import { TOOL_VIEW_SLOT, WIDGET_TOOL_NAMES, slotsOf } from '@dsh-widget-board/contracts'
import { InlineWidget } from './inline'
import { DefineView } from './tool-define'

/** 一个工具视图：收到宿主的属性与插件根上下文。 */
type View = ComponentType<ToolViewProps & { context: unknown }>

/**
 * 注册 `widget_show` 与 `widget_define` 的工具视图。
 *
 * @param ctx - 浏览器半边的根上下文。
 * @returns 释放函数，随插件卸载解除注册。
 */
export function registerToolView(ctx: Context): () => void {
  const slots = slotsOf(ctx)
  const bind = (View: View) => (props: ToolViewProps): ReactNode => createElement(View, { ...props, context: ctx })
  const disposers = [
    slots.inject(TOOL_VIEW_SLOT, () => slots.register({ name: TOOL_VIEW_SLOT, key: WIDGET_TOOL_NAMES.show }, bind(InlineWidget))),
    slots.inject(TOOL_VIEW_SLOT, () => slots.register({ name: TOOL_VIEW_SLOT, key: WIDGET_TOOL_NAMES.define }, bind(DefineView as View))),
  ]
  return () => {
    for (const dispose of disposers.splice(0)) dispose()
  }
}
