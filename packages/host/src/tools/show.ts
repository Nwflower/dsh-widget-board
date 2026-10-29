/**
 * `widget_show`：把一个组件内联显示在当前会话的回答里（D9）。
 *
 * 两条路径。给 `id` 时显示看板上已有的那一张：状态写回卡片，动作经卡片的路由执行，读者在会话里
 * 看到的就是看板上的那一张。给 `widget` 时按组件与 props 起一份一次性快照：它不在任何看板上，不
 * 写看板，状态只留在页面上，动作没有去处。两条路径都不改看板。
 *
 * 返回值同时是客户端工具视图的载荷（`WidgetToolSpec.view`）：视图只按它画，不再回读宿主。
 */
import { randomUUID } from 'node:crypto'
import type { BoardInstance, ShowValue, WidgetFamily, WidgetToolSpec } from '@dsh-widget-board/contracts'
import { WIDGET_TOOL_NAMES, ToolRefusal } from '@dsh-widget-board/contracts'
import { isRecord } from '../guards'
import type { WidgetRecord } from '../library'
import { requireGrantOf } from '../permissions'
import { widgetSummaryOf } from '../snapshot'
import type { ToolContext } from './index'

/** 没点名尺寸族时按这个次序挑一个组件声明过的：内联盒子偏大，够排得下就用大的。 */
const FAMILY_ORDER: readonly WidgetFamily[] = ['xl', 'wide', 'l', 'm', 's']

/**
 * 一个组件在内联显示时用哪个尺寸族（D16）。
 *
 * @param record - 组件记录。
 * @param wanted - 调用方点名的族；省略时按 `FAMILY_ORDER` 挑。
 * @returns 组件声明过的一个族。
 * @throws {ToolRefusal} 点名的族不在 manifest 的 `sizes` 里。
 */
function familyOf(record: WidgetRecord, wanted: unknown): WidgetFamily {
  const sizes = record.manifest.sizes
  if (wanted !== undefined) {
    if (typeof wanted !== 'string') throw new ToolRefusal('size 要是一个字符串')
    if (!(sizes as readonly string[]).includes(wanted)) {
      throw new ToolRefusal(`${record.manifest.id} 没有 ${wanted} 这个尺寸族；它声明的是 ${sizes.join('、')}`)
    }
    return wanted as WidgetFamily
  }
  const picked = FAMILY_ORDER.find((family) => (sizes as readonly string[]).includes(family))
  return picked ?? sizes[0] ?? 's'
}

/**
 * 一次性快照的那张卡：id 由宿主起，不在任何看板上。
 *
 * @param record - 组件记录。
 * @param props - 已经校验过的 props。
 * @param data - 已经校验过的数据；没有数据源也没有给数据时是 `null`。
 * @param source - 卡片绑定的数据源名。
 * @returns 视图要画的那一份。
 */
function snapshotOf(record: WidgetRecord, props: Record<string, unknown>, data: unknown, source: string | undefined): BoardInstance {
  return {
    id: `inline-${randomUUID()}`,
    widget: record.manifest.id,
    hash: record.hash,
    ...(source === undefined ? {} : { source }),
    props,
    data,
    state: null,
    layout: { x: 0, y: 0, w: 1, h: record.manifest.defaultBox?.h ?? 10 },
  }
}

/**
 * `widget_show`：把看板上的一张卡或一份一次性快照内联显示在回答里。
 *
 * @param context - 工具要动的那些东西。
 * @returns 工具的注册项。
 */
