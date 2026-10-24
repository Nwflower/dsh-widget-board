/**
 * 组件库浮窗（D17、D8）：按来源分组的实时缩略画面，按住一格拖到看板，轻点加在末尾。
 *
 * 缩略画面与网格本身住在 `widget-grid.tsx`，卡片设置弹窗的换槽也用同一份；这里只剩导入导出、
 * 头部与关闭。
 */
import { useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import type { WidgetLibraryEntry, WidgetSummary } from '@dsh-widget-board/contracts'
import { CLIENT_ROUTE } from '@dsh-widget-board/contracts'
import { t } from './copy'
import type { FrameHost } from './frame-host'
import type { ShellTheme } from './theme'
import { WidgetGrid } from './widget-grid'

/** 组件库浮窗要画的东西。 */
export interface LibraryPanelProps {
  /** 组件库的全部类型，含读不出来的那些（D17）。 */
  entries: readonly WidgetLibraryEntry[]
  /** 卡片要用的组件元信息：缩略画面按它找组件的哈希与文案。 */
  widgets: Readonly<Record<string, WidgetSummary>>
  /** 当前主题，缩略画面与看板上的卡片用同一份（D10）。 */
  theme: ShellTheme
  /** 整页唯一的握手中心（D3）。 */
  frames: FrameHost
  /** 正在加卡片或整理：整张网格暂时不可操作。 */
  busy: boolean
  /** 轻点或键盘确认：加在末尾。 */
  onAdd: (id: string) => void
  /** 按住一格：交给看板的拖放逻辑。 */
  onBeginDrag: (entry: WidgetLibraryEntry, event: ReactPointerEvent<HTMLElement>) => void
  /** 关掉浮窗。 */
  onClose: () => void
  /** 导入一个组件包之后重读组件库（D8）。 */
  onImported?: () => void
}

/**
 * 把一个 `.dshw` 交给宿主（D8）。
 *
 * @param file - 用户选的文件。
 * @returns 装完之后的结果说明。
 * @throws {Error} 宿主拒绝时带上它给的原因。
 */
async function importWidgetFile(file: File): Promise<string> {
  const response = await fetch(`${CLIENT_ROUTE}/library/import`, {
    method: 'POST',
    headers: { 'content-type': 'application/zip' },
    body: await file.arrayBuffer(),
  })
  const body = await response.json() as { error?: string, entry?: { id: string } }
  if (!response.ok) throw new Error(body.error ?? `导入失败：HTTP ${response.status}`)
  return body.entry?.id ?? file.name
}

/**
 * 添加组件的浮窗：按来源分组，把每个组件画成一格实时缩略画面，按住一格可以拖到看板上。
 *
 * @param props - 组件库、主题、操作回调与关闭。
 * @returns 浮窗。
 */
export function LibraryPanel({
  entries,
  widgets,
  theme,
  frames,
  busy,
  onAdd,
  onBeginDrag,
  onClose,
  onImported,
}: LibraryPanelProps): ReactNode {
  /** 导入的失败原因：画在头部，不把整个浮窗换成错误页。 */
  const [importError, setImportError] = useState<string | null>(null)

  return (
    // 浮窗不占 `dialog` 这个角色：别的插件给所有对话窗统一定尺寸时，那条规则会盖过 library.css 里
    // 按与下方菜单的间距算出的上限，浮窗往上涨过窗口上缘，题头与关闭钮就看不见了。
    <div className="dsh-widget-board__library" data-dsh-widget-board-library="" role="region" aria-label={t('library')}>
      <header className="dsh-widget-board__library-head">
        <div>
          <h2 className="dsh-widget-board__library-title">{t('library')}</h2>
          <p className="dsh-widget-board__library-hint">{t('libraryHint')}</p>
          {importError === null ? null : <p className="dsh-widget-board__library-error" role="status">{importError}</p>}
        </div>
        <div className="dsh-widget-board__library-actions">
          <label className="dsh-widget-board__library-import">
            {t('import')}
            <input
              type="file"
              accept=".dshw"
              data-dsh-widget-board-import=""
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (file === undefined) return
                setImportError(null)
                importWidgetFile(file).then(() => { onImported?.() }, (error: Error) => { setImportError(error.message) })
              }}
            />
          </label>
          <button type="button" className="dsh-widget-board__library-close" onClick={onClose}>{t('close')}</button>
        </div>
      </header>
      <WidgetGrid
        entries={entries}
        widgets={widgets}
        theme={theme}
        frames={frames}
        mode="add"
        busy={busy}
        onActivate={onAdd}
        onBeginDrag={onBeginDrag}
      />
    </div>
  )
}
