/**
 * 卡片设置弹窗（D27）：单卡与翻面组共用一个编辑器。
 *
 * 单卡有「配置 / 日志 / 关于」三节；组卡在三节之上多一条槽条，每个槽仍是一张普通卡片，
 * 换组件只改选中的槽。弹窗只盖看板页自己的矩形，宿主侧栏照常可用（D1）。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import type {
  Board,
  BoardInstance,
  CardSettings,
  CredentialSetting,
  CredentialStatus,
  GrantKind,
  GroupSide,
  WidgetLibraryEntry,
  WidgetSummary,
  WorkspaceSnapshot,
} from '@dsh-widget-board/contracts'
import { FLIP_GROUP_ID } from '@dsh-widget-board/contracts'
import { sourceLabel, t, textOf } from './copy'
import { AboutPanel } from './editor-panels'
import { ConfigPanel } from './fields'
import type { FrameHost } from './frame-host'
import { RequestLogPanel } from './log-panel'
import {
  GrantRequiredError,
  changeGroupSlot,
  fetchInstanceSettings,
  grantInstance,
  readInstanceData,
  revokeInstance,
  saveInstanceProps,
  setInstanceCredential,
} from './snapshot'
import type { ShellTheme } from './theme'
import { WidgetGrid, WidgetPreview } from './widget-grid'

/** 打开的是哪一张卡或哪一组。 */
export type EditorTarget =
  | { kind: 'instance', id: string }
  | { kind: 'group', id: string }

/** 弹窗里的三节：配置、日志与关于（D27）。 */
type EditorTab = 'config' | 'log' | 'about'

/** 槽的前后次序。 */
const SIDE_ORDER: Record<GroupSide, number> = { front: 0, back: 1 }

/** 设置弹窗要画的东西。 */
export interface CardEditorProps {
  target: EditorTarget
  /** 卡片所在的看板；切换看板时由外层关掉弹窗。 */
  board: Board | null
  widgets: Readonly<Record<string, WidgetSummary>>
  library: readonly WidgetLibraryEntry[]
  theme: ShellTheme
  frames: FrameHost
  /** 看板页的根节点：弹窗按它的矩形定位，不盖宿主外壳（D1）。 */
  anchor: HTMLElement | null
  onClose: () => void
  /** 组卡换槽之后的新快照。 */
  onSnapshot: (snapshot: WorkspaceSnapshot) => void
}

/**
 * 一节标签的文案。
 *
 * @param tab - 那一节。
 * @returns 当前语言下的标签。
 */
function tabLabel(tab: EditorTab): string {
  if (tab === 'config') return t('config')
  if (tab === 'log') return t('log')
  return t('about')
}

/**
 * 一个槽的标签。
 *
 * @param side - 正面或背面。
 * @returns 当前语言下的说法。
 */
function sideLabel(side: GroupSide): string {
  return side === 'front' ? t('slotFront') : t('slotBack')
}

/**
 * 把一项凭据的状态换掉；顺手去掉之前那次读失败留下的原因。
 *
 * @param entry - 那一项声明。
 * @param info - 宿主刚给的凭据状态。
 * @returns 换过状态的条目。
 */
function withInfo(entry: CredentialSetting, info: CredentialStatus): CredentialSetting {
  const { unavailable: _unavailable, ...rest } = entry
  return { ...rest, info }
}

/**
 * 卡片设置弹窗。
 *
 * @param props - 目标、看板、组件元信息与回调。
 * @returns 弹窗；锚点还没量出来时不画。
 */
