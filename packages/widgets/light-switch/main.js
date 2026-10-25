/*
 * 开关灯的脚本。
 *
 * 灯有两种状态：日间（浅色主题）与夜间（深色主题）。状态不另存一份，而是从宿主推进来的
 * `--w-color-bg` 计算亮度得出：用户在设置里换主题、装了皮肤插件换了配色，卡片都跟着变。
 *
 * 按下开关时先让灯自己切过去，再经通用的 `dsh.theme` 能力请宿主换主题；组件把点击位置一并报上去，
 * 父页面据此把整页的圆点转场从灯下展开（D29）。失败时把灯放回原状态，并把原因留在卡片下沿。
 */
(function () {
  var card = document.querySelector('.lamp')
  if (!card) return

  var widget = window.widget
  var root = document.documentElement
  var CAPABILITY = 'dsh.theme'
  var SWITCH_MS = 950

  var state = {
    mode: 'light',
    busy: false,
    timer: 0,
    ready: false,
    /** 等主题令牌落地之后再放的那一次圆环：{ mode, origin }。 */
    pending: null
  }

  /** 界面上要用到的节点，按 data-when 成组取一次。 */
  var el = {
    kicker: card.querySelector('.lamp__kicker'),
    state: card.querySelector('[data-role="state"]'),
    error: card.querySelector('.lamp__error'),
    titles: {},
    modes: {},
    hints: {}
  }
  var when = ['light', 'dark']
  for (var i = 0; i < when.length; i += 1) {
    var key = when[i]
    el.titles[key] = card.querySelector('.lamp__title[data-when="' + key + '"]')
    el.modes[key] = card.querySelector('.lamp__meta [data-when="' + key + '"]')
    el.hints[key] = card.querySelector('.lamp__hint[data-when="' + key + '"]')
  }

  /** 取一条 manifest 文案；组件单独打开时用传进来的中文兜底。 */
  function label(name, fallback) {
    if (widget === undefined) return fallback
    var value = widget.t(name)
    return value === name ? fallback : value
  }

  function write(node, value) {
    if (node !== undefined && node !== null) node.textContent = value
  }

  /** 把 manifest 里的文案铺到画面上；语言变化时再铺一次。 */
  function fillText() {
    write(el.kicker, label('label', '外观'))
    write(el.titles.light, label('light', '日间'))
    write(el.titles.dark, label('dark', '夜间'))
    write(el.modes.light, label('lightMode', '浅色'))
    write(el.modes.dark, label('darkMode', '深色'))
    write(el.hints.light, label('hintLight', '轻点开灯，进入夜间'))
    write(el.hints.dark, label('hintDark', '轻点熄灯，回到日间'))
    card.setAttribute('aria-label', label('switchLabel', '切换深色与浅色模式'))
  }

  /** 根节点上此刻的令牌值。 */
  function token(name) {
    return getComputedStyle(root).getPropertyValue(name).trim()
  }

  /** 把 `#rgb`、`#rrggbb`、`rgb()` 与 `rgba()` 解成三个 0–255 的通道；认不出时是 null。 */
  function parseColor(raw) {
    if (raw === '') return null
    if (raw.charAt(0) === '#') {
      var hex = raw.slice(1)
      if (hex.length === 3 || hex.length === 4) {
        return [
          parseInt(hex.charAt(0) + hex.charAt(0), 16),
          parseInt(hex.charAt(1) + hex.charAt(1), 16),
          parseInt(hex.charAt(2) + hex.charAt(2), 16)
        ]
      }
      if (hex.length === 6 || hex.length === 8) {
        return [
          parseInt(hex.slice(0, 2), 16),
          parseInt(hex.slice(2, 4), 16),
          parseInt(hex.slice(4, 6), 16)
        ]
      }
      return null
    }
    var match = /^rgba?\(([^)]+)\)$/.exec(raw)
    if (match === null) return null
    var parts = match[1].split(/[\s,/]+/).filter(function (part) { return part !== '' })
    if (parts.length < 3) return null
    var channels = []
    for (var i = 0; i < 3; i += 1) {
      var value = parseFloat(parts[i])
      if (!isFinite(value)) return null
      channels.push(parts[i].indexOf('%') >= 0 ? value * 2.55 : value)
    }
    return channels
  }

  /** 相对亮度：深色底与浅色底的分界用 0.4 附近的值就够稳。 */
  function luminance(channels) {
    var weights = [0.2126, 0.7152, 0.0722]
    var total = 0
    for (var i = 0; i < 3; i += 1) {
      var channel = channels[i] / 255
      total += weights[i] * (channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4))
    }
    return total
  }

  /** 从宿主令牌判当前配色；令牌还没到、颜色认不出时退回系统偏好。 */
  function modeFromTokens() {
    var background = parseColor(token('--w-color-bg'))
    if (background !== null) return luminance(background) > 0.42 ? 'light' : 'dark'
    var foreground = parseColor(token('--w-color-fg'))
    if (foreground !== null) return luminance(foreground) > 0.5 ? 'dark' : 'light'
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark'
    return 'light'
  }

  /** 把状态写到画面上：属性、读屏文字与开关语义。 */
  function paint(mode) {
    state.mode = mode
    card.setAttribute('data-mode', mode)
    card.setAttribute('aria-checked', mode === 'dark' ? 'true' : 'false')
    write(el.state, mode === 'dark' ? label('stateDark', '当前为深色模式') : label('stateLight', '当前为浅色模式'))
  }

  /** 放一次圆环与拉绳的过场；圆心已经由 aim 放好。 */
  function ring() {
    card.setAttribute('data-switching', 'true')
    window.clearTimeout(state.timer)
    state.timer = window.setTimeout(function () {
      card.removeAttribute('data-switching')
    }, SWITCH_MS)
  }

  /**
   * 宿主换主题、换皮肤或换语言之后，卡片跟着重读一次。
   *
   * 圆环不在按下的一刻起跑：整页转场要等快照拍完才开始，令牌这时才推到卡片里。等这一档真的落到
   * 卡片上再放圆环，两个圆才会同时从同一个点展开（D29）。
   */
  function sync() {
    var mode = modeFromTokens()
    paint(mode)
    fillText()
    var pending = state.pending
    if (pending !== null && mode === pending.mode) {
      state.pending = null
      aim(pending.origin)
      ring()
    }
  }

  /** 显示一次失败；成功切换时清掉。 */
  function fail(message) {
    write(el.error, message)
  }

  function clear() {
    write(el.error, '')
  }

  /** 切换失败后，等宿主下一次把令牌推回来再对齐一次，避免卡片停在乐观状态。 */
  function recover() {
    window.setTimeout(sync, 0)
  }

  /** 按下的位置换算成卡片内的坐标；键盘触发时用灯泡中心。 */
  function originOf(event) {
    var rect = card.getBoundingClientRect()
    var x = rect.width / 2
    var y = rect.height * 0.43
    if (event !== undefined && event !== null && typeof event.clientX === 'number') {
      x = event.clientX - rect.left
      y = event.clientY - rect.top
    } else {
      var bulb = card.querySelector('.lamp__bulb')
      if (bulb !== null) {
        var box = bulb.getBoundingClientRect()
        x = box.left - rect.left + box.width / 2
        y = box.top - rect.top + box.height / 2
      }
    }
    return { x: x, y: y }
  }

  /** 把波纹的圆心放到这次按下的位置；整页转场用的是同一个点（D29）。 */
  function aim(origin) {
    card.style.setProperty('--lamp-ring-x', origin.x.toFixed(1) + 'px')
    card.style.setProperty('--lamp-ring-y', origin.y.toFixed(1) + 'px')
  }

  /** 按下开关：请宿主换主题，等新配色落到卡片里再换灯。 */
  function toggle(event) {
    if (state.busy) return
    if (widget !== undefined && widget.size !== undefined && widget.size !== null && widget.size.placement === 'preview') return
    var before = state.mode
    var target = before === 'dark' ? 'light' : 'dark'
    // 圆环与整页的圆心取同一处：卡片内的按下点，键盘触发时取灯泡中心。
    var origin = originOf(event)
    aim(origin)
    if (widget === undefined) {
      paint(target)
      ring()
      return
    }
    state.pending = { mode: target, origin: origin }
    state.busy = true
    clear()
    widget.call(CAPABILITY, { preference: target, origin: origin }).then(function (result) {
      // 令牌通常先到，sync 已经换好并放了圆环；宿主落定得比令牌早时，再读一次令牌。
      if (result !== null && result !== undefined && state.pending !== null) window.setTimeout(sync, 0)
    }, function (error) {
      state.pending = null
      recover()
      fail(error !== null && error !== undefined && error.message ? error.message : String(error))
    }).then(function () {
      state.busy = false
    })
  }

  card.addEventListener('click', toggle)
  card.addEventListener('keydown', function (event) {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    toggle(event)
  })

  fillText()
  paint(modeFromTokens())
  // 令牌可能在脚本执行之后才到；先让画面出来，再在观察回调里对齐，避免一直空着。
  window.requestAnimationFrame(function () {
    card.setAttribute('data-ready', 'true')
  })
  new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ['style', 'lang'] })
})()
