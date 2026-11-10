/**
 * 高级源码面板（技术契约 4、C4）。
 *
 * 面板按来源规则给出能做什么：内置与插件提供的组件是只读源，编辑它们时另存为一个新的用户组件；
 * 已有用户组件默认另存，只有明确选了「更新全部实例」才就地改，并且要带 `expectedHash`（C4）。
 *
 * 编辑器按需加载：CodeMirror 那个分包在第一次打开高级模式时才去取。面板自己管文件的当前内容、
 * 预览与保存的每一步，按钮的可用状态由「有没有改动」与「来源能不能改」决定。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { WidgetSourceModel, WidgetDraftSummary } from '@dsh-widget-board/contracts'
import { instanceSourcePath } from '@dsh-widget-board/contracts'
import { t } from '../copy'
import type { ShellTheme } from '../theme'
import { defineWidget, fetchWidgetSource, SourceConflictError } from './source-api'
import { fetchDrafts, fetchDraft as fetchDraftRequest, removeDraft as removeDraftRequest, saveDraft as saveDraftRequest } from './source-api'
import { fetchCardContent } from '../snapshot'
import { suggestedIdOf } from './source-rules'
import { isRecord } from './schema'
import { loadSourceEditor } from './source-editor-loader'
import type { SourceEditor } from './source-editor-loader'

/** 面板要画的东西。 */
export interface SourceEditorPanelProps {
  /** 要改的组件 id。 */
  widgetId: string
  /** 当前主题：深色时编辑器用深色配色（D10）。 */
  theme: ShellTheme
  /** 写好了：带着新版本的信息交给页面。 */
  onSaved: (result: { id: string, hash: string }) => void
  /** 当前的文件内容变了：预览面板按它重建（C6）。 */
  onFilesChanged?: (files: Record<string, string>) => void
  /** 关掉面板。 */
  onClose: () => void
  instanceId?: string
  onBinaryChanged?: (files: Record<string, string>) => void
  closeRequest?: number
  onRestore?: () => void
}

/** 面板里那几个标签。 */
const FILES = ['widget.json', 'index.html', 'style.css', 'main.js', 'samples.json'] as const

/** 一个文件。 */
type FileName = string

/**
 * 主机是不是深色：编辑器按它选配色（D10）。
 *
 * @param theme - 外壳的主题。
 * @returns 深色时为真。
 */
function isDark(theme: ShellTheme): boolean {
  const background = theme.tokens['color-bg'] ?? theme.tokens['color-surface'] ?? ''
  const match = /(\d+)\D+(\d+)\D+(\d+)/.exec(background)
  if (match === null) return false
  const [, red, green, blue] = match
  return (Number(red) + Number(green) + Number(blue)) / 3 < 128
}

/**
 * 高级源码面板。
 *
 * @param props - 组件 id、主题与回调。
 * @returns 面板。
 */
