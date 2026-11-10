/** 文件交换独立保存；编辑器有草稿时禁止进入，冲突保留文件和逐行决定供重新预览。 */
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { ImportDecision, ImportField, ItemImportPreview, ItemImportRequest } from '@dsh-widget-board/contracts/item-import'
import { CampusField } from './item-form'
import { commitItems, downloadFile, exportFile, previewItems, releaseItems } from './exchange-api'

const fields: ImportField[] = ['kind', 'title', 'category', 'due', 'dateOnly', 'timeZone', 'status', 'url', 'note', 'uid']
const aliases = ['类型', '标题', '分类', '截止日期', '全天', '时区', '状态', '链接', '说明', '标识']
export function CampusExchange({ target, disabled, onSaved, onPending }: { target: string, disabled: boolean, onSaved: () => void, onPending: (value: boolean) => void }): ReactNode {
  const [request, setRequest] = useState<ItemImportRequest>({ format: 'csv', text: '', timeZone: 'Asia/Shanghai' })
  const [preview, setPreview] = useState<ItemImportPreview | null>(null)
  const [headers, setHeaders] = useState<string[]>([])
  const [stale, setStale] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [kind, setKind] = useState('all')
  const [done, setDone] = useState(false)
  const [cancelled, setCancelled] = useState(false)
  const [file, setFile] = useState<Awaited<ReturnType<typeof exportFile>> | null>(null)
  const session = useRef<string | undefined>(undefined)
  const [page, setPage] = useState(0)
  useEffect(() => { onPending(Boolean(request.text) || busy); return () => { onPending(false) } }, [request.text, busy, onPending])
  useEffect(() => () => { if (session.current) void releaseItems(target, session.current).catch(caught => { console.error('释放文件预览失败', caught) }) }, [target])
  const run = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true); setError('')
    try { await action() } catch (caught) { setError((caught as Error).message) } finally { setBusy(false) }
  }
  const clear = async (): Promise<void> => {
    if (session.current) await releaseItems(target, session.current)
    session.current = undefined; setPreview(null)
  }
  const parse = async (next = request): Promise<void> => {
    await clear()
    const result = await previewItems(target, next)
    session.current = result.previewId
    setPreview(result)
    setHeaders(result.headers)
    setStale(false)
    if (!next.mapping && result.headers.length) {
      const mapping = Object.fromEntries(fields.map((key, index) => [key, result.headers.find(header => header === key || header === aliases[index]) || '']))
      setRequest({ ...next, mapping })
    }
  }
  const change = (patch: Partial<ItemImportRequest>): void => { setRequest(current => ({ ...current, ...patch })); setStale(true) }
  const decisions = request.decisions ?? {}
  return <details className="dsh-widget-board__composer-section" data-dsh-widget-campus-exchange="">
    <summary className="dsh-widget-board__composer-heading">CSV / ICS 文件交换</summary>
    <p className="dsh-widget-board__editor-note">先保存当前编辑再选择文件。逐行核对后一次导入；完整备份请使用看板包。</p>
    <fieldset className="dsh-widget-board__fields" disabled={disabled || busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <CampusField label="选择 UTF-8 CSV 或 ICS（最多2MiB）"><input type="file" accept=".csv,.ics,text/csv,text/calendar" onChange={event => {
        const selected = event.target.files?.[0]
        if (!selected) return
        void run(async () => {
          if (selected.size > 2 * 1024 * 1024) throw new Error('文件超过2MiB')
          const text = new TextDecoder('utf-8', { fatal: true }).decode(await selected.arrayBuffer())
          const next: ItemImportRequest = { format: selected.name.toLowerCase().endsWith('.ics') ? 'ics' : 'csv', text, timeZone: request.timeZone }
          setRequest(next); setPage(0); await parse(next)
        })
      }} /></CampusField>
      {request.text ? <>
        <CampusField label="目标时区（IANA）"><input className="dsh-widget-board__input" value={request.timeZone} onChange={event => { change({ timeZone: event.target.value }) }} /></CampusField>
        {request.format === 'csv' ? <details open={!request.mappingConfirmed}>
          <summary>{request.mappingConfirmed ? '字段映射（已确认，可展开修改）' : '字段映射（请逐项确认）'}</summary>
          {fields.map((key, index) => <CampusField key={key} label={`${aliases[index]}${key === 'title' || key === 'due' ? ' *' : ''}`}><select className="dsh-widget-board__input" value={request.mapping?.[key] ?? ''} onChange={event => { change({ mapping: { ...request.mapping, [key]: event.target.value }, mappingConfirmed: false }) }}><option value="">不映射</option>{headers.map(header => <option key={header}>{header}</option>)}</select></CampusField>)}
          <label><input type="checkbox" checked={Boolean(request.mappingConfirmed)} onChange={event => { change({ mappingConfirmed: event.target.checked }) }} />确认以上字段映射</label>
        </details> : <>
          {(['rangeStart', 'rangeEnd'] as const).map(key => <CampusField key={key} label={key === 'rangeStart' ? '重复展开开始（默认今天）' : '重复展开结束（默认一年后）'}><input type="date" className="dsh-widget-board__input" value={request[key] ?? ''} onChange={event => { change({ [key]: event.target.value }) }} /></CampusField>)}
          {(['floatingConfirmed', 'unknownZoneConfirmed'] as const).map(key => <label key={key}><input type="checkbox" checked={Boolean(request[key])} onChange={event => { change({ [key]: event.target.checked }) }} />{key === 'floatingConfirmed' ? '确认浮动时间使用目标时区' : '确认无法识别的TZID使用目标时区'}</label>)}
        </>}
        <button type="button" className="dsh-widget-board__editor-ghost" onClick={() => { void run(() => parse()) }}>重新解析与匹配</button>
        <button type="button" className="dsh-widget-board__editor-ghost" onClick={() => { void run(async () => { await clear(); setRequest({ format: 'csv', text: '', timeZone: request.timeZone }) }) }}>取消导入</button>
      </> : null}
      {preview ? <>
        <p role="status">有效 {preview.rows.filter(row => row.item).length} · 无效 {preview.rows.filter(row => row.error).length} · 重复 {preview.rows.filter(row => row.duplicateId).length} · 选中 {preview.selected} · 保存后 {preview.total}/100 · {preview.stateBytes}/65536 字节</p>
        {[...preview.warnings, ...preview.errors].map((message, index) => <p key={index} className="dsh-widget-board__editor-error">{message}</p>)}
        {preview.rows.slice(page * 25, (page + 1) * 25).map(row => <article key={row.row} className="dsh-widget-board__array-item">
          <strong>第{row.row}项 · {row.fields.title}</strong>
          <p>{row.fields.due} · {row.item?.due.timeZone || row.fields.timeZone || request.timeZone}</p>
          {row.error ? <p role="alert">{row.error}</p> : null}
          {row.changes?.map(value => <p key={value} style={{ overflowWrap: 'anywhere' }}>{value}</p>)}
          <CampusField label="处理方式"><select className="dsh-widget-board__input" value={decisions[String(row.row)] ?? (row.duplicateId ? 'skip' : 'keep')} onChange={event => {
            const next = { ...request, decisions: { ...decisions, [row.row]: event.target.value as ImportDecision } }
            setRequest(next); void run(() => parse(next))
          }}><option value="skip">跳过</option><option value="keep">保留为新事项</option>{row.duplicateId ? <option value="update">更新，保留完成状态和本地标识</option> : null}</select></CampusField>
          <details><summary>修改本项字段</summary>{[...fields, 'offset' as const].map(key => <CampusField key={key} label={key}><input className="dsh-widget-board__input" defaultValue={row.fields[key] ?? ''} onBlur={event => {
            if (event.target.value === (row.fields[key] ?? '')) return
            change({ edits: { ...request.edits, [row.row]: { ...request.edits?.[String(row.row)], [key]: event.target.value } } })
          }} /></CampusField>)}</details>
        </article>)}
        {preview.rows.length > 25 ? <div className="dsh-widget-board__editor-actions"><button type="button" disabled={page === 0} onClick={() => { setPage(page - 1) }}>上一页</button><span>{page + 1}/{Math.ceil(preview.rows.length / 25)}</span><button type="button" disabled={(page + 1) * 25 >= preview.rows.length} onClick={() => { setPage(page + 1) }}>下一页</button></div> : null}
        {stale ? <p role="status">配置或字段已改变，请重新解析与匹配。</p> : null}
        <button type="button" className="dsh-widget-board__editor-primary" disabled={stale || !preview.previewId || !preview.selected || Boolean(preview.errors.length)} onClick={() => { void run(async () => { await commitItems(target, preview, decisions); session.current = undefined; setPreview(null); setRequest({ format: 'csv', text: '', timeZone: request.timeZone }); onSaved() }) }}>确认一次导入 {preview.selected} 项</button>
      </> : null}
      <CampusField label="导出范围"><select className="dsh-widget-board__input" value={kind} onChange={event => { setKind(event.target.value); setFile(null) }}><option value="all">全部类型</option><option value="deadline">近期事项</option><option value="milestone">里程碑</option></select></CampusField>
      <label><input type="checkbox" checked={done} onChange={event => { setDone(event.target.checked); setFile(null) }} />包含已完成</label>
      <label><input type="checkbox" checked={cancelled} onChange={event => { setCancelled(event.target.checked); setFile(null) }} />包含已取消</label>
      <div className="dsh-widget-board__editor-actions">{['csv', 'ics', 'template'].map(format => <button key={format} type="button" className="dsh-widget-board__editor-ghost" onClick={() => { void run(async () => { setFile(await exportFile(target, format, new URLSearchParams({ kind, done: String(done), cancelled: String(cancelled) }).toString())) }) }}>{format === 'template' ? '标准CSV模板' : `导出 ${format.toUpperCase()}`}</button>)}</div>
      {file ? <button type="button" className="dsh-widget-board__editor-primary" onClick={() => { downloadFile(file); setFile(null) }}>确认下载 {file.name} {file.count === undefined ? '' : `（${file.count}项）`}</button> : null}
    </fieldset>
    {busy ? <p role="status">正在处理文件…</p> : null}
    {error ? <p role="alert" className="dsh-widget-board__editor-error">{error}</p> : null}
  </details>
}
