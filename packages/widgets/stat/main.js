/*
 * 数字卡的脚本：把 data 里的数字与说明填进来，props 改标题区文案。
 *
 * 数据源给的是真实用量时，主数字、单位、趋势与说明都按它写；没有数据时用一份随语言变化的示例。
 * 大数字用紧凑写法（12.4k、1.8M），窄盒子里读数不致顶破。推送新 data 时整块重画，不做补间。
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

  /** 数据源给了 value 时按真实用量写，否则按自带示例写。 */
  var live = false

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

  /** 统计项：只有调用次数与 Token 用量两种。 */
  function metricOf(props) {
    return props !== null && typeof props === 'object' && props.metric === 'tokens' ? 'tokens' : 'calls'
  }

  /** 真实用量下的标题：按统计项说近七天的调用次数或 Token 用量。 */
  function usageTitle(metric) {
    if (isZh()) return metric === 'tokens' ? '近 7 天 Token' : '近 7 天调用'
    return metric === 'tokens' ? 'Tokens · last 7 days' : 'Calls · last 7 days'
  }

  /** 大数字用紧凑写法：12400 写成 12.4k，1842000 写成 1.8M。 */
  function readable(value) {
    if (typeof value !== 'number' || !isFinite(value)) return String(value)
    if (Math.abs(value) > 10000) {
      var millions = Math.abs(value) >= 1000000
      var scaled = millions ? value / 1000000 : value / 1000
      return scaled.toFixed(1).replace(/\.0$/, '') + (millions ? 'M' : 'k')
    }
    return new Intl.NumberFormat(isZh() ? 'zh-CN' : 'en-US').format(value)
  }

  function write(node, value) {
    if (node !== undefined && node !== null) node.textContent = value === null || value === undefined ? '' : String(value)
  }

  function applyProps(source) {
    var props = source !== null && typeof source === 'object' ? source : {}
    var fallback = live ? usageTitle(metricOf(props)) : defaults().title
    write(fields.kicker, typeof props.kicker === 'string' ? props.kicker : '')
    write(fields.title, typeof props.title === 'string' && props.title.trim() !== '' ? props.title : fallback)
    write(fields.meta, typeof props.meta === 'string' ? props.meta : '')
  }

  function applyData(source) {
    var base = defaults()
    var data = source !== null && typeof source === 'object' ? source : {}
    live = data.value !== undefined && data.value !== null
    var value = live ? data.value : base.value
    var unit = live ? (typeof data.unit === 'string' ? data.unit : '') : base.unit
    var delta = live ? (typeof data.delta === 'number' && isFinite(data.delta) ? data.delta : null) : base.delta
    var note = live ? (typeof data.note === 'string' ? data.note : '') : base.note
    var caption = live ? (typeof data.caption === 'string' ? data.caption : '') : base.caption
    write(fields.value, live ? readable(value) : value)
    write(fields.unit, unit)
    write(fields.delta, delta === null ? '' : (delta > 0 ? '+' : '') + delta + '%')
    write(fields.note, note)
    write(fields.caption, caption)
    card.dataset.trend = delta === null || delta === 0 ? 'flat' : delta > 0 ? 'up' : 'down'
    if (fields.trend !== undefined) fields.trend.hidden = delta === null
    if (fields.unit !== undefined) fields.unit.hidden = unit === ''
    if (fields.caption !== undefined) fields.caption.hidden = caption === ''
    applyProps(widget === undefined ? {} : widget.props)
  }

  applyProps(widget === undefined ? {} : widget.props)
  applyData(widget === undefined ? null : widget.data)
  if (widget !== undefined) {
    widget.onProps(applyProps)
    widget.onData(applyData)
  }
})()
