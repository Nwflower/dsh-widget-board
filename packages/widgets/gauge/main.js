/*
 * 表盘卡的脚本：按 data.items 画环形表盘。
 *
 * 每个环是一条 SVG 圆，周长固定，用 stroke-dashoffset 表示比例；比例收在 0 到 1 之间。挂载时
 * 环从空走到目标，之后数据变化直接换值。环心是百分比，环下是标签与说明。
 */
(function () {
  var card = document.querySelector('.gauge-card')
  if (!card) return

  var widget = window.widget
  var root = document.documentElement
  var NS = 'http://www.w3.org/2000/svg'
  var RADIUS = 40
  var CIRCUMFERENCE = 2 * Math.PI * RADIUS
  var LIMIT = 12

  var el = {
    kicker: card.querySelector('[data-field="kicker"]'),
    title: card.querySelector('[data-field="title"]'),
    meta: card.querySelector('[data-field="meta"]'),
    grid: card.querySelector('[data-role="grid"]'),
    empty: card.querySelector('[data-role="empty"]')
  }

  /** 第一遍画出来的环从空走到目标；之后的更新直接落在目标上。 */
  var firstPaint = true

  function isZh() {
    return widget === undefined || String(widget.lang || 'zh').toLowerCase().indexOf('zh') === 0
  }

  function emptyLabel() {
    if (widget === undefined) return isZh() ? '暂无指标' : 'No metrics'
    var label = widget.t('empty')
    return label === 'empty' ? (isZh() ? '暂无指标' : 'No metrics') : label
  }

  function defaults() {
    if (isZh()) {
      return {
        title: '配额与目标',
        items: [
          { label: '上下文窗口', value: 38, max: 64, note: '38 / 64 K' },
          { label: '月度请求', value: 8200, max: 10000, note: '8.2 / 10 K' },
          { label: '本地存储', value: 64, max: 100, note: '64 / 100 GB' }
        ]
      }
    }
    return {
      title: 'Quotas',
      items: [
        { label: 'Context window', value: 38, max: 64, note: '38 / 64 K' },
        { label: 'Monthly requests', value: 8200, max: 10000, note: '8.2 / 10 K' },
        { label: 'Local storage', value: 64, max: 100, note: '64 / 100 GB' }
      ]
    }
  }

  function write(node, value) {
    if (node !== undefined && node !== null) node.textContent = value === null || value === undefined ? '' : String(value)
  }

  function applyProps(source) {
    var base = defaults()
    var props = source !== null && typeof source === 'object' ? source : {}
    write(el.kicker, typeof props.kicker === 'string' ? props.kicker : '')
    write(el.title, typeof props.title === 'string' && props.title.trim() !== '' ? props.title : base.title)
    return typeof props.meta === 'string' ? props.meta : ''
  }

  function toneOf(item) {
    return item.tone === 'warn' || item.tone === 'danger' || item.tone === 'muted' ? item.tone : 'accent'
  }

  function circle(className) {
    var node = document.createElementNS(NS, 'circle')
    node.setAttribute('class', className)
    node.setAttribute('cx', '50')
    node.setAttribute('cy', '50')
    node.setAttribute('r', String(RADIUS))
    node.setAttribute('fill', 'none')
    node.setAttribute('stroke-width', '8')
    return node
  }

  function buildItem(item) {
    var ratio = Math.min(1, Math.max(0, item.value / item.max))
    var percent = Math.round(ratio * 100)

    var figure = document.createElement('figure')
    figure.className = 'gauge-card__item'
    figure.dataset.tone = toneOf(item)

    var ring = document.createElement('div')
    ring.className = 'gauge-card__ring'
    ring.setAttribute('role', 'img')
    ring.setAttribute('aria-label', item.label + ' ' + percent + '%')

    var svg = document.createElementNS(NS, 'svg')
    svg.setAttribute('class', 'gauge-card__svg')
    svg.setAttribute('viewBox', '0 0 100 100')
    svg.setAttribute('aria-hidden', 'true')
    var arc = circle('gauge-card__arc')
    arc.setAttribute('stroke-dasharray', CIRCUMFERENCE.toFixed(2))
    arc.setAttribute('stroke-dashoffset', (firstPaint ? CIRCUMFERENCE : CIRCUMFERENCE * (1 - ratio)).toFixed(2))
    arc.dataset.ratio = String(ratio)
    svg.append(circle('gauge-card__track'), arc)

    var value = document.createElement('span')
    value.className = 'gauge-card__value'
    value.setAttribute('aria-hidden', 'true')
    value.textContent = percent + '%'

    ring.append(svg, value)

    var caption = document.createElement('figcaption')
    caption.className = 'gauge-card__caption'
    var label = document.createElement('span')
    label.className = 'gauge-card__label'
    label.textContent = item.label
    caption.appendChild(label)
    if (typeof item.note === 'string' && item.note.trim() !== '') {
      var note = document.createElement('span')
      note.className = 'gauge-card__note'
      note.textContent = item.note
      caption.appendChild(note)
    }

    figure.append(ring, caption)
    return figure
  }

  function render(items) {
    var figures = []
    for (var index = 0; index < items.length && figures.length < LIMIT; index += 1) {
      var item = items[index]
      if (item === null || typeof item !== 'object' || typeof item.label !== 'string') continue
      if (typeof item.value !== 'number' || typeof item.max !== 'number' || !isFinite(item.value) || !isFinite(item.max) || item.max <= 0) continue
      figures.push(buildItem(item))
    }
    el.grid.replaceChildren.apply(el.grid, figures)
    el.empty.textContent = emptyLabel()
    el.grid.hidden = figures.length === 0
    el.empty.hidden = figures.length > 0
    return figures.length
  }

  /** 挂载后的第一遍：让每个环从空走到自己的比例。 */
  function play() {
    if (!firstPaint) return
    firstPaint = false
    var arcs = el.grid.querySelectorAll('.gauge-card__arc')
    var settle = function () {
      arcs.forEach(function (arc) {
        arc.setAttribute('stroke-dashoffset', String(CIRCUMFERENCE * (1 - Number(arc.dataset.ratio))))
      })
    }
    if (root.getAttribute('data-motion') === 'reduced') { settle(); return }
    requestAnimationFrame(settle)
  }

  function applyData(source) {
    var base = defaults()
    var data = source !== null && typeof source === 'object' ? source : {}
    var items = Array.isArray(data.items) ? data.items : base.items
    var count = render(items)
    play()
    var meta = applyProps(widget === undefined ? {} : widget.props)
    write(el.meta, meta !== '' ? meta : isZh() ? count + ' 个指标' : count + (count === 1 ? ' gauge' : ' gauges'))
  }

  applyProps(widget === undefined ? {} : widget.props)
  applyData(widget === undefined ? null : widget.data)
  if (widget !== undefined) {
    widget.onProps(function (props) {
      applyProps(props)
      applyData(widget.data)
    })
    widget.onData(applyData)
  }
})()
