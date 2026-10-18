/*
 * 翻页时钟的脚本。
 *
 * 时间从 Date 读，不按滴答累加：页面被节流之后回来仍然是对的时刻。时与分是四个翻页数字格，
 * 数字变大向上翻、变小向下翻；秒用套件的数字滚动原语。动的几何与时长都由套件提供，这里只决定
 * 什么时候翻哪一格。
 *
 * props.zone 是 IANA 时区名，留空就是本地时间；读不出来的名字按本地时间显示，并在 meta 的提示里
 * 说明，不让整张卡挂掉（D11）。
 */
(function () {
  var card = document.querySelector('.clock-card')
  if (!card) return

  var widget = window.widget
  var root = document.documentElement
  var TICK_MS = 250

  var el = {
    kicker: card.querySelector('[data-field="kicker"]'),
    title: card.querySelector('[data-field="title"]'),
    meta: card.querySelector('[data-field="meta"]'),
    time: card.querySelector('[data-role="time"]'),
    date: card.querySelector('[data-field="date"]')
  }

  var state = { zone: '', showSeconds: true, drawn: '', first: true }
  var cells = []
  var seconds = null
  var timeFormat = null
  var dateFormat = null
  var timer = 0

  function isZh() {
    return widget === undefined || String(widget.lang || 'zh').toLowerCase().indexOf('zh') === 0
  }

  function label(key, fallback) {
    if (widget === undefined) return fallback
    var value = widget.t(key)
    return value === key ? fallback : value
  }

  function write(node, value) {
    if (node !== undefined && node !== null) node.textContent = value === null || value === undefined ? '' : String(value)
  }

  function ms(name, fallback) {
    var value = parseFloat(getComputedStyle(root).getPropertyValue(name))
    return isFinite(value) ? value : fallback
  }

  function reduced() {
    return root.getAttribute('data-motion') === 'reduced'
  }

  /** 用户给的时区名先试一次 Intl；不合法时退回本地时间，并让调用处把原因挂到 meta 上。 */
  function zoneOf(props) {
    var zone = typeof props.zone === 'string' ? props.zone.trim() : ''
    if (zone === '') return { zone: '', invalid: false }
    try {
      new Intl.DateTimeFormat('en-GB', { timeZone: zone }).format(new Date())
      return { zone: zone, invalid: false }
    } catch (error) {
      return { zone: '', invalid: true }
    }
  }

  function shortZone(zone) {
    var parts = zone.split('/')
    return parts[parts.length - 1].replace(/_/g, ' ')
  }

  function half(part, value) {
    var node = document.createElement('span')
    node.className = 't-flip-half'
    node.dataset.half = part
    node.textContent = value
    return node
  }

  function leaf(part, value, role) {
    var node = document.createElement('span')
    node.className = 't-flip-page'
    node.dataset.half = part
    node.dataset.role = role
    node.textContent = value
    return node
  }

  function settle(cell, to) {
    if (cell.dataset.value !== to) return
    cell.removeAttribute('data-dir')
    cell.replaceChildren(half('top', to), half('bottom', to))
  }

  /** 一个数字格换成新值：变大的翻页上去，变小的翻页下来。 */
  function flip(cell, from, to) {
    var up = Number(to) > Number(from)
    cell.dataset.dir = up ? 'up' : 'down'
    cell.replaceChildren(
      half('top', up ? from : to),
      half('bottom', up ? to : from),
      leaf(up ? 'bottom' : 'top', from, 'out'),
      leaf(up ? 'top' : 'bottom', to, 'in')
    )
    if (reduced()) { settle(cell, to); return }
    setTimeout(function () { settle(cell, to) }, ms('--w-motion-flip', 320))
  }

  function setSeconds(text) {
    if (seconds === null) return
    if (seconds.textContent === text) return
    if (state.first || reduced()) {
      seconds.textContent = text
      return
    }
    seconds.classList.remove('is-animating')
    seconds.replaceChildren()
    text.split('').forEach(function (character) {
      var digit = document.createElement('span')
      digit.className = 't-digit'
      digit.textContent = character
      seconds.appendChild(digit)
    })
    void seconds.offsetHeight
    seconds.classList.add('is-animating')
  }

  function addCell() {
    var cell = document.createElement('span')
    cell.className = 'clock-card__digit t-flip'
    cell.dataset.value = '0'
    cell.append(half('top', '0'), half('bottom', '0'))
    el.time.appendChild(cell)
    cells.push(cell)
  }

  /** 四个数字格与中间那个冒号只建一次；秒跟着设置一起出现。 */
  function buildTime() {
    el.time.replaceChildren()
    cells = []
    seconds = null
    addCell()
    addCell()
    var colon = document.createElement('span')
    colon.className = 'clock-card__colon'
    colon.textContent = ':'
    el.time.appendChild(colon)
    addCell()
    addCell()
    if (state.showSeconds) {
      seconds = document.createElement('span')
      seconds.className = 'clock-card__seconds t-digit-group'
      seconds.textContent = '00'
      el.time.appendChild(seconds)
    }
  }

  function buildFormatters() {
    var zone = state.zone === '' ? undefined : state.zone
    timeFormat = new Intl.DateTimeFormat('en-GB', {
      timeZone: zone,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    })
    dateFormat = new Intl.DateTimeFormat(isZh() ? 'zh-CN' : 'en', {
      timeZone: zone,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })
  }

  function partsOf(date) {
    var parts = timeFormat.formatToParts(date)
    var out = {}
    parts.forEach(function (part) { out[part.type] = part.value })
    return { hour: out.hour, minute: out.minute, second: out.second }
  }

  function paint(date) {
    var parts = partsOf(date)
    var stamp = parts.hour + ':' + parts.minute
    if (stamp !== state.drawn) {
      state.drawn = stamp
      var digits = [parts.hour.charAt(0), parts.hour.charAt(1), parts.minute.charAt(0), parts.minute.charAt(1)]
      digits.forEach(function (digit, index) {
        var cell = cells[index]
        var from = cell.dataset.value
        if (from === digit) return
        cell.dataset.value = digit
        flip(cell, from, digit)
      })
    }
    setSeconds(parts.second)
    state.first = false
    write(el.date, dateFormat.format(date))
  }

  function tick() {
    paint(new Date())
  }

  function start() {
    if (timer === 0) timer = setInterval(tick, TICK_MS)
  }

  function stop() {
    if (timer === 0) return
    clearInterval(timer)
    timer = 0
  }

  function applyProps(source) {
    var props = source !== null && typeof source === 'object' ? source : {}
    var found = zoneOf(props)
    state.showSeconds = props.showSeconds !== false
    write(el.kicker, typeof props.kicker === 'string' ? props.kicker : '')
    write(el.title, typeof props.title === 'string' && props.title.trim() !== '' ? props.title : label('zone', isZh() ? '本地时间' : 'Local time'))
    var meta = typeof props.meta === 'string' ? props.meta : ''
    write(el.meta, meta !== '' ? meta : (found.zone !== '' ? shortZone(found.zone) : (isZh() ? '本地' : 'Local')))
    el.meta.title = found.invalid ? label('invalidZone', '') : ''
    state.zone = found.zone
    state.drawn = ''
    state.first = true
    buildFormatters()
    buildTime()
    tick()
  }

  applyProps(widget === undefined ? {} : widget.props)
  if (widget !== undefined) {
    widget.onProps(applyProps)
    widget.onPause(function (paused) {
      if (paused) { stop(); return }
      tick()
      start()
    })
  }
  if (widget === undefined || widget.paused !== true) start()
})()