export function SourceEditorPanel({ widgetId, instanceId, theme, onSaved, onFilesChanged, onBinaryChanged, onRestore, onClose, closeRequest = 0 }: SourceEditorPanelProps): ReactNode {
  const [model, setModel] = useState<WidgetSourceModel | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** 目标 id：只读源另存时它是一个新的用户组件 id。 */
  const [targetId, setTargetId] = useState(widgetId)
  /** 文件的当前内容；键是相对路径。 */
  const [files, setFiles] = useState<Record<string, string>>({})
  const [active, setActive] = useState<FileName>('index.html')
  const [saving, setSaving] = useState(false)
  const [updateAll, setUpdateAll] = useState(false)
  const [drafts, setDrafts] = useState<WidgetDraftSummary[]>([])
  const [binaryFiles, setBinaryFiles] = useState<Record<string, string>>({})
  const revision = useRef<number | null>(null)
  const baseHash = useRef<string | null>(null)
  /** 关闭时先问一句：存草稿、放弃还是继续编辑（C13）。 */
  const [confirmClose, setConfirmClose] = useState(false)
  /** 这一份草稿的 id：存过一次之后，继续编辑按它更新，不另起一份。 */
  const [draftId, setDraftId] = useState<string | null>(null)
  /** 草稿存好了：面板上给一句看得见的说法。 */
  const [draftSaved, setDraftSaved] = useState(false)
  /** 编辑器还没取到：这一段先显示一份纯文本的兜底，取到了就换过去。 */
  const [editorReady, setEditorReady] = useState(false)
  const editorRef = useRef<SourceEditor | null>(null)
  /** 取到的那个分包：编辑器按它建。 */
  const editorModule = useRef<typeof import('./source-editor') | null>(null)
  const hostRef = useRef<HTMLDivElement | null>(null)

  // 读组件的源码：只读请求也过宿主的请求栅栏（D1）。
  useEffect(() => {
    let live = true
    setLoadError(null)
    setModel(null)
    fetchWidgetSource(widgetId).then((next) => {
      if (!live) return
      setModel(next)
      baseHash.current = next.hash
      // 宿主给的建议 id 优先：它才是真正写盘的那一份判定（C4）。
      setTargetId(next.suggestedId ?? suggestedIdOf(next.id, next.source))
      setFiles({ 'widget.json': next.manifest, ...next.files })
      setBinaryFiles(next.binaryFiles ?? {})
      setActive(next.files['index.html'] === undefined ? 'widget.json' : 'index.html')
    }, (caught: Error) => {
      if (live) setLoadError(caught.message)
    })
    return () => { live = false }
  }, [widgetId])

  useEffect(() => {
    let live = true
    fetchDrafts().then((items) => { if (live) setDrafts(items.filter((entry) => entry.kind === 'source')) }, (caught: Error) => { if (live) setError(caught.message) })
    if (instanceId !== undefined) fetchCardContent(instanceId).then((card) => { revision.current = card.revision }, (caught: Error) => { if (live) setError(caught.message) })
    return () => { live = false }
  }, [instanceId])

  // 编辑器按需加载：第一次打开高级模式时才去取那个分包（技术契约 4）。
  useEffect(() => {
    let live = true
    loadSourceEditor().then((module) => {
      if (!live) return
      editorModule.current = module
      setEditorReady(true)
    }, (caught: Error) => {
      if (live) setLoadError(`源码编辑器取不到：${caught.message}`)
    })
    return () => { live = false }
  }, [])

  // 编辑器就位后建出来；换了文件或换了主题才重建。
  //
  // 内容变了不重建：重建会把光标与撤销历史一起丢掉，那正是人在编辑器里要的东西（D11）。
  // 内容灌进编辑器由下面那个效果负责。
  const dark = isDark(theme)
  useEffect(() => {
    if (!editorReady) return
    const host = hostRef.current
    const module = editorModule.current
    if (host === null || module === null) return
    const editor = module.createSourceEditor({
      parent: host,
      value: files[active] ?? '',
      kind: module.languageOf(active),
      onChange: (text: string) => { setFiles((previous) => ({ ...previous, [active]: text })) },
      theme: { dark },
    })
    editorRef.current = editor
    return () => {
      editor.destroy()
      editorRef.current = null
    }
  }, [editorReady, active, dark])

  // 内容变了灌进编辑器——只在它与编辑器里的不一样时灌，免得把光标顶走。
  useEffect(() => {
    const editor = editorRef.current
    if (editor === null) return
    const text = files[active] ?? ''
    if (editor.content() !== text) editor.setContent(text)
  }, [active, files])

  const writable = model?.writable === true
  const changed = useMemo(() => {
    if (model === null) return false
    return files['widget.json'] !== model.manifest
      || Object.entries(files).some(([path, text]) => path !== 'widget.json' && text !== (model.files[path] ?? ''))
  }, [files, model])

  // 文件变了就把新的一份交给预览面板：它按这一份开预览会话（C6）。
  useEffect(() => {
    onFilesChanged?.(files)
  }, [files, onFilesChanged])
  useEffect(() => { onBinaryChanged?.(binaryFiles) }, [binaryFiles, onBinaryChanged])

  useEffect(() => {
    if (closeRequest > 0) {
      if (changed) setConfirmClose(true)
      else onClose()
    }
  }, [closeRequest])

  /**
   * 存一份草稿：草稿住在插件自己的目录里，凭据值不进来（技术契约 4、C12）。
   *
   * @returns 存下的草稿 id；失败时是 `null`。
   */
  const saveDraft = async (): Promise<string | null> => {
    if (model === null) return null
    setError(null)
    try {
      const saved = await saveDraftRequest({
        ...(draftId === null ? {} : { draftId }),
        target: instanceId === undefined ? { kind: 'widget', widgetId } : { kind: 'instance', instanceId },
        base: { hash: model.hash, ...(revision.current === null ? {} : { revision: revision.current }) },
        files,
        binaryFiles,
      })
      setDraftId(saved.draftId)
      setDraftSaved(true)
      return saved.draftId
    } catch (caught) {
      setError((caught as Error).message)
      return null
    }
  }

  /**
   * 恢复一份草稿：文件回到编辑器里，人可以接着改（C13）。
   */
  const restoreDraft = async (id = draftId): Promise<void> => {
    if (id === null) return
    setError(null)
    try {
      const draft = await fetchDraftRequest(id)
      if (draft.files === undefined) return
      onRestore?.()
      setFiles(draft.files)
      setBinaryFiles(draft.binaryFiles ?? {})
      setDraftId(id)
      baseHash.current = draft.base.hash ?? model?.hash ?? null
      if (draft.base.revision !== undefined) revision.current = draft.base.revision
      setUpdateAll(false)
      if (draft.base.hash !== model?.hash) setError('草稿的基础组件版本已经变化；请核对后另存，输入已保留。')
      setDraftSaved(true)
    } catch (caught) {
      setError((caught as Error).message)
    }
  }

  /**
   * 关掉面板：有未保存的内容时先问一句——存草稿、放弃还是继续编辑（C13）。
   */
  const requestClose = (): void => {
    if (!changed || confirmClose) {
      onClose()
      return
    }
    setConfirmClose(true)
  }

  /**
   * 默认另存；只有显式选择更新全部实例时，才用基础哈希更新原类型。
   */
  const save = async (): Promise<void> => {
    if (model === null || saving) return
    setSaving(true)
    setError(null)
    try {
      const parsed = JSON.parse(files['widget.json'] ?? '{}') as unknown
      const destination = updateAll && writable ? model.id : targetId
      // manifest 的 id 要与目录名一致（C4）：另存时它跟着目标 id 一起改，就地改时不动。
      const manifest = isRecord(parsed) ? { ...parsed, id: destination } : parsed
      const rest: Record<string, string> = {}
      for (const [path, text] of Object.entries(files)) {
        if (path === 'widget.json') continue
        rest[path] = text
      }
      const written = await defineWidget({
        id: destination,
        manifest,
        files: rest,
        binaryFiles,
        ...(updateAll && writable ? { expectedHash: baseHash.current ?? model.hash } : {}),
      })
      if (!updateAll && instanceId !== undefined) {
        const response = await fetch(instanceSourcePath(instanceId), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ widget: written.id, expectedHash: written.hash, expectedRevision: revision.current }) })
        if (!response.ok) {
          const failure = await response.json() as { error?: string }
          throw new Error(failure.error ?? `应用失败：HTTP ${response.status}`)
        }
      }
      // 正式保存成功之后才删除本次草稿（技术契约 4）。
      if (draftId !== null) await removeDraftRequest(draftId).catch(() => undefined)
      onSaved({ id: written.id, hash: written.hash })
    } catch (caught) {
      if (caught instanceof SourceConflictError) {
        setError(`${caught.message}（当前版本 ${(caught.current ?? '').slice(0, 12)}）`)
        return
      }
      setError((caught as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (loadError !== null) {
    return (
      <div className="dsh-widget-board__source" data-dsh-widget-board-source="">
        <p className="dsh-widget-board__editor-error" role="alert">{loadError}</p>
      </div>
    )
  }

  return (
    <div className="dsh-widget-board__source" data-dsh-widget-board-source="">
      <header className="dsh-widget-board__source-head">
        <span className="dsh-widget-board__source-title">
          {model === null ? t('sourceLoading') : `${model.id} · ${model.hash.slice(0, 12)}`}
        </span>
        <span className="dsh-widget-board__source-origin" data-dsh-widget-board-source-origin={model?.source ?? ''}>
          {model === null ? '' : writable ? t('sourceWritable') : t('sourceReadOnly')}
        </span>
        <button
          type="button"
          className="dsh-widget-board__editor-close"
          data-dsh-widget-board-source-close=""
          onClick={requestClose}
          title={t('close')}
        >
          ×
        </button>
      </header>

      <div className="dsh-widget-board__source-tabs" role="tablist">
        {[...new Set([...FILES, ...Object.keys(files)])].map((file) => {
          const present = files[file] !== undefined
          if (!present && file !== 'widget.json' && file !== 'main.js' && file !== 'samples.json') return null
          return (
            <button
              key={file}
              type="button"
              role="tab"
              className="dsh-widget-board__source-tab"
              data-dsh-widget-board-source-tab={file}
              aria-selected={active === file}
              onClick={() => { if (!present) setFiles((current) => ({ ...current, [file]: file === 'samples.json' ? '{}' : '' })); setActive(file) }}
            >
              {present ? file : `+ ${file}`}
            </button>
          )
        })}
      </div>

      {model !== null
        ? (
          <p className="dsh-widget-board__source-note">
            {t('sourceSaveAs')}
            <input
              className="dsh-widget-board__input dsh-widget-board__source-id"
              data-dsh-widget-board-source-id=""
              value={targetId}
              disabled={updateAll}
              onChange={(event) => { setTargetId(event.target.value) }}
            />
          </p>
        )
        : null}

      {writable ? <label className="dsh-widget-board__source-note"><input type="checkbox" data-dsh-widget-board-source-update-all="" checked={updateAll} onChange={(event) => { setUpdateAll(event.target.checked) }} />更新全部实例：{model?.usage?.map((entry) => `${entry.title}（${entry.count}）`).join('、') || '暂无实例'}</label> : null}
      {drafts.length === 0 ? null : <div className="dsh-widget-board__source-note" data-dsh-widget-board-source-drafts="">{drafts.map((entry) => <span key={entry.draftId}><button type="button" className="dsh-widget-board__editor-ghost" onClick={() => { void restoreDraft(entry.draftId) }}>{entry.target.kind === 'widget' ? entry.target.widgetId : entry.target.instanceId} · {entry.updatedAt}</button><button type="button" className="dsh-widget-board__editor-ghost" onClick={() => { void removeDraftRequest(entry.draftId).then(() => { setDrafts((items) => items.filter((item) => item.draftId !== entry.draftId)) }, (caught: Error) => { setError(caught.message) }) }}>删除草稿</button></span>)}</div>}

      <div className="dsh-widget-board__source-editor" ref={hostRef} data-dsh-widget-board-source-editor={active} />

      {model !== null && model.assets.length > 0
        ? (
          <p className="dsh-widget-board__source-note">
            {t('sourceAssets')}
            {model.assets.map((asset) => `${asset.path}（${String(asset.bytes)}）`).join('、')}
          </p>
        )
        : null}

      {error === null ? null : <p className="dsh-widget-board__editor-error" role="alert">{error}</p>}

      {/* 关闭时先问一句：存草稿、放弃还是继续编辑（C13）。 */}
      {confirmClose
        ? (
          <footer className="dsh-widget-board__source-foot" data-dsh-widget-board-source-close-choice="">
            <p className="dsh-widget-board__editor-note">{t('draftUnsaved')}</p>
            <div className="dsh-widget-board__editor-actions">
              <button
                type="button"
                className="dsh-widget-board__editor-ghost"
                data-dsh-widget-board-source-keep=""
                onClick={() => { setConfirmClose(false) }}
              >
                {t('formKeepEditing')}
              </button>
              <button
                type="button"
                className="dsh-widget-board__editor-ghost"
                data-dsh-widget-board-source-draft=""
                onClick={() => {
                  void saveDraft().then((id) => {
                    if (id === null) return
                    onClose()
                  })
                }}
              >
                {t('draftSave')}
              </button>
              <button
                type="button"
                className="dsh-widget-board__editor-primary"
                data-dsh-widget-board-source-discard=""
                onClick={onClose}
              >
                {t('formDiscard')}
              </button>
            </div>
          </footer>
        )
        : (
          <footer className="dsh-widget-board__source-foot">
            <button
              type="button"
              className="dsh-widget-board__editor-ghost"
              data-dsh-widget-board-source-draft-save=""
              disabled={model === null || !changed}
              onClick={() => { void saveDraft() }}
            >
              {t('draftSave')}
            </button>
            {draftId === null
              ? null
              : (
                <button
                  type="button"
                  className="dsh-widget-board__editor-ghost"
                  data-dsh-widget-board-source-draft-restore=""
                  onClick={() => { void restoreDraft() }}
                >
                  {t('draftRestore')}
                </button>
              )}
            {draftSaved
              ? <span className="dsh-widget-board__editor-ok">{t('draftSaved')}</span>
              : null}
            <span className="dsh-widget-board__editor-spacer" />
            <button
              type="button"
              className="dsh-widget-board__editor-ghost"
              data-dsh-widget-board-source-cancel=""
              onClick={requestClose}
            >
              {t('cancel')}
            </button>
            <button
              type="button"
              className="dsh-widget-board__editor-primary"
              data-dsh-widget-board-source-save=""
              disabled={saving || model === null || !changed}
              onClick={() => { void save() }}
            >
              {saving ? t('saving') : t('sourceSave')}
            </button>
          </footer>
        )}
    </div>
  )
}
