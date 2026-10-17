import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import type { WidgetLibraryEntry } from '@dsh-widget-board/contracts'
import { isChinese, t } from './copy'

/** 组件库浮窗要画的东西。 */
export interface LibraryPanelProps {
  /** 组件库的全部类型，含读不出来的那些（D17）。 */
  entries: readonly WidgetLibraryEntry[]
  /** 正在加卡片或整理：整张列表暂时不可操作。 */
  busy: boolean
  /** 轻点或键盘确认：加在末尾。 */
  onAdd: (id: string) => void
  /** 按住一行：交给看板的拖放逻辑。 */
  onBeginDrag: (entry: WidgetLibraryEntry, event: ReactPointerEvent<HTMLElement>) => void
  /** 关掉浮窗。 */
  onClose: () => void
}

/** 一个来源的标题。 */
function sourceLabel(source: WidgetLibraryEntry['source']): string {
  if (source === 'builtin') return t('builtin')
  if (source === 'user') return t('user')
  return t('plugin')
}

/**
 * 按语言取一段文案。
 *
 * @param text - 双语文案。
 * @returns 当前语言下的那一条。
 */
function textOf(text: { zh: string, en: string }): string {
  return isChinese() ? text.zh : text.en
}

/**
 * 添加组件的浮窗：按来源分组列出组件，按住一行可以拖到看板上。
 *
 * 浮窗固定在看板内容之上，不参与看板的排版；行上的指针按下交给 `onBeginDrag`，轻点交给 `onAdd`，
 * 两条路都由外层决定什么时候写宿主（D17）。
 *
 * @param props - 组件库、操作回调与关闭。
 * @returns 浮窗。
 */
export function LibraryPanel({ entries, busy, onAdd, onBeginDrag, onClose }: LibraryPanelProps): ReactNode {
  const groups = ['builtin', 'user', 'plugin'].map((source) => ({
    source: source as WidgetLibraryEntry['source'],
    items: entries.filter((entry) => entry.source === source),
  })).filter((group) => group.items.length > 0)

  const activate = (entry: WidgetLibraryEntry, event: ReactKeyboardEvent<HTMLElement>): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    if (!busy && entry.error === undefined) onAdd(entry.id)
  }

  return (
    <div className="dsh-widget-board__library" data-dsh-widget-board-library="" role="dialog" aria-label={t('library')}>
      <header className="dsh-widget-board__library-head">
        <div>
          <h2 className="dsh-widget-board__library-title">{t('library')}</h2>
          <p className="dsh-widget-board__library-hint">{t('libraryHint')}</p>
        </div>
        <button type="button" className="dsh-widget-board__library-close" onClick={onClose}>{t('close')}</button>
      </header>
      {groups.length === 0
        ? <p className="dsh-widget-board__notice">{t('libraryEmpty')}</p>
        : groups.map((group) => (
          <section key={group.source} className="dsh-widget-board__library-group">
            <h3 className="dsh-widget-board__library-source">{sourceLabel(group.source)}</h3>
            <ul className="dsh-widget-board__library-list">
              {group.items.map((entry) => {
                const unavailable = entry.error !== undefined
                return (
                  <li key={entry.id} className="dsh-widget-board__library-item">
                    <div
                      className="dsh-widget-board__library-add"
                      data-dsh-widget-board-add={entry.id}
                      role="button"
                      tabIndex={unavailable || busy ? -1 : 0}
                      aria-disabled={unavailable || busy}
                      title={entry.error ?? textOf(entry.title)}
                      onPointerDown={(event) => {
                        if (unavailable || busy) return
                        onBeginDrag(entry, event)
                      }}
                      onKeyDown={(event) => activate(entry, event)}
                    >
                      <span className="dsh-widget-board__library-grip" aria-hidden="true">⠿</span>
                      <span className="dsh-widget-board__library-copy">
                        <span className="dsh-widget-board__library-name">
                          {textOf(entry.title)}
                          {entry.provider === undefined ? null : <span className="dsh-widget-board__library-provider">{entry.provider}</span>}
                        </span>
                        {entry.description === undefined ? null : <span className="dsh-widget-board__library-desc">{textOf(entry.description)}</span>}
                        {entry.error === undefined ? null : <span className="dsh-widget-board__library-error">{entry.error}</span>}
                      </span>
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
    </div>
  )
}
