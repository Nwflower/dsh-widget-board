/*
 * 月历的脚本。
 *
 * 日期格两行：公历日号与农历。第二行按「节气 → 节日 → 初一写月名 → 农历日」取一条，所以节气与
 * 节日一个月里一眼看得出来；农历与节气由 lunar-javascript 算（`lunar.js`，经 manifest 的
 * `scripts` 在本脚本之前内联），这里不重写历法。
 *
 * 先画的总是今天所在的月；翻月只改内存里的月份，不写宿主。日期格里的字由 `fitType` 按网格实际
 * 的格子算出来，写进卡片根上的 `--cal-u*` 变量，CSS 只读这些变量。
 */
(function () {
  var card = document.querySelector('.cal')
  if (!card) return
  if (typeof Solar === 'undefined') throw new Error('农历库没有加载：Solar 不在全局作用域里')

  var widget = window.widget
  var LIMIT = 200
  var WEEKDAYS = 7

  /** 只把大家认得的节日写进日期格；「世界住房日」这类不进。 */
  var FESTIVAL = /春节|元宵|龙抬头|端午|七夕|中元|中秋|重阳|腊八|小年|除夕|元旦|清明|劳动节|青年节|儿童节|教师节|国庆节|妇女节|植树节|母亲节|父亲节|感恩节|平安夜|圣诞节|情人节/

  var el = {
    month: card.querySelector('[data-field="month"]'),
    year: card.querySelector('[data-field="year"]'),
    sub: card.querySelector('[data-field="sub"]'),
    week: card.querySelector('[data-role="week"]'),
    grid: card.querySelector('[data-role="grid"]'),
    today: card.querySelector('[data-role="today"]'),
    steps: Array.prototype.slice.call(card.querySelectorAll('.cal-btn--step'))
  }

  var state = { month: '', events: [] }
  var props = {}
  /** 上一次写进卡片的字号：写回去的值引起排版变化时，用它挡住来回震荡。 */
  var lastType = { u: 0, lu: 0 }
  var pendingFrame = 0
  var resizeObserver = new ResizeObserver(function () { scheduleType() })
  resizeObserver.observe(el.grid)

  function isZh() {
    return widget === undefined || String(widget.lang || 'zh').toLowerCase().indexOf('zh') === 0
  }

  function label(key, fallback) {
    if (widget === undefined) return fallback
    var value = widget.t(key)
    return value === key ? fallback : value
  }

  function write(node, value) {
    if (node === null || node === undefined) return
    node.textContent = value === null || value === undefined ? '' : String(value)
  }

  function pad(value) {
    return value < 10 ? '0' + value : String(value)
  }

  function iso(date) {
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
  }

  function monthKeyOf(date) {
    return date.getFullYear() + '-' + pad(date.getMonth() + 1)
  }

  function monthOf(key) {
    if (typeof key !== 'string' || !/^\d{4}-\d{2}$/.test(key)) return undefined
    var year = Number(key.slice(0, 4))
    var month = Number(key.slice(5, 7))
    if (month < 1 || month > 12) return undefined
    return new Date(year, month - 1, 1)
  }

  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate())
  }

  function addDays(date, count) {
    var next = startOfDay(date)
    next.setDate(next.getDate() + count)
    return next
  }

  function baseMonth() {
    var stored = monthOf(state.month)
    return stored === undefined ? new Date() : stored
  }

  /** 一周从周几起：props.weekStart 是 `sun` 时从周日起，其余从周一起。 */
  function weekOffset() {
    return props.weekStart === 'sun' ? 0 : 1
  }

  /** 某一天的农历事实；字段名与 lunar-javascript 的读法一一对应。 */
  function lunarOf(date) {
    var solar = Solar.fromYmd(date.getFullYear(), date.getMonth() + 1, date.getDate())
    var lunar = solar.getLunar()
    var jieQi = lunar.getJieQi()
    var festivals = solar.getFestivals().concat(lunar.getFestivals(), lunar.getOtherFestivals())
    var festival = ''
    for (var index = 0; index < festivals.length; index += 1) {
      if (FESTIVAL.test(festivals[index])) { festival = festivals[index]; break }
    }
    var dayCn = lunar.getDayInChinese()
    // 闰月由库以负的月号给出，读成「闰六月」才是这一年的写法。
    var month = lunar.getMonth()
    var monthName = (month < 0 ? '闰' : '') + lunar.getMonthInChinese() + '月'
    var kind = jieQi !== '' ? 'jieqi' : festival !== '' ? 'festival' : dayCn === '初一' ? 'month' : 'lunar'
    var text = jieQi !== '' ? jieQi : festival !== '' ? festival : dayCn === '初一' ? monthName : dayCn
    return {
      kind: kind,
      text: text,
      monthName: monthName,
      yearGanZhi: lunar.getYearInGanZhi(),
      yearShengXiao: lunar.getYearShengXiao()
    }
  }

  /** 按日期把日程分组。 */
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

  function buildWeek() {
    var format = new Intl.DateTimeFormat(isZh() ? 'zh-CN' : 'en', { weekday: 'short' })
    var monday = new Date(2024, 0, 1)
    var cells = []
    for (var index = 0; index < WEEKDAYS; index += 1) {
      var cell = document.createElement('span')
      var weekday = (index + weekOffset()) % WEEKDAYS
      cell.textContent = format.format(addDays(monday, weekday))
      if (weekday >= 5) cell.setAttribute('data-weekend', '')
      cells.push(cell)
    }
    el.week.replaceChildren.apply(el.week, cells)
  }

  function dayCell(date, base, todayKey, events) {
    var key = iso(date)
    var info = lunarOf(date)
    var cell = document.createElement('div')
    cell.className = 'cal-day'
    cell.setAttribute('role', 'gridcell')
    cell.dataset.date = key
    if (date.getMonth() !== base.getMonth()) cell.dataset.outside = ''
    if (key === todayKey) cell.dataset.today = ''

    var number = document.createElement('span')
    number.className = 'cal-day__num'
    number.textContent = String(date.getDate())
    cell.appendChild(number)

    var lunar = document.createElement('span')
    lunar.className = 'cal-day__lunar'
    lunar.dataset.kind = info.kind
    lunar.textContent = info.text
    cell.appendChild(lunar)

    var planned = events[key]
    if (planned !== undefined) {
      var marks = document.createElement('span')
      marks.className = 'cal-day__marks'
      var list = document.createElement('span')
      list.className = 'cal-day__events'
      planned.slice(0, 3).forEach(function (event) {
        var dot = document.createElement('span')
        dot.className = 'cal-day__dot'
        if (event.tone === 'warn' || event.tone === 'danger') dot.dataset.tone = event.tone
        marks.appendChild(dot)
        if (typeof event.title === 'string' && event.title.trim() !== '') {
          var bar = document.createElement('span')
          bar.className = 'cal-day__event'
          if (event.tone === 'warn' || event.tone === 'danger') bar.dataset.tone = event.tone
          bar.textContent = event.title.trim()
          list.appendChild(bar)
        }
      })
      cell.appendChild(marks)
      cell.appendChild(list)
    }

    var titles = planned === undefined ? [] : planned.map(function (event) { return event.title })
    cell.setAttribute('aria-label', [key, info.text].concat(titles).join('，'))
    return cell
  }

  /**
   * 按网格的实际格子定字号：日号与第二行各算一对宽高，写回卡片根上的变量。
   *
   * 字号会反过来影响排版，所以两处一起防震荡：写之前先比上一次的值，差不到半像素就不写；写这一
   * 步排在一帧之后，一次布局里只量一次。少了这两条，量、写、再量会自己绕圈。
   */
  function fitType() {
    var rect = el.grid.getBoundingClientRect()
    var rows = Number(el.grid.style.getPropertyValue('--rows')) || 6
    var gap = parseFloat(getComputedStyle(el.grid).rowGap) || 0
    var cellH = (rect.height - gap * (rows - 1)) / rows
    var cellW = (rect.width - gap * (WEEKDAYS - 1)) / WEEKDAYS
    if (cellH <= 0 || cellW <= 0) return
    var short = (widget !== undefined && widget.size !== null && widget.size.h > 0 ? widget.size.h : window.innerHeight) < 260
    // 有农历行时整格分给两行（日号占约 1.6 倍字高、农历约 1.1 倍）；矮盒子只剩一行，日号可以占得更满。
    var unitH = cellH * (short ? 0.62 : 0.38)
    var unitW = cellW * (short ? 0.4 : 0.34)
    var lunarH = Math.min(cellH * 0.22, unitH * 0.58)
    var lunarW = cellW * 0.32
    if (Math.abs(unitH - lastType.u) < 0.5 && Math.abs(lunarH - lastType.lu) < 0.5) return
    lastType = { u: unitH, lu: lunarH }
    card.style.setProperty('--cal-u-h', unitH.toFixed(2) + 'px')
    card.style.setProperty('--cal-u-w', unitW.toFixed(2) + 'px')
    card.style.setProperty('--cal-lu-h', lunarH.toFixed(2) + 'px')
    card.style.setProperty('--cal-lu-w', lunarW.toFixed(2) + 'px')
  }

  /** 量字号排到下一帧：一次布局里只量一次，也不在观察者的回调里改排版。 */
  function scheduleType() {
    if (pendingFrame !== 0) return
    pendingFrame = window.requestAnimationFrame(function () {
      pendingFrame = 0
      fitType()
    })
  }

  function render() {
    var base = baseMonth()
    var first = new Date(base.getFullYear(), base.getMonth(), 1)
    var offset = (first.getDay() - weekOffset() + WEEKDAYS) % WEEKDAYS
    var daysInMonth = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate()
    var rows = Math.ceil((offset + daysInMonth) / WEEKDAYS)
    var start = addDays(first, -offset)
    var todayKey = iso(new Date())
    var events = groupEvents(state.events)
    var cells = []

    el.grid.style.setProperty('--rows', String(rows))
    for (var index = 0; index < rows * WEEKDAYS; index += 1) {
      cells.push(dayCell(addDays(start, index), base, todayKey, events))
    }
    el.grid.replaceChildren.apply(el.grid, cells)

    var monthInfo = lunarOf(first)
    write(el.month, new Intl.DateTimeFormat(isZh() ? 'zh-CN' : 'en', { month: 'long' }).format(base))
    write(el.year, String(base.getFullYear()))
    write(el.sub, '农历' + monthInfo.monthName + ' · ' + monthInfo.yearGanZhi + monthInfo.yearShengXiao + '年')
    scheduleType()
  }

  /** 很矮的盒子连标题一起收掉，只画网格。 */
  function applyBox(size) {
    if (size === null || size === undefined) return
    var height = size.h > 0 ? size.h : window.innerHeight
    card.toggleAttribute('data-compact', height < 150)
    // 档位换了之后字号要重新算：清掉上一次的值，免得被半像素的容差挡住。
    lastType = { u: 0, lu: 0 }
    scheduleType()
  }

  function applyProps(source) {
    props = source !== null && typeof source === 'object' ? source : {}
    buildWeek()
  }

  /**
   * 卡片上的日程：没有数据就一条都不画。
   *
   * 月历不编自己的样例日程——格子里冒出来的点会被当成真的安排。要看日程就经数据源或 `widget_push`
   * 推一份 `events` 进来（D6）。
   */
  function applyData(source) {
    var data = source !== null && typeof source === 'object' ? source : {}
    state.events = Array.isArray(data.events) ? data.events : []
  }

  function setMonth(key) {
    state.month = key
    render()
  }

  function step(delta) {
    var base = baseMonth()
    setMonth(monthKeyOf(new Date(base.getFullYear(), base.getMonth() + delta, 1)))
  }

  el.steps.forEach(function (button) {
    button.addEventListener('click', function () { step(Number(button.dataset.step)) })
  })
  el.today.addEventListener('click', function () { setMonth('') })

  el.steps[0].setAttribute('aria-label', label('previous', '上个月'))
  el.steps[1].setAttribute('aria-label', label('next', '下个月'))
  write(el.today, label('today', '今天'))

  applyBox(widget === undefined ? null : widget.size)
  applyProps(widget === undefined ? {} : widget.props)
  applyData(widget === undefined ? null : widget.data)
  render()

  if (widget !== undefined) {
    widget.onProps(function (next) { applyProps(next); render() })
    widget.onData(function (next) { applyData(next); render() })
    widget.onSize(applyBox)
  }
})()
