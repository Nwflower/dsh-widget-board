/* setState没有回执：只在onState收到已保存ledger后通知；超时显示错误，不反复尝试。 */
import { campusProps, campusState } from '@dsh-widget-board/model/campus/model'
import { reminderPlan, reminderVersion } from '@dsh-widget-board/model/campus/reminders'

export function createCampusReminders(widget, feedback) {
  let pending
  let failure = ''
  let disposed = false
  const zh = () => widget.lang.startsWith('zh')
  const unavailable = () => disposed || !widget.size || widget.size.placement !== 'board'
  const cancel = () => { if (pending) clearTimeout(pending.timer); pending = undefined }
  function observe() {
    if (unavailable()) return
    if (failure) { feedback(failure); return }
    if (!pending) return
    const props = campusProps(widget.props)
    const state = campusState(widget.state)
    if (pending.version !== reminderVersion(props, state)) { cancel(); return }
    const keys = Object.keys(pending.ledger)
    const saved = keys.length === Object.keys(state.reminderLedger).length && keys.every(key => state.reminderLedger[key] === pending.ledger[key])
    if (!saved) return
    clearTimeout(pending.timer)
    if (widget.paused) return
    const due = pending.due
    cancel()
    if (!due.length || !props.reminderEnabled) return
    widget.notify({ title: zh() ? `校园事项提醒 · ${due.length}项` : `Campus reminder · ${due.length} items`, body: due.slice(0, 3).map(item => item.title).join('；') + (due.length > 3 ? zh() ? '；请打开看板查看其余事项' : '; open the board for more' : '') })
  }
  function check() {
    if (unavailable()) return
    if (failure) { feedback(failure); return }
    try {
      observe()
      if (pending || widget.paused) return
      const props = campusProps(widget.props)
      const state = campusState(widget.state)
      const plan = reminderPlan(props, state, Date.now())
      if (!plan.changed) return
      campusState({ ...state, reminderLedger: plan.ledger })
      pending = { ...plan, version: reminderVersion(props, state), timer: setTimeout(() => {
        cancel()
        failure = zh() ? '提醒记录尚未保存确认，已停止本卡提醒；请在保存成功后重新打开看板。' : 'Reminder records were not confirmed. Reminders stopped; reopen the board after saving succeeds.'
        feedback(failure)
      }, 8000) }
      widget.setState({ reminderLedger: plan.ledger })
    } catch (error) {
      cancel()
      failure = `${zh() ? '提醒已停止：' : 'Reminders stopped: '}${error.message}`
      feedback(failure)
    }
  }
  return { check, observe, dispose() { disposed = true; cancel() } }
}
