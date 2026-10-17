/*
 * 键值卡的脚本：按 data.items 重建网格；props.columns 决定每行几项。
 */
(function () {
  var card = document.querySelector('.kv-card')
  if (!card) return

  var widget = window.widget
  var el = {
    kicker: card.querySelector('[data-field="kicker"]'),
    title: card.querySelector('[data-field="title"]'),
    meta: card.querySelector('[data-field="meta"]'),
    grid: card.querySelector('[data-role="grid"]'),
    empty: card.querySelector('[data-role="empty"]')
  }
  var LIMIT = 40

  function isZh() {
    return widget === undefined || String(widget.lang || 'zh').toLowerCase().indexOf('zh') === 0
  }

  function emptyLabel() {
    if (widget === undefined) return isZh() ? '暂无字段' : 'No fields'
    var label = widget.t('empty')
    return label === 'empty' ? (isZh() ? '暂无字段' : 'No fields') : label
  }

  function defaults() {
    if (isZh()) {
      return {
        kicker: 'KV · 06',
        title: '运行信息',
        items: [
          { key: '版本', value: '0.0.0', note: 'dsh-widget-board' },
          { key: '宿主', value: '0.2.1-rc.1', note: 'dsh' },
          { key: '组件', value: '14', note: '内置' },
          { key: '修订号', value: '42', note: '布局 7' }
        ]
      }
    }
    return {
      kicker: 'KV · 06',
      title: 'Runtime',
      items: [
        { key: 'Version', value: '0.0.0', note: 'dsh-widget-board' },
        { key: 'Host', value: '0.2.1-rc.1', note: 'dsh' },
        { key: 'Widgets', value: '14', note: 'built-in' },
        { key: 'Revisions', value: '42', note: 'layout 7' }
      ]
    }
  }

  function write(node, value) {
    if (node !== undefined && node !== null) node.textContent = value === null || value === undefined ? '' : String(value)
  }

  function applyProps(source) {
    var base = defaults()
    var props = source !== null && typeof source === 'object' ? source : {}
    write(el.kicker, typeof props.kicker === 'string' && props.kicker.trim() !== '' ? props.kicker : base.kicker)
    write(el.title, typeof props.title === 'string' && props.title.trim() !== '' ? props.title : base.title)
    var columns = typeof props.columns === 'number' && isFinite(props.columns) ? Math.round(props.columns) : 2
    card.style.setProperty('--kv-cols', String(Math.min(3, Math.max(1, columns))))
    return typeof props.meta === 'string' && props.meta.trim() !== '' ? props.meta : ''
  }

  function render(items) {
    var boxes = []
    for (var index = 0; index < items.length && boxes.length < LIMIT; index += 1) {
      var item = items[index]
      if (item === null || typeof item !== 'object' || typeof item.key !== 'string') continue
      var box = document.createElement('div')
      box.className = 'kv-card__item'
      var key = document.createElement('p')
      key.className = 'kv-card__key'
      key.textContent = item.key
      var value = document.createElement('p')
      value.className = 'kv-card__value'
      value.textContent = item.value === null || item.value === undefined ? '' : String(item.value)
      box.append(key, value)
      if (typeof item.note === 'string' && item.note.trim() !== '') {
        var note = document.createElement('p')
        note.className = 'kv-card__note'
        note.textContent = item.note
        box.appendChild(note)
      }
      boxes.push(box)
    }
    el.grid.replaceChildren.apply(el.grid, boxes)
    el.empty.textContent = emptyLabel()
    el.grid.hidden = boxes.length === 0
    el.empty.hidden = boxes.length > 0
    return boxes.length
  }

  function applyData(source) {
    var base = defaults()
    var data = source !== null && typeof source === 'object' ? source : {}
    var items = Array.isArray(data.items) ? data.items : base.items
    var count = render(items)
    var meta = applyProps(widget === undefined ? {} : widget.props)
    write(el.meta, meta !== '' ? meta : count + ' FIELDS')
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
