/**
 * 读类的两个工具：`widget_catalog` 与 `widget_board`（D9）。
 *
 * 两者都只读宿主上的状态，不改任何东西；返回的是规范 JSON 值，模型看到的内容由 `render` 拼。
 */
import type { BoardValue, CatalogEntry, CatalogValue, WidgetToolSpec } from '@dsh-widget-board/contracts'
import { WIDGET_TOOL_NAMES, ToolRefusal } from '@dsh-widget-board/contracts'
import type { ToolContext } from './index'

/** 把一组组件拼成目录说明。 */
function catalogOf(context: ToolContext): CatalogValue {
  const widgets: CatalogEntry[] = []
  for (const entry of context.route.entries) {
    const record = context.route.records.get(entry.id)
    if (record === undefined) {
      widgets.push({
        id: entry.id,
        title: entry.title,
        ...(entry.description === undefined ? {} : { description: entry.description }),
        version: '—',
        sizes: entry.sizes,
        source: entry.source,
        ...(entry.provider === undefined ? {} : { provider: entry.provider }),
        ...(entry.error === undefined ? {} : { error: entry.error }),
      })
      continue
    }
    const { manifest } = record
    widgets.push({
      id: manifest.id,
      title: manifest.title,
      ...(manifest.description === undefined ? {} : { description: manifest.description }),
      version: manifest.version,
      sizes: manifest.sizes,
      source: record.source,
      ...(record.provider === undefined ? {} : { provider: record.provider }),
      hash: record.hash,
      ...(manifest.source === undefined ? {} : { source_id: manifest.source }),
      ...(manifest.actions === undefined ? {} : { actions: manifest.actions.map((action) => action.id) }),
      ...(manifest.credentials === undefined ? {} : { credentials: manifest.credentials }),
      ...(manifest.props === undefined ? {} : { props: manifest.props }),
      ...(manifest.data === undefined ? {} : { data: manifest.data }),
      ...(manifest.minBox === undefined ? {} : { minBox: manifest.minBox }),
      ...(manifest.defaultBox === undefined ? {} : { defaultBox: manifest.defaultBox }),
    })
  }
  return {
    widgets,
    errors: context.route.library.errors.map((error) => ({
      source: error.source,
      ...(error.provider === undefined ? {} : { provider: error.provider }),
      dir: error.dir,
      message: error.message,
    })),
  }
}

/**
 * `widget_catalog`：列出组件库里的组件类型与它们的声明。
 *
 * @param context - 工具要动的那些东西。
 * @returns 工具的注册项。
 */
export function catalogTool(context: ToolContext): WidgetToolSpec {
  return {
    name: WIDGET_TOOL_NAMES.catalog,
    description: 'List the widget types in the board library: id, title, sizes, source, and the props/data JSON Schema each one declares. Use it before writing a new widget or placing a card.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'string', description: 'Only this widget id.' },
        source: { type: 'string', enum: ['builtin', 'user', 'plugin'], description: 'Only widgets from this source.' },
      },
    },
    async execute(args) {
      const wanted = (args ?? {}) as { id?: unknown, source?: unknown }
      const catalog = catalogOf(context)
      const widgets = catalog.widgets.filter((entry) => (typeof wanted.id !== 'string' || entry.id === wanted.id)
        && (typeof wanted.source !== 'string' || entry.source === wanted.source))
      return { widgets, errors: catalog.errors }
    },
    render(value) {
      const catalog = value as CatalogValue
      if (catalog.widgets.length === 0) return [{ type: 'text', text: '组件库里没有符合条件的组件。' }]
      const lines = catalog.widgets.map((entry) => {
        const head = `- ${entry.id}（${entry.title.zh}）${entry.version} · ${entry.source}${entry.provider === undefined ? '' : `/${entry.provider}`} · ${entry.sizes.join('/') || '—'}`
        const parts = [head]
        if (entry.error !== undefined) parts.push(`  不可用：${entry.error}`)
        if (entry.source_id !== undefined) parts.push(`  数据源：${entry.source_id}`)
        if (entry.actions !== undefined && entry.actions.length > 0) parts.push(`  动作：${entry.actions.join('、')}`)
        if (entry.credentials !== undefined && entry.credentials.length > 0) {
          parts.push(`  凭据：${entry.credentials.map((credential) => credential.ref).join('、')}`)
        }
        if (entry.hash !== undefined) parts.push(`  版本哈希：${entry.hash.slice(0, 12)}`)
        return parts.join('\n')
      })
      const errors = catalog.errors.map((error) => `- ${error.dir}：${error.message}`)
      return [{ type: 'text', text: [lines.join('\n'), ...(errors.length === 0 ? [] : ['', '读不出来的目录：', ...errors])].join('\n') }]
    },
  }
}

