/* 构建将共享纯模型内联到本组件脚本，导出的组件无需仓库外模块。 */
import { campusProps, campusState, campusSummary } from '@dsh-widget-board/model/campus/model'
import { dueLabel, dueTone } from '@dsh-widget-board/model/campus/time'
import { DEGREES, SCHOOLS } from '@dsh-widget-board/model/campus/presets'
import { createCampusReminders } from './reminders'

const widget = window.widget
const card = document.querySelector('.campus')
const field = name => card.querySelector(`[data-field="${name}"]`)
const role = name => card.querySelector(`[data-role="${name}"]`)
const zh = () => !widget || widget.lang.startsWith('zh')
const text = (cn, en) => zh() ? cn : en
let timer
let pending
let pendingTimer
let mediaController
let statusFeedback = ''
let mediaFailure = ''
const urls = []
const reminders = widget ? createCampusReminders(widget, feedback) : undefined

function renderFeedback() {
  const message = statusFeedback || mediaFailure
  field('feedback').textContent = message
  field('feedback').hidden = !message
}
function feedback(message) { statusFeedback = message; renderFeedback() }
function mediaFeedback(message) { mediaFailure = message; renderFeedback() }
function releaseMedia() {
  mediaController?.abort()
  for (const url of urls.splice(0)) URL.revokeObjectURL(url)
  for (const element of card.querySelectorAll('[data-media]')) { element.removeAttribute('src'); element.hidden = true }
}
async function loadMedia() {
  releaseMedia()
  if (!widget || widget.paused) return
  mediaFeedback('')
  let props
  try { props = campusProps(widget.props) } catch (error) { feedback(error.message); return }
  const controller = new AbortController()
  mediaController = controller
  for (const name of ['background', 'icon']) {
    if (!(name === 'background' ? props.hasBackground : props.hasIcon)) continue
    try {
      const blob = await widget.readMedia(name, { signal: controller.signal })
      if (controller.signal.aborted) return
      const url = URL.createObjectURL(blob)
      urls.push(url)
      const image = card.querySelector(`[data-media="${name}"]`)
      image.src = url
      image.hidden = false
      if (name === 'icon') image.alt = props.customSchool.iconAlt || text('自定义学校图标', 'Custom school icon')
    } catch (error) { if (!controller.signal.aborted) mediaFeedback(text('图片不可用，已使用默认图案', 'Image unavailable; showing the default pattern')) }
  }
}
function requestManage(section = 'items') { widget?.action('widget-board:edit-content', { section }) }
function complete(id) {
  if (pending || !widget) return
  pending = id
  feedback(text('正在保存…', 'Saving…'))
  render()
  widget.action('widget-board:campus-status', { itemId: id, status: 'done' })
  pendingTimer = setTimeout(() => { pending = undefined; feedback(text('尚未收到保存确认，请重试', 'Save was not confirmed; please retry')); render() }, 8000)
}
function itemNode(item) {
  const row = document.createElement('div')
  row.className = 'campus__item'
  const tone = dueTone(item.due, Date.now())
  row.dataset.tone = tone
  const contents = document.createElement('div')
  contents.className = 'campus__item-text'
  const title = document.createElement('p')
  title.className = 'campus__item-title'
  title.textContent = item.title
  title.title = item.title
  const meta = document.createElement('p')
  meta.className = 'campus__item-meta'
  meta.textContent = `${tone === 'overdue' ? text('已超期 · ', 'Overdue · ') : tone === 'near' ? text('临近 · ', 'Soon · ') : ''}${dueLabel(item.due, zh())}`
  meta.title = meta.textContent
  contents.append(title, meta)
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = pending === item.id ? '…' : text('完成', 'Done')
  button.setAttribute('aria-label', `${text('完成', 'Complete')} ${item.title}`)
  button.dataset.itemId = item.id
  button.disabled = Boolean(pending)
  button.onclick = () => complete(item.id)
  row.append(contents, button)
  return row
}
function render() {
  try {
    card.dataset.preview = String(widget?.size?.family === 'preview')
    const props = campusProps(widget?.props)
    const state = campusState(widget?.state)
    const summary = campusSummary(state, Date.now())
    const school = SCHOOLS.find(entry => entry.id === props.schoolPreset)
    card.style.setProperty('--campus-school-color', school.color)
    field('school').textContent = props.schoolPreset === 'custom' ? props.customSchool.name : zh() ? school.zh : school.en
    field('school').title = field('school').textContent
    field('degree').textContent = zh() ? DEGREES[props.degree].zh : DEGREES[props.degree].en
    field('recent-label').textContent = text('近期事项', 'Upcoming')
    field('milestone-label').textContent = text('下一里程碑', 'Next milestone')
    field('count').textContent = summary.overdue ? `${summary.overdue} ${text('项超期', 'overdue')}` : `${summary.open.length} ${text('项待办', 'open')}`
    const compact = innerHeight <= 256
    const count = compact ? 1 : innerHeight <= 320 ? 2 : 3
    const activeId = document.activeElement?.dataset.itemId
    role('items').replaceChildren(...summary.open.slice(0, count).map(itemNode))
    if (!summary.open.length) {
      const empty = document.createElement('p')
      empty.className = 'campus__empty'
      empty.textContent = state.items.length ? text('当前事项已全部处理', 'Everything is handled') : text('添加你的第一项校园事务', 'Add your first campus task')
      role('items').append(empty)
    }
    field('next').textContent = summary.next ? `${dueTone(summary.next.due, Date.now()) === 'overdue' ? text('已超期 · ', 'Overdue · ') : ''}${summary.next.title}` : text('添加里程碑', 'Add a milestone')
    field('next').title = summary.next ? `${summary.next.title} · ${dueLabel(summary.next.due, zh())}` : ''
    field('progress').textContent = summary.total ? `${summary.completed}/${summary.total}` : ''
    const percentage = summary.total ? Math.round(summary.completed / summary.total * 100) : 0
    card.style.setProperty('--campus-progress', `${percentage}%`)
    card.querySelector('[role="progressbar"]').setAttribute('aria-valuenow', String(percentage))
    card.querySelector('[role="progressbar"]').setAttribute('aria-label', text('里程碑进度', 'Milestone progress'))
    role('links').replaceChildren(...state.links.slice(0, innerWidth <= 320 ? 2 : 4).map(link => {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = link.title
      button.title = link.url
      button.onclick = () => widget?.open(link.url)
      return button
    }))
    for (const image of card.querySelectorAll('[data-pattern]')) image.hidden = image.dataset.pattern !== (['generic', 'custom'].includes(props.schoolPreset) ? props.genericTheme : school.pattern)
    card.style.setProperty('--campus-photo-opacity', String(props.backgroundStrength / 100))
    card.querySelector('[data-media="background"]').style.objectPosition = `${props.backgroundPosition.x}% ${props.backgroundPosition.y}%`
    card.querySelector('[data-action="add"]').textContent = text('新增事项', 'Add task')
    card.querySelector('[data-action="manage"]').textContent = text('查看全部', 'Manage all')
    if (activeId) card.querySelector(`[data-item-id="${CSS.escape(activeId)}"]`)?.focus()
  } catch (error) { feedback(error.message); role('items').replaceChildren() }
}
function schedule() {
  clearInterval(timer)
  render()
  reminders?.check()
  if (widget && !widget.paused) timer = setInterval(() => { render(); reminders?.check() }, 60000)
}
card.querySelector('[data-action="add"]').onclick = () => requestManage('items')
card.querySelector('[data-action="manage"]').onclick = () => requestManage('items')
widget?.onProps(() => { schedule(); void loadMedia() })
widget?.onState(() => { pending = undefined; clearTimeout(pendingTimer); feedback(''); render(); reminders?.check() })
widget?.onSize(render)
widget?.onPause(paused => { clearInterval(timer); if (paused) releaseMedia(); else { schedule(); void loadMedia() } })
window.addEventListener('pagehide', () => { clearInterval(timer); clearTimeout(pendingTimer); reminders?.dispose(); releaseMedia() })
schedule()
