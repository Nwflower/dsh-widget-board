/*
 * 图片卡的脚本：data.src 是 data URL 或 blob URL；没有图时画一块点阵占位。
 *
 * 沙箱的 CSP 只允许 data: 与 blob: 的图片，http(s) 地址会被浏览器拒绝，加载失败时退回占位；
 * 默认图是一张本地生成的 SVG，不联网。
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
    placeholder: card.querySelector('[data-role="placeholder"]'),
    empty: card.querySelector('[data-role="empty"]'),
    caption: card.querySelector('[data-field="caption"]')
  }
  var loaded = ''

  function isZh() {
    return widget === undefined || String(widget.lang || 'zh').toLowerCase().indexOf('zh') === 0
  }

  /** 一张不联网的默认封面：蓝色渐变、点阵与一块云。 */
  function cover() {
    var dots = ''
    for (var row = 0; row < 12; row += 1) {
      for (var column = 0; column < 22; column += 1) {
        var radius = 1 + ((row + column) % 4) * 0.6
        dots += '<circle cx="' + (40 + column * 34) + '" cy="' + (40 + row * 34) + '" r="' + radius + '"/>'
      }
    }
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e8f0ff"/><stop offset="1" stop-color="#b9d4ff"/></linearGradient></defs>' +
      '<rect width="800" height="450" fill="url(#g)"/>' +
      '<g fill="#2563eb" opacity=".38">' + dots + '</g>' +
      '<circle cx="550" cy="170" r="96" fill="#fff" opacity=".62"/>' +
      '<circle cx="632" cy="232" r="54" fill="#fff" opacity=".42"/>' +
      '<circle cx="250" cy="320" r="4" fill="#2563eb" opacity=".8"/>' +
      '<circle cx="274" cy="320" r="4" fill="#2563eb" opacity=".55"/>' +
      '<circle cx="298" cy="320" r="4" fill="#2563eb" opacity=".35"/>' +
      '</svg>'
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
  }

  function defaults() {
    if (isZh()) {
      return { title: '今日一图', caption: '蓝色点阵封面', alt: '蓝色点阵与两团白色光晕' }
    }
    return { title: 'Today', caption: 'Blue dot-grid cover', alt: 'Blue dot grid with two white glows' }
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

  function showPlaceholder() {
    el.img.hidden = true
    el.placeholder.hidden = false
    write(el.empty, widget === undefined ? 'No image' : widget.t('empty'))
  }

  function applyData(source) {
    var base = defaults()
    var data = source !== null && typeof source === 'object' ? source : {}
    var src = typeof data.src === 'string' && data.src.trim() !== '' ? data.src.trim() : cover()
    var caption = typeof data.caption === 'string' && data.caption.trim() !== '' ? data.caption : base.caption
    var alt = typeof data.alt === 'string' && data.alt.trim() !== '' ? data.alt : base.alt
    write(el.caption, caption)
    if (src === loaded) return
    loaded = src
    showPlaceholder()
    el.img.alt = alt
    el.img.onload = function () {
      el.img.hidden = false
      el.placeholder.hidden = true
    }
    el.img.onerror = function () {
      loaded = ''
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
