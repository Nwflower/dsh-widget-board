/**
 * 编辑一张卡的内容（C02、C05、C06、C07）：按组件声明的 schema 改 props、data 与 state，保存时带上
 * 读到的看板修订号。
 *
 * 只改这一张卡：保存走 `POST /instance/<id>/content`，组件源码、同一类型的其它卡片都不动（C05）。
 * 修订号过期时保留草稿并给出两条路——重新读取，或把这份内容另存成一张新卡片（C07）；保存失败时
 * 输入原样留在这里（C06）。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type {
  Board,
  CardContentModel,
  CardLayout,
  WidgetLibraryEntry,
  WidgetSummary,
  WorkspaceSnapshot,
  MediaBinding,
} from '@dsh-widget-board/contracts'
import { t, textOf } from '../copy'
import type { FrameHost } from '../frame-host'
import type { ShellTheme } from '../theme'
import { WidgetPreview } from '../widget-grid'
import {
  ContentRejectedError,
  ContentStaleError,
  composeInstance,
  fetchCardContent,
  saveCardContent,
} from '../snapshot'
import { SchemaForm, formPathOf } from './fields'
import { SourceEditorPanel } from './source-panel'
import { PreviewPanel } from './preview-panel'
import { copyMedia, imageFormSchema, ImageDraftPreview, ImageField } from './media-field'
import { CampusForm, isCampusSchema } from '../campus/form'
import { campusProps, campusState } from '@dsh-widget-board/model/campus/model'
import { CampusMedia } from './campus-media'
import { CampusExchange } from '../campus/exchange'

/** 内容编辑器要画的东西。 */
export interface ContentEditorProps {
  instanceId: string
  board: Board
  widgets: Readonly<Record<string, WidgetSummary>>
  library: readonly WidgetLibraryEntry[]
  theme: ShellTheme
  frames: FrameHost
  anchor: HTMLElement | null
  /** 保存成功：带着新的工作区交给页面。 */
  onSaved: (snapshot?: WorkspaceSnapshot) => void
  /** 关掉内容编辑，回到卡片设置。 */
  onClose: () => void
  /** 内容已经有了新的去处（另存为新卡片）：两个弹窗一起收起来。 */
  onDone: () => void
}

/** 表单里的一节。 */
interface Section {
  key: 'props' | 'data' | 'state'
  title: string
}

/**
 * 三节的次序（C02）：外观、数据、状态，缺 schema 的节不出现。
 *
 * @param model - 这张卡的内容读模型。
 * @returns 要画的那几节。
 */
function sectionsOf(model: CardContentModel): Section[] {
  const sections: Section[] = []
  if (model.widget.propsSchema !== undefined) sections.push({ key: 'props', title: t('formProps') })
  if (model.widget.dataSchema !== undefined) sections.push({ key: 'data', title: t('formData') })
  if (model.widget.stateSchema !== undefined) sections.push({ key: 'state', title: t('formState') })
  return sections
}

/**
 * 宿主给的逐字段原因收成一张表：键是 `节.点分路径`，与表单画出来的路径对得上。
 *
 * @param rejected - 宿主的拒绝。
 * @returns 键是路径的原因。
 */
function issuesOf(rejected: ContentRejectedError): Record<string, string> {
  const subject = rejected.subject ?? 'props'
  const map: Record<string, string> = {}
  for (const issue of rejected.issues) map[`${subject}.${formPathOf(issue.path)}`] = issue.message
  return map
}

/**
 * 编辑一张卡的内容。
 *
 * @param props - 卡片、看板、组件库、主题与回调。
 * @returns 弹窗。
 */
