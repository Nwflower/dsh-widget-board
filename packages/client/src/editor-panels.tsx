/**
 * 卡片设置弹窗的三节内容（D22）：凭据、数据与权限、关于。
 *
 * 凭据只显示状态、不显示值；写入与移除由外层交给宿主。权限一节把数据源登记的权限、当前组件版本上
 * 的授权与「立即刷新」放在一起，缺授权时就在这里给一次。
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import type { ActionPermission, CardSettings, CredentialSetting, GrantKind, LocalizedText } from '@dsh-widget-board/contracts'
import { sourceLabel, t, textOf } from './copy'

/**
 * 一项凭据的来源说明。
 *
 * @param source - 宿主凭据服务给的来源层 id。
 * @returns 当前语言下的说法。
 */
function sourceText(source: string): string {
  if (source === 'env') return t('credentialEnv')
  if (source === 'file') return t('credentialFile')
  if (source === 'project-env' || source === 'user-env') return t('credentialDotenv')
  return `${t('credentialConfigured')} · ${source}`
}

/** 凭据面板要画的东西。 */
export interface CredentialsPanelProps {
  settings: CardSettings
  busy: boolean
  /** 保存一项凭据；值只往宿主走。 */
  onSet: (ref: string, value: string) => Promise<void>
  /** 移除一项凭据。 */
  onUnset: (ref: string) => Promise<void>
}

/**
 * 凭据面板：每项声明一张卡，状态、输入、保存与移除。
 *
 * @param props - 设置读模型与写入回调。
 * @returns 凭据一节。
 */
export function CredentialsPanel({ settings, busy, onSet, onUnset }: CredentialsPanelProps): ReactNode {
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [working, setWorking] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState<string | null>(null)

  if (settings.credentials.length === 0) {
    return <p className="dsh-widget-board__editor-empty">{t('noCredentials')}</p>
  }

  /** 记下这一项的错误，不动别的项。 */
  const fail = (ref: string, message: string): void => {
    setErrors((previous) => ({ ...previous, [ref]: message }))
  }

  /** 清掉这一项的提示。 */
  const clear = (ref: string): void => {
    setErrors((previous) => {
      const next = { ...previous }
      delete next[ref]
      return next
    })
    setSaved(null)
  }

  /** 保存一项。 */
  const save = async (entry: CredentialSetting): Promise<void> => {
    const value = drafts[entry.ref] ?? ''
    if (value === '' || working !== null) return
    clear(entry.ref)
    setConfirm(null)
    setWorking(entry.ref)
    try {
      await onSet(entry.ref, value)
      setDrafts((previous) => ({ ...previous, [entry.ref]: '' }))
      setSaved(entry.ref)
    } catch (error) {
      fail(entry.ref, (error as Error).message)
    } finally {
      setWorking(null)
    }
  }

  /** 移除一项；第一次按下只把按钮换成确认。 */
  const remove = async (entry: CredentialSetting): Promise<void> => {
    if (confirm !== entry.ref) {
      setConfirm(entry.ref)
      return
    }
    clear(entry.ref)
    setWorking(entry.ref)
    try {
      await onUnset(entry.ref)
      setConfirm(null)
    } catch (error) {
      fail(entry.ref, (error as Error).message)
    } finally {
      setWorking(null)
    }
  }

  return (
    <div className="dsh-widget-board__credentials">
      {settings.credentialsAvailable
        ? null
        : <p className="dsh-widget-board__editor-error" role="status">{t('credentialNoService')}</p>}
      {settings.credentials.map((entry) => {
        const info = entry.info
        const configured = info?.configured === true
        const writable = info?.writable === true && entry.unavailable === undefined
        const label = textOf(entry.label)
        const description = entry.description === undefined ? undefined : textOf(entry.description)
        const status = entry.unavailable !== undefined
          ? entry.unavailable
          : info === undefined
            ? t('credentialMissing')
            : configured
              ? info.source === undefined ? t('credentialConfigured') : sourceText(info.source)
              : t('credentialMissing')
        const error = errors[entry.ref]
        return (
          <section key={entry.ref} className="dsh-widget-board__credential" data-dsh-widget-board-credential={entry.ref}>
            <header className="dsh-widget-board__credential-head">
              <div>
                <h3 className="dsh-widget-board__credential-title">
                  {label}
                  {entry.required === true ? <span className="dsh-widget-board__field-required" aria-hidden="true">*</span> : null}
                </h3>
                <p className="dsh-widget-board__credential-ref">{entry.ref}</p>
                {description === undefined ? null : <p className="dsh-widget-board__credential-desc">{description}</p>}
              </div>
              <span
                className="dsh-widget-board__credential-status"
                data-configured={configured ? 'true' : 'false'}
                data-writable={writable ? 'true' : 'false'}
              >
                {status}
              </span>
            </header>
            {writable
              ? (
                <div className="dsh-widget-board__credential-form">
                  <input
                    className="dsh-widget-board__input"
                    type="password"
                    data-dsh-widget-board-credential-input={entry.ref}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={t('credentialPlaceholder')}
                    value={drafts[entry.ref] ?? ''}
                    disabled={working !== null || busy}
                    onChange={(event) => {
                      setDrafts((previous) => ({ ...previous, [entry.ref]: event.target.value }))
                      clear(entry.ref)
                    }}
                  />
                  <button
                    type="button"
                    className="dsh-widget-board__editor-primary"
                    data-dsh-widget-board-credential-save={entry.ref}
                    disabled={working !== null || busy || (drafts[entry.ref] ?? '') === ''}
                    onClick={() => { void save(entry) }}
                  >
                    {working === entry.ref ? t('saving') : t('credentialSave')}
                  </button>
                  {configured
                    ? (
                      <button
                        type="button"
                        className="dsh-widget-board__editor-ghost"
                        disabled={working !== null || busy}
                        onClick={() => { void remove(entry) }}
                      >
                        {confirm === entry.ref ? t('credentialRemoveConfirm') : t('credentialRemove')}
                      </button>
                    )
                    : null}
                </div>
              )
              : null}
            <p className="dsh-widget-board__credential-note">{t('credentialPrivacy')}</p>
            {saved === entry.ref ? <p className="dsh-widget-board__editor-ok" role="status">{t('saved')}</p> : null}
            {error === undefined ? null : <p className="dsh-widget-board__editor-error" role="alert">{error}</p>}
          </section>
        )
      })}
    </div>
  )
}

