/** 常用入口按用户保存的顺序显示；内置入口仅经显式添加。 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { CampusLink, SchoolPreset } from '@dsh-widget-board/model/campus/types'
import { safeLink } from '@dsh-widget-board/model/campus/model'
import { CampusField, say } from './item-form'

export function CampusLinks({ links, school, onChange, disabled, onPending }: { links: CampusLink[], school: SchoolPreset, onChange: (links: CampusLink[]) => void, disabled: boolean, onPending: (value: boolean) => void }): ReactNode {
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { onPending(Boolean(title || url || editing)); return () => { onPending(false) } }, [title, url, editing, onPending])
  const move = (index: number, direction: number): void => {
    const next = [...links]
    const other = index + direction
    if (other < 0 || other >= next.length) return
    ;[next[index], next[other]] = [next[other]!, next[index]!]
    onChange(next)
  }
  const add = (): void => {
    if (!title.trim() || !safeLink(url.trim())) { setError(say('请输入标题和有效的 http/https 地址', 'Enter a title and valid http/https URL')); return }
    if (!editing && links.length >= 12) { setError(say('最多十二个入口', 'Up to twelve links')); return }
    const entry = { id: editing ?? crypto.randomUUID(), title: title.trim(), url: url.trim() }
    onChange(editing ? links.map(link => link.id === editing ? entry : link) : [...links, entry])
    setEditing(null); setTitle(''); setUrl(''); setError(null)
  }
  return <section className="dsh-widget-board__composer-section" data-dsh-widget-campus-links="">
    <h3 className="dsh-widget-board__composer-heading">{say('常用入口', 'Quick links')} · {links.length}/12</h3>
    {links.map((link, index) => <div key={link.id} className="dsh-widget-board__array-item" data-dsh-widget-campus-link={link.id}>
      <strong>{link.title}</strong><p className="dsh-widget-board__editor-note" style={{ overflowWrap: 'anywhere' }}>{link.url}</p>
      <div className="dsh-widget-board__editor-actions">
        <button type="button" className="dsh-widget-board__editor-ghost" disabled={disabled || index === 0} aria-label={`${say('上移', 'Move up')} ${link.title}`} onClick={() => { move(index, -1) }}>↑</button>
        <button type="button" className="dsh-widget-board__editor-ghost" disabled={disabled || index === links.length - 1} aria-label={`${say('下移', 'Move down')} ${link.title}`} onClick={() => { move(index, 1) }}>↓</button>
        <button type="button" className="dsh-widget-board__editor-ghost" disabled={disabled} onClick={() => { setEditing(link.id); setTitle(link.title); setUrl(link.url) }}>{say('编辑', 'Edit')}</button>
        <button type="button" className="dsh-widget-board__editor-ghost" disabled={disabled} onClick={() => { onChange(links.filter(entry => entry.id !== link.id)) }}>{say('删除', 'Delete')}</button>
      </div>
    </div>)}
    {school.links.length ? <button type="button" className="dsh-widget-board__editor-ghost" disabled={disabled} onClick={() => {
      const incoming = school.links.filter(link => !links.some(entry => entry.url === link.url))
      if (links.length + incoming.length > 12) { setError(say('添加学校入口会超过十二项，请先整理', 'Remove some links before adding the school links')); return }
      onChange([...links, ...incoming]); setError(null)
    }}>{say('添加学校公开入口', 'Add public school links')}</button> : null}
    <CampusField label={say('入口名称', 'Link title')}><input className="dsh-widget-board__input" data-dsh-widget-campus-link-title="" value={title} maxLength={40} disabled={disabled} onChange={event => { setTitle(event.target.value) }} /></CampusField>
    <CampusField label={say('http/https 地址', 'http/https URL')}><input type="url" className="dsh-widget-board__input" data-dsh-widget-campus-link-url="" value={url} maxLength={2048} disabled={disabled} onChange={event => { setUrl(event.target.value) }} /></CampusField>
    <button type="button" className="dsh-widget-board__editor-ghost" disabled={disabled} data-dsh-widget-campus-link-save="" onClick={add}>{editing ? say('确认修改', 'Confirm changes') : say('加入入口', 'Add link')}</button>
    <button type="button" className="dsh-widget-board__editor-ghost" disabled={disabled} onClick={() => { setEditing(null); setTitle(''); setUrl(''); setError(null) }}>{say('取消输入', 'Cancel input')}</button>
    {error ? <p className="dsh-widget-board__editor-error" role="alert">{error}</p> : null}
  </section>
}
