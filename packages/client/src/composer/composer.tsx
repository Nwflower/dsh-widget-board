/**
 * 创建卡片（C01、C02、C06）：选模板、填内容、看真实渲染，再一次写进看板。
 *
 * 内容先留在这一层，只有按下「添加到看板」才变成正式实例；宿主拒绝时按逐字段原因把提示放回对应的
 * 那一行，输入一个字都不丢（C06）。预览用真实的组件文档与真实的盒子，但只有本地状态：预览里改
 * 出来的东西没有地方可写（C01 的「无假占位」说的是这个——每一个入口都真的会做事）。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type {
  Board,
  LocalizedText,
  WidgetFormModel,
  WidgetLibraryEntry,
  WidgetSummary,
  WorkspaceSnapshot,
  MediaBinding,
} from '@dsh-widget-board/contracts'
import { FLIP_GROUP_ID } from '@dsh-widget-board/contracts'
import { isChinese, t, textOf } from '../copy'
import { ContentRejectedError, composeInstance, fetchWidgetForm } from '../snapshot'
import type { FrameHost } from '../frame-host'
import type { ShellTheme } from '../theme'
import { WidgetPreview } from '../widget-grid'
import { SchemaForm, formPathOf } from './fields'
import { SourceEditorPanel } from './source-panel'
import { PreviewPanel } from './preview-panel'
import type { Template, TemplateKey } from './templates'
import { TEMPLATES, seedOf, templateOf } from './templates'
import { imageFormSchema, ImageDraftPreview, ImageField } from './media-field'
import { CampusForm, isCampusSchema } from '../campus/form'
import { campusProps, campusState } from '@dsh-widget-board/model/campus/model'
import { CampusMedia } from './campus-media'

/** 创建器要画的东西。 */
export interface ComposerProps {
  board: Board
  widgets: Readonly<Record<string, WidgetSummary>>
  library: readonly WidgetLibraryEntry[]
  theme: ShellTheme
  frames: FrameHost
  /** 看板页的根节点：弹窗按它的矩形定位，不盖宿主外壳（D1）。 */
  anchor: HTMLElement | null
  /** 创建成功：带着新卡片所在的工作区交给页面。 */
  onCreated: (snapshot: WorkspaceSnapshot) => void
  onClose: () => void
}

/** 表单里的一节：标题与那一份内容。 */
interface FormSection {
  key: 'props' | 'data' | 'state'
  title: string
}

/**
 * 这一份 manifest 的几节按模板给出的次序排。
 *
 * @param template - 选中的模板。
 * @returns 要展开的那几节。
 */
function sectionsOf(template: Template | null): FormSection[] {
  const wanted = template?.sections ?? (['props', 'data', 'state'] as const)
  return wanted.map((key) => ({
    key,
    title: key === 'props' ? t('formProps') : key === 'data' ? t('formData') : t('formState'),
  }))
}

/**
 * 一份组件在模板里的名字：模板写过就用模板的，没有时用组件自己的标题。
 *
 * @param template - 模板。
 * @param widget - 组件的标题。
 * @returns 当前语言下的名字。
 */
function titleOf(template: Template | null, widget: LocalizedText | undefined): string {
  if (template !== null) return isChinese() ? template.title.zh : template.title.en
  return widget === undefined ? '' : textOf(widget)
}

/**
 * 创建一张卡片的弹窗。
 *
 * @param props - 看板、组件库、主题、预览裁决与回调。
 * @returns 弹窗。
 */
