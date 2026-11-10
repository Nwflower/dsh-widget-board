/** 校园管理沿用内容编辑器的保存、冲突和草稿边界。 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { DEFAULT_CAMPUS_PROPS, campusState, orderedOpen, setCampusStatus } from '@dsh-widget-board/model/campus/model'
import { DEGREES, SCHOOLS } from '@dsh-widget-board/model/campus/presets'
import { dueLabel } from '@dsh-widget-board/model/campus/time'
import type { CampusItem, CampusProps, CampusState } from '@dsh-widget-board/model/campus/types'
import { CampusField, CampusItemForm, say } from './item-form'
import { CampusLinks } from './links-form'
import { isChinese } from '../copy'

export { isCampusSchema } from '@dsh-widget-board/model/campus/model'

export function CampusForm({ props: rawProps, state: rawState, onProps, onState, onPending, disabled, media }: {
  props: Record<string, unknown>, state: unknown, onProps: (next: Record<string, unknown>) => void,
  onState: (next: unknown) => void, onPending: (pending: boolean) => void, disabled: boolean, media?: ReactNode,
}): ReactNode {
  const [tab, setTab] = useState('items')
  const [editing, setEditing] = useState<{ kind: CampusItem['kind'], item?: CampusItem } | null>(null)
  const [linkPending, setLinkPending] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [category, setCategory] = useState('')
  const [editingCategory, setEditingCategory] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { onPending(editing !== null || linkPending || Boolean(category)); return () => { onPending(false) } }, [editing, linkPending, category, onPending])
  let props: CampusProps
  let state: CampusState
  try {
    // 输入中的时区和名称可暂时不完整；保存前执行完整校验，表单不因此消失。
    props = { ...DEFAULT_CAMPUS_PROPS, ...rawProps, customSchool: { ...DEFAULT_CAMPUS_PROPS.customSchool, ...(rawProps.customSchool as Partial<CampusProps['customSchool']> | undefined) }, backgroundPosition: { ...DEFAULT_CAMPUS_PROPS.backgroundPosition, ...(rawProps.backgroundPosition as Partial<CampusProps['backgroundPosition']> | undefined) } }
    state = campusState(rawState)
  } catch (caught) { return <p role="alert" className="dsh-widget-board__editor-error">{(caught as Error).message}</p> }
  const school = SCHOOLS.find(entry => entry.id === props.schoolPreset) ?? SCHOOLS[0]!
  const write = (next: CampusState): boolean => {
    try { onState(campusState(next)); setError(null); return true } catch (caught) { setError((caught as Error).message); return false }
  }
  const configure = (next: Partial<CampusProps>): void => { onProps({ ...props, ...next }) }
  const kind = tab === 'milestones' ? 'milestone' : 'deadline'
  const rows = state.items.filter(item => item.kind === kind)
  const drawItem = (item: CampusItem): ReactNode => <article key={item.id} className="dsh-widget-board__array-item" data-dsh-widget-campus-item={item.id}>
    <strong style={{ overflowWrap: 'anywhere' }}>{item.title}</strong>
    <p className="dsh-widget-board__editor-note">{item.category} · {dueLabel(item.due, isChinese())} · {item.status === 'todo' ? say('待完成', 'Open') : item.status === 'done' ? say('已完成', 'Done') : say('已取消', 'Cancelled')}</p>
    {item.note ? <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{item.note}</p> : null}
    <div className="dsh-widget-board__editor-actions">
      <button type="button" className="dsh-widget-board__editor-ghost" disabled={disabled} onClick={() => { setEditing({ kind, item }) }}>{say('编辑', 'Edit')}</button>
      <button type="button" className="dsh-widget-board__editor-ghost" disabled={disabled} onClick={() => { write(setCampusStatus(state, item.id, item.status === 'todo' ? 'done' : 'todo', new Date().toISOString())) }}>{item.status === 'todo' ? say('完成', 'Complete') : say('恢复', 'Restore')}</button>
      {item.status === 'todo' ? <button type="button" className="dsh-widget-board__editor-ghost" disabled={disabled} onClick={() => { write(setCampusStatus(state, item.id, 'cancelled', new Date().toISOString())) }}>{say('取消事项', 'Cancel item')}</button> : null}
      <button type="button" className="dsh-widget-board__editor-ghost" disabled={disabled} onClick={() => {
        if (deleting === item.id) { write({ ...state, items: state.items.filter(entry => entry.id !== item.id) }); setDeleting(null) } else setDeleting(item.id)
      }}>{deleting === item.id ? say('确认删除', 'Confirm delete') : say('删除', 'Delete')}</button>
      {deleting === item.id ? <button type="button" className="dsh-widget-board__editor-ghost" onClick={() => { setDeleting(null) }}>{say('保留', 'Keep')}</button> : null}
    </div>
  </article>
  return <div data-dsh-widget-campus-form="" className="dsh-widget-board__fields">
    <nav className="dsh-widget-board__editor-actions" aria-label={say('校园卡管理', 'Campus management')}>
      {[['items', say('近期事项', 'Deadlines')], ['milestones', say('阶段里程碑', 'Milestones')], ['links', say('常用入口', 'Links')], ['appearance', say('校园外观', 'Appearance')]].map(([key, label]) => <button key={key} type="button" className="dsh-widget-board__editor-ghost" data-dsh-widget-campus-tab={key} aria-pressed={tab === key} disabled={editing !== null || linkPending || Boolean(category)} onClick={() => { setTab(key!) }}>{label}</button>)}
    </nav>
    <section className="dsh-widget-board__composer-section" data-dsh-widget-campus-reminders="">
      <CampusField label={say('看板内提醒', 'Board reminders')}><span><input type="checkbox" disabled={disabled} checked={props.reminderEnabled} onChange={event => { configure({ reminderEnabled: event.target.checked }) }} />{say('开启提醒', 'Enable reminders')}</span></CampusField>
      <CampusField label={say('提前量（另含到期提醒）', 'Advance notice (plus due reminder)')}><select className="dsh-widget-board__input" disabled={disabled || !props.reminderEnabled} value={props.reminderLeadHours} onChange={event => { configure({ reminderLeadHours: Number(event.target.value) }) }}>{[0, 1, 24, 72].map(hours => <option key={hours} value={hours}>{hours === 0 ? say('仅到期', 'At due time only') : `${hours} ${say('小时', 'hours')}`}</option>)}</select></CampusField>
      <p className="dsh-widget-board__editor-note">{say('全天事项在本地09:00提醒；仅在看板打开且卡片运行时检查。切离看板或退出DSH后停止，多窗口可能分别提醒。', 'All-day items notify at 09:00 in their time zone. Checks run only while the board and card are active. Leaving the board or closing DSH stops checks. Separate windows may notify separately.')}</p>
    </section>
    {tab === 'items' || tab === 'milestones' ? editing ? <CampusItemForm original={editing.item} kind={editing.kind} props={props} categories={[...DEGREES[props.degree].categories, ...DEGREES[props.degree].milestones, ...state.customCategories]} onCancel={() => { setEditing(null) }} onConfirm={item => write({ ...state, items: editing.item ? state.items.map(entry => entry.id === item.id ? item : entry) : [...state.items, item] })} /> : <section className="dsh-widget-board__composer-section">
      <h3 className="dsh-widget-board__composer-heading">{kind === 'milestone' ? say('阶段里程碑', 'Milestones') : say('近期事项', 'Deadlines')} · {state.items.length}/100</h3>
      <p className="dsh-widget-board__editor-note">{say('时间由你填写；切换学校或身份不会删除事项。', 'Enter your own dates. Switching school or degree preserves items.')}</p>
      <button type="button" className="dsh-widget-board__editor-primary" data-dsh-widget-campus-add="" disabled={disabled || state.items.length >= 100} onClick={() => { setEditing({ kind }) }}>{say('新增', 'Add')}</button>
      {orderedOpen(rows).map(drawItem)}
      {!rows.length ? <p className="dsh-widget-board__editor-empty">{say('还没有事项，添加一个真实的日期。', 'No items yet. Add a real date.')}</p> : null}
      <details><summary>{say('已完成和已取消', 'Completed and cancelled')} ({rows.filter(item => item.status !== 'todo').length})</summary>{rows.filter(item => item.status !== 'todo').map(drawItem)}</details>
    </section> : null}
    {tab === 'links' ? <CampusLinks links={state.links} school={school} disabled={disabled} onPending={setLinkPending} onChange={links => { write({ ...state, links }) }} /> : null}
    {tab === 'appearance' ? <section className="dsh-widget-board__composer-section">
      <CampusField label={say('学校', 'School')}><select className="dsh-widget-board__input dsh-widget-board__select" data-dsh-widget-campus-school="" value={props.schoolPreset} disabled={disabled} onChange={event => { configure({ schoolPreset: event.target.value as CampusProps['schoolPreset'] }) }}>{SCHOOLS.map(entry => <option key={entry.id} value={entry.id}>{say(entry.zh, entry.en)}</option>)}</select></CampusField>
      <CampusField label={say('学习阶段', 'Degree')}><select className="dsh-widget-board__input dsh-widget-board__select" data-dsh-widget-campus-degree="" value={props.degree} disabled={disabled} onChange={event => { configure({ degree: event.target.value as CampusProps['degree'] }) }}>{Object.entries(DEGREES).map(([key, value]) => <option key={key} value={key}>{say(value.zh, value.en)}</option>)}</select></CampusField>
      {props.schoolPreset === 'generic' ? <CampusField label={say('通用图案', 'Pattern')}><select className="dsh-widget-board__input dsh-widget-board__select" value={props.genericTheme} onChange={event => { configure({ genericTheme: event.target.value as CampusProps['genericTheme'] }) }}>{['book', 'tree', 'clock'].map(value => <option key={value}>{value}</option>)}</select></CampusField> : null}
      {props.schoolPreset === 'custom' ? (['name', 'shortName', 'iconAlt'] as const).map((key, index) => <CampusField key={key} label={[say('学校名称', 'School name'), say('简称', 'Short name'), say('图标说明', 'Icon description')][index]!}><input className="dsh-widget-board__input" value={props.customSchool[key]} maxLength={key === 'shortName' ? 12 : key === 'iconAlt' ? 160 : 80} onChange={event => { configure({ customSchool: { ...props.customSchool, [key]: event.target.value } }) }} /></CampusField>) : null}
      <CampusField label={say('默认时区（IANA）', 'Default time zone (IANA)')}><input className="dsh-widget-board__input" value={props.timeZone} onChange={event => { onProps({ ...props, timeZone: event.target.value }) }} /></CampusField>
      {(['x', 'y'] as const).map(axis => <CampusField key={axis} label={`${say('背景焦点', 'Photo focal point')} ${axis}`}><input type="range" min={0} max={100} value={props.backgroundPosition[axis]} onChange={event => { configure({ backgroundPosition: { ...props.backgroundPosition, [axis]: Number(event.target.value) } }) }} /></CampusField>)}
      <CampusField label={say('背景强度', 'Photo strength')}><input type="range" min={0} max={24} value={props.backgroundStrength} onChange={event => { configure({ backgroundStrength: Number(event.target.value) }) }} /></CampusField>
      <h3 className="dsh-widget-board__composer-heading">{say('自定义分类', 'Custom categories')} · {state.customCategories.length}/20</h3>
      {state.customCategories.map(value => <div key={value} className="dsh-widget-board__editor-actions"><span>{value}</span><button type="button" className="dsh-widget-board__editor-ghost" onClick={() => { setCategory(value); setEditingCategory(value) }}>{say('修改分类', 'Rename category')}</button><button type="button" className="dsh-widget-board__editor-ghost" onClick={() => { write({ ...state, customCategories: state.customCategories.filter(entry => entry !== value) }) }}>{say('移除分类', 'Remove category')}</button></div>)}
      <CampusField label={say('新分类', 'New category')}><input className="dsh-widget-board__input" value={category} maxLength={40} onChange={event => { setCategory(event.target.value) }} /></CampusField>
      <button type="button" className="dsh-widget-board__editor-ghost" disabled={disabled || !category.trim() || (!editingCategory && state.customCategories.length >= 20)} onClick={() => {
        const next = category.trim()
        if (write({ ...state, customCategories: [...new Set(editingCategory ? state.customCategories.map(value => value === editingCategory ? next : value) : [...state.customCategories, next])], items: editingCategory ? state.items.map(item => item.category === editingCategory ? { ...item, category: next } : item) : state.items })) { setCategory(''); setEditingCategory(null) }
      }}>{editingCategory ? say('确认分类名称', 'Confirm category name') : say('添加分类', 'Add category')}</button>
      <button type="button" className="dsh-widget-board__editor-ghost" onClick={() => { setCategory(''); setEditingCategory(null) }}>{say('取消输入', 'Cancel input')}</button>
    </section> : null}
    <div hidden={tab !== 'appearance'}>{media}</div>
    {error ? <p role="alert" className="dsh-widget-board__editor-error">{error}</p> : null}
  </div>
}
