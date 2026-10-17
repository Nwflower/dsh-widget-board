import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import type { BoardInstance, WidgetLibraryEntry, WidgetSummary } from '@dsh-widget-board/contracts'
import { FLIP_GROUP_BACK, FLIP_GROUP_FRONT, FLIP_GROUP_ID } from '@dsh-widget-board/contracts'
import type { GridPlacement } from '@dsh-widget-board/model'
import { CardSurface } from './card-surface'
import type { FrameHost } from './frame-host'
import type { ShellTheme } from './theme'
import { isChinese, t } from './copy'

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
 * 一格缩略画面用哪个组件。
 *
 * 翻面组没有自己的组件文档，缩略画面取正面的那张卡；正面不在时用背面（D19）。
 *
 * @param entry - 组件库里的一个类型。
 * @param widgets - 快照里的组件元信息。
 * @returns 组件 id 与它的元信息；元信息缺席时没有画面。
 */
function previewOf(entry: WidgetLibraryEntry, widgets: Readonly<Record<string, WidgetSummary>>): { widgetId: string, widget: WidgetSummary | undefined } {
  if (entry.id !== FLIP_GROUP_ID) return { widgetId: entry.id, widget: widgets[entry.id] }
  const widgetId = widgets[FLIP_GROUP_FRONT] === undefined ? FLIP_GROUP_BACK : FLIP_GROUP_FRONT
  return { widgetId, widget: widgets[widgetId] }
}

/** 缩略画面不写宿主：它没有看板上的实例，组件的 setState 也就没有落点。 */
const ignoreState = (): void => {}

/** 缩略画面也不发通知：组件库里的一次预览不该在看板栏上记一笔。 */
const ignoreNotify = (): void => {}