export function showTool(context: ToolContext): WidgetToolSpec {
  return {
    name: WIDGET_TOOL_NAMES.show,
    description: 'Show a widget inline in this conversation, in the answer itself. Pass `id` for a card that is already on the board (its state and actions keep working); pass `widget` with optional `props` and `data` for a one-off snapshot that touches no board and keeps its state only on the page. Call widget_catalog first for the widget id and its props/data JSON Schema.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'string', description: 'Card instance id from widget_board; the inline view shares that card.' },
        widget: { type: 'string', description: 'Widget type id from widget_catalog, for a one-off snapshot.' },
        props: { type: 'object', description: 'Props for the snapshot; validated against the widget props schema.' },
        data: { description: 'Data for the snapshot; validated against the widget data schema. Omit to read the widget\'s declared data source once.' },
        size: { type: 'string', description: 'Which declared size family to lay the inline box out in; defaults to the largest the widget declares.' },
      },
    },
    async execute(args) {
      if (!isRecord(args)) throw new ToolRefusal('widget_show 要一个对象参数')
      const wanted = args as { id?: unknown, widget?: unknown, props?: unknown, data?: unknown, size?: unknown }
      const id = typeof wanted.id === 'string' && wanted.id !== '' ? wanted.id : undefined
      const widget = typeof wanted.widget === 'string' && wanted.widget !== '' ? wanted.widget : undefined
      if (id === undefined && widget === undefined) throw new ToolRefusal('widget_show 要写明 id（看板上的卡）或 widget（一次性快照）')
      if (id !== undefined && widget !== undefined) throw new ToolRefusal('widget_show 的 id 与 widget 只能给一个')
      if (wanted.props !== undefined && !isRecord(wanted.props)) throw new ToolRefusal('props 要是一个对象')

      if (id !== undefined) {
        const found = context.route.workspace.findInstance(id)
        if (found === undefined) throw new ToolRefusal(`看板上没有这张卡：${id}`)
        const instance = found.instance
        const record = context.route.records.get(instance.widget)
        if (record === undefined) throw new ToolRefusal(`卡片 ${id} 的组件 ${instance.widget} 不在组件库里，显示不了`)
        return {
          id: instance.id,
          widget: instance.widget,
          // 卡片可能钉在旧版本上：显示卡片自己那一份，不跟着组件库换。
          hash: instance.hash,
          ...(instance.source === undefined ? {} : { source: instance.source }),
          props: instance.props,
          data: instance.data,
          state: instance.state,
          family: familyOf(record, wanted.size),
          summary: { ...widgetSummaryOf(record, (id) => context.route.sources.resolveCapability(id)), hash: instance.hash },
          board: { id: found.board.id, title: found.board.title },
        } satisfies ShowValue
      }

      const record = context.route.records.get(widget as string)
      if (record === undefined) throw new ToolRefusal(`组件库里没有可用的组件 ${String(widget)}，先用 widget_catalog 看有哪些`)
      if (wanted.props !== undefined) {
        const problem = context.propsError(record.manifest.props, wanted.props)
        if (problem !== undefined) throw new ToolRefusal(problem)
      }
      const source = record.manifest.source
      let data: unknown = null
      if (wanted.data !== undefined) {
        const problem = context.dataError(record.manifest.data, wanted.data)
        if (problem !== undefined) throw new ToolRefusal(`数据与 ${record.manifest.id} 的 data schema 不符：${problem}`)
        data = wanted.data
      } else if (source !== undefined) {
        const resolved = context.route.sources.resolveDataSource(source)
        if (resolved === undefined) throw new ToolRefusal(`没有数据源 ${source}，提供它的插件可能没有安装`)
        // 一次性快照不在看板上，没有可以单独授权的卡片：按组件版本核对已给出的授权，缺授权就不读（D6）。
        if (resolved.registration.permission !== undefined) {
          try {
            requireGrantOf(context.route.grants, record.manifest.id, record.hash, 'source', source, resolved.registration.permission, resolved.provider)
          } catch (error) {
            throw new ToolRefusal(`${(error as Error).message}；先把它放上看板，由人在卡片上给出授权之后才能读`)
          }
        }
        const face = { id: 'inline', widget: record.manifest.id, props: (wanted.props ?? {}) as Record<string, unknown> }
        data = await context.readSource(source, face)
        const problem = context.dataError(record.manifest.data, data)
        if (problem !== undefined) {
          // 提供方跑完了但交出来的东西不合 schema：这是它的一次失败，只在这一处记（D31）。dataError 交出来的
          // 已经是一整句：来源与组件写在前面，同一句话不在健康记录与拒绝里出现两次。
          context.route.sources.health.failed(resolved.provider, 'provider-output', `数据源 ${source} 给组件 ${record.manifest.id} 的数据不合格：${problem}`)
          throw new ToolRefusal(`数据源 ${source} 给组件 ${record.manifest.id} 返回的数据不合格：${problem}`)
        }
      }
      const instance = snapshotOf(record, (wanted.props ?? {}) as Record<string, unknown>, data, source)
      return {
        ...instance,
        family: familyOf(record, wanted.size),
        summary: widgetSummaryOf(record, (id) => context.route.sources.resolveCapability(id)),
      } satisfies ShowValue
    },
    view(value) {
      return value
    },
    render(value) {
      const shown = value as ShowValue
      const title = shown.summary.title.zh
      const where = shown.board === undefined
        ? '这是一份一次性快照，不在看板上；状态只留在页面上'
        : `它同时是看板「${shown.board.title}」上的卡片 ${shown.id}；这份快照不跟着看板更新，组件交出的状态会写回那张卡`
      return [{
        type: 'text',
        text: `组件 ${shown.widget}（${title}）以 ${shown.family} 尺寸内联显示在回答里；${where}。`,
      }]
    },
  }
}
