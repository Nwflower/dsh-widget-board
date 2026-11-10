/**
 * 设置页里的「看板」一节（D21）：列出全部看板，改名、移除与选中都在这里；标签条的更多按钮与右键菜单调同一份动作。
 * 看板列表下面是提供方的健康表（D31）：每个提供方能不能用、声明了哪些用途、累计注册与失败。
 *
 * 这一节由宿主的设置外壳挂上来，与看板页不共享内存：它自己取一次工作区，之后跟随变更通知
 * （D18）；每一次写都以宿主的答复为准（D5）。
 */
import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { boardTitleProblem } from '@dsh-widget-board/contracts'
import type {
  BoardEventFrame,
  SettingsSectionProps,
  WidgetProviderHealth,
  WorkspaceSnapshot,
} from '@dsh-widget-board/contracts'
import { t } from './copy'
import { subscribeLive } from './live'
import { mergeEvent, needsSnapshot } from './merge'
import { activateBoard, fetchWorkspace } from './snapshot'
import { deleteBoardById, factsOf, renameBoardTo } from './board-management/actions'

/** 没有提供方时共用的空表：快照还没到时也返回它。 */
const NO_PROVIDERS: readonly WidgetProviderHealth[] = []

/**
 * 快照里的提供方健康记录（D31）。
 *
 * @param snapshot - 页面上的工作区；还没读到时为 `null`。
 * @returns 健康记录，按宿主给的次序；宿主不带 `providers` 时为空。
 */
export function providerHealthOf(snapshot: WorkspaceSnapshot | null): readonly WidgetProviderHealth[] {
  if (snapshot === null) return NO_PROVIDERS
  return snapshot.providers ?? NO_PROVIDERS
}

/**
 * 提供方健康表：每个提供方一行，写明能不能用、声明了哪些用途、累计注册与失败。
 *
 * 只按传进来的行画，自己不留状态；快照换了，表跟着换。
 *
 * @param props - `providers`：宿主给的健康行。没有提供方时画空状态。
 * @returns 设置页里的一张表。
 */
