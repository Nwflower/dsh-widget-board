/*
 * 图表卡的脚本：把 data.points 画成折线、面积或柱状，props 的 kind 切换画法。
 *
 * 只有采样点与一条时间轴，不引第三方图表库；坐标在 100×52 的 viewBox 里算，SVG 按卡片拉伸，
 * 线宽用 vector-effect 保持像素宽度。
 */
(function () {
  var card = document.querySelector('.chart-card')
  if (!card) return

  var widget = window.widget
  var NS = 'http://www.w3.org/2000/svg'
  var el = {
    kicker: card.querySelector('[data-field="kicker"]'),
    title: card.querySelector('[data-field="title"]'),
    meta: card.querySelector('[data-field="meta"]'),
    grid: card.querySelector('[data-role="grid"]'),
    area: card.querySelector('[data-role="area"]'),
    line: card.querySelector('[data-role="line"]'),
    bars: card.querySelector('[data-role="bars"]'),
    dot: card.querySelector('[data-role="dot"]'),
    axis: card.querySelector('[data-role="axis"]'),
    caption: card.querySelector('[data-field="caption"]'),
    empty: card.querySelector('[data-role="empty"]')
  }
  var MAX_POINTS = 60

  function isZh() {
    return widget === undefined || String(widget.lang || 'zh').toLowerCase().indexOf('zh') === 0
  }

  function emptyLabel() {
    if (widget === undefined) return isZh() ? '暂无采样点' : 'No samples'
    var label = widget.t('empty')
    return label === 'empty' ? (isZh() ? '暂无采样点' : 'No samples') : label
  }

  function defaults() {
    if (isZh()) {
      return {
        kicker: 'CHART · 04',
        title: '请求量',
        caption: '最近七天 · 每小时的请求数',
        points: [
          { label: '周一', value: 32 }, { label: '周二', value: 48 }, { label: '周三', value: 41 },
          { label: '周四', value: 66 }, { label: '周五', value: 58 }, { label: '周六', value: 74 },
          { label: '周日', value: 63 }
        ]
      }
    }
    return {
      kicker: 'CHART · 04',
      title: 'Requests',
      caption: 'Last seven days · requests per hour',
      points: [
        { label: 'Mon', value: 32 }, { label: 'Tue', value: 48 }, { label: 'Wed', value: 41 },
        { label: 'Thu', value: 66 }, { label: 'Fri', value: 58 }, { label: 'Sat', value: 74 },
        { label: 'Sun', value: 63 }
      ]
    }
  }

  function write(node, value) {
    if (node !== undefined && node !== null) node.textContent = value === null || value === undefined ? '' : String(value)
  }

  function svg(name, attributes) {
    var node = document.createElementNS(NS, name)
    for (var key in attributes) {
      if (!Object.prototype.hasOwnProperty.call(attributes, key)) continue
      node.setAttribute(key, String(attributes[key]))
    }
    return node
  }

  function applyProps(source) {
    var base = defaults()
    var props = source !== null && typeof source === 'object' ? source : {}
    write(el.kicker, typeof props.kicker === 'string' && props.kicker.trim() !== '' ? props.kicker : base.kicker)
    write(el.title, typeof props.title === 'string' && props.title.trim() !== '' ? props.title : base.title)
    card.dataset.kind = props.kind === 'area' || props.kind === 'bar' ? props.kind : 'line'
    return typeof props.meta === 'string' && props.meta.trim() !== '' ? props.meta : ''
  }

  function draw(points) {
    var values = points.map(function (point) { return point.value })
    var maximum = Math.max.apply(null, values.concat([1]))
    var minimum = Math.min.apply(null, values.concat([0]))
    var span = maximum - minimum || 1
    var count = points.length
    var coordinates = points.map(function (point, index) {
      var x = count === 1 ? 50 : (index / (count - 1)) * 100
      var y = 46 - ((point.value - minimum) / span) * 42
      return { x: x, y: y }
    })
    var grid = []
    ;[4, 18, 32, 46].forEach(function (y) {
      grid.push(svg('line', { x1: 0, y1: y, x2: 100, y2: y }))
    })
    el.grid.replaceChildren.apply(el.grid, grid)

    if (count === 0) {
      el.line.setAttribute('d', '')
      el.area.setAttribute('d', '')
      el.bars.replaceChildren()
      el.dot.hidden = true
      el.axis.replaceChildren()
      return
    }

    var line = coordinates.map(function (point, index) {
      return (index === 0 ? 'M' : 'L') + point.x.toFixed(2) + ' ' + point.y.toFixed(2)
    }).join(' ')
    var area = line + ' L' + coordinates[coordinates.length - 1].x.toFixed(2) + ' 46 L' + coordinates[0].x.toFixed(2) + ' 46 Z'
    el.line.setAttribute('d', line)
    el.area.setAttribute('d', area)
    el.dot.hidden = count !== 1
    if (count === 1) {
      el.dot.setAttribute('cx', String(coordinates[0].x))
      el.dot.setAttribute('cy', String(coordinates[0].y))
    }

    var step = 100 / Math.max(1, count)
    var bars = coordinates.map(function (point) {
      var width = step * 0.56
      return svg('rect', {
        class: 'chart-card__bar',
        x: (point.x - width / 2).toFixed(2),
        y: point.y.toFixed(2),
        width: width.toFixed(2),
        height: Math.max(0, 46 - point.y).toFixed(2),
        rx: 1
      })
    })
    el.bars.replaceChildren.apply(el.bars, bars)

    var labels = count === 1 ? [0] : [0, Math.floor((count - 1) / 2), count - 1]
    var axis = []
    var seen = {}
    labels.forEach(function (index) {
      if (seen[index]) return
      seen[index] = true
      var span = document.createElement('span')
      span.textContent = points[index].label
      axis.push(span)
    })
    el.axis.replaceChildren.apply(el.axis, axis)
  }

  function applyData(source) {
    var base = defaults()
    var data = source !== null && typeof source === 'object' ? source : {}
    var points = Array.isArray(data.points) ? data.points.slice(0, MAX_POINTS).filter(function (point) {
      return point !== null && typeof point === 'object' && typeof point.label === 'string' && typeof point.value === 'number' && isFinite(point.value)
    }) : base.points
    write(el.caption, typeof data.caption === 'string' && data.caption.trim() !== '' ? data.caption : base.caption)
    draw(points)
    var empty = points.length === 0
    el.empty.textContent = emptyLabel()
    el.empty.hidden = !empty
    el.grid.hidden = empty
    el.line.hidden = empty
    el.area.hidden = empty
    el.bars.hidden = empty
    el.axis.hidden = empty
    var meta = applyProps(widget === undefined ? {} : widget.props)
    write(el.meta, meta !== '' ? meta : points.length + ' POINTS')
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