/**
 * `widget_board`：读看板上现在有哪些卡片。
 *
 * @param context - 工具要动的那些东西。
 * @returns 工具的注册项。
 */
export function boardTool(context: ToolContext): WidgetToolSpec {
  return {
    name: WIDGET_TOOL_NAMES.board,
    description: 'Read a widget board: every card with its widget, props, data, state, and box. Returns all boards with their ids; pass `board` to read another board. Use it to find the instance id a later widget_place, widget_push, or widget_remove call needs.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'string', description: 'Only this card instance id.' },
        widget: { type: 'string', description: 'Only cards of this widget type.' },
        board: { type: 'string', description: 'Board id from the boards list; omit for the selected board.' },
      },
    },
    async execute(args) {
      const wanted = (args ?? {}) as { id?: unknown, widget?: unknown, board?: unknown }
      const workspace = context.route.workspace
      const chosen = typeof wanted.board === 'string' && wanted.board !== '' ? wanted.board : workspace.activeId()
      if (!workspace.has(chosen)) throw new ToolRefusal(`没有这块看板：${chosen}`)
      const board = workspace.board(chosen)
      const boards = workspace.list().map((entry) => ({
        id: entry.id,
        title: entry.title,
        active: entry.id === workspace.activeId(),
        cards: entry.instances.length,
      }))
      const cards = board.instances
        .filter((instance) => (typeof wanted.id !== 'string' || instance.id === wanted.id)
          && (typeof wanted.widget !== 'string' || instance.widget === wanted.widget))
        .map((instance) => {
          const record = context.route.records.get(instance.widget)
          return {
            id: instance.id,
            widget: instance.widget,
            title: record?.manifest.title ?? { zh: instance.widget, en: instance.widget },
            ...(record === undefined ? { error: '这个组件不在组件库里，卡片画成不可用的占位' } : {}),
            hash: instance.hash,
            ...(instance.source === undefined ? {} : { source: instance.source }),
            props: instance.props,
            data: instance.data,
            state: instance.state,
            layout: instance.layout,
          }
        })
      return { boards, board: board.id, title: board.title, revision: board.revision, layoutRevision: board.layoutRevision, cards } satisfies BoardValue
    },
    render(value) {
      const board = value as BoardValue
      const summary = board.boards
        .map((entry) => `「${entry.title}」${entry.active ? '（选中）' : ''} ${entry.cards} 张`)
        .join('、')
      if (board.cards.length === 0) return [{ type: 'text', text: `看板：${summary}。\n看板「${board.title}」上没有符合条件的卡片。` }]
      const lines = board.cards.map((card) => {
        const head = `- ${card.id} · ${card.widget}（${card.title.zh}）· ${card.layout.w} 列 × ${card.layout.h}rem @ (${card.layout.x}, ${card.layout.y})`
        const parts = [head]
        if (card.error !== undefined) parts.push(`  不可用：${card.error}`)
        if (card.source !== undefined) parts.push(`  数据源：${card.source}`)
        if (Object.keys(card.props).length > 0) parts.push(`  props：${JSON.stringify(card.props)}`)
        return parts.join('\n')
      })
      return [{ type: 'text', text: [`看板：${summary}。`, `看板「${board.title}」（修订 ${board.revision}，布局修订 ${board.layoutRevision}）：`, ...lines].join('\n') }]
    },
  }
}
