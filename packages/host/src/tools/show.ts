/**
 * `widget_show`：把一张卡、或一份一次性的 props 与 data，画进当前会话（D9）。
 *
 * 工具本身不画东西：它定下要画的版本（内容哈希）与那一刻的 props、data、state，交给会话里的工具
 * 视图。这一份随工具结果存进会话日志，会话重新打开时视图按同一个哈希从版本库取回当时的组件文档
 * （D7），画出来的就是当时的样子。会话里的画面是只读的快照：组件写的状态不回到看板。
 */
import type { ShowValue, WidgetToolSpec } from '@dsh-widget-board/contracts'
import { WIDGET_TOOL_NAMES, ToolRefusal, withinLimit } from '@dsh-widget-board/contracts'
import { DEFAULT_HEIGHT_REM, snapCardHeight } from '@dsh-widget-board/model'
import { isRecord } from '../guards'
import type { ToolContext } from './index'

/**
 * 把模型给的高度收进看板的高度档位（D16）。
 *
 * @param value - 模型给的高度（rem）。
 * @param fallback - 没给时用的高度。
 * @returns 一个档位上的高度。
 */
function heightOf(value: unknown, fallback: number): number {
  if (value === undefined) return snapCardHeight(fallback)
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new ToolRefusal('height 要是一个数（rem）')
  return snapCardHeight(value)
}

/**
 * `widget_show`：在会话里画出一个组件。
 *
 * @param context - 工具要动的那些东西。
 * @returns 工具的注册项。
 */
export function showTool(context: ToolContext): WidgetToolSpec {
  return {
    name: WIDGET_TOOL_NAMES.show,
    description: 'Render a widget inline in this conversation. Pass `card` to show a board card as it is right now, or `widget` with optional `props` and `data` to show a one-off snapshot without touching any board. The inline view is a read-only snapshot pinned to the current widget version, so it still renders the same way when the conversation is reopened.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        card: { type: 'string', description: 'Id of a board card (from widget_board). Shows its props, data and state as they are now.' },
        widget: { type: 'string', description: 'Widget id from widget_catalog, for a one-off snapshot. Ignored when `card` is given.' },
        props: { type: 'object', description: 'Props for the snapshot; must match the widget props schema.' },
        data: { description: 'Data for the snapshot; must match the widget data schema.' },
        height: { type: 'number', description: 'Height in rem, snapped to the board height steps (6 to 30). Defaults to the card height or the widget default box.' },
      },
    },
    async execute(args) {
      const wanted = (isRecord(args) ? args : {}) as { card?: unknown, widget?: unknown, props?: unknown, data?: unknown, height?: unknown }
      let value: ShowValue
      if (typeof wanted.card === 'string' && wanted.card !== '') {
        const found = context.route.workspace.findInstance(wanted.card)
        if (found === undefined) throw new ToolRefusal(`看板上没有这张卡：${wanted.card}`)
        const { instance } = found
        const record = context.route.records.get(instance.widget)
        if (record === undefined) throw new ToolRefusal(`卡片 ${instance.id} 的组件 ${instance.widget} 现在不在组件库里，画不出来`)
        value = {
          widget: instance.widget,
          title: record.manifest.title,
          hash: instance.hash,
          props: instance.props,
          data: instance.data ?? null,
          state: instance.state ?? null,
          height: heightOf(wanted.height, instance.layout.h),
          card: instance.id,
        }
      } else {
        if (typeof wanted.widget !== 'string' || wanted.widget === '') throw new ToolRefusal('widget_show 要写明 card，或写明 widget')
        const record = context.route.records.get(wanted.widget)
        if (record === undefined) throw new ToolRefusal(`组件库里没有可用的组件 ${wanted.widget}，先用 widget_catalog 看有哪些`)
        if (wanted.props !== undefined && !isRecord(wanted.props)) throw new ToolRefusal('props 要是一个对象')
        const props = (wanted.props ?? {}) as Record<string, unknown>
        const propsProblem = context.propsError(record.manifest.props, props)
        if (propsProblem !== undefined) throw new ToolRefusal(`props 与 ${wanted.widget} 的 props schema 不符：${propsProblem}`)
        const data = wanted.data ?? null
        if (wanted.data !== undefined) {
          const dataProblem = context.dataError(record.manifest.data, data)
          if (dataProblem !== undefined) throw new ToolRefusal(`数据与 ${wanted.widget} 的 data schema 不符：${dataProblem}`)
        }
        value = {
          widget: wanted.widget,
          title: record.manifest.title,
          hash: record.hash,
          props,
          data,
          state: null,
          height: heightOf(wanted.height, record.manifest.defaultBox?.h ?? DEFAULT_HEIGHT_REM),
        }
      }
      // 视图握手时把这一份整个递进组件，超过桥的长度上限就画不出来（D3）。
      if (!withinLimit(value)) throw new ToolRefusal('要画的 props、data 与 state 合起来超过 64 KiB；只给会话里要看的那部分')
      return value
    },
    render(value) {
      const shown = value as ShowValue
      const origin = shown.card === undefined ? '一次性快照' : `看板上的卡片 ${shown.card}`
      return [{
        type: 'text',
        text: `在会话里画出了 ${shown.widget}（${shown.title.zh}，${origin}，版本哈希 ${shown.hash.slice(0, 12)}，高 ${String(shown.height)}rem）。这是只读的快照，组件写的状态不会回到看板。`,
      }]
    },
    meta(value) {
      return value
    },
  }
}