export function CardComposer({
  board,
  widgets,
  library,
  theme,
  frames,
  anchor,
  onCreated,
  onClose,
}: ComposerProps): ReactNode {
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [templateKey, setTemplateKey] = useState<TemplateKey | null>(null)
  const [advanced, setAdvanced] = useState<string | null>(null)
  const [props, setProps] = useState<Record<string, unknown>>({})
  const [data, setData] = useState<unknown>(null)
  const [state, setState] = useState<unknown>(null)
  const [issues, setIssues] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [media, setMedia] = useState<MediaBinding>({})
  const [mediaBusy, setMediaBusy] = useState(false)
  const [campusPending, setCampusPending] = useState(false)
  const [mediaPreview, setMediaPreview] = useState<string | null>(null)
  const [confirmClose, setConfirmClose] = useState(false)
  const [previewFamily, setPreviewFamily] = useState<'regular' | 'narrow' | 'wide'>('regular')
  /** 选中组件的那份表单模型：schema 与文案按它画，创建器不必先把实例建出来。 */
  const [form, setForm] = useState<WidgetFormModel | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  /** 高级模式：改的是组件源码而不是这张卡的内容（C4）。 */
  const [sourceOpen, setSourceOpen] = useState(false)
  /** 源码模式下的预览：文件与内容交给它渲染。 */
  const [sourceCloseRequest, setSourceCloseRequest] = useState(0)
  const [previewAutoRun, setPreviewAutoRun] = useState(true)
  const [sourcePane, setSourcePane] = useState<'editor' | 'preview'>('editor')
  const [sourceBinary, setSourceBinary] = useState<Record<string, string>>({})
  /** 源码模式里当前的���件内容：预览面板按它开一个预览会话。 */
  const [sourceFiles, setSourceFiles] = useState<Record<string, string>>({})
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const closeRef = useRef<HTMLButtonElement | null>(null)

  const template = useMemo(
    () => (templateKey === null ? null : TEMPLATES.find((entry) => entry.key === templateKey) ?? null),
    [templateKey],
  )
  const widgetId = templateKey === 'advanced' ? advanced : template?.widget ?? null
  const widget = widgetId === null ? undefined : widgets[widgetId]
  const pickable = library.filter((entry) => entry.id !== FLIP_GROUP_ID && entry.error === undefined && widgets[entry.id] !== undefined)

  // 换组件时重读它的表单模型：版本变了（热重载）之后表单要跟着换 schema。
  useEffect(() => {
    if (widgetId === null || widget === undefined) {
      setForm(null)
      setFormError(null)
      return
    }
    let live = true
    setFormError(null)
    fetchWidgetForm(widgetId).then((next) => {
      if (live) setForm(next)
    }, (caught: Error) => {
      if (live) setFormError(caught.message)
    })
    return () => { live = false }
  }, [widgetId, widget?.hash])

  // 弹窗按看板页的矩形定位；宿主侧栏与外壳不受影响（D1）。
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

  useEffect(() => { closeRef.current?.focus() }, [])

  /** 换一个模板：内容换成新模板的预填值。 */
  const choose = useCallback((next: Template | null, nextAdvanced: string | null): void => {
    const seed = next === null ? { props: {}, data: null, state: null } : seedOf(next)
    setProps(seed.props)
    setData(seed.data)
    setState(seed.state)
    setMedia({})
    setIssues({})
    setError(null)
    setAdvanced(nextAdvanced)
  }, [])

  /** 选一个模板。 */
  const pickTemplate = (key: TemplateKey): void => {
    setTemplateKey(key)
    const next = TEMPLATES.find((entry) => entry.key === key) ?? null
    choose(next, null)
  }

  /**
   * 表单画出来的路径与宿主的逐字段原因对上。
   *
   * 最后一张表是 `节.点分路径`：宿主的原因从被拒那一份的根算起，表单一节一节画，所以这里先认节，
   * 再把剩下的路径交给那一节的表单。
   */
  const issuesFor = (section: 'props' | 'data' | 'state'): Record<string, string> | undefined => {
    const picked: Record<string, string> = {}
    for (const [path, message] of Object.entries(issues)) {
      const at = path.indexOf('.')
      if (at === -1 || path.slice(0, at) !== section) continue
      picked[path.slice(at + 1)] = message
    }
    return Object.keys(picked).length === 0 ? undefined : picked
  }

  /** 宿主给的逐字段原因收成 `节.点分路径` → 原因。 */
  const collectIssues = (rejected: ContentRejectedError): void => {
    const subject = rejected.subject ?? 'props'
    const map: Record<string, string> = {}
    for (const issue of rejected.issues) map[`${subject}.${formPathOf(issue.path)}`] = issue.message
    setIssues(map)
  }

  /** 提交：一次写进一张完整的卡片（C02、C06）。 */
  const submit = async (): Promise<void> => {
    if (widgetId === null || widget === undefined || saving || mediaBusy || campusPending) return
    setSaving(true)
    setError(null)
    setIssues({})
    try {
      if (isCampusSchema(form?.stateSchema)) { campusProps(props); campusState(state) }
      const { snapshot } = await composeInstance(board.id, {
        widget: widgetId,
        props,
        data,
        state,
        ...media,
      })
      onCreated(snapshot)
    } catch (caught) {
      if (caught instanceof ContentRejectedError) {
        collectIssues(caught)
        setError(caught.message)
      } else {
        setError((caught as Error).message)
      }
    } finally {
      setSaving(false)
    }
  }

  /** 关掉弹窗：填过内容时先确认（C06 的一半——输入不因为一次误点丢掉）。 */
  const requestClose = (): void => {
    if (sourceOpen) { setSourceCloseRequest((value) => value + 1); return }
    const blank = Object.keys(props).length === 0 && (data === null || data === undefined) && (state === null || state === undefined)
    if (blank || confirmClose) {
      onClose()
      return
    }
    setConfirmClose(true)
  }

  if (rect === null) return null

  const sections = sectionsOf(template)
  const previewWidget = widget
  const ready = widgetId !== null && widget !== undefined

  return (
    <div
      className="dsh-widget-board__editor-layer"
      style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          requestClose()
        }
      }}
    >
      <div className="dsh-widget-board__editor-backdrop" onPointerDown={requestClose} />
      <div
        ref={dialogRef}
        className="dsh-widget-board__editor dsh-widget-board__composer"
        data-dsh-widget-board-composer=""
        role="dialog"
        aria-labelledby="dsh-widget-board-composer-title"
      >
        <header className="dsh-widget-board__editor-head">
          <div>
            <p className="dsh-widget-board__editor-eyebrow">{t('create')}</p>
            <h2 id="dsh-widget-board-composer-title" className="dsh-widget-board__editor-title">
              {templateKey === null ? t('createTitle') : titleOf(template, widget?.title)}
            </h2>
            <p className="dsh-widget-board__editor-source">{t('createHint')}</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="dsh-widget-board__editor-close"
            data-dsh-widget-board-composer-close=""
            onClick={requestClose}
            title={t('close')}
          >
            ×
          </button>
        </header>

        {sourceOpen ? <div className="dsh-widget-board__source-panes">{(['editor', 'preview'] as const).map((pane) => <button key={pane} type="button" className="dsh-widget-board__editor-ghost" aria-pressed={sourcePane === pane} onClick={() => { setSourcePane(pane) }}>{pane === 'editor' ? '源码' : '预览'}</button>)}</div> : null}
        <div className="dsh-widget-board__composer-body" data-dsh-widget-board-source-pane={sourceOpen ? sourcePane : undefined}>
          <div className="dsh-widget-board__composer-form">
            <div className="dsh-widget-board__composer-templates" role="group" aria-label={t('templates')}>
              {TEMPLATES.map((entry) => {
                const unavailable = entry.key !== 'advanced' && widgets[entry.widget] === undefined
                return (
                  <button
                    key={entry.key}
                    type="button"
                    className="dsh-widget-board__composer-template"
                    data-dsh-widget-board-template={entry.key}
                    aria-pressed={templateKey === entry.key}
                    disabled={unavailable || saving || mediaBusy || sourceOpen || campusPending}
                    title={unavailable ? t('templateMissing') : isChinese() ? entry.hint.zh : entry.hint.en}
                    onClick={() => { pickTemplate(entry.key) }}
                  >
                    <span className="dsh-widget-board__composer-template-title">
                      {isChinese() ? entry.title.zh : entry.title.en}
                    </span>
                    <span className="dsh-widget-board__composer-template-hint">
                      {isChinese() ? entry.hint.zh : entry.hint.en}
                    </span>
                  </button>
                )
              })}
            </div>

            {/* 高级模式：改的是组件源码（C4）。它有自己的面板，表单模式不受影响。 */}
            {widgetId === null
              ? null
              : (
                <div className="dsh-widget-board__composer-modes" role="group" aria-label={t('sourceTitle')}>
                  <button
                    type="button"
                    className="dsh-widget-board__composer-mode"
                    data-dsh-widget-board-mode="form"
                    aria-pressed={!sourceOpen}
                    disabled={saving}
                    onClick={() => { setSourceCloseRequest((value) => value + 1) }}
                  >
                    {t('formBasic')}
                  </button>
                  <button
                    type="button"
                    className="dsh-widget-board__composer-mode"
                    data-dsh-widget-board-mode="source"
                    aria-pressed={sourceOpen}
                    disabled={saving}
                    onClick={() => { if (!campusPending && !mediaBusy) setSourceOpen(true) }}
                  >
                    {t('sourceTitle')}
                  </button>
                </div>
              )}

            {sourceOpen && widgetId !== null
              ? (
                <SourceEditorPanel
                  key={widgetId}
                  widgetId={widgetId}
                  theme={theme}
                  onSaved={(result) => { setTemplateKey('advanced'); setAdvanced(result.id); setSourceOpen(false) }}
                  onFilesChanged={setSourceFiles}
                  onBinaryChanged={setSourceBinary}
                  closeRequest={sourceCloseRequest}
                  onRestore={() => { setPreviewAutoRun(false) }}
                  onClose={() => { setSourceOpen(false); setSourceCloseRequest(0) }}
                />
              )
              : null}

            {templateKey === 'advanced' && advanced === null
              ? (
                <div className="dsh-widget-board__composer-picker" data-dsh-widget-board-composer-picker="">
                  <p className="dsh-widget-board__editor-empty">{t('formAdvancedPick')}</p>
                  <div className="dsh-widget-board__composer-picker-grid">
                    {pickable.map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        className="dsh-widget-board__composer-picker-item"
                        data-dsh-widget-board-pick-widget={entry.id}
                        disabled={saving}
                        onClick={() => {
                          setAdvanced(entry.id)
                          const seed = templateOf(entry.id) === undefined ? { props: {}, data: null, state: null } : seedOf(templateOf(entry.id) as Template)
                          setProps(seed.props)
                          setData(seed.data)
                          setState(seed.state)
                          setIssues({})
                          setError(null)
                        }}
                      >
                        {textOf(entry.title)}
                      </button>
                    ))}
                  </div>
                </div>
              )
              : null}

            {formError === null ? null : <p className="dsh-widget-board__editor-error" role="alert">{formError}</p>}
            {widgetId === 'image' && !sourceOpen ? <ImageField key={widgetId} target={`board:${board.id}`} value={media} onChange={next => { setMedia(next); setProps(current => ({ ...current, localImage: Boolean(next.media?.background) })) }} onBusy={setMediaBusy} onPreview={setMediaPreview} disabled={saving} /> : null}

            {ready && form !== null && !sourceOpen
              ? isCampusSchema(form?.stateSchema) ? <CampusForm props={props} state={state} onProps={setProps} onState={setState} onPending={setCampusPending} disabled={saving || mediaBusy} media={<CampusMedia target={`board:${board.id}`} value={media} onChange={next => { setMedia(next); setProps(current => ({ ...current, hasBackground: Boolean(next.media?.background), hasIcon: Boolean(next.media?.icon) })) }} onBusy={setMediaBusy} disabled={saving || mediaBusy} />} /> : sections.map((section) => {
                const schema = section.key === 'props' ? form.propsSchema : section.key === 'data' ? form.dataSchema : form.stateSchema
                const value = section.key === 'props' ? props : section.key === 'data' ? data : state
                const write = section.key === 'props'
                  ? (next: unknown) => { setProps(next !== null && typeof next === 'object' && !Array.isArray(next) ? next as Record<string, unknown> : {}) }
                  : section.key === 'data' ? setData : setState
                return (
                  <section key={section.key} className="dsh-widget-board__composer-section" data-dsh-widget-board-composer-section={section.key}>
                    <h3 className="dsh-widget-board__composer-heading">{section.title}</h3>
                    <SchemaForm
                      schema={widgetId === 'image' ? imageFormSchema(schema, section.key) : schema}
                      value={value}
                      onChange={write}
                      text={form.text}
                      issues={issuesFor(section.key)}
                      disabled={saving}
                      section={section.key}
                    />
                  </section>
                )
              })
              : templateKey === null
                ? <p className="dsh-widget-board__editor-empty">{t('createHint')}</p>
                : null}

            {error === null ? null : <p className="dsh-widget-board__editor-error" role="alert">{error}</p>}
          </div>

          <aside className="dsh-widget-board__composer-preview" aria-label={t('formPreview')}>
            <div className="dsh-widget-board__composer-preview-head">
              <span>{t('formPreview')}</span>
              <span className="dsh-widget-board__composer-sizes" role="group">
                {(['narrow', 'regular', 'wide'] as const).map((family) => (
                  <button
                    key={family}
                    type="button"
                    className="dsh-widget-board__composer-size"
                    data-dsh-widget-board-preview-size={family}
                    aria-pressed={previewFamily === family}
                    onClick={() => { setPreviewFamily(family) }}
                  >
                    {family === 'narrow' ? 'S' : family === 'regular' ? 'M' : 'L'}
                  </button>
                ))}
              </span>
            </div>
            {/* 源码模式下走真正的预览会话：文件还没进组件库时也能看到它画出来的样子（C6）。 */}
            {sourceOpen && widgetId !== null
              ? (
                <PreviewPanel
                  files={sourceFiles}
                  binaryFiles={sourceBinary}
                  autoRun={previewAutoRun}
                  props={props}
                  data={data}
                  state={state}
                  theme={theme}
                  frames={frames}
                />
              )
              : null}
            {sourceOpen ? null : previewWidget === undefined || widgetId === null
              ? <p className="dsh-widget-board__editor-empty">{t('formPreviewHint')}</p>
              : (
                <div className="dsh-widget-board__composer-frame" data-size={previewFamily}>
                  {widgetId === 'image' ? <ImageDraftPreview url={mediaPreview} props={props} data={data} /> : <WidgetPreview
                    id={`composer:${board.id}`}
                    widgetId={widgetId}
                    widget={previewWidget}
                    theme={theme}
                    frames={frames}
                    content={{ props: isCampusSchema(form?.stateSchema) ? { ...props, hasBackground: false, hasIcon: false } : props, data, state }}
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
                  data-dsh-widget-board-composer-keep=""
                  onClick={() => { setConfirmClose(false) }}
                >
                  {t('formKeepEditing')}
                </button>
                <button
                  type="button"
                  className="dsh-widget-board__editor-primary"
                  data-dsh-widget-board-composer-discard=""
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
                data-dsh-widget-board-composer-submit=""
                disabled={!ready || saving || mediaBusy || sourceOpen || campusPending}
                onClick={() => { void submit() }}
              >
                {saving ? t('formSubmitting') : t('formSubmit')}
              </button>
            </footer>
          )}
      </div>
    </div>
  )
}
