/*
 * 图片卡的脚本：data.src 是 data URL 或 blob URL；没有图时画一块封面。
 *
 * 沙箱的 CSP 只允许 data: 与 blob: 的图片，http(s) 地址会被浏览器拒绝，加载失败时退回占位；
 * 没有图时画一块由令牌混出来的封面（CSS 画的，不是图片），浅色与深色各有自己的底色。
 *
 * 图片来自数据源（`data.src`）还是设置里写的 `props.src`，按这个次序；封面样式由
 * `props.preset` 选：光晕点阵、几何网格、极光波浪。
 */
(function () {
  var card = document.querySelector('.image-card')
  if (!card) return

  var widget = window.widget
  var el = {
    kicker: card.querySelector('[data-field="kicker"]'),
    title: card.querySelector('[data-field="title"]'),
    meta: card.querySelector('[data-field="meta"]'),
    img: card.querySelector('[data-role="img"]'),
    cover: card.querySelector('[data-role="cover"]'),
    placeholder: card.querySelector('[data-role="placeholder"]'),
    empty: card.querySelector('[data-role="empty"]'),
    caption: card.querySelector('[data-field="caption"]')
  }
  var loaded = null
  var props = {}
  var data = {}
  var localUrl = null
  var reading = null

  /** 放开这一轮本地图片：作废在途读取、收回 blob URL，再按设置里的地址重画一次。 */
  function release() {
    if (reading) reading.abort()
    reading = null
    var had = localUrl !== null
    if (localUrl) URL.revokeObjectURL(localUrl)
    localUrl = null
    if (had) paint()
  }

  async function loadLocal() {
    release()
    if (!widget || props.localImage !== true || widget.paused) return
    var current = new AbortController()
    reading = current
    showPlaceholder()
    try {
      var blob = await widget.readMedia('background', { signal: current.signal })
      if (current.signal.aborted) return
      localUrl = URL.createObjectURL(blob)
      paint()
    } catch (error) {
      if (current.signal.aborted) return
      showPlaceholder()
      write(el.empty, error.message)
    }
  }

  function isZh() {
    return widget === undefined || String(widget.lang || 'zh').toLowerCase().indexOf('zh') === 0
  }

  function defaults() {
    if (isZh()) {
      return { title: '今日一图', caption: '点阵封面', alt: '点阵与两团光晕' }
    }
    return { title: 'Today', caption: 'Dot-grid cover', alt: 'Dot grid with two glows' }
  }

  function write(node, value) {
    if (node !== null && node !== undefined) node.textContent = value === null || value === undefined ? '' : String(value)
  }

  /** 一条文案：先看数据源给的，再看设置里写的，最后是自带的默认。 */
  function pick(fromData, fromProps, fallback) {
    if (typeof fromData === 'string' && fromData.trim() !== '') return fromData
    if (typeof fromProps === 'string' && fromProps.trim() !== '') return fromProps
    return fallback
  }

  function showCover() {
    el.img.hidden = true
    el.placeholder.hidden = true
    el.cover.hidden = false
  }

  function showPlaceholder() {
    el.img.hidden = true
    el.cover.hidden = true
    el.placeholder.hidden = false
    write(el.empty, widget === undefined ? 'No image' : widget.t('empty'))
  }

  /** 画一遍：标题区、说明与画面都从这里出去，props 或 data 变了就再画一次。 */
  function paint() {
    var base = defaults()
    var focusX = typeof props.focusX === 'number' ? props.focusX : 50
    var focusY = typeof props.focusY === 'number' ? props.focusY : 50
    var source = pick(data.src, props.src, '')
    var src = localUrl === null ? source : localUrl
    var caption = pick(data.caption, props.caption, base.caption)
    var alt = pick(data.alt, props.alt, base.alt)
    var preset = typeof props.preset === 'string' && props.preset !== '' ? props.preset : 'glow'
    write(el.kicker, typeof props.kicker === 'string' ? props.kicker : '')
    write(el.title, typeof props.title === 'string' && props.title.trim() !== '' ? props.title : base.title)
    write(el.meta, typeof props.meta === 'string' ? props.meta : '')
    write(el.caption, caption)
    el.cover.setAttribute('aria-label', alt)
    el.cover.dataset.preset = preset
    el.img.alt = alt
    el.img.style.objectPosition = String(focusX) + '% ' + String(focusY) + '%'
    if (src === loaded) return
    loaded = src
    if (src === '') { showCover(); return }
    showPlaceholder()
    el.img.onload = function () {
      el.img.hidden = false
      el.cover.hidden = true
      el.placeholder.hidden = true
    }
    el.img.onerror = function () {
      loaded = null
      showPlaceholder()
    }
    el.img.src = src
  }

  function applyProps(source) {
    props = source !== null && typeof source === 'object' ? source : {}
    paint()
  }

  function applyData(source) {
    data = source !== null && typeof source === 'object' ? source : {}
    paint()
  }

  applyProps(widget === undefined ? {} : widget.props)
  applyData(widget === undefined ? null : widget.data)
  if (widget !== undefined) {
    widget.onProps(function (props) { applyProps(props); void loadLocal() })
    widget.onData(function (data) { applyData(data); void loadLocal() })
    widget.onPause(function (paused) { if (paused) release(); else void loadLocal() })
    window.addEventListener('pagehide', release)
    void loadLocal()
  }
})()
