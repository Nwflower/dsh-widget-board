/**
 * 组件网格与缩略画面（D17、D22）：组件库浮窗与卡片设置弹窗的换槽共用同一份。
 *
 * 缩略画面是同一份组件文档照原样渲染出来的：没有看板实例，`setState` 与通知都不写宿主，指针与焦点
 * 都被 `inert` 挡住。网格只有两种用法——添加到看板、给组卡的一个槽挑组件。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import type { BoardInstance, WidgetLibraryEntry, WidgetSummary } from '@dsh-widget-board/contracts'
import { CLIENT_ROUTE, FLIP_GROUP_BACK, FLIP_GROUP_FRONT, FLIP_GROUP_ID } from '@dsh-widget-board/contracts'
import type { GridPlacement } from '@dsh-widget-board/model'
import { CardSurface } from './card-surface'
import { sourceLabel, t, textOf } from './copy'
import type { FrameHost } from './frame-host'
import type { ShellTheme } from './theme'

/** 缩略画面不写宿主：它没有看板上的实例，组件的 setState 也就没有落点。 */
const ignoreState = (): void => {}

/** 缩略画面也不发通知：一次预览不该在看板栏上记一笔。 */
const ignoreNotify = (): void => {}

/** 没有传入内容时共用的一份空 props。 */
const EMPTY_PROPS: Record<string, unknown> = {}

/**
 * 一个组件包的下载地址（D8）。
 *
 * @param id - 组件 id。
 * @returns 文档相对的地址；写成 `<a download>` 的 href 就能直接下载。
 */
function exportPathOf(id: string): string {
  return `${CLIENT_ROUTE}/library/widget/${encodeURIComponent(id)}/export`
}

/** 缩略画面要显示的那一份实例内容。 */
export interface PreviewContent {
  props?: Record<string, unknown>
  data?: unknown
  state?: unknown
}

/**
 * 缩略画面：量出格子的像素盒，按真实盒子把组件渲染一次。
 *
 * @param props - 预览 id、组件、主题、握手中心与可选的实例内容。
 * @returns 一格缩略画面。
 */
export function WidgetPreview({
  id,
  widgetId,
  widget,
  theme,
  frames,
  content,
  flip = false,
}: {
  /** 预览用的稳定 id 前缀；同一页里不能与别的预览撞。 */
  id: string
  widgetId: string
  widget: WidgetSummary
  theme: ShellTheme
  frames: FrameHost
  content?: PreviewContent
  /** 右下角画不画翻面组的标记。 */
  flip?: boolean
}): ReactNode {
  const boxRef = useRef<HTMLDivElement | null>(null)
  const inertRef = useRef<HTMLDivElement | null>(null)
  const [box, setBox] = useState<{ width: number, height: number } | null>(null)
  const props = content?.props ?? EMPTY_PROPS
  const data = content?.data ?? null
  const state = content?.state ?? null
  const instance = useMemo<BoardInstance>(() => ({
    id: `preview:${id}`,
    widget: widgetId,
    hash: widget.hash,
    props,
    data,
    state,
    layout: { x: 0, y: 0, w: 1, h: 1 },
  }), [data, id, props, state, widget.hash, widgetId])
  const placement = useMemo<GridPlacement | null>(() => box === null
    ? null
    : { id: instance.id, x: 0, y: 0, width: box.width, height: box.height, columns: 1 }, [box, instance.id])

  // 格子宽度跟着容器走：量一次，组件按真实的盒子排版；只有尺寸变了才重新握手。
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

  // 缩略画面只是画面：组件拿不到焦点，也不接指针。
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
      {flip ? <span className="dsh-widget-board__library-flip">⇄</span> : null}
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
interface WidgetTileProps {
  entry: WidgetLibraryEntry
  widgetId: string
  widget: WidgetSummary | undefined
  theme: ShellTheme
  frames: FrameHost
  mode: 'add' | 'pick'
  /** 换槽时这个槽当前的组件。 */
  current: string | undefined
  /** 整张网格暂时不可操作。 */
  busy: boolean
  onActivate: (id: string) => void
  onBeginDrag?: (entry: WidgetLibraryEntry, event: ReactPointerEvent<HTMLElement>) => void
}

/**
 * 网格里的一格：一张缩略画面，下面一行名字与一句说明。
 *
 * @param props - 组件、缩略画面、模式与操作回调。
 * @returns 网格里的一格。
 */
function WidgetTile({
  entry,
  widgetId,
  widget,
  theme,
  frames,
  mode,
  current,
  busy,
  onActivate,
  onBeginDrag,
}: WidgetTileProps): ReactNode {
  const unavailable = entry.error !== undefined || widget === undefined
  const description = entry.description === undefined ? undefined : textOf(entry.description)
  const selected = mode === 'pick' && current === entry.id
  const activate = (event: ReactKeyboardEvent<HTMLElement>): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    if (!unavailable && !busy) onActivate(entry.id)
  }

  return (
    <li className="dsh-widget-board__library-item" data-current={selected ? 'true' : undefined}>
      <div
        className="dsh-widget-board__library-add"
        data-dsh-widget-board-add={entry.id}
        data-mode={mode}
        data-current={selected ? 'true' : undefined}
        data-unavailable={unavailable ? '' : undefined}
        role="button"
        tabIndex={unavailable || busy ? -1 : 0}
        aria-disabled={unavailable || busy}
        aria-current={selected ? 'true' : undefined}
        title={entry.error ?? description ?? textOf(entry.title)}
        onPointerDown={(event) => {
          if (unavailable || busy || mode !== 'add') return
          onBeginDrag?.(entry, event)
        }}
        onClick={() => {
          if (unavailable || busy || mode !== 'pick') return
          onActivate(entry.id)
        }}
        onKeyDown={activate}
      >
        {widget === undefined
          ? <EmptyPreview entry={entry} />
          : (
            <WidgetPreview
              id={`picker:${entry.id}`}
              widgetId={widgetId}
              widget={widget}
              theme={theme}
              frames={frames}
              flip={entry.id === FLIP_GROUP_ID}
            />
          )}
        <span className="dsh-widget-board__library-copy">
          <span className="dsh-widget-board__library-name">
            <span className="dsh-widget-board__library-label">{textOf(entry.title)}</span>
            {selected ? <span className="dsh-widget-board__library-current">{t('current')}</span> : null}
            {entry.provider === undefined ? null : <span className="dsh-widget-board__library-provider">{entry.provider}</span>}
          </span>
          {entry.error === undefined
            ? description === undefined ? null : <span className="dsh-widget-board__library-desc">{description}</span>
            : <span className="dsh-widget-board__library-error">{entry.error}</span>}
        </span>
      </div>
      {mode === 'add' && !unavailable && entry.id !== FLIP_GROUP_ID
        ? (
          <a
            className="dsh-widget-board__library-export"
            data-dsh-widget-board-export={entry.id}
            href={exportPathOf(entry.id)}
            download={`${entry.id}.dshw`}
            onPointerDown={(event) => { event.stopPropagation() }}
            title={t('export')}
          >
            {t('export')}
          </a>
        )
        : null}
    </li>
  )
}

