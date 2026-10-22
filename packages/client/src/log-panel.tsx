/**
 * 卡片设置弹窗的日志一节（D28）：这张卡对外的每一次请求。
 *
 * 只列出方法、主机与路径、状态与耗时；凭据不进这里，查询串里带的值照原样显示。打开时读一次，
 * 也可以按「刷新」再读。
 */
import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { RequestLogEntry } from '@dsh-widget-board/contracts'
import { t } from './copy'
import { fetchInstanceLog } from './snapshot'

/** 日志一节要画的东西。 */
export interface RequestLogPanelProps {
  /** 卡片实例的 id。 */
  instanceId: string
}

/** 把毫秒时间戳写成当天的时分秒。 */
function timeOf(at: number): string {
  const date = new Date(at)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/**
 * 日志一节：一行一次请求，最新的在最上面。
 *
 * @param props - 卡片 id。
 * @returns 日志一节。
 */
export function RequestLogPanel({ instanceId }: RequestLogPanelProps): ReactNode {
  const [entries, setEntries] = useState<RequestLogEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback((): void => {
    setBusy(true)
    fetchInstanceLog(instanceId).then((value) => {
      setEntries(value)
      setError(null)
    }, (caught: Error) => {
      setError(caught.message)
    }).finally(() => {
      setBusy(false)
    })
  }, [instanceId])

  useEffect(() => {
    load()
  }, [load])

  if (error !== null) {
    return (
      <div className="dsh-widget-board__log">
        <p className="dsh-widget-board__editor-error" role="alert">{error}</p>
        <div className="dsh-widget-board__editor-actions">
          <span className="dsh-widget-board__editor-spacer" />
          <button type="button" className="dsh-widget-board__editor-ghost" data-dsh-widget-board-log-refresh="" disabled={busy} onClick={load}>
            {t('refresh')}
          </button>
        </div>
      </div>
    )
  }

  if (entries === null) {
    return <p className="dsh-widget-board__editor-empty">{t('boardListLoading')}</p>
  }

  return (
    <div className="dsh-widget-board__log" data-dsh-widget-board-log="">
      {entries.length === 0
        ? <p className="dsh-widget-board__editor-empty">{t('noRequests')}</p>
        : (
          <ul className="dsh-widget-board__log-list">
            {[...entries].reverse().map((entry) => (
              <li
                key={`${entry.at}:${entry.method}:${entry.path}`}
                className="dsh-widget-board__log-row"
                data-ok={entry.error === undefined ? 'true' : 'false'}
                data-dsh-widget-board-log-row=""
              >
                <span className="dsh-widget-board__log-time">{timeOf(entry.at)}</span>
                <span className="dsh-widget-board__log-method">{entry.method}</span>
                <span className="dsh-widget-board__log-target" title={`${entry.host}${entry.path}`}>
                  <span className="dsh-widget-board__log-host">{entry.host}</span>
                  <span className="dsh-widget-board__log-path">{entry.path.split('?')[0]}</span>
                </span>
                <span className="dsh-widget-board__log-status">
                  {entry.error === undefined ? entry.status : `${t('requestFailed')} · ${entry.error}`}
                </span>
                <span className="dsh-widget-board__log-ms">{`${String(entry.ms)} ms`}</span>
              </li>
            ))}
          </ul>
        )}
      <p className="dsh-widget-board__editor-note">{t('requestLogHint')}</p>
      <div className="dsh-widget-board__editor-actions">
        <span className="dsh-widget-board__editor-spacer" />
        <button type="button" className="dsh-widget-board__editor-ghost" data-dsh-widget-board-log-refresh="" disabled={busy} onClick={load}>
          {busy ? t('refreshing') : t('refresh')}
        </button>
      </div>
    </div>
  )
}