/** 数据与权限面板要画的东西。 */
export interface DataPanelProps {
  settings: CardSettings
  busy: boolean
  onGrant: (kind: GrantKind, id: string) => Promise<void>
  onRevoke: (kind: GrantKind, id: string) => Promise<void>
  onRefresh: () => Promise<void>
}

/** 一份权限里的主机与命令；没有声明权限时是空表。 */
function PermissionChips({ permission }: { permission: ActionPermission | undefined }): ReactNode {
  // 没有声明权限时，facts 里已经写了「不需要额外授权」；这里不再重复一行。
  if (permission === undefined) return null
  const hosts = permission.hosts ?? []
  const commands = permission.commands ?? []
  if (hosts.length === 0 && commands.length === 0) return null
  return (
    <div className="dsh-widget-board__permission-list">
      {hosts.length === 0 ? null : (
        <p>
          <span className="dsh-widget-board__permission-label">{t('permissionHosts')}</span>
          {hosts.map((host) => <span key={host} className="dsh-widget-board__chip">{host}</span>)}
        </p>
      )}
      {commands.length === 0 ? null : (
        <p>
          <span className="dsh-widget-board__permission-label">{t('permissionCommands')}</span>
          {commands.map((command) => <span key={command} className="dsh-widget-board__chip">{command}</span>)}
        </p>
      )}
    </div>
  )
}

/**
 * 数据与权限：数据源、宿主能力、提供方、权限、授权状态与立即刷新（D6、D24）。
 *
 * @param props - 设置读模型与授权、刷新回调。
 * @returns 数据与权限一节。
 */