/** 一格缩略图：组件照常渲染，量出格子的像素盒再交给它（D3、D16）。 */
function WidgetPreview({ entryId, widgetId, widget, theme, frames }: {
  entryId: string
  widgetId: string
  widget: WidgetSummary
  theme: ShellTheme
  frames: FrameHost
}): ReactNode {
  const boxRef = useRef<HTMLDivElement | null>(null)
  const inertRef = useRef<HTMLDivElement | null>(null)
  const [box, setBox] = useState<{ width: number, height: number } | null>(null)
  const instance = useMemo<BoardInstance>(() => ({
    id: `library:${entryId}`,
    widget: widgetId,
    hash: widget.hash,
    props: {},
    data: null,
    state: null,
    layout: { x: 0, y: 0, w: 1, h: 1 },
  }), [entryId, widgetId, widget.hash])
  const placement = useMemo<GridPlacement | null>(() => box === null
    ? null
    : { id: instance.id, x: 0, y: 0, width: box.width, height: box.height, columns: 1 }, [box, instance.id])

  // 格子宽度跟着浮窗走：量一次，组件按真实的盒子排版；只有尺寸变了才重新握手。
  useEffect(() => {
    const element = boxRef.current
    if (element === null) return
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (rect === undefined) return
      const width = Math.round(rect.width)
      const height = Math.round(rect.height)
      if (width < 1 || height < 1) return
      setBox((previous) => previous !== null && previous.width === width && previous.height === height
        ? previous
        : { width, height })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // 缩略画面只是画面：组件拿不到焦点，也不接指针，按住整格就是拖动。
  useEffect(() => { inertRef.current?.setAttribute('inert', '') }, [])

  return (
    <div ref={boxRef} className="dsh-widget-board__library-preview" aria-hidden="true">
      <div ref={inertRef} className="dsh-widget-board__library-preview-surface">
        {placement === null
          ? null
          : (
            <CardSurface
              instance={instance}
              widget={widget}
              placement={placement}
              theme={theme}
              frames={frames}
              onState={ignoreState}
              onNotify={ignoreNotify}
              paused={false}
              preview
            />
          )}
      </div>
      {entryId === FLIP_GROUP_ID ? <span className="dsh-widget-board__library-flip">⇄</span> : null}
    </div>
  )
}

/** 读不出组件时的画面：虚线格子里写它是哪一个。 */
function EmptyPreview({ entry }: { entry: WidgetLibraryEntry }): ReactNode {
  return (
    <div className="dsh-widget-board__library-preview dsh-widget-board__library-preview--empty" aria-hidden="true">
      <span className="dsh-widget-board__library-preview-id">{entry.id}</span>
      {entry.error === undefined ? null : <span className="dsh-widget-board__library-preview-mark">!</span>}
    </div>
  )
}

/** 网格里的一格。 */
interface LibraryTileProps {
  entry: WidgetLibraryEntry
  widgetId: string
  widget: WidgetSummary | undefined
  theme: ShellTheme
  frames: FrameHost
  busy: boolean
  onAdd: (id: string) => void
  onBeginDrag: (entry: WidgetLibraryEntry, event: ReactPointerEvent<HTMLElement>) => void
}

/**
 * 一格组件：一张缩略画面，下面一行名字与一句说明；按住整格拖到看板，轻点加在末尾。
 *
 * @param props - 组件、缩略画面、主题与操作回调。
 * @returns 网格里的一格。
 */
function LibraryTile({ entry, widgetId, widget, theme, frames, busy, onAdd, onBeginDrag }: LibraryTileProps): ReactNode {
  const unavailable = entry.error !== undefined || widget === undefined
  const description = entry.description === undefined ? undefined : textOf(entry.description)
  const activate = (event: ReactKeyboardEvent<HTMLElement>): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    if (!unavailable && !busy) onAdd(entry.id)
  }

  return (
    <li className="dsh-widget-board__library-item">
      <div
        className="dsh-widget-board__library-add"
        data-dsh-widget-board-add={entry.id}
        data-unavailable={unavailable ? '' : undefined}
        role="button"
        tabIndex={unavailable || busy ? -1 : 0}
        aria-disabled={unavailable || busy}
        title={entry.error ?? description ?? textOf(entry.title)}
        onPointerDown={(event) => {
          if (unavailable || busy) return
          onBeginDrag(entry, event)
        }}
        onKeyDown={activate}
      >
        {widget === undefined
          ? <EmptyPreview entry={entry} />
          : <WidgetPreview entryId={entry.id} widgetId={widgetId} widget={widget} theme={theme} frames={frames} />}
        <span className="dsh-widget-board__library-copy">
          <span className="dsh-widget-board__library-name">
            <span className="dsh-widget-board__library-label">{textOf(entry.title)}</span>
            {entry.provider === undefined ? null : <span className="dsh-widget-board__library-provider">{entry.provider}</span>}
          </span>
          {entry.error === undefined
            ? description === undefined ? null : <span className="dsh-widget-board__library-desc">{description}</span>
            : <span className="dsh-widget-board__library-error">{entry.error}</span>}
        </span>
      </div>
    </li>
  )
}

/**
 * 添加组件的浮窗：按来源分组，把每个组件画成一格实时缩略画面，按住一格可以拖到看板上。
 *
 * 浮窗固定在看板内容之上，不参与看板的排版；缩略画面是同一份组件照原样渲染出来的，尺寸按格子量出，
 * 格上的指针按下交给 `onBeginDrag`，轻点交给 `onAdd`，两条路都由外层决定什么时候写宿主（D3、D17）。
 *
 * @param props - 组件库、主题、操作回调与关闭。
 * @returns 浮窗。
 */
export function LibraryPanel({ entries, widgets, theme, frames, busy, onAdd, onBeginDrag, onClose }: LibraryPanelProps): ReactNode {
  const groups = ['builtin', 'user', 'plugin'].map((source) => ({
    source: source as WidgetLibraryEntry['source'],
    items: entries.filter((entry) => entry.source === source),
  })).filter((group) => group.items.length > 0)

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
                const preview = previewOf(entry, widgets)
                return (
                  <LibraryTile
                    key={entry.id}
                    entry={entry}
                    widgetId={preview.widgetId}
                    widget={preview.widget}
                    theme={theme}
                    frames={frames}
                    busy={busy}
                    onAdd={onAdd}
                    onBeginDrag={onBeginDrag}
                  />
                )
              })}
            </ul>
          </section>
        ))}
    </div>
  )
}