export function CardEditorDialog({
  target,
  board,
  widgets,
  library,
  theme,
  frames,
  anchor,
  onClose,
  onSnapshot,
}: CardEditorProps): ReactNode {
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [tab, setTab] = useState<EditorTab>('config')
  const [side, setSide] = useState<GroupSide>('front')
  const [settings, setSettings] = useState<CardSettings | null>(null)
  const [loading, setLoading] = useState(false)
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [dirty, setDirty] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const [mode, setMode] = useState<'settings' | 'picker'>('settings')
  const [pending, setPending] = useState<string | null>(null)
  const [pickerError, setPickerError] = useState<string | null>(null)
  const [writing, setWriting] = useState(false)

  const dialogRef = useRef<HTMLDivElement | null>(null)
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const backRef = useRef<HTMLButtonElement | null>(null)

  const slots = useMemo<BoardInstance[]>(() => {
    if (board === null) return []
    if (target.kind === 'instance') {
      const instance = board.instances.find((candidate) => candidate.id === target.id)
      return instance === undefined ? [] : [instance]
    }
    return board.instances
      .filter((instance) => instance.group?.id === target.id)
      .sort((left, right) => SIDE_ORDER[left.group?.side ?? 'back'] - SIDE_ORDER[right.group?.side ?? 'back'])
  }, [board, target])

  const slot = target.kind === 'group'
    ? slots.find((candidate) => candidate.group?.side === side)
    : slots[0]

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

  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  // 切到组件网格时，原来的「更换组件」按钮不在了：把焦点交给返回按钮。
  useEffect(() => {
    if (mode === 'picker') backRef.current?.focus()
  }, [mode])

  // 没有未保存修改时，关掉确认条。
  useEffect(() => {
    if (!dirty) setConfirmClose(false)
  }, [dirty])

  // 卡片或组被别处移除、或切到另一块看板时，弹窗跟着收起来（D27）。
  useEffect(() => {
    if (board === null) return
    const exists = target.kind === 'instance'
      ? board.instances.some((candidate) => candidate.id === target.id)
      : board.instances.some((candidate) => candidate.group?.id === target.id)
    if (!exists) onClose()
  }, [board, onClose, target])

  const slotId = slot?.id
  const slotWidget = slot?.widget
  const slotHash = slot?.hash
  useEffect(() => {
    if (slotId === undefined) {
      setSettings(null)
      setLoading(false)
      setSettingsError(null)
      return
    }
    let live = true
    setLoading(true)
    setSettingsError(null)
    setSettings((previous) => previous !== null && previous.instance.id === slotId ? previous : null)
    fetchInstanceSettings(slotId).then((next) => {
      if (!live) return
      setSettings(next)
    }, (error: Error) => {
      if (!live) return
      setSettingsError(error.message)
    }).finally(() => {
      if (live) setLoading(false)
    })
    return () => { live = false }
  }, [refreshKey, slotHash, slotId, slotWidget])

  /** 请求关闭；组件网格里先退回设置，有草稿时先确认。 */
  const requestClose = useCallback((): void => {
    if (confirmClose) {
      onClose()
      return
    }
    if (mode === 'picker') {
      setMode('settings')
      setPending(null)
      setPickerError(null)
      return
    }
    if (dirty) {
      setConfirmClose(true)
      return
    }
    onClose()
  }, [confirmClose, dirty, mode, onClose])

  /** 关闭层上的键盘：Escape 关闭，Tab 圈在弹窗里。 */
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      requestClose()
      return
    }
    if (event.key !== 'Tab') return
    const dialog = dialogRef.current
    if (dialog === null) return
    const nodes = dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
    )
    const focusable = [...nodes].filter((node) => node.offsetParent !== null)
    if (focusable.length === 0) return
    const first = focusable[0] as HTMLElement
    const last = focusable[focusable.length - 1] as HTMLElement
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  /** 保存 props；宿主存下来的那一份换进读模型。 */
  const saveProps = async (props: Record<string, unknown>): Promise<void> => {
    if (slot === undefined) return
    const saved = await saveInstanceProps(slot.id, props)
    setSettings((previous) => previous !== null && previous.instance.id === slot.id
      ? { ...previous, instance: { ...previous.instance, props: saved } }
      : previous)
  }

  /** 保存一项凭据；值只往宿主走。 */
  const saveCredential = async (ref: string, value: string): Promise<void> => {
    if (slot === undefined) return
    const info = await setInstanceCredential(slot.id, ref, 'set', value)
    setSettings((previous) => previous !== null && previous.instance.id === slot.id
      ? { ...previous, credentials: previous.credentials.map((entry) => entry.ref === ref ? withInfo(entry, info) : entry) }
      : previous)
  }

  /** 移除一项凭据。 */
  const removeCredential = async (ref: string): Promise<void> => {
    if (slot === undefined) return
    const info = await setInstanceCredential(slot.id, ref, 'unset')
    setSettings((previous) => previous !== null && previous.instance.id === slot.id
      ? { ...previous, credentials: previous.credentials.map((entry) => entry.ref === ref ? withInfo(entry, info) : entry) }
      : previous)
  }

  /** 给数据源或宿主能力一次授权；读模型跟着重取（D6、D24）。 */
  const grant = async (kind: GrantKind, id: string): Promise<void> => {
    if (slot === undefined) return
    await grantInstance(slot.id, kind, id)
    setRefreshKey((key) => key + 1)
  }

  /** 撤掉数据源或宿主能力的一份授权。 */
  const revoke = async (kind: GrantKind, id: string): Promise<void> => {
    if (slot === undefined) return
    await revokeInstance(slot.id, kind, id)
    setRefreshKey((key) => key + 1)
  }

  /** 立即读一次数据；缺授权时把读模型重取一遍，让授权按钮出现。 */
  const refreshData = async (): Promise<void> => {
    if (slot === undefined) return
    try {
      await readInstanceData(slot.id)
    } catch (error) {
      if (error instanceof GrantRequiredError) setRefreshKey((key) => key + 1)
      throw error
    }
  }

  /** 确认换槽：写宿主、换快照、重读取设置。 */
  const replaceWidget = async (): Promise<void> => {
    if (pending === null || slot === undefined || target.kind !== 'group' || slot.group === undefined) return
    setWriting(true)
    setPickerError(null)
    try {
      const next = await changeGroupSlot(target.id, slot.group.side, pending)
      onSnapshot(next)
      setMode('settings')
      setPending(null)
      setTab('config')
      setRefreshKey((key) => key + 1)
    } catch (error) {
      setPickerError((error as Error).message)
    } finally {
      setWriting(false)
    }
  }

  if (rect === null) return null

  const group = target.kind === 'group'
  const widgetTitle = settings === null ? '' : textOf(settings.widget.title)
  const cardTitle = settings !== null && typeof settings.instance.props.title === 'string' && settings.instance.props.title.trim() !== ''
    ? settings.instance.props.title
    : settings === null
      ? t('cardSettings')
      : widgetTitle
  const title = group
    ? (slot === undefined ? t('editorGroupMissing') : `${sideLabel(side)} ${slotWidget === undefined ? '' : textOf(widgets[slotWidget]?.title ?? { zh: slotWidget, en: slotWidget })}`)
    : cardTitle
  const eyebrow = group || settings === null
    ? t(group ? 'groupSettings' : 'cardSettings')
    : cardTitle === widgetTitle
      ? t('cardSettings')
      : `${t('cardSettings')} · ${widgetTitle}`
  const source = settings?.widget.source
  const currentWidget = slot?.widget
  const pendingWidget = pending === null ? undefined : widgets[pending]
  const pendingTitle = pendingWidget === undefined ? pending ?? '' : textOf(pendingWidget.title)
  const currentTitle = currentWidget === undefined ? '' : textOf(widgets[currentWidget]?.title ?? { zh: currentWidget, en: currentWidget })
  const grows = pendingWidget?.minBox !== undefined && slot !== undefined
    && (pendingWidget.minBox.w > slot.layout.w || pendingWidget.minBox.h > slot.layout.h)
  const pickable = library.filter((entry) => entry.id !== FLIP_GROUP_ID
    && entry.error === undefined
    && widgets[entry.id] !== undefined)

  return (
    <div
      className="dsh-widget-board__editor-layer"
      style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
      onKeyDown={onKeyDown}
    >
      <div className="dsh-widget-board__editor-backdrop" onPointerDown={requestClose} />
      <div
        ref={dialogRef}
        className="dsh-widget-board__editor"
        data-dsh-widget-board-editor=""
        role="dialog"
        aria-labelledby="dsh-widget-board-editor-title"
      >
        <header className="dsh-widget-board__editor-head">
          <div>
            <p className="dsh-widget-board__editor-eyebrow">{eyebrow}</p>
            <h2 id="dsh-widget-board-editor-title" className="dsh-widget-board__editor-title">{title}</h2>
            {source === undefined || settings === null ? null : (
              <p className="dsh-widget-board__editor-source">
                {sourceLabel(source)}
                {settings.widget.provider === undefined ? '' : ` · ${settings.widget.provider}`}
              </p>
            )}
          </div>
          <button
            ref={closeRef}
            type="button"
            className="dsh-widget-board__editor-close"
            data-dsh-widget-board-editor-close=""
            onClick={requestClose}
            title={t('close')}
          >
            ×
          </button>
        </header>

        {mode === 'picker'
          ? (
            <div className="dsh-widget-board__editor-picker">
              <div className="dsh-widget-board__editor-picker-head">
                <button ref={backRef} type="button" className="dsh-widget-board__editor-ghost" onClick={requestClose}>
                  {t('back')}
                </button>
                <div>
                  <h3 className="dsh-widget-board__editor-heading">{t('pickWidget')}</h3>
                  <p className="dsh-widget-board__editor-empty">{t('pickHint')}</p>
                </div>
              </div>
              <div className="dsh-widget-board__editor-picker-body">
                <WidgetGrid
                  entries={pickable}
                  widgets={widgets}
                  theme={theme}
                  frames={frames}
                  mode="pick"
                  current={currentWidget}
                  busy={writing}
                  onActivate={(id) => {
                    if (id === currentWidget) return
                    setPending(id)
                    setPickerError(null)
                  }}
                />
              </div>
              {pending === null
                ? null
                : (
                  <div className="dsh-widget-board__editor-confirm">
                    <p>
                      {currentTitle}
                      {' → '}
                      {pendingTitle}
                    </p>
                    <p className="dsh-widget-board__editor-empty">{t('replaceWarning')}</p>
                    {grows ? <p className="dsh-widget-board__editor-note">{t('minBoxWarning')}</p> : null}
                    {pickerError === null ? null : <p className="dsh-widget-board__editor-error" role="alert">{pickerError}</p>}
                    <div className="dsh-widget-board__editor-actions">
                      <button
                        type="button"
                        className="dsh-widget-board__editor-primary"
                        data-dsh-widget-board-slot-confirm=""
                        disabled={writing}
                        onClick={() => { void replaceWidget() }}
                      >
                        {writing ? t('saving') : t('replaceConfirm')}
                      </button>
                      <button type="button" className="dsh-widget-board__editor-ghost" onClick={() => { setPending(null) }}>
                        {t('cancel')}
                      </button>
                    </div>
                  </div>
                )}
            </div>
          )
          : (
            <>
              {group
                ? (
                  <div className="dsh-widget-board__slots" role="group" aria-label={t('groupSlots')}>
                    {slots.map((entry) => {
                      const entrySide = entry.group?.side
                      if (entrySide === undefined) return null
                      const summary = widgets[entry.widget]
                      return (
                        <button
                          key={entrySide}
                          type="button"
                          className="dsh-widget-board__slot"
                          data-dsh-widget-board-slot={entrySide}
                          aria-pressed={entrySide === side}
                          disabled={dirty || writing}
                          title={dirty ? t('unsaved') : undefined}
                          onClick={() => {
                            if (dirty || writing) return
                            setSide(entrySide)
                            setMode('settings')
                            setTab('config')
                            setPending(null)
                          }}
                        >
                          <span className="dsh-widget-board__slot-copy">
                            <span className="dsh-widget-board__slot-side">{sideLabel(entrySide)}</span>
                            <span className="dsh-widget-board__slot-name">
                              {summary === undefined ? entry.widget : textOf(summary.title)}
                            </span>
                          </span>
                          {summary === undefined
                            ? <span className="dsh-widget-board__slot-missing">{entry.widget}</span>
                            : (
                              <span className="dsh-widget-board__slot-preview">
                                <WidgetPreview
                                  id={`slot:${entry.id}`}
                                  widgetId={entry.widget}
                                  widget={summary}
                                  theme={theme}
                                  frames={frames}
                                  content={{ props: entry.props, data: entry.data, state: entry.state }}
                                />
                              </span>
                            )}
                        </button>
                      )
                    })}
                    <button
                      type="button"
                      className="dsh-widget-board__slot-change"
                      data-dsh-widget-board-slot-change=""
                      disabled={dirty || writing || slot === undefined}
                      title={dirty ? t('unsaved') : undefined}
                      onClick={() => {
                        setPending(null)
                        setPickerError(null)
                        setMode('picker')
                      }}
                    >
                      {t('changeWidget')}
                    </button>
                  </div>
                )
                : null}

              <div className="dsh-widget-board__editor-tabs" role="tablist" aria-label={t('cardSettings')}>
                {(['config', 'log', 'about'] as EditorTab[]).map((candidate) => (
                  <button
                    key={candidate}
                    type="button"
                    role="tab"
                    aria-selected={tab === candidate}
                    data-dsh-widget-board-tab={candidate}
                    className="dsh-widget-board__editor-tab"
                    data-warning={candidate === 'about' && settings !== null
                      && (settings.sourceError !== undefined
                        || (settings.source !== undefined && settings.source.permission !== undefined && !settings.source.granted)
                        || settings.capabilities.some((capability) => capability.unavailable !== undefined
                          || (capability.permission !== undefined && !capability.granted)))
                      ? 'true'
                      : undefined}
                    onClick={() => { setTab(candidate) }}
                  >
                    {tabLabel(candidate)}
                  </button>
                ))}
              </div>

              <div className="dsh-widget-board__editor-body">
                {settingsError !== null
                  ? (
                    <div className="dsh-widget-board__editor-failure">
                      <p role="alert">{`${t('editorFailed')}：${settingsError}`}</p>
                      <button
                        type="button"
                        className="dsh-widget-board__editor-ghost"
                        onClick={() => { setRefreshKey((key) => key + 1) }}
                      >
                        {t('refreshNow')}
                      </button>
                    </div>
                  )
                  : slot === undefined
                    ? <p className="dsh-widget-board__editor-empty">{group ? t('editorGroupMissing') : t('editorInstanceMissing')}</p>
                    : loading && settings === null
                      ? <p className="dsh-widget-board__editor-empty">{t('editorLoading')}</p>
                      : settings === null
                        ? null
                        : (
                          <>
                            <div role="tabpanel" hidden={tab !== 'config'}>
                              <ConfigPanel
                                key={settings.instance.id}
                                settings={settings}
                                busy={writing}
                                onSaveProps={saveProps}
                                onSetCredential={saveCredential}
                                onUnsetCredential={removeCredential}
                                onDirtyChange={setDirty}
                              />
                            </div>
                            <div role="tabpanel" hidden={tab !== 'log'}>
                              <RequestLogPanel instanceId={settings.instance.id} />
                            </div>
                            <div role="tabpanel" hidden={tab !== 'about'}>
                              <AboutPanel
                                key={settings.instance.id}
                                settings={settings}
                                busy={writing}
                                onGrant={grant}
                                onRevoke={revoke}
                                onRefresh={refreshData}
                              />
                            </div>
                          </>
                        )}
              </div>
            </>
          )}

        {mode === 'settings'
          ? confirmClose
            ? (
              <footer className="dsh-widget-board__editor-foot">
                <p className="dsh-widget-board__editor-note">{t('unsaved')}</p>
                <div className="dsh-widget-board__editor-actions">
                  <button
                    type="button"
                    className="dsh-widget-board__editor-ghost"
                    data-dsh-widget-board-editor-keep=""
                    onClick={() => { setConfirmClose(false) }}
                  >
                    {t('keepEditing')}
                  </button>
                  <button
                    type="button"
                    className="dsh-widget-board__editor-primary"
                    data-dsh-widget-board-editor-discard=""
                    onClick={onClose}
                  >
                    {t('discard')}
                  </button>
                </div>
              </footer>
            )
            : (
              <footer className="dsh-widget-board__editor-foot">
                <button
                  type="button"
                  className="dsh-widget-board__editor-primary"
                  data-dsh-widget-board-editor-done=""
                  onClick={requestClose}
                >
                  {t('done')}
                </button>
              </footer>
            )
          : null}
      </div>
    </div>
  )
}