export function DataPanel({ settings, busy, onGrant, onRevoke, onRefresh }: DataPanelProps): ReactNode {
  const [working, setWorking] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshed, setRefreshed] = useState(false)

  /** 跑一个授权、撤权或刷新动作，失败原因留在这一节。 */
  const run = async (key: string, action: () => Promise<void>, refresh = false): Promise<void> => {
    if (working !== null || busy) return
    setWorking(key)
    setError(null)
    setRefreshed(false)
    try {
      await action()
      if (refresh) setRefreshed(true)
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setWorking(null)
    }
  }

  const source = settings.source
  const capabilities = settings.capabilities
  if (source === undefined && capabilities.length === 0) {
    return settings.sourceError === undefined
      ? <p className="dsh-widget-board__editor-empty">{t('noSource')}</p>
      : <p className="dsh-widget-board__editor-error" role="status">{settings.sourceError}</p>
  }

  return (
    <div className="dsh-widget-board__data">
      {settings.sourceError === undefined ? null : <p className="dsh-widget-board__editor-error" role="status">{settings.sourceError}</p>}
      {source === undefined
        ? null
        : (
          <>
            <dl className="dsh-widget-board__facts">
              <div>
                <dt>{t('source')}</dt>
                <dd>{source.id}</dd>
              </div>
              <div>
                <dt>{t('provider')}</dt>
                <dd>{source.provider}</dd>
              </div>
              <div>
                <dt>{t('granted')}</dt>
                <dd>{source.permission === undefined ? t('permissionNone') : source.granted ? t('granted') : t('notGranted')}</dd>
              </div>
            </dl>
            <section className="dsh-widget-board__permission">
              <h3 className="dsh-widget-board__editor-heading">{t('dataAndPermissions')}</h3>
              <PermissionChips permission={source.permission} />
              {source.permission !== undefined && !source.granted
                ? (
                  <button
                    type="button"
                    className="dsh-widget-board__editor-primary"
                    data-dsh-widget-board-grant-source=""
                    disabled={working !== null || busy}
                    onClick={() => { void run('source-grant', () => onGrant('source', source.id)) }}
                  >
                    {t('allow')}
                  </button>
                )
                : null}
              {source.permission !== undefined && source.granted
                ? (
                  <button
                    type="button"
                    className="dsh-widget-board__editor-ghost"
                    disabled={working !== null || busy}
                    onClick={() => { void run('source-revoke', () => onRevoke('source', source.id)) }}
                  >
                    {working === 'source-revoke' ? t('saving') : t('revoke')}
                  </button>
                )
                : null}
            </section>
          </>
        )}
      {capabilities.map((capability) => {
        const label = capability.title === undefined ? capability.id : textOf(capability.title)
        const needsGrant = capability.permission !== undefined
        return (
          <section className="dsh-widget-board__permission" key={capability.id}>
            <h3 className="dsh-widget-board__editor-heading">{label}</h3>
            {capability.description === undefined ? null : <p className="dsh-widget-board__editor-empty">{textOf(capability.description)}</p>}
            <dl className="dsh-widget-board__facts">
              <div>
                <dt>{t('provider')}</dt>
                <dd>{capability.provider === '' ? '—' : capability.provider}</dd>
              </div>
              <div>
                <dt>{t('granted')}</dt>
                <dd>{capability.unavailable !== undefined ? '—' : needsGrant ? (capability.granted ? t('granted') : t('notGranted')) : t('permissionNone')}</dd>
              </div>
            </dl>
            {capability.unavailable === undefined ? null : <p className="dsh-widget-board__editor-error" role="status">{capability.unavailable}</p>}
            <PermissionChips permission={capability.permission} />
            {needsGrant && capability.unavailable === undefined && !capability.granted
              ? (
                <button
                  type="button"
                  className="dsh-widget-board__editor-primary"
                  data-dsh-widget-board-grant-capability={capability.id}
                  disabled={working !== null || busy}
                  onClick={() => { void run(`capability-grant:${capability.id}`, () => onGrant('capability', capability.id)) }}
                >
                  {t('allow')}
                </button>
              )
              : null}
            {needsGrant && capability.unavailable === undefined && capability.granted
              ? (
                <button
                  type="button"
                  className="dsh-widget-board__editor-ghost"
                  disabled={working !== null || busy}
                  onClick={() => { void run(`capability-revoke:${capability.id}`, () => onRevoke('capability', capability.id)) }}
                >
                  {working === `capability-revoke:${capability.id}` ? t('saving') : t('revoke')}
                </button>
              )
              : null}
          </section>
        )
      })}
      {source === undefined
        ? null
        : (
          <div className="dsh-widget-board__editor-actions">
            <button
              type="button"
              className="dsh-widget-board__editor-primary"
              data-dsh-widget-board-refresh=""
              disabled={working !== null || busy}
              onClick={() => { void run('refresh', onRefresh, true) }}
            >
              {working === 'refresh' ? t('refreshing') : t('refreshNow')}
            </button>
          </div>
        )}
      {refreshed ? <p className="dsh-widget-board__editor-ok" role="status">{t('refreshed')}</p> : null}
      {error === null ? null : <p className="dsh-widget-board__editor-error" role="alert">{error}</p>}
    </div>
  )
}

/** 关于面板要画的东西。 */
export interface AboutPanelProps {
  settings: CardSettings
}

/**
 * 关于：来源、提供方、版本与刷新策略。
 *
 * @param props - 设置读模型。
 * @returns 关于一节。
 */
export function AboutPanel({ settings }: AboutPanelProps): ReactNode {
  const widget = settings.widget
  const refresh = widget.refresh
  const refreshText = refresh === undefined || refresh.mode === 'onDemand'
    ? t('onDemand')
    : refresh.everyMs === undefined
      ? t('interval')
      : `${t('interval')} · ${Math.round(refresh.everyMs / 1000)}s`
  const description: LocalizedText | undefined = widget.description
  return (
    <div className="dsh-widget-board__about">
      <h3 className="dsh-widget-board__editor-heading">{textOf(widget.title)}</h3>
      {description === undefined ? null : <p className="dsh-widget-board__editor-empty">{textOf(description)}</p>}
      <dl className="dsh-widget-board__facts">
        <div>
          <dt>{t('widgetSource')}</dt>
          <dd>{sourceLabel(widget.source)}{widget.provider === undefined ? '' : ` · ${widget.provider}`}</dd>
        </div>
        <div>
          <dt>{t('version')}</dt>
          <dd>{widget.version}</dd>
        </div>
        <div>
          <dt>hash</dt>
          <dd title={widget.hash}>{widget.hash.slice(0, 12)}</dd>
        </div>
        <div>
          <dt>{t('refreshPolicy')}</dt>
          <dd>{refreshText}</dd>
        </div>
      </dl>
    </div>
  )
}
