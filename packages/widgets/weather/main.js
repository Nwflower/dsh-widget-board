/*
 * 天气卡的脚本。
 *
 * 组件与外界只有 `window.widget` 这一条路（D7）：预报内容默认是卡自带的一份样例，宿主推来
 * `data` 时以宿主为准；尺寸换族时切换栏的药丸重新对位。所有动效原语（数字、文字、图标、切换栏）
 * 由运行时套件提供，这里只按顺序驱动它们。
 */
(function () {
  var card = document.querySelector('.wx')
  if (!card) return

  var widget = window.widget
  var root = document.documentElement

  /** 自带的一份预报：宿主没有推数据时显示它。 */
  var FORECAST = [
    { name: { zh: '星期一', en: 'Monday' }, short: { zh: '周一', en: 'Mon' }, icon: 'sun', sky: 'clear', condition: { zh: '晴', en: 'Sunny' }, temp: 24, high: 26, low: 17 },
    { name: { zh: '星期二', en: 'Tuesday' }, short: { zh: '周二', en: 'Tue' }, icon: 'cloud', sky: 'cloudy', condition: { zh: '多云', en: 'Cloudy' }, temp: 19, high: 21, low: 14 },
    { name: { zh: '星期三', en: 'Wednesday' }, short: { zh: '周三', en: 'Wed' }, icon: 'rain', sky: 'rain', condition: { zh: '小雨', en: 'Light rain' }, temp: 16, high: 18, low: 12 },
    { name: { zh: '星期四', en: 'Thursday' }, short: { zh: '周四', en: 'Thu' }, icon: 'bolt', sky: 'storm', condition: { zh: '雷阵雨', en: 'Thunderstorms' }, temp: 15, high: 17, low: 11 },
    { name: { zh: '星期五', en: 'Friday' }, short: { zh: '周五', en: 'Fri' }, icon: 'sun', sky: 'clear', condition: { zh: '晴', en: 'Sunny' }, temp: 22, high: 25, low: 15 }
  ]

  var PLACE = { zh: '旧金山', en: 'San Francisco' }

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

  var days = FORECAST
  var place = PLACE
  var current = 0

  /** 当前语言。 */
  function zh() { return String(widget ? widget.lang : root.lang || 'en').indexOf('zh') === 0 }
  /** 取一段双语文案。 */
  function pick(pair) { return pair ? (zh() ? pair.zh : pair.en) : '' }
  /** 系统或宿主是否要求减弱动效。 */
  function reduced() { return root.getAttribute('data-motion') === 'reduced' }
  /** 读一个套件令牌的毫秒数。 */
  function ms(name, fallback) { var value = parseFloat(getComputedStyle(root).getPropertyValue(name)); return isFinite(value) ? value : fallback }

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

  /** 把第 i 天画到卡上；`instant` 用于首帧与语言切换。 */
  function paint(i, instant) {
    var day = days[i]
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
      tab.querySelector('span').textContent = pick(days[index].short)
      tab.setAttribute('aria-selected', index === i ? 'true' : 'false')
      tab.setAttribute('tabindex', index === i ? '0' : '-1')
    })
    el.panel.setAttribute('aria-labelledby', el.tabs[i].id)
    moveTo(el.tabs[i], instant !== true)
  }

  /** 选中第 i 天。 */
  function select(i, focus) {
    if (i === current) return
    current = i
    paint(i, false)
    if (focus) el.tabs[i].focus()
  }

  el.tabs.forEach(function (tab, index) {
    tab.addEventListener('click', function () { select(index, false) })
  })
  el.bar.addEventListener('keydown', function (event) {
    if (event.key === 'ArrowRight') { event.preventDefault(); select((current + 1) % el.tabs.length, true) }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); select((current - 1 + el.tabs.length) % el.tabs.length, true) }
  })

  /** 宿主推来的数据合法时用它替换自带的那份。 */
  function adoptData(data) {
    if (!data || !Array.isArray(data.days) || data.days.length === 0) return false
    days = data.days.slice(0, el.tabs.length)
    place = data.place || place
    current = 0
    paint(0, true)
    return true
  }

  if (widget) {
    widget.onSize(function () { paint(current, true) })
    widget.onData(function (data) { adoptData(data) })
  }

  paint(0, true)
  requestAnimationFrame(function () { moveTo(el.tabs[current], false) })
  window.addEventListener('resize', function () { moveTo(el.tabs[current], false) })
})()
