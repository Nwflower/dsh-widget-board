/**
 * 卡片设置弹窗的关于一节（D27）：组件的身份、数据源、宿主能力、授权与刷新。
 *
 * 全是只读的事实与人的一次许可：身份来自组件库，数据源与能力来自注册表，授权绑在这张卡当前的组件
 * 版本上（D6、D24）。
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import type { ActionPermission, CardSettings, GrantKind, LocalizedText } from '@dsh-widget-board/contracts'
import { sourceLabel, t, textOf } from './copy'

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

/** 关于一节要画的东西。 */
export interface AboutPanelProps {
  settings: CardSettings
  busy: boolean
  /** 给数据源或宿主能力一次授权。 */
  onGrant: (kind: GrantKind, id: string) => Promise<void>
  /** 撤掉数据源或宿主能力的一份授权。 */
  onRevoke: (kind: GrantKind, id: string) => Promise<void>
  /** 按卡片绑定的数据源读一次数据。 */
  onRefresh: () => Promise<void>
}

/**
 * 关于：组件的身份、数据源、宿主能力、授权与刷新（D27）。
 *
 * @param props - 设置读模型与授权、刷新回调。
 * @returns 关于一节。
 */
export function AboutPanel({ settings, busy, onGrant, onRevoke, onRefresh }: AboutPanelProps): ReactNode {
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

  const widget = settings.widget
  const refresh = widget.refresh
  const refreshText = refresh === undefined || refresh.mode === 'onDemand'
    ? t('onDemand')
    : refresh.everyMs === undefined
      ? t('interval')
      : `${t('interval')} · ${Math.round(refresh.everyMs / 1000)}s`
  const description: LocalizedText | undefined = widget.description
  const source = settings.source
  const capabilities = settings.capabilities

  return (
    <div className="dsh-widget-board__about">
      <section className="dsh-widget-board__about-card">
        <h3 className="dsh-widget-board__editor-heading">{textOf(widget.title)}</h3>
        {description === undefined ? null : <p className="dsh-widget-board__about-desc">{textOf(description)}</p>}
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
            <dd className="dsh-widget-board__facts-hash" title={widget.hash}>{widget.hash.slice(0, 12)}</dd>
          </div>
          <div>
            <dt>{t('refreshPolicy')}</dt>
            <dd>{refreshText}</dd>
          </div>
        </dl>
      </section>

      <section className="dsh-widget-board__about-card">
        <h3 className="dsh-widget-board__editor-heading">{t('dataAndPermissions')}</h3>
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
              <PermissionChips permission={source.permission} />
              <div className="dsh-widget-board__about-actions">
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
                <button
                  type="button"
                  className="dsh-widget-board__editor-ghost"
                  data-dsh-widget-board-refresh=""
                  disabled={working !== null || busy}
                  onClick={() => { void run('refresh', onRefresh, true) }}
                >
                  {working === 'refresh' ? t('refreshing') : t('refreshNow')}
                </button>
              </div>
            </>
          )}

        {capabilities.map((capability) => {
          const label = capability.title === undefined ? capability.id : textOf(capability.title)
          const needsGrant = capability.permission !== undefined
          return (
            <div key={capability.id} className="dsh-widget-board__about-block">
              <h4 className="dsh-widget-board__about-subheading">{label}</h4>
              {capability.description === undefined ? null : <p className="dsh-widget-board__about-desc">{textOf(capability.description)}</p>}
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
              <div className="dsh-widget-board__about-actions">
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
              </div>
            </div>
          )
        })}

        {source === undefined && capabilities.length === 0
          ? <p className="dsh-widget-board__editor-empty">{t('noSource')}</p>
          : null}
        {refreshed ? <p className="dsh-widget-board__editor-ok" role="status">{t('refreshed')}</p> : null}
        {error === null ? null : <p className="dsh-widget-board__editor-error" role="alert">{error}</p>}
      </section>
    </div>
  )
}
