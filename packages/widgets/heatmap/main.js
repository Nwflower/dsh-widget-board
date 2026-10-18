/*
 * 热力图的脚本：把 data.days 铺成最近若干周的格子。
 *
 * 窗口以今天所在的周一结尾，往前数周数；周数按盒子的宽度档位挑（窄 16、常规 26、宽 53），
 * 尺寸变化时重排。今天之后的日子留空，今天的格子加一圈描边。没有有效数据时显示空状态。
 */
(function () {
  var card = document.querySelector('.heatmap-card')
  if (!card) return

  var widget = window.widget
  var root = document.documentElement
  var LIMIT = 400

  var el = {
    kicker: card.querySelector('[data-field="kicker"]'),
    title: card.querySelector('[data-field="title"]'),
    meta: card.querySelector('[data-field="meta"]'),
    grid: card.querySelector('[data-role="grid"]'),
    caption: card.querySelector('[data-field="caption"]'),
    less: card.querySelector('[data-field="less"]'),
    more: card.querySelector('[data-field="more"]'),
    foot: card.querySelector('[data-role="foot"]'),
    empty: card.querySelector('[data-role="empty"]')
  }

  var state = { days: {}, caption: '', meta: '' }

  var formatDay = new Intl.DateTimeFormat(isZh() ? 'zh-CN' : 'en', { month: 'short', day: 'numeric' })

  function isZh() {
    return widget === undefined || String(widget.lang || 'zh').toLowerCase().indexOf('zh') === 0
  }

  function label(key, fallback) {
    if (widget === undefined) return fallback
    var value = widget.t(key)
    return value === key ? fallback : value
  }

  function emptyLabel() {
    return label('empty', isZh() ? '暂无记录' : 'No activity')
  }

  function defaults() {
    if (isZh()) {
      return { title: '活动', caption: '' }
    }
    return { title: 'Activity', caption: '' }
  }

  function write(node, value) {
    if (node !== undefined && node !== null) node.textContent = value === null || value === undefined ? '' : String(value)
  }

  function applyProps(source) {
    var base = defaults()
    var props = source !== null && typeof source === 'object' ? source : {}
    write(el.kicker, typeof props.kicker === 'string' ? props.kicker : '')
    write(el.title, typeof props.title === 'string' && props.title.trim() !== '' ? props.title : base.title)
    state.meta = typeof props.meta === 'string' && props.meta.trim() !== '' ? props.meta : ''
  }

  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate())
  }

  function addDays(date, count) {
    var next = startOfDay(date)
    next.setDate(next.getDate() + count)
    return next
  }

  function iso(date) {
    var month = date.getMonth() + 1
    var day = date.getDate()
    return date.getFullYear() + '-' + (month < 10 ? '0' + month : month) + '-' + (day < 10 ? '0' + day : day)
  }

  /** 演示数据：最近 53 周的固定模式，按日期算出来，不随机。 */
  function demoDays() {
    var days = {}
    var end = startOfDay(new Date())
    for (var index = 0; index < 371; index += 1) {
      var day = addDays(end, -index)
      days[iso(day)] = demoValue(day)
    }
    return days
  }

  function demoValue(day) {
    var seed = day.getFullYear() * 372 + (day.getMonth() + 1) * 31 + day.getDate()
    var noise = ((seed * 9301 + 49297) % 233280) / 233280
    if ((day.getDay() + 6) % 7 >= 5) noise *= 0.35
    return noise < 0.18 ? 0 : Math.round(noise * 8)
  }

  function weeksFor() {
    var width = root.getAttribute('data-box-width')
    if (width === 'narrow') return 16
    if (width === 'wide') return 53
    return 26
  }

  function levelOf(value, max) {
    if (value <= 0) return 0
    return Math.min(4, Math.max(1, Math.ceil((value / max) * 4)))
  }

  function countText(template, count) {
    return template.replace('{n}', String(count))
  }

  /** 连续天数：从今天往前数；今天还没有记录时从昨天算起。 */
  function streakOf(days, end) {
    var cursor = end
    if (!(days[iso(cursor)] > 0)) cursor = addDays(cursor, -1)
    var count = 0
    while ((days[iso(cursor)] || 0) > 0) {
      count += 1
      cursor = addDays(cursor, -1)
    }
    return count
  }

  function render() {
    var days = state.days
    var weeks = weeksFor()
    var end = startOfDay(new Date())
    var first = addDays(end, -((end.getDay() + 6) % 7) - (weeks - 1) * 7)
    var total = 0
    var active = 0
    var max = 1
    var index = 0

    for (index = 0; index < weeks * 7; index += 1) {
      var probe = addDays(first, index)
      var probeValue = probe > end ? 0 : (days[iso(probe)] || 0)
      if (probeValue > max) max = probeValue
      if (probeValue > 0) {
        total += probeValue
        active += 1
      }
    }

    var todayKey = iso(end)
    var columns = []
    for (var column = 0; column < weeks; column += 1) {
      var week = document.createElement('div')
      week.className = 'heatmap-card__week'
      for (var row = 0; row < 7; row += 1) {
        var day = addDays(first, column * 7 + row)
        var key = iso(day)
        var value = day > end ? 0 : (days[key] || 0)
        var cell = document.createElement('span')
        cell.className = 'heatmap-card__cell'
        cell.dataset.level = String(levelOf(value, max))
        if (day > end) cell.dataset.future = ''
        else if (key === todayKey) cell.dataset.today = ''
        cell.title = formatDay.format(day) + (value > 0 ? ' · ' + value : '')
        week.appendChild(cell)
      }
      columns.push(week)
    }

    var summary = [
      countText(label('total', '共 {n} 次'), total),
      countText(label('active', '{n} 天有记录'), active)
    ]
    var streak = streakOf(days, end)
    if (streak > 0) summary.push(countText(label('streak', '连续 {n} 天'), streak))

    el.grid.replaceChildren.apply(el.grid, columns)
    el.grid.setAttribute('aria-label', summary.join('，'))
    write(el.caption, state.caption !== '' ? state.caption : summary.join(' · '))
    write(el.less, label('less', '少'))
    write(el.more, label('more', '多'))
    write(el.meta, state.meta !== '' ? state.meta : isZh() ? weeks + ' 周' : weeks + ' weeks')

    var empty = Object.keys(days).length === 0
    el.grid.hidden = empty
    el.foot.hidden = empty
    el.empty.hidden = !empty
    el.empty.textContent = emptyLabel()
    if (empty) el.grid.replaceChildren()
  }

  function applyData(source) {
    var data = source !== null && typeof source === 'object' ? source : {}
    var provided = Array.isArray(data.days)
    var days = {}
    if (provided) {
      for (var index = 0; index < data.days.length && index < LIMIT; index += 1) {
        var item = data.days[index]
        if (item === null || typeof item !== 'object') continue
        if (typeof item.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(item.date)) continue
        if (typeof item.value !== 'number' || !isFinite(item.value)) continue
        days[item.date] = Math.max(0, item.value)
      }
    }
    state.days = provided ? days : demoDays()
    state.caption = typeof data.caption === 'string' && data.caption.trim() !== '' ? data.caption : ''
    render()
  }

  applyProps(widget === undefined ? {} : widget.props)
  applyData(widget === undefined ? null : widget.data)
  if (widget !== undefined) {
    widget.onProps(function (props) {
      applyProps(props)
      render()
    })
    widget.onData(applyData)
    widget.onSize(render)
  }
})()
