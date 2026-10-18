/*
 * 天气卡的脚本。
 *
 * 卡片的数据来自 manifest 的 `request.url`：宿主请求 Open-Meteo，把原始响应推进来，这里把它映射
 * 成五天预报。组件与外界只有 `window.widget` 这一条路（D7）；天气代码、星期与文案的解读都在这一
 * 份脚本里，看板插件不参与。尺寸换族时切换栏的药丸重新对位。所有动效原语（数字、文字、图标、切
 * 换栏）由运行时套件提供，这里只按顺序驱动它们。
 */
(function () {
  var card = document.querySelector('.wx')
  if (!card) return

  var widget = window.widget
  var root = document.documentElement

  /** 默认地点；与 widget.json 里 props schema 的默认值一致。 */
  var DEFAULT_PLACE = { zh: '北京', en: 'Beijing' }

  /** 卡片能放下的预报天数。 */
  var SLOTS = 5

  /**
   * WMO 天气代码到卡片图标、天空与中英文案的映射。
   *
   * Open-Meteo 只给代码。卡片只有晴、云、雨、雷四个图标，雪按云处理，文字照实写。
   */
  var WEATHER = {
    0: ['sun', 'clear', '晴', 'Clear'],
    1: ['sun', 'clear', '大部晴朗', 'Mostly clear'],
    2: ['cloud', 'cloudy', '多云', 'Partly cloudy'],
    3: ['cloud', 'cloudy', '阴', 'Overcast'],
    45: ['cloud', 'cloudy', '雾', 'Fog'],
    48: ['cloud', 'cloudy', '雾凇', 'Rime fog'],
    51: ['rain', 'rain', '毛毛雨', 'Drizzle'],
    53: ['rain', 'rain', '毛毛雨', 'Drizzle'],
    55: ['rain', 'rain', '浓毛毛雨', 'Dense drizzle'],
    56: ['rain', 'rain', '冻毛毛雨', 'Freezing drizzle'],
    57: ['rain', 'rain', '冻毛毛雨', 'Freezing drizzle'],
    61: ['rain', 'rain', '小雨', 'Light rain'],
    63: ['rain', 'rain', '中雨', 'Rain'],
    65: ['rain', 'rain', '大雨', 'Heavy rain'],
    66: ['rain', 'rain', '冻雨', 'Freezing rain'],
    67: ['rain', 'rain', '冻雨', 'Freezing rain'],
    71: ['cloud', 'cloudy', '小雪', 'Light snow'],
    73: ['cloud', 'cloudy', '中雪', 'Snow'],
    75: ['cloud', 'cloudy', '大雪', 'Heavy snow'],
    77: ['cloud', 'cloudy', '雪粒', 'Snow grains'],
    80: ['rain', 'rain', '阵雨', 'Rain showers'],
    81: ['rain', 'rain', '阵雨', 'Rain showers'],
    82: ['rain', 'rain', '强阵雨', 'Violent rain showers'],
    85: ['cloud', 'cloudy', '阵雪', 'Snow showers'],
    86: ['cloud', 'cloudy', '阵雪', 'Snow showers'],
    95: ['bolt', 'storm', '雷暴', 'Thunderstorm'],
    96: ['bolt', 'storm', '雷暴伴冰雹', 'Thunderstorm with hail'],
    99: ['bolt', 'storm', '雷暴伴冰雹', 'Thunderstorm with hail']
  }

  /** 切换栏那一格的小图标：四种天气里雨与云共用云形，和大幅图标一致。 */
  var TAB_PATHS = {
    sun: 'M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z',
    cloud: 'M2.25 15a4.5 4.5 0 0 0 4.5 4.5H18a3.75 3.75 0 0 0 1.332-7.257 3 3 0 0 0-3.758-3.848 5.25 5.25 0 0 0-10.233 2.33A4.502 4.502 0 0 0 2.25 15Z',
    rain: 'M2.25 15a4.5 4.5 0 0 0 4.5 4.5H18a3.75 3.75 0 0 0 1.332-7.257 3 3 0 0 0-3.758-3.848 5.25 5.25 0 0 0-10.233 2.33A4.502 4.502 0 0 0 2.25 15Z',
    bolt: 'm3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z'
  }

  var el = {
    bg: card.querySelector('.wx-bg'),
    big: card.querySelector('.wx-big'),
    place: card.querySelector('#wx-place'),
    day: card.querySelector('#wx-day'),
    temp: card.querySelector('#wx-temp'),
    cond: card.querySelector('#wx-cond'),
    hi: card.querySelector('#wx-hi'),
    lo: card.querySelector('#wx-lo'),
    panel: card.querySelector('#wx-panel'),
    bar: card.querySelector('.t-tabs'),
    pill: card.querySelector('.t-tabs-pill'),
    tabs: Array.prototype.slice.call(card.querySelectorAll('.t-tab')),
    icons: Array.prototype.slice.call(card.querySelectorAll('.wx-big .t-icon'))
  }

  var days = []
  var place = DEFAULT_PLACE
  var current = 0
  /** 宿主存下来的那一天；数据还没到时先记着。 */
  var wanted = -1
  var loadTimer = 0

  /** 当前语言。 */
  function zh() { return String(widget ? widget.lang : root.lang || 'en').indexOf('zh') === 0 }
  /** 取一段双语文案。 */
  function pick(pair) { return pair ? (zh() ? pair.zh : pair.en) : '' }
  /** 系统或宿主是否要求减弱动效。 */
  function reduced() { return root.getAttribute('data-motion') === 'reduced' }
  /** 读一个套件令牌的毫秒数。 */
  function ms(name, fallback) { var value = parseFloat(getComputedStyle(root).getPropertyValue(name)); return isFinite(value) ? value : fallback }
  /** manifest 的 text 里的一条文案；没有宿主时用给好的兜底。 */
  function t(key, fallback) { return widget ? widget.t(key) : fallback }

  /** 一条天气代码对应的图标、天空与文字。 */
  function describe(code) {
    var entry = WEATHER[code] || WEATHER[3]
    return { icon: entry[0], sky: entry[1], zh: entry[2], en: entry[3] }
  }

  /** 把切换栏里那一格的图标换成这一天自己的天气图标。 */
  function tabIcon(tab, icon) {
    if (tab.dataset.icon === icon) return
    tab.dataset.icon = icon
    var previous = tab.querySelector('svg')
    if (previous === null) return
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('width', '16')
    svg.setAttribute('height', '16')
    svg.setAttribute('viewBox', '0 0 24 24')
    svg.setAttribute('fill', 'none')
    svg.setAttribute('stroke', 'currentColor')
    svg.setAttribute('stroke-linecap', 'round')
    svg.setAttribute('stroke-linejoin', 'round')
    svg.setAttribute('stroke-width', '2.25')
    svg.setAttribute('aria-hidden', 'true')
    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', TAB_PATHS[icon] || TAB_PATHS.cloud)
    svg.appendChild(path)
    previous.replaceWith(svg)
  }

  /** 把 `YYYY-MM-DD` 读成本地当天中午，避免时区把日期挪一天。 */
  function dayOf(iso) {
    var parts = String(iso).split('-')
    var date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 12)
    return isNaN(date.getTime()) ? new Date() : date
  }

  /** 某一天的中文或英文星期名。 */
  function weekday(date, locale, style) {
    return new Intl.DateTimeFormat(locale, { weekday: style }).format(date)
  }

  /** 卡片上的地点：props 给了双语名字就用它，否则用默认地点。 */
  function placeOf(props) {
    var value = props && props.place
    if (value && typeof value.zh === 'string' && typeof value.en === 'string') return value
    return DEFAULT_PLACE
  }

  /** 雨丝：按固定次序铺开，和刷新无关。 */
  card.querySelectorAll('.wx-rain').forEach(function (rain) {
    var count = parseInt(rain.getAttribute('data-count'), 10) || 12
    for (var i = 0; i < count; i += 1) {
      var streak = document.createElement('span')
      var x = ((i * 37) % 100) + (i % 3) * 2
      streak.style.setProperty('--x', Math.min(x, 112) + '%')
      streak.style.setProperty('--d', ((i * 0.618) % 1).toFixed(3))
      streak.style.setProperty('--len', (12 + (i * 7) % 10) + 'px')
      rain.appendChild(streak)
    }
  })

  /** 数字：逐位换成新值，后两位错开出现，没变的位不动。 */
  function setDigits(group, next, instant) {
    var text = String(next)
    var previous = group.textContent.replace(/\s+/g, '')
    if (previous === text) return
    if (instant || reduced()) { group.textContent = text; return }
    var same = 0
    while (same < previous.length && same < text.length && previous[same] === text[same]) same += 1
    group.classList.remove('is-animating')
    group.replaceChildren()
    text.split('').forEach(function (character, index) {
      var span = document.createElement('span')
      span.className = 't-digit'
      span.textContent = character
      if (index < same) span.dataset.same = ''
      if (index === text.length - 2) span.dataset.stagger = '1'
      else if (index === text.length - 1) span.dataset.stagger = '2'
      group.appendChild(span)
    })
    void group.offsetHeight
    group.classList.add('is-animating')
  }

  /** 文字切换：旧值上移淡出，新值从下方淡入。 */
  function swapText(node, next, instant) {
    var target = node.dataset.next || node.textContent
    if (target === next) return
    node.dataset.next = next
    clearTimeout(node._swapTimer)
    if (instant || reduced()) { node.textContent = next; return }
    node.classList.remove('is-enter-start')
    node.classList.add('is-exit')
    node._swapTimer = setTimeout(function () {
      node.textContent = next
      node.classList.remove('is-exit')
      node.classList.add('is-enter-start')
      void node.offsetHeight
      node.classList.remove('is-enter-start')
    }, ms('--w-motion-fast', 150))
  }

  /** 文字变形：只替换前后不同的那一段，容器宽度跟着过渡。 */
  function morphText(node, next, instant) {
    var previous = node.dataset.text != null ? node.dataset.text : node.textContent
    if (previous === next) return
    node.dataset.text = next
    clearTimeout(node._morphTimer)
    if (instant || reduced()) { node.textContent = next; return }
    var head = 0
    while (head < previous.length && head < next.length && previous[head] === next[head]) head += 1
    var tail = 0
    while (
      tail < previous.length - head && tail < next.length - head &&
      previous[previous.length - 1 - tail] === next[next.length - 1 - tail]
    ) tail += 1
    var swap = document.createElement('span')
    swap.className = 't-morph-swap'
    var out = document.createElement('span')
    out.className = 't-morph-old'
    out.setAttribute('aria-hidden', 'true')
    out.textContent = previous.slice(head, previous.length - tail)
    var inn = document.createElement('span')
    inn.className = 't-morph-new'
    inn.textContent = next.slice(head, next.length - tail)
    swap.append(out, inn)
    node.textContent = ''
    node.append(next.slice(0, head), swap, next.slice(next.length - tail))
    swap.style.width = out.getBoundingClientRect().width + 'px'
    void swap.offsetWidth
    swap.classList.add('is-morphing')
    swap.style.width = inn.getBoundingClientRect().width + 'px'
    node._morphTimer = setTimeout(function () { node.textContent = next }, Math.max(ms('--w-motion-morph', 180), ms('--w-motion-morph-resize', 240)) + 40)
  }

  /** 药丸对到选中的那一格；`animate` 为假时直接落位。 */
  function moveTo(tab, animate) {
    if (!animate) {
      var previous = el.pill.style.transition
      el.pill.style.transition = 'none'
      el.pill.style.transform = 'translateX(' + tab.offsetLeft + 'px)'
      el.pill.style.width = tab.offsetWidth + 'px'
      void el.pill.offsetWidth
      el.pill.style.transition = previous
      return
    }
    el.pill.style.transform = 'translateX(' + tab.offsetLeft + 'px)'
    el.pill.style.width = tab.offsetWidth + 'px'
  }

  /** 数据还没到时的卡片：地点与结构在，读数留白，切换栏不能按。 */
  function paintEmpty() {
    el.bg.setAttribute('data-wx', 'cloudy')
    el.big.setAttribute('data-state', 'cloud')
    el.icons.forEach(function (icon) {
      icon.toggleAttribute('data-active', icon.dataset.key === 'cloud')
    })
    el.place.textContent = pick(place)
    el.day.textContent = '—'
    delete el.day.dataset.text
    el.cond.textContent = t('loading', 'Fetching weather')
    el.temp.textContent = '--'
    el.hi.textContent = '--'
    el.lo.textContent = '--'
    el.tabs.forEach(function (tab, index) {
      tabIcon(tab, 'cloud')
      tab.querySelector('span').textContent = '—'
      tab.disabled = true
      tab.setAttribute('aria-selected', index === 0 ? 'true' : 'false')
      tab.setAttribute('tabindex', index === 0 ? '0' : '-1')
    })
    el.panel.setAttribute('aria-labelledby', el.tabs[0].id)
    moveTo(el.tabs[0], false)
  }

  /** 数据还没到、请求也没回来：把等待换成一句可见的原因。 */
  function showUnavailable() {
    if (days.length > 0) return
    el.cond.textContent = t('unavailable', 'Weather unavailable')
  }

  /** 把第 i 天画到卡上；`instant` 用于首帧与语言切换。 */
  function paint(i, instant) {
    var day = days[i]
    if (day === undefined) { paintEmpty(); return }
    el.bg.setAttribute('data-wx', day.sky)
    el.big.setAttribute('data-state', day.icon)
    el.icons.forEach(function (icon) {
      icon.toggleAttribute('data-active', icon.dataset.key === day.icon)
    })
    el.place.textContent = pick(place)
    morphText(el.day, pick(day.name), instant)
    swapText(el.cond, pick(day.condition), instant)
    setDigits(el.temp, day.temp, instant)
    setDigits(el.hi, day.high, instant)
    setDigits(el.lo, day.low, instant)
    el.tabs.forEach(function (tab, index) {
      var entry = days[index]
      if (entry !== undefined) tabIcon(tab, entry.icon)
      tab.disabled = entry === undefined
      tab.querySelector('span').textContent = entry === undefined ? '—' : pick(entry.short)
      tab.setAttribute('aria-selected', index === i ? 'true' : 'false')
      tab.setAttribute('tabindex', index === i ? '0' : '-1')
    })
    el.panel.setAttribute('aria-labelledby', el.tabs[i].id)
    moveTo(el.tabs[i], instant !== true)
  }

  /** 选中第 i 天；`quiet` 用于从宿主存下的状态恢复，不再回头写一次。 */
  function select(i, focus, quiet) {
    if (days.length === 0 || i === current || i < 0 || i >= days.length || i >= el.tabs.length) return
    current = i
    paint(i, false)
    if (focus) el.tabs[i].focus()
    if (quiet !== true && widget) widget.setState({ day: i })
  }

  el.tabs.forEach(function (tab, index) {
    tab.addEventListener('click', function () { select(index, false) })
  })
  el.bar.addEventListener('keydown', function (event) {
    if (days.length === 0) return
    if (event.key === 'ArrowRight') { event.preventDefault(); select((current + 1) % days.length, true) }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); select((current - 1 + days.length) % days.length, true) }
  })

  /** 宿主推来的原始 Open-Meteo 数据换成卡片自己的五天预报。 */
  function adoptData(data) {
    if (!data || !data.daily || !Array.isArray(data.daily.time)) return false
    var daily = data.daily
    var currentReading = data.current || {}
    var count = Math.min(daily.time.length, SLOTS, el.tabs.length)
    if (count === 0) return false
    var next = []
    for (var i = 0; i < count; i += 1) {
      var high = daily.temperature_2m_max[i]
      var low = daily.temperature_2m_min[i]
      if (typeof high !== 'number' || typeof low !== 'number') return false
      var mean = daily.temperature_2m_mean[i]
      var code = i === 0 && typeof currentReading.weather_code === 'number' ? currentReading.weather_code : daily.weather_code[i]
      var weather = describe(code)
      var date = dayOf(daily.time[i])
      var temp = i === 0 && typeof currentReading.temperature_2m === 'number'
        ? Math.round(currentReading.temperature_2m)
        : Math.round(typeof mean === 'number' ? mean : (high + low) / 2)
      next.push({
        name: { zh: weekday(date, 'zh-CN', 'long'), en: weekday(date, 'en-US', 'long') },
        short: { zh: weekday(date, 'zh-CN', 'short'), en: weekday(date, 'en-US', 'short') },
        icon: weather.icon,
        sky: weather.sky,
        condition: { zh: weather.zh, en: weather.en },
        temp: temp,
        high: Math.round(high),
        low: Math.round(low)
      })
    }
    days = next
    place = placeOf(widget ? widget.props : {})
    clearTimeout(loadTimer)
    if (current >= days.length) current = 0
    paint(current, true)
    // 数据先到、状态后到：状态里选中的那一天盖回来。
    if (wanted >= 0) select(wanted, false, true)
    return true
  }

  if (widget) {
    widget.onSize(function () {
      if (days.length === 0) paintEmpty()
      else paint(current, true)
    })
    widget.onProps(function (props) {
      place = placeOf(props)
      if (days.length === 0) el.place.textContent = pick(place)
      else paint(current, true)
    })
    widget.onData(function (data) { adoptData(data) })
    widget.onState(function (value) {
      if (!value || typeof value.day !== 'number') return
      wanted = value.day
      select(wanted, false, true)
    })
  }

  place = placeOf(widget ? widget.props : {})
  paintEmpty()
  loadTimer = window.setTimeout(showUnavailable, 15000)
  requestAnimationFrame(function () { moveTo(el.tabs[current], false) })
  window.addEventListener('resize', function () { moveTo(el.tabs[current], false) })
})()
