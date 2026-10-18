/**
 * 会话里的工具视图（D9）：`widget_define` 与 `widget_show` 的结果直接画出组件。
 *
 * 注册在 `tool.call.toolview` 上，按线上工具名分派；宿主没有这个插槽时视图不出现，工具照常可用。
 * 视图收到的 `block.meta` 是工具随结果存进会话日志的那一份，实时与重放两条路上都是它（D9）。
 */
import { createElement } from 'react'
import type { ComponentType, ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { TOOL_VIEW_SLOT, WIDGET_TOOL_NAMES, slotsOf } from '@dsh-widget-board/contracts'
import type { ToolViewProps } from '@dsh-widget-board/contracts'
import { DefineView } from './tool-define'
import { ShowView } from './tool-show'

/** 一个工具视图：宿主按工具名分派时把它们当成普通组件渲染。 */
type View = ComponentType<Record<string, unknown>>

/**
 * 注册两个工具视图；宿主没有工具视图这一处插槽时什么也不做。
 *
 * @param ctx - 浏览器半边的根上下文。
 * @returns 释放函数。
 */
export function registerToolViews(ctx: Context): () => void {
  const slots = slotsOf(ctx)
  /** 两个视图都要拿到插件根上下文：主题服务在它上面（D10）。 */
  const wrapper = (View: View) => (props: ToolViewProps): ReactNode => createElement(View, { ...props, context: ctx })
  const disposers = [
    slots.inject(TOOL_VIEW_SLOT, () => slots.register({ name: TOOL_VIEW_SLOT, key: WIDGET_TOOL_NAMES.show }, wrapper(ShowView as View))),
    slots.inject(TOOL_VIEW_SLOT, () => slots.register({ name: TOOL_VIEW_SLOT, key: WIDGET_TOOL_NAMES.define }, wrapper(DefineView as View))),
  ]
  return () => {
    for (const dispose of disposers.splice(0)) dispose()
  }
}
