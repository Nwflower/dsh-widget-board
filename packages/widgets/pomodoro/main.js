/*
 * 番茄钟的脚本。
 *
 * 组件与外界只有 `window.widget` 这一条路（D7）：文案从 manifest 的 `text` 里按语言取，会话状态
 * 只在这一次会话里有效——宿主还没有把 setState 存下来的路由。
 *
 * 计时按结束时刻算，不按每次滴答累加，所以页面被节流也不会走慢。
 */
(function () {
  var card = document.querySelector('.pomo')
  if (!card) return

  var widget = window.widget
  var root = document.documentElement
  var MINUTES = { min: 15, max: 60 }
  var TICK_MS = 250

  var el = {
    title: card.querySelector('#pomo-title'),
    caption: card.querySelector('#pomo-cap'),
    digits: card.querySelector('#pomo-digits'),
    slider: card.querySelector('#pomo-slider'),
    ticks: card.querySelector('.pomo-ticks'),
    range: card.querySelector('#pomo-range'),
    start: card.querySelector('#pomo-start'),
    startLabel: card.querySelector('#pomo-start-label')
  }

  /** 一次会话的状态：选中的分钟数、是否在跑、跑的时候在哪一刻结束。 */
  var state = { minutes: 25, running: false, endsAt: 0, finished: false, shown: 25 }
  var timer = 0

  /** manifest 里的一条文案；没有宿主时退回键名。 */
  function label(key) { return widget === undefined ? key : widget.t(key) }
  /** 读一个套件令牌的毫秒数。 */
  function ms(name, fallback) { var value = parseFloat(getComputedStyle(root).getPropertyValue(name)); return isFinite(value) ? value : fallback }
  /** 系统或宿主是否要求减弱动效。 */
  function reduced() { return root.getAttribute('data-motion') === 'reduced' }

  /** 文字切换：旧值上移淡出，新值从下方淡入（原语在套件里）。 */
  function swapText(node, next) {
    if (node.textContent === next) return
    if (reduced()) { node.textContent = next; return }
    node.classList.add('is-exit')
    setTimeout(function () {
      node.textContent = next
      node.classList.remove('is-exit')
      node.classList.add('is-enter-start')
      void node.offsetHeight
      node.classList.remove('is-enter-start')
    }, ms('--w-motion-fast', 150))
  }

  /** 数字：逐位换成新值，后两位错开出现，没变的位不动。 */
  function setDigits(value) {
    var text = String(value)
    var previous = el.digits.textContent.replace(/\s+/g, '')
    if (previous === text) return
    state.shown = value
    if (reduced()) { el.digits.textContent = text; return }
    var same = 0
    while (same < previous.length && same < text.length && previous[same] === text[same]) same += 1
    el.digits.classList.remove('is-animating')
    el.digits.replaceChildren()
    text.split('').forEach(function (character, index) {
      var span = document.createElement('span')
      span.className = 't-digit'
      span.textContent = character
      if (index < same) span.dataset.same = ''
      if (index === text.length - 2) span.dataset.stagger = '1'
      else if (index === text.length - 1) span.dataset.stagger = '2'
      el.digits.appendChild(span)
    })
    void el.digits.offsetHeight
    el.digits.classList.add('is-animating')
  }

  /** 刻度从头铺到尾，选中或走到的部分亮起来。 */
  function buildTicks() {
    var count = MINUTES.max - MINUTES.min
    for (var index = 0; index <= count; index += 1) {
      var tick = document.createElement('span')
      tick.className = 'pomo-tick'
      tick.style.setProperty('--t', index / count)
      el.ticks.appendChild(tick)
    }
  }

  /** 亮到 `fraction` 为止的刻度。 */
  function paintTicks(fraction) {
    var ticks = el.ticks.children
    for (var index = 0; index < ticks.length; index += 1) {
      ticks[index].classList.toggle('is-on', index / (ticks.length - 1) <= fraction + 0.001)
    }
  }

  /** 选中的分钟数对应的刻度位置。 */
  function selectedFraction() {
    return (state.minutes - MINUTES.min) / (MINUTES.max - MINUTES.min)
  }

  /** 剩余分钟数，向上取整到分钟。 */
  function remainingMinutes() {
    return Math.max(0, Math.ceil((state.endsAt - Date.now()) / 60000))
  }

  /** 把一次会话落到界面上。 */
  function paint() {
    el.range.value = String(state.minutes)
    el.range.disabled = state.running
    el.start.setAttribute('aria-pressed', state.running ? 'true' : 'false')
    if (state.running) {
      swapText(el.caption, label('running'))
      swapText(el.startLabel, label('stop'))
      paintTicks(1 - remainingMinutes() / state.minutes)
    } else {
      swapText(el.caption, label(state.finished ? 'done' : 'idle'))
      swapText(el.startLabel, label('start'))
      paintTicks(selectedFraction())
    }
  }

  /** 跑着的时候每秒对一次表；只有分钟数真的变了才动数字。 */
  function tick() {
    var left = remainingMinutes()
    if (left !== state.shown) setDigits(left)
    paintTicks(1 - left / state.minutes)
    if (left <= 0) finish()
  }

  /** 开始一段。 */
  function start() {
    state.running = true
    state.finished = false
    state.endsAt = Date.now() + state.minutes * 60000
    setDigits(state.minutes)
    paint()
    clearInterval(timer)
    timer = setInterval(tick, TICK_MS)
  }

  /** 结束一段，计时停掉。 */
  function stop(finished) {
    state.running = false
    state.finished = finished
    clearInterval(timer)
    timer = 0
    if (finished) setDigits(0)
    paint()
  }

  el.range.addEventListener('input', function () {
    state.minutes = Number(el.range.value)
    state.finished = false
    setDigits(state.minutes)
    paint()
  })

  el.start.addEventListener('click', function () {
    if (state.running) stop(false)
    else start()
  })

  /** 文案落到界面上；语言变化后重新走一遍。 */
  function paintLabels() {
    el.title.textContent = label('title')
    el.range.setAttribute('aria-label', label('length'))
    paint()
  }

  // 握手之后才有语言与文案：onSize 在 init 之后触发，顺带把文案补上；尺寸变化时也重排刻度。
  if (widget !== undefined) {
    widget.onSize(function () {
      paintLabels()
      paintTicks(state.running ? 1 - remainingMinutes() / state.minutes : selectedFraction())
    })
  }

  buildTicks()
  setDigits(state.minutes)
  paintLabels()
})()
