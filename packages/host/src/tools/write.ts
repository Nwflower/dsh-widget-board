/**
 * 写类的三个工具：`widget_place`、`widget_remove`、`widget_push`（D9）。
 *
 * 三个都只经 `ToolContext.save` 改看板，与界面走同一条写入链：宿主是唯一权威，写入串行（D5）。放卡
 * 与移除会让布局修订号前进；推数据不会，所以会话在推数据的同时用户还能拖动。
 */
import type { BoardInstance, CardLayout, PlaceValue, WidgetToolSpec } from '@dsh-widget-board/contracts'
import { WIDGET_TOOL_NAMES, ToolRefusal } from '@dsh-widget-board/contracts'
import { isRecord } from '../guards'
import { withInstanceAdded, withInstancePatched, withInstanceRemoved } from '../state'
import type { ToolContext } from './index'

/**
 * 读一个盒子的四个数；缺项保持 `undefined`。
 *
 * @param value - 模型给的 layout。
 * @returns 四元组，或 `undefined`。
 * @throws {ToolRefusal} 有哪一项不是数。
 */
function layoutOf(value: unknown): Partial<CardLayout> | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) throw new ToolRefusal('layout 要是一个对象：{ x, y, w, h }')
  const layout: Partial<CardLayout> = {}
  for (const key of ['x', 'y', 'w', 'h'] as const) {
    const raw = value[key]
    if (raw === undefined) continue
    if (typeof raw !== 'number' || !Number.isFinite(raw)) throw new ToolRefusal(`layout.${key} 要是一个数`)
    layout[key] = raw
  }
  return layout
}

/** 一张卡在工具结果里的样子。 */
function placed(instance: BoardInstance, notes: string[]): PlaceValue {
  return {
    id: instance.id,
    widget: instance.widget,
    layout: instance.layout,
    ...(notes.length === 0 ? {} : { notes }),
  }
}

/**
 * `widget_place`：往看板上放一张卡，或改一张已有卡的位置、大小、props 与数据源。
 *
 * @param context - 工具要动的那些东西。
 * @returns 工具的注册项。
 */
export function placeTool(context: ToolContext): WidgetToolSpec {
  return {
    name: WIDGET_TOOL_NAMES.place,
    description: 'Put a widget on the board, or change a card that is already there: move it, resize it, change its props, or rebind its data source. Omit `id` to add a new card; pass an instance id from widget_board to change that card.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['widget'],
      properties: {
        widget: { type: 'string', description: 'Widget type id from widget_catalog.' },
        id: { type: 'string', description: 'An existing card instance id; omit to add a new card.' },
        layout: {
          type: 'object',
          additionalProperties: false,
          description: 'Box in board units: x is the column, w spans columns, y and h are rem.',
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
            w: { type: 'number' },
            h: { type: 'number' },
          },
        },
        props: { type: 'object', description: 'Replaces the card props when given.' },
        source: { type: 'string', description: 'Data source id; the card reads it once after the change.' },
      },
    },
    async execute(args) {
      if (!isRecord(args) || typeof args.widget !== 'string' || args.widget === '') throw new ToolRefusal('widget_place 要写明 widget')
      const wanted = args as { widget: string, id?: unknown, layout?: unknown, props?: unknown, source?: unknown }
      const record = context.route.records.get(wanted.widget)
      if (record === undefined) throw new ToolRefusal(`组件库里没有可用的组件 ${wanted.widget}，先用 widget_catalog 看有哪些`)
      const layout = layoutOf(wanted.layout)
      if (wanted.props !== undefined && !isRecord(wanted.props)) throw new ToolRefusal('props 要是一个对象')
      if (wanted.source !== undefined && typeof wanted.source !== 'string') throw new ToolRefusal('source 要是一个字符串')

      if (typeof wanted.id === 'string' && wanted.id !== '') {
        const existing = context.route.board.instances.find((instance) => instance.id === wanted.id)
        if (existing === undefined) throw new ToolRefusal(`看板上没有这张卡：${wanted.id}`)
        if (existing.widget !== wanted.widget) {
          throw new ToolRefusal(`卡片 ${wanted.id} 是 ${existing.widget}，不能改成 ${wanted.widget}；要换组件就移除再放一张`)
        }
        if (wanted.props !== undefined) {
          const problem = context.propsError(context.route.records.get(existing.widget)?.manifest.props, wanted.props)
          if (problem !== undefined) throw new ToolRefusal(problem)
        }
        const notes: string[] = []
        const next = await context.save(
          (current) => withInstancePatched(current, wanted.id as string, {
            ...(layout === undefined ? {} : { layout }),
            ...(wanted.props === undefined ? {} : { props: wanted.props as Record<string, unknown> }),
            ...(wanted.source === undefined ? {} : { source: wanted.source as string }),
          }, (widget) => context.route.records.get(widget)?.manifest.minBox),
          { layoutChanged: layout !== undefined, event: () => ({ type: 'board' }) },
        )
        const instance = next.instances.find((candidate) => candidate.id === wanted.id) as BoardInstance
        if (wanted.source !== undefined) await readInto(context, instance, notes)
        return placed(instance, notes)
      }

      if (wanted.props !== undefined) {
        const problem = context.propsError(record.manifest.props, wanted.props)
        if (problem !== undefined) throw new ToolRefusal(problem)
      }
      // 调用方没点名数据源时用组件自己声明的那个（D17）；声明的那个现在不在时卡片照样加得进来。
      const declared = record.manifest.source
      const source = wanted.source === undefined ? declared : wanted.source as string
      const added = await context.save(
        (current) => withInstanceAdded(current, record, {
          ...(source === undefined ? {} : { source }),
          ...(wanted.props === undefined ? {} : { props: wanted.props as Record<string, unknown> }),
          ...(layout === undefined ? {} : { layout: layout as CardLayout }),
        }).board,
        { layoutChanged: true, event: () => ({ type: 'board' }) },
      )
      const instance = added.instances.at(-1) as BoardInstance
      const notes: string[] = []
      // 数据源不在时：调用方点名的算错误，组件自己声明的只留一条说明，数据留空（D17）。
      if (source !== undefined) await readInto(context, instance, notes, wanted.source !== undefined)
      return placed(instance, notes)
    },
    render(value) {
      const place = value as PlaceValue
      const box = `${place.layout.w} 列 × ${place.layout.h}rem @ (${place.layout.x}, ${place.layout.y})`
      const notes = place.notes === undefined ? [] : place.notes
      return [{ type: 'text', text: [`卡片 ${place.id}（${place.widget}）在 ${box}。`, ...notes].join('\n') }]
    },
  }
}

