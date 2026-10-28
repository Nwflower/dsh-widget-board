/** 一次编辑一项；确认前保留局部输入，取消不修改列表。 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import type { CampusItem, CampusProps } from '@dsh-widget-board/model/campus/types'
import { dueFromInput, dueInput, localOffsets } from '@dsh-widget-board/model/campus/time'
import { isChinese } from '../copy'

export const say = (zh: string, en: string): string => isChinese() ? zh : en
export function CampusField({ label, children }: { label: string, children: ReactNode }): ReactNode {
  return <label className="dsh-widget-board__field"><span className="dsh-widget-board__field-label">{label}</span>{children}</label>
}
export function CampusItemForm({ original, kind, props, categories, onConfirm, onCancel }: {
  original?: CampusItem, kind: CampusItem['kind'], props: CampusProps, categories: readonly string[], onConfirm: (item: CampusItem) => boolean, onCancel: () => void,
}): ReactNode {
  const initial = original ? dueInput(original.due) : { date: '', time: '', offset: '' }
  const [title, setTitle] = useState(original?.title ?? '')
  const [category, setCategory] = useState(original?.category ?? categories[0] ?? '')
  const [date, setDate] = useState(initial.date)
  const [time, setTime] = useState(initial.time)
  const [zone, setZone] = useState(original?.due.timeZone ?? props.timeZone)
  const [dateKind, setDateKind] = useState<'date' | 'instant'>(original?.due.kind ?? 'date')
  const [offset, setOffset] = useState(initial.offset)
  const [url, setUrl] = useState(original?.url ?? '')
  const [note, setNote] = useState(original?.note ?? '')
  const [error, setError] = useState<string | null>(null)
  const offsets = dateKind === 'instant' ? localOffsets(date, time, zone) : []
  const confirm = (): void => {
    setError(null)
    try {
      if (!title.trim()) throw new Error(say('请填写标题', 'Enter a title'))
      const due = dueFromInput(dateKind, date, time, zone, offsets.length > 1 ? offset || undefined : undefined)
      const now = new Date().toISOString()
      const next: CampusItem = {
        ...original, id: original?.id ?? crypto.randomUUID(), kind, title: title.trim(), category: category.trim(), due,
        status: original?.status ?? 'todo', source: original?.source ?? 'manual', createdAt: original?.createdAt ?? now, updatedAt: now,
        ...(url.trim() ? { url: url.trim() } : {}), ...(note.trim() ? { note: note.trim() } : {}),
      }
      if (!url.trim()) delete next.url
      if (!note.trim()) delete next.note
      if (onConfirm(next)) onCancel()
    } catch (caught) { setError((caught as Error).message) }
  }
  return <section data-dsh-widget-campus-item-form="" className="dsh-widget-board__composer-section">
    <h3 className="dsh-widget-board__composer-heading">{original ? say('编辑事项', 'Edit item') : say('新增事项', 'New item')}</h3>
    <CampusField label={say('标题', 'Title')}><input className="dsh-widget-board__input" data-dsh-widget-campus-field="title" value={title} maxLength={120} required autoFocus onChange={event => { setTitle(event.target.value) }} /></CampusField>
    <CampusField label={say('分类', 'Category')}><input className="dsh-widget-board__input" list="dsh-campus-categories" value={category} maxLength={40} onChange={event => { setCategory(event.target.value) }} /><datalist id="dsh-campus-categories">{categories.map(entry => <option key={entry} value={entry} />)}</datalist></CampusField>
    <CampusField label={say('截止类型', 'Due type')}><select className="dsh-widget-board__input dsh-widget-board__select" value={dateKind} data-dsh-widget-campus-field="due-kind" onChange={event => { setDateKind(event.target.value as 'date' | 'instant'); setOffset('') }}><option value="date">{say('全天日期', 'All-day date')}</option><option value="instant">{say('精确时刻', 'Exact time')}</option></select></CampusField>
    <CampusField label={say('日期', 'Date')}><input type="date" className="dsh-widget-board__input" data-dsh-widget-campus-field="date" value={date} required onChange={event => { setDate(event.target.value); setOffset('') }} /></CampusField>
    {dateKind === 'instant' ? <CampusField label={say('时刻', 'Time')}><input type="time" className="dsh-widget-board__input" data-dsh-widget-campus-field="time" value={time} required onChange={event => { setTime(event.target.value); setOffset('') }} /></CampusField> : null}
    <CampusField label={say('时区（IANA）', 'Time zone (IANA)')}><input className="dsh-widget-board__input" data-dsh-widget-campus-field="zone" value={zone} maxLength={80} onChange={event => { setZone(event.target.value); setOffset('') }} /></CampusField>
    {offsets.length > 1 ? <CampusField label={say('此时刻重复出现，请选择 UTC 偏移', 'This time occurs twice; select its UTC offset')}><select className="dsh-widget-board__input dsh-widget-board__select" value={offset} data-dsh-widget-campus-field="offset" onChange={event => { setOffset(event.target.value) }}><option value="">{say('请选择', 'Select')}</option>{offsets.map(value => <option key={value} value={value}>{value}</option>)}</select></CampusField> : null}
    <CampusField label={say('相关链接（可选）', 'Related URL (optional)')}><input type="url" className="dsh-widget-board__input" value={url} maxLength={2048} onChange={event => { setUrl(event.target.value) }} /></CampusField>
    <CampusField label={say('说明（可选）', 'Note (optional)')}><textarea className="dsh-widget-board__input dsh-widget-board__textarea" rows={3} value={note} maxLength={500} onChange={event => { setNote(event.target.value) }} /></CampusField>
    {error ? <p className="dsh-widget-board__editor-error" role="alert">{error}</p> : null}
    <p className="dsh-widget-board__editor-note">{say('确认后，点击页面底部保存到卡片。', 'After confirming, save the card at the bottom of this dialog.')}</p>
    <div className="dsh-widget-board__editor-actions"><button type="button" className="dsh-widget-board__editor-ghost" onClick={onCancel}>{say('取消本项', 'Cancel item')}</button><button type="button" className="dsh-widget-board__editor-primary" data-dsh-widget-campus-confirm-item="" onClick={confirm}>{say('确认事项', 'Confirm item')}</button></div>
  </section>
}
