/*
 * 进度卡的脚本：按 data.items 重建进度条；value/max 收在 0 到 1 之间。
 */
(function () {
  var card = document.querySelector('.progress-card')
  if (!card) return

  var widget = window.widget
  var el = {
    kicker: card.querySelector('[data-field="kicker"]'),
    title: card.querySelector('[data-field="title"]'),
    meta: card.querySelector('[data-field="meta"]'),
    list: card.querySelector('[data-role="list"]'),
    empty: card.querySelector('[data-role="empty"]')
  }
  var LIMIT = 20

  function isZh() {
    return widget === undefined || String(widget.lang || 'zh').toLowerCase().indexOf('zh') === 0
  }

  function emptyLabel() {
    if (widget === undefined) return isZh() ? '暂无进度' : 'No metrics'
    var label = widget.t('empty')
    return label === 'empty' ? (isZh() ? '暂无进度' : 'No metrics') : label
  }

  function defaults() {
    if (isZh()) {
      return {
        title: '容量与配额',
        items: [
          { label: '本地存储', value: 64, max: 100, note: '64 / 100 GB' },
          { label: '上下文窗口', value: 38, max: 64, note: '38 / 64 K' },
          { label: '月度请求', value: 8200, max: 10000, note: '8.2 / 10 K' }
        ]
      }
    }
    return {
      title: 'Capacity',
      items: [
        { label: 'Local storage', value: 64, max: 100, note: '64 / 100 GB' },
        { label: 'Context window', value: 38, max: 64, note: '38 / 64 K' },
        { label: 'Monthly requests', value: 8200, max: 10000, note: '8.2 / 10 K' }
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
    return typeof props.meta === 'string' && props.meta.trim() !== '' ? props.meta : ''
  }

  function render(items) {
    var rows = []
    for (var index = 0; index < items.length && rows.length < LIMIT; index += 1) {
      var item = items[index]
      if (item === null || typeof item !== 'object' || typeof item.label !== 'string') continue
      if (typeof item.value !== 'number' || typeof item.max !== 'number' || !isFinite(item.value) || !isFinite(item.max) || item.max <= 0) continue
      var ratio = Math.min(1, Math.max(0, item.value / item.max))
      var row = document.createElement('div')
      row.className = 'progress-card__row'
      var line = document.createElement('div')
      line.className = 'progress-card__line'
      var label = document.createElement('span')
      label.className = 'progress-card__label'
      label.textContent = item.label
      var value = document.createElement('span')
      value.className = 'progress-card__value'
      value.textContent = Math.round(ratio * 100) + '%'
      line.append(label, value)
      var track = document.createElement('div')
      track.className = 'progress-card__track'
      track.setAttribute('role', 'progressbar')
      track.setAttribute('aria-label', item.label)
      track.setAttribute('aria-valuemin', '0')
      track.setAttribute('aria-valuemax', String(item.max))
      track.setAttribute('aria-valuenow', String(item.value))
      track.setAttribute('aria-valuetext', Math.round(ratio * 100) + '%')
      var bar = document.createElement('span')
      bar.className = 'progress-card__bar'
      bar.style.transform = 'scaleX(' + ratio.toFixed(4) + ')'
      track.appendChild(bar)
      row.append(line, track)
      if (typeof item.note === 'string' && item.note.trim() !== '') {
        var note = document.createElement('p')
        note.className = 'progress-card__note'
        note.textContent = item.note
        row.appendChild(note)
      }
      rows.push(row)
    }
    el.list.replaceChildren.apply(el.list, rows)
    el.empty.textContent = emptyLabel()
    el.list.hidden = rows.length === 0
    el.empty.hidden = rows.length > 0
    return rows.length
  }

  function applyData(source) {
    var base = defaults()
    var data = source !== null && typeof source === 'object' ? source : {}
    var items = Array.isArray(data.items) ? data.items : base.items
    var count = render(items)
    var meta = applyProps(widget === undefined ? {} : widget.props)
    write(el.meta, meta !== '' ? meta : isZh() ? count + ' 项' : count + (count === 1 ? ' metric' : ' metrics'))
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
