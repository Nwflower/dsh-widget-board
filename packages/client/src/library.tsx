import type { ReactNode } from 'react'
import type { WidgetLibraryEntry } from '@dsh-widget-board/contracts'
import { isChinese, t } from './copy'

/** 组件库面板要画的东西。 */
export interface LibraryPanelProps {
  /** 组件库的全部类型，含读不出来的那些（D17）。 */
  entries: readonly WidgetLibraryEntry[]
  /** 加一张卡；加载中时为 null。 */
  onAdd: ((id: string) => void) | null
  /** 关掉面板。 */
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
 * 添加组件的面板：按来源分组列出组件库，读不出来的类型排在各自分组的最后并写明原因。
 *
 * @param props - 组件库、加卡片与关闭的回调。
 * @returns 面板。
 */
export function LibraryPanel({ entries, onAdd, onClose }: LibraryPanelProps): ReactNode {
  const groups = ['builtin', 'user', 'plugin'].map((source) => ({
    source: source as WidgetLibraryEntry['source'],
    items: entries.filter((entry) => entry.source === source),
  })).filter((group) => group.items.length > 0)
  return (
    <div className="dsh-widget-board__library" data-dsh-widget-board-library="">
      <header className="dsh-widget-board__library-head">
        <h2 className="dsh-widget-board__library-title">{t('library')}</h2>
        <button type="button" className="dsh-widget-board__library-close" onClick={onClose}>{t('close')}</button>
      </header>
      {groups.length === 0
        ? <p className="dsh-widget-board__notice">{t('libraryEmpty')}</p>
        : groups.map((group) => (
          <section key={group.source} className="dsh-widget-board__library-group">
            <h3 className="dsh-widget-board__library-source">{sourceLabel(group.source)}</h3>
            <ul className="dsh-widget-board__library-list">
              {group.items.map((entry) => (
                <li key={entry.id} className="dsh-widget-board__library-item">
                  <button
                    type="button"
                    className="dsh-widget-board__library-add"
                    data-dsh-widget-board-add={entry.id}
                    disabled={entry.error !== undefined || onAdd === null}
                    title={entry.error ?? textOf(entry.title)}
                    onClick={() => onAdd?.(entry.id)}
                  >
                    <span className="dsh-widget-board__library-name">
                      {textOf(entry.title)}
                      {entry.provider === undefined ? null : <span className="dsh-widget-board__library-provider">{entry.provider}</span>}
                    </span>
                    {entry.description === undefined ? null : <span className="dsh-widget-board__library-desc">{textOf(entry.description)}</span>}
                    {entry.error === undefined ? null : <span className="dsh-widget-board__library-error">{entry.error}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
    </div>
  )
}
