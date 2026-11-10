/*
 * 日期倒计时的脚本。
 *
 * 目标是一瞬间：`date` 与 `time` 是某个时区里的墙上时间，先在那个时区里读成 UTC 毫秒数再与此刻相减，
 * 所以换个时区看同一张卡，天数会跟着变；Luxon 校验 IANA 时区与夏令时边界。
 *
 * 分钟精度就够，每 15 秒重算一次；暂停时停掉计时器，恢复时按此刻重算再启动（D16）。非法时区和
 * 不存在的墙上时间显示原因；重复时间必须点名 UTC 偏移，不能静默选择（D11）。
 */
import { DateTime } from 'luxon'

(function () {
  var card = document.querySelector('.countdown-card')
  if (!card) return

  var widget = window.widget
  var DEFAULT_ZONE = 'Asia/Shanghai'
  var TICK_MS = 15000
  var MINUTE = 60000
  var DAY_MINUTES = 1440

  var el = {
    kicker: card.querySelector('[data-field="kicker"]'),
    title: card.querySelector('[data-field="title"]'),
    target: card.querySelector('[data-field="target"]'),
    units: card.querySelector('[data-role="units"]'),
    days: card.querySelector('[data-role="days"]'),
    hours: card.querySelector('[data-role="hours"]'),
    minutes: card.querySelector('[data-role="minutes"]'),
    daysLabel: card.querySelector('[data-field="days-label"]'),
    hoursLabel: card.querySelector('[data-field="hours-label"]'),
    minutesLabel: card.querySelector('[data-field="minutes-label"]'),
    note: card.querySelector('[data-field="note"]'),
    hint: card.querySelector('[data-field="hint"]'),
    empty: card.querySelector('[data-role="empty"]'),
    summary: card.querySelector('[data-field="summary"]')
  }

  /** 由 props 定下来的那部分：目标时刻、时区与文案。 */
  var state = { target: null, missing: 'empty', allDay: true, zone: '', invalidZone: false, name: '', note: '' }
  /** 四个格式器都按当前时区重建，props 或语言变化时一起换掉。 */
  var formats = { day: null, date: null, weekday: null, time: null }
  /** 宿主把卡片判为离开视口时置真：计时器停掉，恢复时重算再启动（D16）。 */
  var paused = widget !== undefined && widget.paused === true
  var timer = 0

  function isZh() {
    return widget === undefined || String(widget.lang || 'zh').toLowerCase().indexOf('zh') === 0
  }

  /** manifest 里的一条文案；没有宿主时退回调用处给的兜底。 */
  function label(key, fallback) {
    if (widget === undefined) return fallback
    var value = widget.t(key)
    return value === key ? fallback : value
  }

  /** 写一段文字；值没变就不碰节点，免得每 15 秒的刷新在界面上留下一次无谓的重画。 */
  function write(node, value) {
    if (node === null || node === undefined) return
    var text = value === null || value === undefined ? '' : String(value)
    if (node.textContent !== text) node.textContent = text
  }

  function pad(value) {
    return value < 10 ? '0' + value : String(value)
  }

  /** 文案里 `{名字}` 的空位换成实际值。 */
  function fill(template, values) {
    var text = template
    Object.keys(values).forEach(function (name) { text = text.split('{' + name + '}').join(String(values[name])) })
    return text
  }

  /** 时区不合法时保留可绘制的格式器，但停止倒计时并显示错误。 */
  function zoneOf(props) {
    var zone = typeof props.zone === 'string' ? props.zone.trim() : ''
    if (zone === '') zone = DEFAULT_ZONE
    return DateTime.now().setZone(zone).isValid
      ? { zone: zone, invalid: false }
      : { zone: DEFAULT_ZONE, invalid: true }
  }

  /** 成熟时间库给出候选偏移；缺口不能被自动顺延，重复时间由用户明确选择。 */
  function instantOf(date, time, offset) {
    var value = DateTime.fromObject({ year: date.year, month: date.month, day: date.day, hour: time.hour, minute: time.minute }, { zone: state.zone })
    if (!value.isValid || value.year !== date.year || value.month !== date.month || value.day !== date.day || value.hour !== time.hour || value.minute !== time.minute) {
      state.missing = 'badDateTime'
      return null
    }
    var choices = value.getPossibleOffsets()
    if (choices.length > 1 && !Number.isInteger(offset)) {
      state.missing = 'ambiguousTime'
      return null
    }
    var selected = offset === undefined ? value : choices.find(function (choice) { return choice.offset === offset })
    if (!selected) { state.missing = 'badOffset'; return null }
    return selected.toMillis()
  }

  /** 解析 YYYY-MM-DD；不成立的日期（例如 2 月 30 日）读成 null。 */
  function parseDate(text) {
    if (typeof text !== 'string') return null
    var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim())
    if (match === null) return null
    var year = Number(match[1])
    var month = Number(match[2])
    var day = Number(match[3])
    var probe = new Date(Date.UTC(year, month - 1, day))
    if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null
    return { year: year, month: month, day: day }
  }

  /** 解析 HH:mm；读不出来时返回 null，交给调用处给出可见的说法。 */
  function parseTime(text) {
    var match = typeof text === 'string' ? /^(\d{1,2}):(\d{2})$/.exec(text.trim()) : null
    if (match === null) return null
    var hour = Number(match[1])
    var minute = Number(match[2])
    if (hour > 23 || minute > 59) return null
    return { hour: hour, minute: minute }
  }

  /** 四个格式器都按当前时区与语言建，只负责显示，不负责墙上时间换算。 */
  function buildFormats() {
    var zone = state.zone === '' ? undefined : state.zone
    formats.day = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' })
    formats.date = new Intl.DateTimeFormat(isZh() ? 'zh-CN' : 'en', { timeZone: zone, year: 'numeric', month: 'short', day: 'numeric' })
    formats.weekday = new Intl.DateTimeFormat(isZh() ? 'zh-CN' : 'en', { timeZone: zone, weekday: 'short' })
    formats.time = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' })
  }

  /** 卡片自己的文案：三个单位；空状态的文字按具体原因在 paintEmpty 里写。 */
  function paintLabels() {
    write(el.daysLabel, label('days', isZh() ? '天' : 'days'))
    write(el.hoursLabel, label('hours', isZh() ? '小时' : 'hours'))
    write(el.minutesLabel, label('minutes', isZh() ? '分钟' : 'minutes'))
  }

  /** 一行说明：全天项目从目标时区当天的 00:00 起算。 */
  function paintHint() {
    el.hint.dataset.warn = 'false'
    var template = state.allDay
      ? label('allDayHint', isZh() ? '全天：按 {zone} 的 00:00 算' : 'All day: 00:00 in {zone}')
      : label('zoneHint', isZh() ? '按 {zone} 的墙上时间计算' : 'Counted in {zone} at wall-clock time')
    write(el.hint, fill(template, { zone: state.zone }))
    el.hint.hidden = false
  }

  /** 右上角的目标：按目标时区写出日期、星期与时刻，全天项目只写日期与星期。 */
  function targetText() {
    var at = new Date(state.target)
    var date = formats.date.format(at) + ' ' + formats.weekday.format(at)
    return state.allDay ? date : date + ' ' + formats.time.format(at)
  }

  /** 没有可用的目标：读数与说明都收掉，只留一句原因（没填日期，或日期与时刻读不出来）。 */
  function paintEmpty() {
    el.units.hidden = true
    el.empty.hidden = false
    el.note.hidden = true
    el.hint.hidden = true
    var reasons = {
      invalidZone: ['时区无效，请填写 IANA 时区名', 'Invalid IANA time zone'],
      badDateTime: ['这个时区不存在该时刻，请修改日期或时间', 'That wall time does not exist in this time zone'],
      ambiguousTime: ['该时刻重复，请在设置里填写明确的 UTC 偏移分钟', 'Ambiguous time: choose an explicit UTC offset in minutes'],
      badOffset: ['UTC 偏移与该时刻的时区不匹配', 'The UTC offset does not match this local time']
    }
    write(el.empty, label(state.missing, reasons[state.missing] ? reasons[state.missing][isZh() ? 0 : 1] : isZh()
      ? (state.missing === 'badTime' ? '时刻读不出来，写成 HH:mm；全天项目不看这一项' : '还没设日期，在设置里填一个')
      : (state.missing === 'badTime' ? 'The time could not be read; write it as HH:mm' : 'No date yet — set one in the card settings')))
    write(el.kicker, '')
    write(el.target, '')
    write(el.summary, '')
    card.dataset.phase = 'empty'
  }

  /** 全天项目到了目标那一天：读数收起来，只说「就是今天」——这一天的读数没有意义。 */
  function paintDone() {
    el.units.hidden = true
    el.empty.hidden = true
    el.note.hidden = false
    paintHint()
    paintLabels()
    var done = label('done', isZh() ? '就是今天' : 'Today')
    write(el.kicker, done)
    write(el.summary, done)
    write(el.target, targetText())
    card.dataset.phase = 'done'
  }

  /** 按此刻重算一次：还剩几天几时几分，到点之后换成已经过去多久。 */
  function render() {
    if (state.target === null) {
      paintEmpty()
      return
    }
    var now = Date.now()
    var diff = state.target - now
    // 全天项目只认日期：目标那天到了就算到了，午夜之后不再数「已经过去几小时」。
    if (state.allDay && formats.day.format(new Date(state.target)) === formats.day.format(new Date(now))) {
      paintDone()
      return
    }
    var passed = diff < 0

    // 分钟四舍五入，最少一分钟：还差半分钟时写「1 分钟」，不吃掉最后那一格。
    var total = Math.max(1, Math.round(Math.abs(diff) / MINUTE))
    var days = Math.floor(total / DAY_MINUTES)
    var hours = Math.floor((total % DAY_MINUTES) / 60)
    var minutes = total % 60

    el.units.hidden = false
    el.empty.hidden = true
    el.note.hidden = false
    paintHint()
    // 每帧都写一次单位：宿主换了界面语言时，下一次刷新把文案带过来（文字没变就不碰节点）。
    paintLabels()
    write(el.days, String(days))
    write(el.hours, pad(hours))
    write(el.minutes, pad(minutes))
    write(el.target, targetText())

    var head = label(passed ? 'passed' : 'remaining', passed ? (isZh() ? '已经过去' : 'Passed') : (isZh() ? '还有' : 'To go'))
    write(el.kicker, head)
    write(el.summary, [head, days, label('days', '天'), pad(hours), label('hours', '小时'), pad(minutes), label('minutes', '分钟')].join(' '))
    card.dataset.phase = passed ? 'passed' : 'remaining'
  }

  /** 计时器只在有目标、且卡片没被暂停时跑：空卡片与视口外的卡片都不必每秒算一次。 */
  function start() {
    if (paused || state.target === null) return
    if (timer === 0) timer = setInterval(render, TICK_MS)
  }

  function stop() {
    if (timer === 0) return
    clearInterval(timer)
    timer = 0
  }

  /** props 变了：时区、日期、时刻与文案一起换掉，目标时刻按新的时区重算。 */
  function applyProps(source) {
    var props = source !== null && typeof source === 'object' ? source : {}
    var found = zoneOf(props)
    state.zone = found.zone
    state.invalidZone = found.invalid
    state.allDay = props.allDay === true
    state.name = typeof props.name === 'string' ? props.name.trim() : ''
    state.note = typeof props.note === 'string' ? props.note.trim() : ''
    buildFormats()

    var date = parseDate(props.date)
    var time = state.allDay ? { hour: 0, minute: 0 } : parseTime(props.time)
    // 读不出来的日期与时刻各给一句原因：静悄悄按 00:00 算，用户会以为卡片算错了。
    state.missing = found.invalid ? 'invalidZone' : date === null ? 'empty' : (time === null ? 'badTime' : '')
    state.target = state.missing === '' ? instantOf(date, time, props.offsetMinutes) : null

    write(el.title, state.name === '' ? label('title', isZh() ? '倒数日' : 'Countdown') : state.name)
    write(el.note, state.note)
    paintLabels()
    if (state.target === null) {
      paintEmpty()
      stop()
      return
    }
    render()
    start()
  }

  applyProps(widget === undefined ? {} : widget.props)
  if (widget !== undefined) {
    widget.onProps(applyProps)
    widget.onPause(function (next) {
      paused = next
      if (paused) { stop(); return }
      render()
      start()
    })
  }
  start()
})()
