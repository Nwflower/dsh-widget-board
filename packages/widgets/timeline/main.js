/*
 * 时间线卡的脚本：按 data.items 重建事件；状态只影响节点的颜色。
 */
(function () {
  var card = document.querySelector('.timeline-card')
  if (!card) return

  var widget = window.widget
  var el = {
    kicker: card.querySelector('[data-field="kicker"]'),
    title: card.querySelector('[data-field="title"]'),
    meta: card.querySelector('[data-field="meta"]'),
    list: card.querySelector('[data-role="list"]'),
    empty: card.querySelector('[data-role="empty"]')
  }
  var LIMIT = 50

  function isZh() {
    return widget === undefined || String(widget.lang || 'zh').toLowerCase().indexOf('zh') === 0
  }

  function emptyLabel() {
    if (widget === undefined) return isZh() ? '暂无事件' : 'No events'
    var label = widget.t('empty')
    return label === 'empty' ? (isZh() ? '暂无事件' : 'No events') : label
  }

  function defaults() {
    if (isZh()) {
      return {
        kicker: 'TIMELINE · 07',
        title: '最近活动',
        items: [
          { time: '09:12', title: '同步看板快照', detail: '卡片与组件库一起更新', status: 'ok' },
          { time: '10:40', title: '提交自由布局', detail: '列 2 · 高 22rem', status: 'ok' },
          { time: '11:05', title: '推送一张卡的数据', detail: '事件增量，没有重取整块看板', status: 'idle' }
        ]
      }
    }
    return {
      kicker: 'TIMELINE · 07',
      title: 'Recent activity',
      items: [
        { time: '09:12', title: 'Board snapshot synced', detail: 'Cards and library updated together', status: 'ok' },
        { time: '10:40', title: 'Free layout committed', detail: 'Column 2 · 22rem high', status: 'ok' },
        { time: '11:05', title: 'Instance data pushed', detail: 'Event delta, no full snapshot refetch', status: 'idle' }
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
    return typeof props.meta === 'string' && props.meta.trim() !== '' ? props.meta : ''
  }

  function render(items) {
    var rows = []
    for (var index = 0; index < items.length && rows.length < LIMIT; index += 1) {
      var item = items[index]
      if (item === null || typeof item !== 'object' || typeof item.title !== 'string') continue
      var row = document.createElement('div')
      row.className = 'timeline-card__row'
      row.dataset.status = item.status === 'ok' || item.status === 'warn' || item.status === 'error' ? item.status : 'idle'
      var time = document.createElement('p')
      time.className = 'timeline-card__time'
      time.textContent = typeof item.time === 'string' ? item.time : ''
      var title = document.createElement('p')
      title.className = 'timeline-card__title'
      title.textContent = item.title
      row.append(time, title)
      if (typeof item.detail === 'string' && item.detail.trim() !== '') {
        var detail = document.createElement('p')
        detail.className = 'timeline-card__detail'
        detail.textContent = item.detail
        row.appendChild(detail)
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
    write(el.meta, meta !== '' ? meta : count + ' EVENTS')
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
