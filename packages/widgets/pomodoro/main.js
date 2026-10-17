/*
 * 番茄钟的脚本。
 *
 * 组件与外界只有 `window.widget` 这一条路（D7）：文案从 manifest 的 `text` 里按语言取，选中的
 * 时长与结束时刻经 `setState` 交给宿主存下来——切走再切回、页面被重挂之后都接着跑。
 *
 * 剩余时间按结束时刻算，不按每次滴答累加，所以页面被节流也不会走慢。数字按翻页显示：一个数字
 * 分成上下两半，变大的翻页上去，变小的翻页下来。
 */
(function () {
  var card = document.querySelector('.pomo')
  if (!card) return

  var widget = window.widget
  var root = document.documentElement
  var MINUTES = { min: 5, max: 60 }
  var TICK_MS = 200

  var el = {
    title: card.querySelector('#pomo-title'),
    caption: card.querySelector('#pomo-cap'),
    time: card.querySelector('#pomo-time'),
    ticks: card.querySelector('.pomo-ticks'),
    range: card.querySelector('#pomo-range'),
    presets: card.querySelector('#pomo-presets'),
    presetButtons: Array.prototype.slice.call(card.querySelectorAll('.pomo-preset')),
    start: card.querySelector('#pomo-start'),
    startLabel: card.querySelector('#pomo-start-label')
  }

  /** 一次会话的状态：选中的分钟数、是否在跑、跑的时候在哪一刻结束、已经画出来的剩余秒数。 */
  var state = { minutes: 25, running: false, endsAt: 0, finished: false, shown: -1 }
  var timer = 0
  var cells = []

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

  /** 数字的一半：上半截显示数字的上半，下半截显示下半。 */
  function half(part, value) {
    var node = document.createElement('span')
    node.className = 't-flip-half'
    node.dataset.half = part
    node.textContent = value
    return node
  }

  /** 翻过去的那半页：带自己的底色，不透明才不会透出后面的数字。 */
  function leaf(part, value, role) {
    var node = document.createElement('span')
    node.className = 't-flip-page'
    node.dataset.half = part
    node.dataset.role = role
    node.textContent = value
    return node
  }

  /** 把半页的底色对到卡片上的那一块：按它在卡片里的位置偏移同一张渐变。 */
  function alignLeaf(node) {
    var box = node.getBoundingClientRect()
    node.style.setProperty('--t-flip-page-x', `${-box.left}px`)
    node.style.setProperty('--t-flip-page-y', `${-box.top}px`)
  }

  /** 翻完之后只留下静止的两半。 */
  function settle(cell, to) {
    if (cell.dataset.value !== to) return
    cell.removeAttribute('data-dir')
    cell.replaceChildren(half('top', to), half('bottom', to))
  }

  /** 一个数字格换成新值：变大的翻页上去，变小的翻页下来。 */
  function flip(cell, from, to) {
    var up = Number(to) > Number(from)
    var out = leaf(up ? 'bottom' : 'top', from, 'out')
    var into = leaf(up ? 'top' : 'bottom', to, 'in')
    cell.dataset.dir = up ? 'up' : 'down'
    cell.replaceChildren(
      half('top', up ? from : to),
      half('bottom', up ? to : from),
      out,
      into
    )
    alignLeaf(out)
    alignLeaf(into)
    if (reduced()) { settle(cell, to); return }
    setTimeout(function () { settle(cell, to) }, ms('--w-motion-flip', 320))
  }

  /** 剩余时间：四个数字格与中间那个冒号，只建一次。 */
  function buildTime() {
    ;['0', '0', ':', '0', '0'].forEach(function (seed) {
      if (seed === ':') {
        var colon = document.createElement('span')
        colon.className = 'pomo-colon'
        colon.textContent = ':'
        el.time.appendChild(colon)
        return
      }
      var cell = document.createElement('span')
      cell.className = 't-flip'
      cell.append(half('top', seed), half('bottom', seed))
      el.time.appendChild(cell)
      cells.push(cell)
    })
  }

  /** 把剩余秒数画成 mm:ss，只翻真正变了的数字格。 */
  function paintTime(seconds) {
    if (seconds === state.shown) return
    state.shown = seconds
    var minutes = Math.floor(seconds / 60)
    var rest = seconds % 60
    var chars = [Math.floor(minutes / 10), minutes % 10, Math.floor(rest / 10), rest % 10].map(String)
    cells.forEach(function (cell, index) {
      var to = chars[index]
      var from = cell.dataset.value
      if (from === to) return
      cell.dataset.value = to
      if (from === undefined) {
        cell.replaceChildren(half('top', to), half('bottom', to))
        return
      }
      flip(cell, from, to)
    })
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

  /**
   * 刻度按设备像素落位：分数坐标上的 2px 条会被画成 2px 或 3px，看起来粗细不匀。
   * 每根条的位置与宽度都取整到设备像素，剩下的差值落在间距上。
   */
  function placeTicks() {
    var ticks = el.ticks.children
    var count = ticks.length
    if (count < 2) return
    var box = el.ticks.getBoundingClientRect()
    if (box.width <= 0) return
    var ratio = window.devicePixelRatio || 1
    var width = Math.max(1, Math.round(2 * ratio)) / ratio
    var span = box.width - width
    for (var index = 0; index < count; index += 1) {
      var tick = ticks[index]
      var at = box.left + (index / (count - 1)) * span
      tick.style.width = `${width}px`
      tick.style.left = `${Math.round(at * ratio) / ratio - box.left}px`
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

  /** 剩余秒数，向上取整：最后不足一秒的那一下停在 00:01 上。 */
  function remainingSeconds() {
    return Math.max(0, Math.ceil((state.endsAt - Date.now()) / 1000))
  }

  /** 一次会话的总秒数。 */
  function totalSeconds() {
    return state.minutes * 60
  }

  /** 两个快捷时长：当前选中的那个亮着；点一下直接开始这一段。 */
  function paintPresets() {
    el.presetButtons.forEach(function (button) {
      var text = label(button.dataset.text)
      if (button.textContent !== text) button.textContent = text
      button.dataset.active = state.minutes === Number(button.dataset.minutes) ? 'true' : 'false'
    })
  }

  /** 把一次会话落到界面上。 */
  function paint() {
    card.dataset.running = state.running ? 'true' : 'false'
    el.range.value = String(state.minutes)
    el.range.disabled = state.running
    el.start.setAttribute('aria-pressed', state.running ? 'true' : 'false')
    paintPresets()
    if (state.running) {
      var left = remainingSeconds()
      swapText(el.caption, label('running'))
      swapText(el.startLabel, label('stop'))
      paintTicks(1 - left / totalSeconds())
      paintTime(left)
    } else {
      swapText(el.caption, label(state.finished ? 'done' : 'idle'))
      swapText(el.startLabel, label('start'))
      paintTicks(selectedFraction())
      paintTime(state.finished ? 0 : totalSeconds())
    }
  }

  /** 跑着的时候对表；只有秒数变了才动数字。 */
  function tick() {
    var left = remainingSeconds()
    paintTime(left)
    paintTicks(1 - left / totalSeconds())
    if (left <= 0) stop(true)
  }

  /** 开始一段。 */
  function start() {
    state.running = true
    state.finished = false
    state.endsAt = Date.now() + totalSeconds() * 1000
    paint()
    clearInterval(timer)
    timer = setInterval(tick, TICK_MS)
    save()
  }

  /** 结束一段，计时停掉。 */
  function stop(finished) {
    state.running = false
    state.finished = finished
    clearInterval(timer)
    timer = 0
    paint()
    save()
    // 到点才通知：主动结束的一段不算。标题用组件标题，看板栏上能看出是谁发的。
    if (finished && widget !== undefined) widget.notify({ title: label('title'), body: label('done') })
  }

  /** 接着跑一段已经在走的计时：余额按结束时刻算，切页面不影响。 */
  function resume(end) {
    state.running = true
    state.finished = false
    state.endsAt = end
    paint()
    clearInterval(timer)
    timer = setInterval(tick, TICK_MS)
  }

  /** 把这次会话交给宿主存下来：下一次赋值来自它，切页面与重挂都接得上（D5）。 */
  function save() {
    if (widget === undefined) return
    widget.setState({ minutes: state.minutes, endsAt: state.running ? state.endsAt : 0 })
  }

  /** 第一次拿到的状态就是这张卡存下的会话；之后的回声不再覆盖正在跑的计时。 */
  var restored = false
  function restore(value) {
    if (restored) return
    restored = true
    if (value === null || typeof value !== 'object') return
    var minutes = value.minutes
    if (typeof minutes === 'number' && minutes >= MINUTES.min && minutes <= MINUTES.max) state.minutes = minutes
    var end = value.endsAt
    if (typeof end === 'number' && end > 0) {
      if (end > Date.now()) resume(end)
      else stop(true)
      return
    }
    paint()
  }

  el.range.addEventListener('input', function () {
    state.minutes = Number(el.range.value)
    state.finished = false
    paint()
  })

  // 拖动过程中只重画，松手时才交给宿主：免得一次拖动写出几十次状态。
  el.range.addEventListener('change', save)

  // 快捷时长既换数字也立刻开始：点 5 分钟就是要一段 5 分钟的专注。跑着的时候这一排收起来，
  // 换一段要先结束当前这一段。
  el.presetButtons.forEach(function (button) {
    button.addEventListener('click', function () {
      state.minutes = Number(button.dataset.minutes)
      start()
    })
  })

  el.start.addEventListener('click', function () {
    if (state.running) stop(false)
    else start()
  })

  /** 文案落到界面上；语言变化后重新走一遍。 */
  function paintLabels() {
    el.title.textContent = label('title')
    el.time.setAttribute('aria-label', label('remaining'))
    el.range.setAttribute('aria-label', label('length'))
    el.presets.setAttribute('aria-label', label('quick'))
    paint()
  }

  // 握手之后才有语言与文案：onSize 在 init 之后触发，顺带把文案补上；尺寸变化时也重排刻度。
  if (widget !== undefined) {
    widget.onSize(function () {
      paintLabels()
      paintTicks(state.running ? 1 - remainingSeconds() / totalSeconds() : selectedFraction())
      requestAnimationFrame(placeTicks)
    })
    widget.onState(restore)
  }

  // 单独打开这份文档时没有宿主，宽度变化只会走窗口的 resize。
  window.addEventListener('resize', function () { requestAnimationFrame(placeTicks) })

  buildTicks()
  buildTime()
  paintLabels()
  placeTicks()
})()
