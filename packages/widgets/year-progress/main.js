/*
 * 年度进度的脚本：按今天的日期算今年走了多少。
 *
 * 天用 UTC 的日期差算，跨夏令时不会多出或少掉一天。百分比按整天取整，每分钟重算一次，
 * 跨过午夜之后数字自己往前走。首次画出来的数字不走滚动，之后的变化才播动画。
 */
(function () {
  var card = document.querySelector('.year-card')
  if (!card) return

  var widget = window.widget
  var root = document.documentElement
  var TICK_MS = 60000

  var el = {
    kicker: card.querySelector('[data-field="kicker"]'),
    title: card.querySelector('[data-field="title"]'),
    meta: card.querySelector('[data-field="meta"]'),
    percent: card.querySelector('[data-role="percent"]'),
    track: card.querySelector('[data-role="track"]'),
    fill: card.querySelector('[data-role="fill"]'),
    note: card.querySelector('[data-field="note"]')
  }

  var state = { shown: -1 }

  function isZh() {
    return widget === undefined || String(widget.lang || 'zh').toLowerCase().indexOf('zh') === 0
  }

  function label(key, fallback) {
    if (widget === undefined) return fallback
    var value = widget.t(key)
    return value === key ? fallback : value
  }

  function defaults() {
    if (isZh()) {
      return { kicker: 'YEAR · 13', title: '年度进度' }
    }
    return { kicker: 'YEAR · 13', title: 'Year progress' }
  }

  function write(node, value) {
    if (node !== undefined && node !== null) node.textContent = value === null || value === undefined ? '' : String(value)
  }

  function applyProps(source) {
    var base = defaults()
    var props = source !== null && typeof source === 'object' ? source : {}
    write(el.kicker, typeof props.kicker === 'string' && props.kicker.trim() !== '' ? props.kicker : base.kicker)
    write(el.title, typeof props.title === 'string' && props.title.trim() !== '' ? props.title : base.title)
    return typeof props.meta === 'string' && props.meta.trim() !== '' ? props.meta : ''
  }

  function dayOfYear(date) {
    return Math.floor((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(date.getFullYear(), 0, 1)) / 86400000) + 1
  }

  function daysInYear(year) {
    return (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 86400000
  }

  /** 逐位滚动：新值按位替换，后两位错开出现。 */
  function setDigits(text, instant) {
    var group = el.percent
    if (group.textContent === text) return
    if (instant || root.getAttribute('data-motion') === 'reduced') {
      group.textContent = text
      return
    }
    group.classList.remove('is-animating')
    group.replaceChildren()
    text.split('').forEach(function (character, index) {
      var digit = document.createElement('span')
      digit.className = 't-digit'
      digit.textContent = character
      if (index === text.length - 2) digit.dataset.stagger = '1'
      else if (index === text.length - 1) digit.dataset.stagger = '2'
      group.appendChild(digit)
    })
    void group.offsetHeight
    group.classList.add('is-animating')
  }

  function render() {
    var now = new Date()
    var year = now.getFullYear()
    var day = dayOfYear(now)
    var total = daysInYear(year)
    var percent = Math.min(100, Math.max(0, Math.floor((day / total) * 100)))
    var left = total - day

    setDigits(String(percent), state.shown < 0)
    state.shown = percent
    el.fill.style.width = percent + '%'
    el.track.setAttribute('aria-valuenow', String(percent))
    write(el.note, left <= 0
      ? label('done', isZh() ? '今年已经过完' : 'The year is over')
      : label('note', isZh() ? '第 {day} 天 · 还剩 {left} 天' : 'Day {day} · {left} days left')
        .replace('{day}', String(day))
        .replace('{left}', String(left)))
    var meta = applyProps(widget === undefined ? {} : widget.props)
    write(el.meta, meta !== '' ? meta : String(year))
  }

  applyProps(widget === undefined ? {} : widget.props)
  render()
  if (widget !== undefined) {
    widget.onProps(function (props) {
      applyProps(props)
      render()
    })
  }
  setInterval(render, TICK_MS)
})()