/**
 * 让这张卡按绑定的数据源读一次，把数据写进卡片。
 *
 * @param context - 工具要动的那些东西。
 * @param instance - 卡片。
 * @param notes - 收集要回给模型的说明。
 * @param strict - 数据源不存在时是抛错（调用方点名了它）还是留空（组件自己声明的）。
 */
async function readInto(context: ToolContext, instance: BoardInstance, notes: string[], strict = false): Promise<void> {
  const source = instance.source
  if (source === undefined) return
  let data: unknown
  try {
    data = await context.readSource(source, { id: instance.id, widget: instance.widget, props: instance.props })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (strict) throw new ToolRefusal(message)
    notes.push(`数据源 ${source} 没读到：${message}`)
    return
  }
  const problem = context.dataError(context.route.records.get(instance.widget)?.manifest.data, data)
  if (problem !== undefined) {
    notes.push(`数据源 ${source} 的数据与组件的 data schema 不符：${problem}`)
    return
  }
  await context.save((current) => withInstancePatched(current, instance.id, { data }), { event: () => ({ type: 'instance', id: instance.id, data }) })
  notes.push(`已经按 ${source} 读了一次数据。`)
}

/**
 * `widget_remove`：从看板上移除一张卡。
 *
 * @param context - 工具要动的那些东西。
 * @returns 工具的注册项。
 */
export function removeTool(context: ToolContext): WidgetToolSpec {
  return {
    name: WIDGET_TOOL_NAMES.remove,
    description: 'Remove one card from the board. A flip group is two cards sharing a group id: removing either side removes both.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['id'],
      properties: {
        id: { type: 'string', description: 'Card instance id from widget_board.' },
      },
    },
    async execute(args) {
      if (!isRecord(args) || typeof args.id !== 'string' || args.id === '') throw new ToolRefusal('widget_remove 要写明 id')
      const instance = context.route.board.instances.find((candidate) => candidate.id === args.id)
      if (instance === undefined) throw new ToolRefusal(`看板上没有这张卡：${args.id}`)
      const group = instance.group?.id
      await context.save(
        (current) => (group === undefined
          ? withInstanceRemoved(current, instance.id)
          : { ...current, instances: current.instances.filter((candidate) => candidate.group?.id !== group) }),
        { layoutChanged: true, event: () => ({ type: 'board' }) },
      )
      return { id: instance.id, widget: instance.widget, group: group ?? null }
    },
    render(value) {
      const removed = value as { id: string, widget: string, group: string | null }
      const tail = removed.group === null ? '' : `（它属于组 ${removed.group}，整组一起移除）`
      return [{ type: 'text', text: `移除了卡片 ${removed.id}（${removed.widget}）${tail}。` }]
    },
  }
}

/**
 * `widget_push`：把数据推给一张卡。
 *
 * @param context - 工具要动的那些东西。
 * @returns 工具的注册项。
 */
export function pushTool(context: ToolContext): WidgetToolSpec {
  return {
    name: WIDGET_TOOL_NAMES.push,
    description: 'Push data to one card. The data is validated against the widget\'s data JSON Schema before it is stored; a mismatch is refused with the reason.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'data'],
      properties: {
        id: { type: 'string', description: 'Card instance id from widget_board.' },
        data: { description: 'Any JSON value the widget\'s data schema accepts.' },
      },
    },
    async execute(args) {
      if (!isRecord(args) || typeof args.id !== 'string' || args.id === '') throw new ToolRefusal('widget_push 要写明 id')
      if (!('data' in args)) throw new ToolRefusal('widget_push 要写明 data')
      const instance = context.route.board.instances.find((candidate) => candidate.id === args.id)
      if (instance === undefined) throw new ToolRefusal(`看板上没有这张卡：${args.id}`)
      const problem = context.dataError(context.route.records.get(instance.widget)?.manifest.data, args.data)
      if (problem !== undefined) throw new ToolRefusal(`数据与 ${instance.widget} 的 data schema 不符：${problem}`)
      await context.save((current) => withInstancePatched(current, instance.id, { data: args.data }), {
        event: () => ({ type: 'instance', id: instance.id, data: args.data }),
      })
      return { id: instance.id, widget: instance.widget, ok: true }
    },
    render(value) {
      const pushed = value as { id: string, widget: string }
      return [{ type: 'text', text: `把数据推给了卡片 ${pushed.id}（${pushed.widget}）。` }]
    },
  }
}