export function ProviderHealthTable({ providers }: { providers: readonly WidgetProviderHealth[] }): ReactNode {
  return (
    <section
      className="dsh-widget-board__provider-health"
      data-dsh-widget-board-provider-health=""
      aria-label={t('providerHealth')}
    >
      <h3 className="dsh-widget-board__provider-health-title">{t('providerHealth')}</h3>
      {providers.length === 0
        ? (
          <p
            className="dsh-widget-board__board-settings-notice"
            data-dsh-widget-board-provider-health-empty=""
          >
            {t('providerHealthEmpty')}
          </p>
        )
        : (
          <div className="dsh-widget-board__provider-health-scroll">
            <table className="dsh-widget-board__provider-health-table">
              <thead>
                <tr>
                  <th scope="col">{t('provider')}</th>
                  <th scope="col">{t('providerState')}</th>
                  <th scope="col">{t('providerFeatures')}</th>
                  <th scope="col" className="dsh-widget-board__provider-health-number">{t('providerRegistrations')}</th>
                  <th scope="col" className="dsh-widget-board__provider-health-number">{t('providerFailures')}</th>
                  <th scope="col" className="dsh-widget-board__provider-health-number">{t('providerTimeouts')}</th>
                  <th scope="col">{t('providerLastError')}</th>
                </tr>
              </thead>
              <tbody>
                {providers.map((row) => (
                  <tr
                    key={row.provider}
                    className="dsh-widget-board__provider-health-row"
                    data-dsh-widget-board-provider={row.provider}
                    data-available={row.available ? 'true' : 'false'}
                  >
                    <th scope="row" className="dsh-widget-board__provider-health-name">{row.provider}</th>
                    <td className="dsh-widget-board__provider-health-state">
                      {row.available ? t('providerAvailable') : t('providerUnavailable')}
                    </td>
                    <td>
                      {row.features.length === 0
                        ? <span className="dsh-widget-board__provider-health-none">{t('providerNoFeatures')}</span>
                        : (
                          <span className="dsh-widget-board__provider-health-features">
                            {row.features.map((feature) => (
                              <code key={feature} className="dsh-widget-board__provider-health-feature">{feature}</code>
                            ))}
                          </span>
                        )}
                    </td>
                    <td className="dsh-widget-board__provider-health-number">{row.registrations}</td>
                    <td className="dsh-widget-board__provider-health-number">{row.failures}</td>
                    <td className="dsh-widget-board__provider-health-number">{row.timeouts}</td>
                    <td className="dsh-widget-board__provider-health-error">{row.lastError ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </section>
  )
}

/**
 * 看板一节。
 *
 * @param _props - 宿主给的 `close`；这一节里没有要关掉设置面板的动作，因此不用它。
 * @returns 设置页里的一节。
 */
export function BoardSettings(_props: SettingsSectionProps): ReactNode {
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /** 正在改名的看板 id；为 `null` 时没有一行在编辑。 */
  const [editing, setEditing] = useState<string | null>(null)
  const [title, setTitle] = useState('')

  const apply = useCallback((next: WorkspaceSnapshot): void => {
    setSnapshot(next)
    setFailure(null)
  }, [])

  const reload = useCallback(() => {
    fetchWorkspace().then(apply, (error: Error) => { setFailure(error.message) })
  }, [apply])

  useEffect(() => { reload() }, [reload])

  const onEvent = useCallback((frame: BoardEventFrame) => {
    if (needsSnapshot(frame)) {
      reload()
      return
    }
    setSnapshot((previous) => previous === null ? previous : mergeEvent(previous, frame))
  }, [reload])

  useEffect(() => subscribeLive(onEvent), [onEvent])

  /** 一次写宿主：期间按钮不可按，宿主的答复到了换上新的一份。 */
  const write = useCallback((action: () => Promise<WorkspaceSnapshot>, done?: () => void): void => {
    if (busy) return
    setBusy(true)
    action().then((next) => {
      apply(next)
      done?.()
    }, (error: Error) => { setFailure(error.message) })
      .finally(() => { setBusy(false) })
  }, [apply, busy])

  const onSelect = useCallback((id: string) => {
    write(() => activateBoard(id))
  }, [write])

  const onStartRename = useCallback((id: string, current: string) => {
    setEditing(id)
    setTitle(current)
  }, [])

  const onCancelRename = useCallback(() => {
    setEditing(null)
    setTitle('')
  }, [])

  const onConfirmRename = useCallback(() => {
    const id = editing
    if (id === null) return
    write(() => renameBoardTo(id, title), () => { setEditing(null); setTitle('') })
  }, [editing, title, write])

  const onRemove = useCallback((id: string) => {
    write(() => deleteBoardById(id))
  }, [write])

  const boards = snapshot === null ? [] : snapshot.boards

  return (
    <div className="dsh-widget-board__board-settings" data-dsh-widget-board-settings="">
      {failure === null
        ? null
        : <p className="dsh-widget-board__board-settings-notice dsh-widget-board__board-settings-notice--error">{failure}</p>}
      {snapshot === null
        ? <p className="dsh-widget-board__board-settings-notice">{t('boardListLoading')}</p>
        : (
          <ul className="dsh-widget-board__board-settings-list" aria-label={t('boards')}>
            {boards.map((board) => (
              <li
                key={board.id}
                className="dsh-widget-board__board-settings-row"
                data-dsh-widget-board-settings-board={board.id}
                data-active={board.id === snapshot.active ? 'true' : 'false'}
              >
                <button
                  type="button"
                  className="dsh-widget-board__board-settings-name"
                  aria-current={board.id === snapshot.active}
                  title={t('selectBoard')}
                  onClick={() => { onSelect(board.id) }}
                >
                  {board.title}
                </button>
                <span className="dsh-widget-board__board-settings-count">
                  {factsOf(board).cards}
                  {' '}
                  {t('boardCards')}
                </span>
                {editing === board.id
                  ? (
                    <>
                      <input
                        className="dsh-widget-board__board-settings-input"
                        value={title}
                        aria-label={t('boardName')}
                        aria-invalid={boardTitleProblem(title) !== null}
                        autoFocus
                        onChange={(event) => { setTitle(event.target.value) }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229) onConfirmRename()
                          if (event.key === 'Escape') onCancelRename()
                        }}
                      />
                      <button
                        type="button"
                        className="dsh-widget-board__board-settings-action"
                        disabled={busy || boardTitleProblem(title) !== null}
                        onClick={onConfirmRename}
                      >
                        {t('renameConfirm')}
                      </button>
                      <button type="button" className="dsh-widget-board__board-settings-action" onClick={onCancelRename}>
                        {t('renameCancel')}
                      </button>
                    </>
                  )
                  : (
                    <>
                      <button
                        type="button"
                        className="dsh-widget-board__board-settings-action"
                        onClick={() => { onStartRename(board.id, board.title) }}
                      >
                        {t('rename')}
                      </button>
                      <button
                        type="button"
                        className="dsh-widget-board__board-settings-action"
                        disabled={busy}
                        title={t('removeBoard')}
                        onClick={() => { onRemove(board.id) }}
                      >
                        {t('removeBoard')}
                      </button>
                    </>
                  )}
              </li>
            ))}
          </ul>
        )}
      {snapshot === null ? null : <ProviderHealthTable providers={providerHealthOf(snapshot)} />}
    </div>
  )
}
