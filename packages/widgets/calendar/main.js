/*
 * 月历的脚本。
 *
 * 网格以周一开始，行数按这个月需要的周数算（四周到六周），前后补上邻月的日期。有安排的日期按
 * data.events 点一颗点，今天是一枚圆形底色。翻月只改 state.month（空的表示跟着今天走），经
 * `setState` 交给宿主存下来，页面重挂之后还停在同一月（D5）。
 */
(function () {
  var card = document.querySelector('.calendar-card')
  if (!card) return

  var widget = window.widget
  var NS_WEEKDAYS = 7
  var LIMIT = 200

  var el = {
    kicker: card.querySelector('[data-field="kicker"]'),
    title: card.querySelector('[data-field="title"]'),
    meta: card.querySelector('[data-field="meta"]'),
    month: card.querySelector('[data-field="month"]'),
    weekdays: card.querySelector('[data-role="weekdays"]'),
    grid: card.querySelector('[data-role="grid"]'),
    today: card.querySelector('[data-role="today"]'),
    steps: Array.prototype.slice.call(card.querySelectorAll('.calendar-card__step'))
  }

  var state = { month: '', events: [], meta: '' }

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
      return {
        title: '日程',
        events: [
          { date: todayIso(0), title: '站会', tone: 'accent' },
          { date: todayIso(0), title: '代码评审' },
          { date: todayIso(2), title: '版本发布', tone: 'warn' },
          { date: todayIso(5), title: '季度回顾', tone: 'danger' },
          { date: todayIso(9), title: '客户回访' }
        ]
      }
    }
    return {
      title: 'Schedule',
      events: [
        { date: todayIso(0), title: 'Standup', tone: 'accent' },
        { date: todayIso(0), title: 'Code review' },
        { date: todayIso(2), title: 'Release', tone: 'warn' },
        { date: todayIso(5), title: 'Quarterly review', tone: 'danger' },
        { date: todayIso(9), title: 'Customer call' }
      ]
    }
  }

  function write(node, value) {
    if (node !== undefined && node !== null) node.textContent = value === null || value === undefined ? '' : String(value)
  }

  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate())
  }

  function addDays(date, count) {
    var next = startOfDay(date)
    next.setDate(next.getDate() + count)
    return next
  }

  function pad(value) {
    return value < 10 ? '0' + value : String(value)
  }

  function iso(date) {
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
  }

  function todayIso(offset) {
    return iso(addDays(new Date(), offset))
  }

  function monthKeyOf(date) {
    return date.getFullYear() + '-' + pad(date.getMonth() + 1)
  }

  /** 把 "YYYY-MM" 读成一个月的第一天；读不出来时是 undefined。 */
  function monthOf(key) {
    if (typeof key !== 'string' || !/^\d{4}-\d{2}$/.test(key)) return undefined
    var year = Number(key.slice(0, 4))
    var month = Number(key.slice(5, 7))
    if (month < 1 || month > 12) return undefined
    return new Date(year, month - 1, 1)
  }

  function currentMonth() {
    var stored = monthOf(state.month)
    return stored === undefined ? startOfDay(new Date()) : stored
  }

  function weekdayNames() {
    var format = new Intl.DateTimeFormat(isZh() ? 'zh-CN' : 'en', { weekday: 'short' })
    var names = []
    var monday = new Date(2024, 0, 1)
    for (var index = 0; index < NS_WEEKDAYS; index += 1) {
      names.push(format.format(addDays(monday, index)))
    }
    return names
  }

  function groupEvents(events) {
    var map = {}
    for (var index = 0; index < events.length && index < LIMIT; index += 1) {
      var event = events[index]
      if (event === null || typeof event !== 'object') continue
      if (typeof event.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(event.date)) continue
      if (map[event.date] === undefined) map[event.date] = []
      map[event.date].push(event)
    }
    return map
  }

  function eventTitle(events) {
    var titles = []
    events.forEach(function (event) {
      if (typeof event.title === 'string' && event.title.trim() !== '') titles.push(event.title.trim())
    })
    return titles.join(' · ')
  }

  function buildWeekdays() {
    var cells = weekdayNames().map(function (name) {
      var cell = document.createElement('span')
      cell.textContent = name
      return cell
    })
    el.weekdays.replaceChildren.apply(el.weekdays, cells)
  }

  function render() {
    var base = currentMonth()
    var first = new Date(base.getFullYear(), base.getMonth(), 1)
    var offset = (first.getDay() + 6) % 7
    var daysInMonth = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate()
    var total = Math.ceil((offset + daysInMonth) / 7) * 7
    var start = addDays(first, -offset)
    var todayKey = todayIso(0)
    var events = groupEvents(state.events)
    var cells = []

    for (var index = 0; index < total; index += 1) {
      var day = addDays(start, index)
      var key = iso(day)
      var cell = document.createElement('div')
      cell.className = 'calendar-card__day'
      cell.setAttribute('role', 'gridcell')
      if (day.getMonth() !== base.getMonth()) cell.dataset.outside = ''
      if (key === todayKey) cell.dataset.today = ''
      var number = document.createElement('span')
      number.className = 'calendar-card__number'
      number.textContent = String(day.getDate())
      cell.appendChild(number)
      var planned = events[key]
      if (planned !== undefined) {
        var dots = document.createElement('span')
        dots.className = 'calendar-card__dots'
        planned.slice(0, 3).forEach(function (event) {
          var dot = document.createElement('span')
          dot.className = 'calendar-card__dot'
          if (event.tone === 'warn' || event.tone === 'danger') dot.dataset.tone = event.tone
          dots.appendChild(dot)
        })
        cell.appendChild(dots)
        cell.title = eventTitle(planned)
        cell.setAttribute('aria-label', key + ' · ' + cell.title)
      } else {
        cell.setAttribute('aria-label', key)
      }
      cells.push(cell)
    }

    el.grid.replaceChildren.apply(el.grid, cells)
    write(el.month, new Intl.DateTimeFormat(isZh() ? 'zh-CN' : 'en', { year: 'numeric', month: 'long' }).format(base))
    var total = countEvents(events)
    write(el.meta, state.meta !== '' ? state.meta : isZh() ? total + ' 个安排' : total + (total === 1 ? ' event' : ' events'))
  }

  function countEvents(events) {
    var total = 0
    Object.keys(events).forEach(function (key) { total += events[key].length })
    return total
  }

  function applyProps(source) {
    var base = defaults()
    var props = source !== null && typeof source === 'object' ? source : {}
    write(el.kicker, typeof props.kicker === 'string' ? props.kicker : '')
    write(el.title, typeof props.title === 'string' && props.title.trim() !== '' ? props.title : base.title)
    state.meta = typeof props.meta === 'string' ? props.meta : ''
  }

  function applyData(source) {
    var base = defaults()
    var data = source !== null && typeof source === 'object' ? source : {}
    state.events = Array.isArray(data.events) ? data.events : base.events
    render()
  }

  function setMonth(key) {
    state.month = key
    render()
    if (widget !== undefined) widget.setState({ month: key })
  }

  function step(delta) {
    var base = currentMonth()
    setMonth(monthKeyOf(new Date(base.getFullYear(), base.getMonth() + delta, 1)))
  }

  el.steps.forEach(function (button) {
    button.addEventListener('click', function () { step(Number(button.dataset.step)) })
  })
  el.today.addEventListener('click', function () { setMonth('') })

  el.steps[0].setAttribute('aria-label', label('previous', '上个月'))
  el.steps[1].setAttribute('aria-label', label('next', '下个月'))
  write(el.today, label('today', '今天'))

  applyProps(widget === undefined ? {} : widget.props)
  buildWeekdays()
  applyData(widget === undefined ? null : widget.data)
  if (widget !== undefined) {
    widget.onProps(function (props) {
      applyProps(props)
      render()
    })
    widget.onData(applyData)
    widget.onState(function (value) {
      if (value === null || typeof value !== 'object') return
      state.month = monthOf(value.month) === undefined ? '' : value.month
      render()
    })
  }
})()
