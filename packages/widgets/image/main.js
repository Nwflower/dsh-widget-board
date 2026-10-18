/*
 * 图片卡的脚本：data.src 是 data URL 或 blob URL；没有图时画一块点阵占位。
 *
 * 沙箱的 CSP 只允许 data: 与 blob: 的图片，http(s) 地址会被浏览器拒绝，加载失败时退回占位；
 * 没有 data.src 时画一块由令牌混出来的点阵封面（CSS 画的，不是图片），浅色与深色各有自己的底色。
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
    if (node !== undefined && node !== null) node.textContent = value === null || value === undefined ? '' : String(value)
  }

  function applyProps(source) {
    var base = defaults()
    var props = source !== null && typeof source === 'object' ? source : {}
    write(el.kicker, typeof props.kicker === 'string' ? props.kicker : '')
    write(el.title, typeof props.title === 'string' && props.title.trim() !== '' ? props.title : base.title)
    write(el.meta, typeof props.meta === 'string' ? props.meta : '')
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

  function applyData(source) {
    var base = defaults()
    var data = source !== null && typeof source === 'object' ? source : {}
    var src = typeof data.src === 'string' ? data.src.trim() : ''
    var caption = typeof data.caption === 'string' && data.caption.trim() !== '' ? data.caption : base.caption
    var alt = typeof data.alt === 'string' && data.alt.trim() !== '' ? data.alt : base.alt
    write(el.caption, caption)
    el.cover.setAttribute('aria-label', alt)
    if (src === loaded) return
    loaded = src
    if (src === '') { showCover(); return }
    showPlaceholder()
    el.img.alt = alt
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

  applyProps(widget === undefined ? {} : widget.props)
  applyData(widget === undefined ? null : widget.data)
  if (widget !== undefined) {
    widget.onProps(applyProps)
    widget.onData(applyData)
  }
})()