export function ContentEditor({
  instanceId,
  board,
  widgets,
  library,
  theme,
  frames,
  anchor,
  onSaved,
  onClose,
  onDone,
}: ContentEditorProps): ReactNode {
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [model, setModel] = useState<CardContentModel | null>(null)
  const [props, setProps] = useState<Record<string, unknown>>({})
  const [data, setData] = useState<unknown>(null)
  const [state, setState] = useState<unknown>(null)
  const [issues, setIssues] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  const [saving, setSaving] = useState(false)
  const [media, setMedia] = useState<MediaBinding>({})
  const [mediaBusy, setMediaBusy] = useState(false)
  const [campusPending, setCampusPending] = useState(false)
  const [exchangePending, setExchangePending] = useState(false)
  const [mediaPreview, setMediaPreview] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [confirmClose, setConfirmClose] = useState(false)
  const [savedOnce, setSavedOnce] = useState(false)
  const [sourceOpen, setSourceOpen] = useState(false)
  const [sourceFiles, setSourceFiles] = useState<Record<string, string>>({})
  const [sourceBinary, setSourceBinary] = useState<Record<string, string>>({})
  const [sourceCloseRequest, setSourceCloseRequest] = useState(0)
  const [previewAutoRun, setPreviewAutoRun] = useState(true)
  const [sourcePane, setSourcePane] = useState<'editor' | 'preview'>('editor')
  const currentSize = useMemo(() => {
    const frame = anchor?.querySelector<HTMLIFrameElement>(`[data-instance="${CSS.escape(instanceId)}"] iframe.dsh-widget-board__frame`)
    if (frame === null || frame === undefined) return undefined
    const box = frame.getBoundingClientRect()
    return { width: box.width, height: box.height }
  }, [anchor, instanceId])
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const closeRef = useRef<HTMLButtonElement | null>(null)

  // 弹窗按看板页的矩形定位（D1）。
  useLayoutEffect(() => {
    if (anchor === null) return
    const update = (): void => { setRect(anchor.getBoundingClientRect()) }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(anchor)
    window.addEventListener('resize', update)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [anchor])

  /** 重读这张卡：初值、修订号与 schema 一起换（C07 的「重新读取」）。 */
  const load = useCallback((keepDraft: boolean): void => {
    setLoadError(null)
    fetchCardContent(instanceId).then((next) => {
      setModel(next)
      setStale(false)
      if (keepDraft) return
      setProps(next.instance.props)
      setData(next.instance.data)
      setState(next.instance.state)
      setMedia(next.instance.media === undefined ? {} : { media: next.instance.media })
      setIssues({})
      setError(null)
      setSavedOnce(false)
    }, (caught: Error) => {
      setLoadError(caught.message)
    })
  }, [instanceId])

  useEffect(() => { load(false) }, [load])

  useEffect(() => { closeRef.current?.focus() }, [])

  const sections = useMemo(() => (model === null ? [] : sectionsOf(model)), [model])
  const preview = model === null ? undefined : widgets[model.widget.id]
  const blank = model === null
    || (JSON.stringify(props) === JSON.stringify(model.instance.props)
      && JSON.stringify(data) === JSON.stringify(model.instance.data)
      && JSON.stringify(state) === JSON.stringify(model.instance.state)
      && JSON.stringify(media.media ?? {}) === JSON.stringify(model.instance.media ?? {}))
  const dirty = !blank || campusPending || exchangePending

  /** 保存：带上读到的修订号；字段原因、冲突与失败分开处理（C06、C07）。 */
  const save = async (): Promise<void> => {
    if (model === null || saving || mediaBusy || campusPending || exchangePending) return
    setSaving(true)
    setError(null)
    setIssues({})
    setStale(false)
    try {
      if (isCampusSchema(model.widget.stateSchema)) { campusProps(props); campusState(state) }
      const saved = await saveCardContent(instanceId, {
        expectedRevision: model.revision,
        ...media,
        props,
        data,
        state,
      })
      setModel({ ...model, revision: saved.revision, instance: { ...model.instance, props: saved.props, data: saved.data, state: saved.state, media: saved.media } })
      setMedia(saved.media === undefined ? {} : { media: saved.media })
      setProps(saved.props)
      setData(saved.data)
      setState(saved.state)
      setSavedOnce(true)
      onSaved()
    } catch (caught) {
      if (caught instanceof ContentStaleError) {
        setStale(true)
        setError(caught.message)
        if (caught.snapshot !== undefined) onSaved(caught.snapshot)
      } else if (caught instanceof ContentRejectedError) {
        setIssues(issuesOf(caught))
        setError(caught.message)
      } else {
        setError((caught as Error).message)
      }
    } finally {
      setSaving(false)
    }
  }

  /** 另存为新卡片：把这份内容按同一个组件建一张新卡（C07）。 */
  const saveAsNew = async (layout?: CardLayout): Promise<void> => {
    if (model === null || saving || mediaBusy || campusPending || exchangePending) return
    setSaving(true)
    setError(null)
    try {
      if (isCampusSchema(model.widget.stateSchema)) { campusProps(props); campusState(state) }
      const copiedMedia = media.media === undefined ? {} : await copyMedia(instanceId, board.id, media)
      const { snapshot } = await composeInstance(board.id, {
        widget: model.widget.id,
        ...copiedMedia,
        props,
        data,
        state,
        ...(layout === undefined ? {} : { layout }),
      })
      onSaved(snapshot)
      onDone()
    } catch (caught) {
      if (caught instanceof ContentRejectedError) setIssues(issuesOf(caught))
      setError((caught as Error).message)
    } finally {
      setSaving(false)
    }
  }

  /** 关掉弹窗：有未保存内容时先确认。 */
  const requestClose = (): void => {
    if (sourceOpen) { setSourceCloseRequest((value) => value + 1); return }
    if (!dirty && error === null) {
      onClose()
      return
    }
    if (confirmClose) {
      onClose()
      return
    }
    setConfirmClose(true)
  }

  const issuesFor = (section: Section['key']): Record<string, string> | undefined => {
    const picked: Record<string, string> = {}
    for (const [key, value] of Object.entries(issues)) {
      if (!key.startsWith(`${section}.`)) continue
      picked[key.slice(section.length + 1)] = value
    }
    return Object.keys(picked).length === 0 ? undefined : picked
  }

  if (rect === null) return null

  return (
    <div
      className="dsh-widget-board__editor-layer"
      style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.stopPropagation()
        requestClose()
      }}
    >
      <div className="dsh-widget-board__editor-backdrop" onPointerDown={requestClose} />
      <div
        ref={dialogRef}
        className="dsh-widget-board__editor dsh-widget-board__composer"
        data-dsh-widget-board-content-editor=""
        role="dialog"
        aria-labelledby="dsh-widget-board-content-title"
      >
        <header className="dsh-widget-board__editor-head">
          <div>
            <p className="dsh-widget-board__editor-eyebrow">{t('editContent')}</p>
            <h2 id="dsh-widget-board-content-title" className="dsh-widget-board__editor-title">
              {model === null ? t('editTitle') : textOf(model.widget.title)}
            </h2>
            <p className="dsh-widget-board__editor-source">
              {model === null ? t('editorLoading') : `${t('formPreviewHint')} · ${model.widget.version}`}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="dsh-widget-board__editor-close"
            data-dsh-widget-board-content-close=""
            onClick={requestClose}
            title={t('close')}
          >
            ×
          </button>
        </header>

        {sourceOpen ? <div className="dsh-widget-board__source-panes">{(['editor', 'preview'] as const).map((pane) => <button key={pane} type="button" className="dsh-widget-board__editor-ghost" aria-pressed={sourcePane === pane} onClick={() => { setSourcePane(pane) }}>{pane === 'editor' ? '源码' : '预览'}</button>)}</div> : null}
        <div className="dsh-widget-board__composer-body" data-dsh-widget-board-source-pane={sourceOpen ? sourcePane : undefined}>
          <div className="dsh-widget-board__composer-form">
            {model !== null && !sourceOpen && isCampusSchema(model.widget.stateSchema) ? <CampusExchange target={instanceId} disabled={!blank || campusPending || mediaBusy || saving} onPending={setExchangePending} onSaved={() => { load(false); onSaved() }} /> : null}
            {model?.widget.id === 'image' && !sourceOpen ? <ImageField target={instanceId} value={media} onChange={next => { setMedia(next); setProps(current => ({ ...current, localImage: Boolean(next.media?.background) })) }} onBusy={setMediaBusy} onPreview={setMediaPreview} disabled={saving} /> : null}
            {model === null ? null : <button type="button" className="dsh-widget-board__editor-ghost" data-dsh-widget-board-content-source="" disabled={exchangePending || campusPending || mediaBusy || saving} onClick={() => { setSourceOpen(true) }}>{t('sourceTitle')}</button>}
            {sourceOpen && model !== null ? <SourceEditorPanel widgetId={model.widget.id} instanceId={instanceId} theme={theme} onFilesChanged={setSourceFiles} onBinaryChanged={setSourceBinary} onRestore={() => { setPreviewAutoRun(false) }} closeRequest={sourceCloseRequest} onClose={() => { setSourceOpen(false); setSourceCloseRequest(0) }} onSaved={() => { setSourceOpen(false); load(true); onSaved() }} /> : null}
            {loadError === null
              ? null
              : (
                <div className="dsh-widget-board__editor-failure">
                  <p role="alert">{`${t('editorFailed')}：${loadError}`}</p>
                  <button type="button" className="dsh-widget-board__editor-ghost" onClick={() => { load(false) }}>
                    {t('formReload')}
                  </button>
                </div>
              )}
            <fieldset disabled={exchangePending} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
            {model === null
              ? <p className="dsh-widget-board__editor-empty">{t('editorLoading')}</p>
              : sourceOpen ? null : isCampusSchema(model.widget.stateSchema) ? <CampusForm props={props} state={state} onProps={setProps} onState={setState} onPending={setCampusPending} disabled={saving || mediaBusy} media={<CampusMedia target={instanceId} value={media} onChange={next => { setMedia(next); setProps(current => ({ ...current, hasBackground: Boolean(next.media?.background), hasIcon: Boolean(next.media?.icon) })) }} onBusy={setMediaBusy} disabled={saving || mediaBusy} />} /> : sections.map((section) => {
                const schema = section.key === 'props'
                  ? model.widget.propsSchema
                  : section.key === 'data' ? model.widget.dataSchema : model.widget.stateSchema
                const value = section.key === 'props' ? props : section.key === 'data' ? data : state
                const write = section.key === 'props'
                  ? (next: unknown) => { setProps(next !== null && typeof next === 'object' && !Array.isArray(next) ? next as Record<string, unknown> : {}) }
                  : section.key === 'data' ? setData : setState
                return (
                  <section key={section.key} className="dsh-widget-board__composer-section" data-dsh-widget-board-content-section={section.key}>
                    <h3 className="dsh-widget-board__composer-heading">{section.title}</h3>
                    <SchemaForm
                      schema={model.widget.id === 'image' ? imageFormSchema(schema, section.key) : schema}
                      value={value}
                      onChange={write}
                      text={model.widget.text}
                      issues={issuesFor(section.key)}
                      disabled={saving}
                      section={section.key}
                    />
                  </section>
                )
              })}
            </fieldset>
            {error === null ? null : <p className="dsh-widget-board__editor-error" role="alert">{error}</p>}
            {stale
              ? (
                <div className="dsh-widget-board__composer-conflict" data-dsh-widget-board-content-stale="">
                  <p>{t('formStale')}</p>
                  <div className="dsh-widget-board__editor-actions">
                    <button
                      type="button"
                      className="dsh-widget-board__editor-ghost"
                      data-dsh-widget-board-content-reload=""
                      disabled={saving}
                      onClick={() => { load(false) }}
                    >
                      {t('formReload')}
                    </button>
                    <button
                      type="button"
                      className="dsh-widget-board__editor-primary"
                      data-dsh-widget-board-content-save-as-new=""
                      disabled={saving}
                      onClick={() => { void saveAsNew() }}
                    >
                      {t('formSaveAsNew')}
                    </button>
                  </div>
                </div>
              )
              : null}
          </div>

          <aside className="dsh-widget-board__composer-preview" aria-label={t('formPreview')}>
            <div className="dsh-widget-board__composer-preview-head">
              <span>{t('formPreview')}</span>
              {savedOnce ? <span className="dsh-widget-board__editor-ok">{t('saved')}</span> : null}
            </div>
            {sourceOpen ? <PreviewPanel files={sourceFiles} binaryFiles={sourceBinary} autoRun={previewAutoRun} currentSize={currentSize} props={props} data={data} state={state} theme={theme} frames={frames} /> : preview === undefined || model === null
              ? <p className="dsh-widget-board__editor-empty">{t('formPreviewHint')}</p>
              : (
                <div className="dsh-widget-board__composer-frame">
                  {model.widget.id === 'image' ? <ImageDraftPreview url={mediaPreview} props={props} data={data} /> : <WidgetPreview
                    id={`content:${instanceId}`}
                    widgetId={model.widget.id}
                    widget={preview}
                    theme={theme}
                    frames={frames}
                    content={{ props: isCampusSchema(model.widget.stateSchema) ? { ...props, hasBackground: false, hasIcon: false } : props, data, state }}
                  />}
                </div>
              )}
          </aside>
        </div>

        {confirmClose
          ? (
            <footer className="dsh-widget-board__editor-foot">
              <p className="dsh-widget-board__editor-note">{t('formUnsaved')}</p>
              <div className="dsh-widget-board__editor-actions">
                <button
                  type="button"
                  className="dsh-widget-board__editor-ghost"
                  data-dsh-widget-board-content-keep=""
                  onClick={() => { setConfirmClose(false) }}
                >
                  {t('formKeepEditing')}
                </button>
                <button
                  type="button"
                  className="dsh-widget-board__editor-primary"
                  data-dsh-widget-board-content-discard=""
                  onClick={onClose}
                >
                  {t('formDiscard')}
                </button>
              </div>
            </footer>
          )
          : (
            <footer className="dsh-widget-board__editor-foot">
              <button type="button" className="dsh-widget-board__editor-ghost" onClick={requestClose}>{t('cancel')}</button>
              <span className="dsh-widget-board__editor-spacer" />
              <button
                type="button"
                className="dsh-widget-board__editor-primary"
                data-dsh-widget-board-content-save=""
                disabled={saving || mediaBusy || campusPending || exchangePending || model === null || !dirty || sourceOpen}
                onClick={() => { void save() }}
              >
                {saving ? t('formSaving') : t('save')}
              </button>
            </footer>
          )}
      </div>
    </div>
  )
}
