/**
 * 会话里的 `widget_show` 视图（D9）：把工具记下的版本与数据画进对话。
 *
 * 画的是调用那一刻的组件版本、props、data 与 state——这一份随工具结果留在会话日志里，会话重新
 * 打开时按同一个哈希从版本库取回组件文档（D7），看到的还是当时的样子。只读：组件写的状态不会回
 * 到看板。宽度跟着对话的宽度走，高度按工具的 `height`（rem）定。
 */
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { ShowValue, ToolViewProps } from '@dsh-widget-board/contracts'
import { t } from './copy'
import { frameHostOf } from './page-frames'
import { SnapshotSurface } from './snapshot-surface'
import { resolveTheme, watchTheme } from './theme'
import type { ShellTheme } from './theme'

/** 根字号：高度按 rem 给出（D16）。 */
export function rootFontSize(): number {
  return Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
}

/**
 * 跟着自己的盒子变宽变窄。
 *
 * @returns 一个挂到容器上的 ref 与当前宽度（像素）。
 */
export function useWidth(): { ref: (node: HTMLDivElement | null) => void, width: number } {
  const [node, setNode] = useState<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    if (node === null) return
    const update = (): void => setWidth(node.clientWidth)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(node)
    return () => { observer.disconnect() }
  }, [node])
  return { ref: setNode, width }
}

/**
 * 跟随宿主主题（D10）：工具视图与看板用同一份令牌。
 *
 * @param context - 浏览器半边的根上下文；视图拿得到时传它，切皮肤也能收到。
 * @returns 当前主题。
 */
export function useTheme(context?: unknown): ShellTheme {
  const [theme, setTheme] = useState<ShellTheme>(resolveTheme)
  useEffect(() => {
    const dispose = watchTheme(context, setTheme)
    return () => { dispose() }
  }, [context])
  return theme
}

/**
 * 把一次 `widget_show` 的结果画出来。
 *
 * @param props - 工具视图收到的阶段、调用 id 与结果块，以及插件根上下文。
 * @returns 组件画面，或一句还没到结果的说明。
 */
export function ShowView({ phase, block, context }: ToolViewProps & { context?: unknown }): ReactNode {
  const value = phase === 'result' ? showOf(block.meta) : undefined
  const failed = phase === 'result' && block.isError
  const { ref, width } = useWidth()
  const theme = useTheme(context)
  if (failed) return <p className="dsh-widget-board-tool__note">{textOfBlock(block)}</p>
  if (value === undefined) return <p className="dsh-widget-board-tool__note">{t('showName')}…</p>
  return (
    <div ref={ref} className="dsh-widget-board-tool" data-dsh-widget-board-tool="show">
      {width === 0 ? null : (
        <SnapshotSurface
          hash={value.hash}
          title={value.title.zh}
          props={value.props}
          data={value.data}
          state={value.state}
          text={{}}
          size={{ w: width, h: Math.round(value.height * rootFontSize()), placement: 'inline', family: 'inline', cols: 1 }}
          placement="inline"
          theme={theme}
          frames={frameHostOf()}
        />
      )}
      <p className="dsh-widget-board-tool__foot">{t('showSnapshot')}</p>
    </div>
  )
}

/**
 * 结果块里的那一份快照数据；形状不对时给 `undefined`。
 *
 * @param meta - 工具结果里的 `meta`。
 * @returns 快照数据。
 */
function showOf(meta: unknown): ShowValue | undefined {
  if (typeof meta !== 'object' || meta === null) return undefined
  const value = meta as Partial<ShowValue>
  if (typeof value.hash !== 'string' || typeof value.widget !== 'string' || typeof value.height !== 'number') return undefined
  return {
    widget: value.widget,
    title: value.title ?? { zh: value.widget, en: value.widget },
    hash: value.hash,
    props: value.props ?? {},
    data: value.data ?? null,
    state: value.state ?? null,
    height: value.height,
    ...(value.card === undefined ? {} : { card: value.card }),
  }
}

/**
 * 失败时模型与用户看到的那段文字。
 *
 * @param block - 结果块。
 * @returns 文本。
 */
function textOfBlock(block: { content: readonly { type: string, text?: string }[] }): string {
  return block.content.filter((part) => part.type === 'text').map((part) => part.text ?? '').join('\n') || t('showMissing')
}
