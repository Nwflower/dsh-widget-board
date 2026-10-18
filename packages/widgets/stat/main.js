/*
 * 数字卡的脚本：把 data 里的数字与说明填进来，props 改标题区文案。
 *
 * 没有数据时用一份随语言变化的示例；推送新 data 时整块重画，不做进度条式的补间。
 */
(function () {
  var card = document.querySelector('.stat')
  if (!card) return

  var widget = window.widget
  var fields = {}
  var nodes = card.querySelectorAll('[data-field]')
  for (var index = 0; index < nodes.length; index += 1) {
    var key = nodes[index].getAttribute('data-field')
    if (key !== null) fields[key] = nodes[index]
  }

  function isZh() {
    return widget === undefined || String(widget.lang || 'zh').toLowerCase().indexOf('zh') === 0
  }

  function defaults() {
    if (isZh()) {
      return {
        title: '本周专注',
        value: 128,
        unit: '分钟',
        delta: 12,
        note: '较上周',
        caption: '周一至周五 · 专注统计'
      }
    }
    return {
      title: 'Focus this week',
      value: 128,
      unit: 'min',
      delta: 12,
      note: 'vs last week',
      caption: 'Monday to Friday · focus time'
    }
  }

  function write(node, value) {
    if (node !== undefined && node !== null) node.textContent = value === null || value === undefined ? '' : String(value)
  }

  function applyProps(source) {
    var base = defaults()
    var props = source !== null && typeof source === 'object' ? source : {}
    write(fields.kicker, typeof props.kicker === 'string' ? props.kicker : '')
    write(fields.title, typeof props.title === 'string' && props.title.trim() !== '' ? props.title : base.title)
    write(fields.meta, typeof props.meta === 'string' ? props.meta : '')
  }

  function applyData(source) {
    var base = defaults()
    var data = source !== null && typeof source === 'object' ? source : {}
    var value = data.value === undefined || data.value === null ? base.value : data.value
    var unit = typeof data.unit === 'string' && data.unit.trim() !== '' ? data.unit : base.unit
    var delta = typeof data.delta === 'number' && isFinite(data.delta) ? data.delta : base.delta
    var note = typeof data.note === 'string' && data.note.trim() !== '' ? data.note : base.note
    var caption = typeof data.caption === 'string' && data.caption.trim() !== '' ? data.caption : base.caption
    write(fields.value, value)
    write(fields.unit, unit)
    write(fields.delta, (delta > 0 ? '+' : '') + delta + '%')
    write(fields.note, note)
    write(fields.caption, caption)
    card.dataset.trend = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat'
  }

  applyProps(widget === undefined ? {} : widget.props)
  applyData(widget === undefined ? null : widget.data)
  if (widget !== undefined) {
    widget.onProps(applyProps)
    widget.onData(applyData)
  }
})()
