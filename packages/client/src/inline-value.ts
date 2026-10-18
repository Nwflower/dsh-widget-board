/**
 * 内联视图与工具载荷之间的那一层（D9）：把这次结果的 `meta` 收成画得出来的那一份。
 *
 * 单独一个模块是为了能在没有 DOM 的地方判定：视图只做画，形状的判定放在这里。
 */
import type { ShowValue, WidgetSummary } from '@dsh-widget-board/contracts'

/** 判断一个外来值是不是普通对象。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 把这次结果的 `meta` 收成内联视图认的载荷。
 *
 * @param value - 工具经 `presentationMeta` 投影的载荷。
 * @returns 形状对时为载荷，否则 `undefined`（视图退回这次结果的文字）。
 */
export function showOf(value: unknown): ShowValue | undefined {
  if (!isRecord(value)) return undefined
  const { id, widget, hash, source, props, data, state, family, summary, board } = value
  if (typeof id !== 'string' || id === '' || typeof widget !== 'string' || typeof hash !== 'string') return undefined
  if (typeof family !== 'string' || family === '') return undefined
  if (!isRecord(props) || !isRecord(summary) || !isRecord(summary.title) || typeof summary.title.zh !== 'string') return undefined
  return {
    id,
    widget,
    hash,
    ...(typeof source === 'string' ? { source } : {}),
    props,
    data,
    state,
    family: family as ShowValue['family'],
    summary: summary as unknown as WidgetSummary,
    ...(isRecord(board) && typeof board.id === 'string' && typeof board.title === 'string'
      ? { board: { id: board.id, title: board.title } }
      : {}),
  }
}

/**
 * 把这次结果里的文字块拼成一段。
 *
 * @param blocks - 内容块。
 * @returns 拼好的文字；没有可显示的内容时是 `undefined`。
 */
export function textOf(blocks: readonly { type?: string, text?: string }[] | undefined): string | undefined {
  const text = (blocks ?? [])
    .filter((block) => block.type === undefined || block.type === 'text')
    .map((block) => block.text ?? '')
    .join('\n')
    .trim()
  return text === '' ? undefined : text
}
