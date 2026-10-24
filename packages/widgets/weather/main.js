/*
 * 天气卡的脚本：窗外是一幅画，卡片是它前面的一层玻璃。
 *
 * 数据来自 manifest 的 `request.url`：宿主请求 Open-Meteo，把原始响应推来，这里映射成五天预报。
 * 画面由两份同目录的脚本画：`world.js` 画窗外的景，`glass.js` 画玻璃上的雨雪与水珠。这一份只管
 * 卡片的文字、预报栏、选中哪一天，以及什么时候重画、什么时候停下。
 *
 * 组件与外界只有 `window.widget` 这条路（D7）。动效跟随宿主的动画档位与暂停状态（D10、D16）：
 * 减弱动效时只留一帧静止的雨窗，卡片离开视口就停下，不再逐帧重画。
 */
;(function () {
  var card = document.querySelector('.wx')
  if (!card) return

  var widget = window.widget
  var root = document.documentElement
  var canvas = card.querySelector('[data-role="scene"]')

  /** 没有配置城市时的地点；与 widget.json 里 props schema 的默认值一致。 */
  var DEFAULT_PLACE = { zh: '北京', en: 'Beijing' }

  /** 卡片能放下的预报天数。 */
  var SLOTS = 5

  /** 画布最大像素比：再高的屏也按 2 算，水珠够细，代价不涨。 */
  var MAX_DPR = 2

  /**
   * WMO 天气代码到图标与天空的映射。
   *
   * Open-Meteo 只给代码。天空决定画面：晴、云、雨、雪、雷各有画法，文字照实写。
   */
  var WEATHER = {
    0: ['sun', 'clear', '晴', 'Clear'],
    1: ['sun', 'clear', '大部晴朗', 'Mostly clear'],
    2: ['cloud', 'cloudy', '多云', 'Partly cloudy'],
    3: ['cloud', 'overcast', '阴', 'Overcast'],
    45: ['cloud', 'overcast', '雾', 'Fog'],
    48: ['cloud', 'overcast', '雾凇', 'Rime fog'],
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
    71: ['snow', 'snow', '小雪', 'Light snow'],
    73: ['snow', 'snow', '中雪', 'Snow'],
    75: ['snow', 'snow', '大雪', 'Heavy snow'],
    77: ['snow', 'snow', '雪粒', 'Snow grains'],
    80: ['rain', 'rain', '阵雨', 'Rain showers'],
    81: ['rain', 'rain', '阵雨', 'Rain showers'],
    82: ['rain', 'rain', '强阵雨', 'Violent rain showers'],
    85: ['snow', 'snow', '阵雪', 'Snow showers'],
    86: ['snow', 'snow', '阵雪', 'Snow showers'],
    95: ['bolt', 'storm', '雷暴', 'Thunderstorm'],
    96: ['bolt', 'storm', '雷暴伴冰雹', 'Thunderstorm with hail'],
    99: ['bolt', 'storm', '雷暴伴冰雹', 'Thunderstorm with hail']
  }

  /** 切换栏那一格的小图标路径。 */
  var TAB_PATHS = {
    sun: 'M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z',
    moon: 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z',
    cloud: 'M2.25 15a4.5 4.5 0 0 0 4.5 4.5H18a3.75 3.75 0 0 0 1.332-7.257 3 3 0 0 0-3.758-3.848 5.25 5.25 0 0 0-10.233 2.33A4.502 4.502 0 0 0 2.25 15Z',
    rain: 'M2.25 15a4.5 4.5 0 0 0 4.5 4.5H18a3.75 3.75 0 0 0 1.332-7.257 3 3 0 0 0-3.758-3.848 5.25 5.25 0 0 0-10.233 2.33A4.502 4.502 0 0 0 2.25 15Z',
    snow: 'M12 2.5v19M2.8 7.25l18.4 10.5M21.2 7.25 2.8 17.75M12 6.4l2.6-2.1M12 6.4 9.4 4.3M12 17.6l2.6 2.1M12 17.6l-2.6 2.1',
    bolt: 'm3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z'
  }

  var el = {
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
  /** 这一帧的天空与昼夜，来自当前选中的那天。 */
  var sky = { scene: 'cloudy', night: false }
  /** 世界那层画布：每换一次天重画一次。 */
  var world = null
  var worldCanvas = null
  var skyLayer = null
  var groundLayer = null
  var clouds = []
  var hidden = false
  var frameHandle = 0
  var lastStamp = 0
  var clock = 0
  var flashAt = -1e9
  var metrics = { w: 0, h: 0, dpr: 1 }

  var rand = function (a, b) { return a + Math.random() * (b - a) }

  function zh() { return String(widget ? widget.lang : root.lang || 'en').indexOf('zh') === 0 }
  function pick(pair) { return pair ? (zh() ? pair.zh : pair.en) : '' }
  function reduced() { return root.getAttribute('data-motion') === 'reduced' }
  /** 宿主的配色是不是深的；只认 `data-scheme`，不认卡片自己写上去的文字色。 */
  function dark() { return card.dataset.scheme === 'dark' }
  function ms(name, fallback) {
    var value = parseFloat(getComputedStyle(root).getPropertyValue(name))
    return isFinite(value) ? value : fallback
  }
  function t(key, fallback) { return widget ? widget.t(key) : fallback }

  /** 一条天气代码对应的图标、天空与文字；晴天的夜里换成月亮。 */
  function describe(code, night) {
    var entry = WEATHER[code] || WEATHER[3]
    var icon = night && entry[0] === 'sun' ? 'moon' : entry[0]
    return { icon: icon, sky: entry[1], zh: entry[2], en: entry[3] }
  }

  // ── 画布 ───────────────────────────────────────────────

  /** 一块按像素比放大、坐标仍按 CSS 像素算的画布。 */
  function surface(node, w, h, dpr) {
    node.width = Math.max(1, Math.round(w * dpr))
    node.height = Math.max(1, Math.round(h * dpr))
    var ctx = node.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    return ctx
  }

  /** 造一块离屏画布，交给 `world.js` 与 `glass.js` 用。 */
  function make(w, h, dpr) {
    var node = document.createElement('canvas')
    return { canvas: node, ctx: surface(node, w, h, dpr === undefined ? 1 : dpr) }
  }

  var glass = window.WxGlass.createGlass({ make: make, rand: rand })

  /** 按当前盒子与天空重建世界与玻璃。 */
  function rebuild() {
    var box = canvas.getBoundingClientRect()
    var w = Math.max(1, Math.round(box.width || card.clientWidth || 320))
    var h = Math.max(1, Math.round(box.height || card.clientHeight || 220))
    var dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1)
    metrics = { w: w, h: h, dpr: dpr }
    surface(canvas, w, h, dpr)

    // 天与地面分两层：云要飘在城市后面，城市就得叠在云之上。
    skyLayer = make(w, h, dpr)
    window.WxWorld.paintSky(skyLayer.ctx, w, h, sky.scene, sky.night, dark())
    groundLayer = make(w, h, dpr)
    window.WxWorld.paintGround(groundLayer.ctx, w, h, sky.night)
    world = make(w, h, dpr)
    world.ctx.drawImage(skyLayer.canvas, 0, 0, w, h)
    world.ctx.drawImage(groundLayer.canvas, 0, 0, w, h)
    worldCanvas = world.canvas
    glass.rebuild(w, h, dpr, sky.scene, sky.night, skyLayer.canvas, groundLayer.canvas, worldCanvas)

    // 云：晴天与多云是几朵会飘的积云，阴雨雪天是一层柔云。
    var tone = window.WxWorld.cloudTone(sky.scene, sky.night, dark())
    var dry = sky.scene === 'clear' || sky.scene === 'cloudy'
    var counts = dry
      ? (sky.scene === 'clear' ? 4 : 5)
      : ({ overcast: 7, rain: 6, storm: 7, snow: 5 }[sky.scene] || 4)
    var speeds = dry
      ? (sky.scene === 'clear' ? [2, 5] : [3, 7])
      : ({ overcast: [3, 7], rain: [3, 6], storm: [4, 9], snow: [1.5, 4] }[sky.scene] || [2, 5])
    clouds = []
    // 日月的位置：飘动的云也按它的方向受光，云和日月的明暗才是一套
    var bodyX = w * (sky.night ? 0.76 : 0.74)
    var bodyY = h * (sky.night ? 0.24 : 0.22)
    for (var c = 0; c < counts; c += 1) {
      var size = h * (dry ? rand(0.26, 0.44) : rand(0.26, 0.48))
      var cloudX = rand(-w * 0.3, w * 1.1)
      var cloudY = h * rand(dry ? 0.02 : 0.03, dry ? 0.22 : 0.34)
      var vx = bodyX - cloudX
      var vy = bodyY - cloudY
      var len = Math.max(1, Math.sqrt(vx * vx + vy * vy))
      clouds.push({
        sprite: dry
          ? window.WxWorld.cumulusSprite(function (cw, ch) { return make(cw, ch, 1) }, size, tone, 200 + c * 13, { x: vx / len, y: vy / len })
          : window.WxWorld.cloudSprite(function (s) { return make(s, s, 1) }, h * rand(0.13, 0.24), sky.night ? 'rgba(150,175,205,A)' : 'rgba(255,255,255,A)'),
        x: cloudX,
        y: cloudY,
        speed: rand(speeds[0], speeds[1]),
        scale: dry ? rand(0.85, 1.15) : rand(0.7, 1.3),
        alpha: dry ? rand(0.8, 0.96) : rand(0.3, 0.5)
      })
    }
  }

  /** 画一帧：窗外的景、飘过的云、远处的雨丝、玻璃上的水珠与雪，最后压一层颗粒。 */
  function paint() {
    if (worldCanvas === null) return
    var ctx = canvas.getContext('2d')
    var w = metrics.w
    var h = metrics.h
    var scene = sky.scene
    ctx.clearRect(0, 0, w, h)
    // 顺序就是它们的远近：天在最里，星与云在它前面，城市挡住云，水珠与雪落在玻璃上最外。
    var dry = scene === 'clear' || scene === 'cloudy'
    glass.paintBackdrop(ctx, dry)

    // 夜里才有的星：逐帧画，慢慢闪。
    if (sky.night) {
      var starAlpha = scene === 'clear' ? 1 : scene === 'cloudy' ? 0.45 : scene === 'snow' ? 0.3 : 0.15
      window.WxWorld.paintStars(ctx, w, h, clock, starAlpha)
    }

    for (var c = 0; c < clouds.length; c += 1) {
      var cloud = clouds[c]
      var span = cloud.sprite.width * cloud.scale
      var x = ((cloud.x + clock * cloud.speed + span) % (w + span * 2)) - span
      ctx.globalAlpha = cloud.alpha
      ctx.drawImage(cloud.sprite, x, cloud.y, span, cloud.sprite.height * cloud.scale)
    }
    ctx.globalAlpha = 1

    glass.paintGround(ctx, dry)

    // 远处落下的雨丝：玻璃上看不清细节，只留一层斜线
    if (scene === 'rain' || scene === 'storm') {
      var count = scene === 'storm' ? 46 : 30
      var seed = window.WxWorld.seeded(919)
      ctx.strokeStyle = scene === 'storm' ? 'rgba(206,226,246,0.3)' : 'rgba(214,232,248,0.22)'
      ctx.lineWidth = 1
      ctx.beginPath()
      for (var s = 0; s < count; s += 1) {
        var sx = seed() * w
        var speed = 220 + seed() * 260
        var sy = (seed() * h + clock * speed) % (h + 40) - 20
        var length = 10 + seed() * 16
        ctx.moveTo(sx, sy)
        ctx.lineTo(sx - length * 0.14, sy + length)
      }
      ctx.stroke()
    }

    glass.paint(ctx, scene, reduced() ? 40 : 18)

    // 雷：一亮一暗再补一下，像真的落雷
    if (scene === 'storm') {
      var since = clock - flashAt
      if (since >= 0 && since < 0.34) {
        var power = since < 0.05 ? 0.62 : since < 0.1 ? 0.1 : since < 0.18 ? 0.48 : since < 0.24 ? 0.08 : 0.22
        ctx.fillStyle = 'rgba(226,240,255,' + power.toFixed(3) + ')'
        ctx.fillRect(0, 0, w, h)
      }
    }
  }

  /** 逐帧推进；暂停、减弱动效或不可见时停下。 */
  function loop(stamp) {
    frameHandle = 0
    if (hidden) return
    var dt = lastStamp === 0 ? 1 / 60 : Math.min(0.05, (stamp - lastStamp) / 1000)
    lastStamp = stamp
    clock += dt
    // 落雷隔两三秒一次，比之前密得多
    if (sky.scene === 'storm' && clock >= flashAt + 0.34) flashAt = clock + 2.2 + rand(0, 2.6)
    glass.advance(dt, sky.scene)
    paint()
    frameHandle = window.requestAnimationFrame(loop)
  }

  function start() {
    if (frameHandle !== 0 || hidden) return
    lastStamp = 0
    frameHandle = window.requestAnimationFrame(loop)
  }

  function stop() {
    if (frameHandle === 0) return
    window.cancelAnimationFrame(frameHandle)
    frameHandle = 0
  }

  /** 换一片天空：重画世界、重建贴图，再决定要不要继续动。 */
  function adoptSky(scene, night) {
    var changed = scene !== sky.scene || night !== sky.night || worldCanvas === null
    sky = { scene: scene, night: night }
    card.dataset.scene = scene
    applyTextTheme()
    if (changed) {
      clock = 0
      // 切到雷暴天时，第一声雷在将近一秒后落下
      flashAt = 0.8
      rebuild()
    }
    paint()
    if (reduced()) stop()
    else start()
  }

  // ── 卡片的结构与交互 ───────────────────────────────────

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

  /** 预报所在地今天的日期；`daily.time` 是地点当地的日期。 */
  function todayAt(zone) {
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: zone || undefined, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
    } catch (error) {
      return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
    }
  }

  /** 卡片上方那一行：预报所在地这一天的月日与星期。 */
  function longDate(date, locale) {
    return new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric', weekday: 'long' }).format(date)
  }

  function weekday(date, locale, style) {
    return new Intl.DateTimeFormat(locale, { weekday: style }).format(date)
  }

  /**
   * 卡片上的地点：设置里解析出的双语地名优先，其次是人写的城市名，都没有时是默认地点。
   *
   * 城市名只由设置界面解析成坐标与双语地名，组件自己拿不到网络（D3）；这里不再回填 `place`，
   * 一次只读一次 props 给出的东西。
   */
  function placeOf(props) {
    var value = props && props.place
    if (value && typeof value.zh === 'string' && typeof value.en === 'string') return value
    var city = props && typeof props.city === 'string' ? props.city.trim() : ''
    if (city !== '') return { zh: city, en: city }
    return DEFAULT_PLACE
  }

  /** 数字：逐位换成新值，后两位错开出现，没变的位不动。 */
  function setDigits(group, next, instant) {
    var text = String(next)
    var previous = group.textContent.replace(/\s+/g, '')
    if (previous === text) return
    if (instant || reduced()) {
      group.textContent = text
      return
    }
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
    if (instant || reduced()) {
      node.textContent = next
      return
    }
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
    if (instant || reduced()) {
      node.textContent = next
      return
    }
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
    el.place.textContent = pick(place)
    el.day.textContent = '—'
    delete el.day.dataset.text
    el.cond.textContent = t('loading', 'Fetching weather')
    el.temp.textContent = '--'
    el.hi.textContent = '--'
    el.lo.textContent = '--'
    el.tabs.forEach(function (tab, index) {
      tabIcon(tab, 'cloud')
      tab.querySelector('.wx-tab-day').textContent = '—'
      tab.querySelector('.wx-tab-temp').textContent = '--'
      tab.disabled = true
      tab.setAttribute('aria-selected', index === 0 ? 'true' : 'false')
      tab.setAttribute('tabindex', index === 0 ? '0' : '-1')
    })
    el.panel.setAttribute('aria-labelledby', el.tabs[0].id)
    moveTo(el.tabs[0], false)
    adoptSky('cloudy', dark())
  }

  /** 数据还没到、请求也没回来：把等待换成一句可见的原因。 */
  function showUnavailable() {
    if (days.length > 0) return
    el.cond.textContent = t('unavailable', 'Weather unavailable')
  }

  /** 把第 i 天画到卡上；`instant` 用于首帧与语言切换。 */
  function paintDay(i, instant) {
    var day = days[i]
    if (day === undefined) {
      paintEmpty()
      return
    }
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
      tab.querySelector('.wx-tab-day').textContent = entry === undefined ? '—' : pick(entry.short)
      tab.querySelector('.wx-tab-temp').textContent = entry === undefined ? '--' : entry.mean + '°'
      tab.setAttribute('aria-selected', index === i ? 'true' : 'false')
      tab.setAttribute('tabindex', index === i ? '0' : '-1')
    })
    el.panel.setAttribute('aria-labelledby', el.tabs[i].id)
    moveTo(el.tabs[i], instant !== true)
    adoptSky(day.sky, day.night)
  }

  /** 选中第 i 天；`quiet` 用于从宿主存下的状态恢复，不再回头写一次。 */
  function select(i, focus, quiet) {
    if (days.length === 0 || i === current || i < 0 || i >= days.length || i >= el.tabs.length) return
    current = i
    paintDay(i, false)
    if (focus) el.tabs[i].focus()
    if (quiet !== true && widget) widget.setState({ day: i })
  }

  el.tabs.forEach(function (tab, index) {
    tab.addEventListener('click', function () { select(index, false) })
  })
  el.bar.addEventListener('keydown', function (event) {
    if (days.length === 0) return
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      select((current + 1) % days.length, true)
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      select((current - 1 + days.length) % days.length, true)
    }
  })

  /** 宿主推来的原始 Open-Meteo 数据换成卡片自己的五天预报。 */
  function adoptData(data) {
    if (!data || !data.daily || !Array.isArray(data.daily.time)) return false
    var daily = data.daily
    var currentReading = data.current || {}
    // 缓存的响应可能已经跨过地点的零点：丢掉过去的日子，从今天起算；全是过去的日子时原样显示。
    var today = todayAt(typeof data.timezone === 'string' ? data.timezone : '')
    var first = 0
    while (first < daily.time.length && String(daily.time[first]) < today) first += 1
    if (first >= daily.time.length) first = 0
    var count = Math.min(daily.time.length - first, SLOTS, el.tabs.length)
    if (count === 0) return false
    var nightNow = currentReading.is_day === 0
    var next = []
    for (var n = 0; n < count; n += 1) {
      var i = first + n
      var high = daily.temperature_2m_max[i]
      var low = daily.temperature_2m_min[i]
      if (typeof high !== 'number' || typeof low !== 'number') return false
      var mean = daily.temperature_2m_mean[i]
      var isToday = String(daily.time[i]) === today
      var code = isToday && typeof currentReading.weather_code === 'number' ? currentReading.weather_code : daily.weather_code[i]
      var night = isToday && nightNow
      var weather = describe(code, night)
      var date = dayOf(daily.time[i])
      var temp = isToday && typeof currentReading.temperature_2m === 'number'
        ? Math.round(currentReading.temperature_2m)
        : Math.round(typeof mean === 'number' ? mean : (high + low) / 2)
      next.push({
        name: { zh: longDate(date, 'zh-CN'), en: longDate(date, 'en-US') },
        short: isToday ? { zh: '今天', en: 'Today' } : { zh: weekday(date, 'zh-CN', 'short'), en: weekday(date, 'en-US', 'short') },
        mean: Math.round(typeof mean === 'number' ? mean : (high + low) / 2),
        icon: weather.icon,
        sky: weather.sky,
        night: night,
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
    paintDay(current, true)
    // 数据先到、状态后到：状态里选中的那一天盖回来。
    if (wanted >= 0) select(wanted, false, true)
    return true
  }

  /**
   * 文字用深色还是浅色。
   *
   * 看两件事：宿主的配色，与这一帧的天。深色主题或画里的夜晚都用浅色字；浅色主题的白天用深色字。
   * 夜里即使是浅色主题，窗外也是暗的，白字才读得清。
   *
   * 写到 `data-theme` 上，`dark()` 读的是 `data-scheme`：两者分开，否则这里写下去的值会被当成
   * 宿主的配色读回来，画过的天就换不回来了。
   */
  function applyTextTheme() {
    card.dataset.theme = dark() || sky.night ? 'dark' : 'light'
  }

  /** 宿主的配色变了：窗外那幅画与文字色都要重画。 */
  function watchScheme() {
    var previous = card.dataset.scheme
    card.dataset.scheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    applyTextTheme()
    if (card.dataset.scheme === previous || worldCanvas === null) return
    rebuild()
    paint()
  }

  if (widget) {
    widget.onSize(function () {
      rebuild()
      paint()
      if (days.length === 0) paintEmpty()
    })
    widget.onProps(function (props) {
      place = placeOf(props)
      if (days.length === 0) el.place.textContent = pick(place)
      else paintDay(current, true)
    })
    widget.onData(function (data) { adoptData(data) })
    widget.onState(function (value) {
      if (!value || typeof value.day !== 'number') return
      wanted = value.day
      select(wanted, false, true)
    })
    widget.onPause(function (paused) {
      hidden = paused
      if (paused) stop()
      else if (!reduced()) start()
    })
  }

  watchScheme()
  var scheme = window.matchMedia('(prefers-color-scheme: dark)')
  if (typeof scheme.addEventListener === 'function') scheme.addEventListener('change', watchScheme)

  // 盒子由看板拖动改变，画布跟着换尺寸。
  if (typeof ResizeObserver === 'function') {
    var watching = false
    new ResizeObserver(function () {
      if (watching || hidden) return
      watching = true
      window.requestAnimationFrame(function () {
        watching = false
        if (hidden) return
        rebuild()
        paint()
      })
    }).observe(canvas)
  }

  place = placeOf(widget ? widget.props : {})
  paintEmpty()
  loadTimer = window.setTimeout(showUnavailable, 15000)
  window.requestAnimationFrame(function () { moveTo(el.tabs[current], false) })
  window.addEventListener('resize', function () {
    moveTo(el.tabs[current], false)
    rebuild()
    paint()
  })
})()
