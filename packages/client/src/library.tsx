/**
 * 组件库整窗（D17、D8）：按来源分组的实时缩略画面，按住一格拖到看板，轻点加在末尾。
 *
 * 缩略画面与网格本身住在 `widget-grid.tsx`，卡片设置弹窗的换槽也用同一份；这里只剩导入导出、
 * 头部与关闭。面板从底部上拉，关着时由 `open` 停在虚化下沉的关态（D10）。
 */
import { useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import type { MarketListing, MarketSectionSnapshot, WidgetLibraryEntry, WidgetSummary } from '@dsh-widget-board/contracts'
import { libraryImportPath, libraryMarketInstallPath } from '@dsh-widget-board/contracts'
import { t } from './copy'
import { BoardError, failureOf } from './snapshot'
import type { FrameHost } from './frame-host'
import type { ShellTheme } from './theme'
import { WidgetGrid } from './widget-grid'

/** 组件库整窗要画的东西。 */
export interface LibraryPanelProps {
  /** 组件库的全部类型，含读不出来的那些（D17）。 */
  entries: readonly WidgetLibraryEntry[]
  /** 卡片要用的组件元信息：缩略画面按它找组件的哈希与文案。 */
  widgets: Readonly<Record<string, WidgetSummary>>
  /** 市场区：快照里的提供方节；省略时按没有提供方算。 */
  market?: readonly MarketSectionSnapshot[]
  /** 当前主题，缩略画面与看板上的卡片用同一份（D10）。 */
  theme: ShellTheme
  /** 整页唯一的握手中心（D3）。 */
  frames: FrameHost
  /** 正在加卡片或整理：整张网格暂时不可操作。 */
  busy: boolean
  /** 面板是否停在打开态；关态仍留在页面上走完退场过渡。 */
  open: boolean
  /** 轻点或键盘确认：加在末尾。 */
  onAdd: (id: string) => void
  /** 按住一格：交给看板的拖放逻辑。 */
  onBeginDrag: (entry: WidgetLibraryEntry, event: ReactPointerEvent<HTMLElement>) => void
  /** 关掉面板。 */
  onClose: () => void
  /** 导入一个组件包或装一个市场条目之后重读组件库（D8）。 */
  onImported?: () => void
}

/**
 * 把一个 `.dshw` 交给宿主（D8）。
 *
 * @param file - 用户选的文件。
 * @param replace - 允许覆盖同 id 的另一个版本（冲突后用户点了「覆盖安装」）。
 * @returns 装完之后的结果说明。
 * @throws {BoardError} 宿主拒绝时带上它给的原因；同 id 不同内容是 `widget-conflict`。
 */
async function importWidgetFile(file: File, replace = false): Promise<string> {
  const response = await fetch(`${libraryImportPath()}${replace ? '?replace=true' : ''}`, {
    method: 'POST',
    headers: { 'content-type': 'application/zip' },
    body: await file.arrayBuffer(),
  })
  // 拒绝翻成带 code 的错误：同 id 不同内容是 `widget-conflict`，冲突的下半段协议（覆盖重试）靠它识别。
  if (!response.ok) throw await failureOf(response, '导入失败')
  const body = await response.json() as { entry?: { id: string } }
  return body.entry?.id ?? file.name
}

/**
 * 装一个市场条目（D8 之后的市场契约）：把提供方、条目与版本交给宿主，宿主取包、核对、写进市场来源。
 *
 * @param provider - 提供方名。
 * @param listing - 条目。
 * @param version - 要装的版本。
 * @returns 装好的组件 id。
 * @throws {BoardError} 宿主拒绝时带上它给的原因。
 */
async function installMarketListing(provider: string, listing: MarketListing, version: string): Promise<string> {
  const response = await fetch(libraryMarketInstallPath(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider, id: listing.id, version }),
  })
  if (!response.ok) throw await failureOf(response, '安装失败')
  const body = await response.json() as { entry?: { id: string } }
  return body.entry?.id ?? listing.id
}

/**
 * 添加组件的整窗：按来源分组，把每个组件画成一格实时缩略画面，按住一格可以拖到看板上。
 *
 * @param props - 组件库、主题、打开状态、操作回调与关闭。
 * @returns 组件库面板。
 */
export function LibraryPanel({
  entries,
  widgets,
  market,
  theme,
  frames,
  busy,
  open,
  onAdd,
  onBeginDrag,
  onClose,
  onImported,
}: LibraryPanelProps): ReactNode {
  /** 导入的失败原因：画在头部，不把整个面板换成错误页。 */
  const [importError, setImportError] = useState<string | null>(null)
  /** 同名不同内容的导入：等用户决定要不要覆盖（D8 的冲突协议下半段）。 */
  const [conflict, setConflict] = useState<File | null>(null)
  /** 正在安装的市场条目；安装中时整张网格暂时不可操作由 busy 决定，这里只记失败原因。 */
  const [marketError, setMarketError] = useState<string | null>(null)

  /** 装一个包；冲突时把决定权交给用户，其余失败画在头部。 */
  const install = (file: File, replace: boolean): void => {
    setImportError(null)
    importWidgetFile(file, replace).then(() => {
      setConflict(null)
      onImported?.()
    }, (error: Error) => {
      if (error instanceof BoardError && error.code === 'widget-conflict') {
        setConflict(file)
        return
      }
      setConflict(null)
      setImportError(error.message)
    })
  }

  /** 装一个市场条目；失败原因画在市场区上方。 */
  const installMarket = (provider: string, listing: MarketListing, version: string): void => {
    setMarketError(null)
    installMarketListing(provider, listing, version).then(() => {
      onImported?.()
    }, (error: Error) => {
      setMarketError(error.message)
    })
  }

  return (
    // 面板不占 `dialog` 这个角色：别的插件给所有对话窗统一定尺寸时，那条规则会盖过 library.css 里
    // 按看板这一栏算出的四边，面板会被拉出看板之外。
    <div
      className="dsh-widget-board__library"
      data-dsh-widget-board-library=""
      data-open={open ? 'true' : 'false'}
      role="region"
      aria-label={t('library')}
    >
      <header className="dsh-widget-board__library-head">
        <div>
          <h2 className="dsh-widget-board__library-title">{t('library')}</h2>
          <p className="dsh-widget-board__library-hint">{t('libraryHint')}</p>
          {importError === null ? null : <p className="dsh-widget-board__library-error" role="status">{importError}</p>}
          {conflict === null ? null : (
            <p className="dsh-widget-board__library-error" role="status">
              {t('importConflict')}
              {' '}
              <button
                type="button"
                data-dsh-widget-board-import-replace=""
                onClick={() => { install(conflict, true) }}
              >
                {t('overwrite')}
              </button>
              <button type="button" onClick={() => { setConflict(null) }}>{t('cancel')}</button>
            </p>
          )}
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
                setConflict(null)
                install(file, false)
              }}
            />
          </label>
          <button type="button" className="dsh-widget-board__library-close" onClick={onClose}>{t('close')}</button>
        </div>
      </header>
      <div className="dsh-widget-board__library-body">
        {marketError === null ? null : <p className="dsh-widget-board__library-error" role="status">{marketError}</p>}
        <WidgetGrid
          entries={entries}
          widgets={widgets}
          theme={theme}
          frames={frames}
          mode="add"
          busy={busy}
          onActivate={onAdd}
          onBeginDrag={onBeginDrag}
          {...(market === undefined ? {} : { market })}
          onMarketInstall={installMarket}
        />
      </div>
    </div>
  )
}