/** 组件网格要画的东西。 */
export interface WidgetGridProps {
  entries: readonly WidgetLibraryEntry[]
  widgets: Readonly<Record<string, WidgetSummary>>
  theme: ShellTheme
  frames: FrameHost
  /** 添加到看板，或给组卡的一个槽挑组件。 */
  mode: 'add' | 'pick'
  /** 换槽时这个槽当前的组件。 */
  current?: string
  /** 整张网格暂时不可操作。 */
  busy?: boolean
  /** 轻点或键盘确认。 */
  onActivate: (id: string) => void
  /** 添加模式里按住一格：交给看板的拖放逻辑。 */
  onBeginDrag?: (entry: WidgetLibraryEntry, event: ReactPointerEvent<HTMLElement>) => void
}

/**
 * 按来源分组的组件网格。
 *
 * @param props - 组件、主题、模式与操作回调。
 * @returns 网格。
 */
export function WidgetGrid({
  entries,
  widgets,
  theme,
  frames,
  mode,
  current,
  busy = false,
  onActivate,
  onBeginDrag,
}: WidgetGridProps): ReactNode {
  const groups = ['builtin', 'user', 'plugin'].map((source) => ({
    source: source as WidgetLibraryEntry['source'],
    items: entries.filter((entry) => entry.source === source),
  })).filter((group) => group.items.length > 0)

  if (groups.length === 0) return <p className="dsh-widget-board__notice">{t('libraryEmpty')}</p>
  return (
    <>
      {groups.map((group) => (
        <section key={group.source} className="dsh-widget-board__library-group">
          <h3 className="dsh-widget-board__library-source">{sourceLabel(group.source)}</h3>
          <ul className="dsh-widget-board__library-list">
            {group.items.map((entry) => {
              const preview = previewOf(entry, widgets)
              return (
                <WidgetTile
                  key={entry.id}
                  entry={entry}
                  widgetId={preview.widgetId}
                  widget={preview.widget}
                  theme={theme}
                  frames={frames}
                  mode={mode}
                  current={current}
                  busy={busy}
                  onActivate={onActivate}
                  {...(onBeginDrag === undefined ? {} : { onBeginDrag })}
                />
              )
            })}
          </ul>
        </section>
      ))}
    </>
  )
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
