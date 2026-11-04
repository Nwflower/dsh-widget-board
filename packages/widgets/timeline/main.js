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

  /** 缩略画面：没有真数据时用一份样例，缩略图不会是一片空白。 */
  function isPreview() {
    if (widget === undefined || widget.size === null || widget.size === undefined) return false
    return widget.size.placement === 'preview'
  }

  function emptyLabel() {
    if (widget === undefined) return isZh() ? '暂无事件' : 'No events'
    var label = widget.t('empty')
    return label === 'empty' ? (isZh() ? '暂无事件' : 'No events') : label
  }

  function defaults() {
    if (isZh()) {
      return {
        title: '最近活动',
        items: [
          { time: '09:12', title: '同步看板快照', detail: '卡片与组件库一起更新', status: 'ok' },
          { time: '10:40', title: '提交自由布局', detail: '列 2 · 高 22rem', status: 'ok' },
          { time: '11:05', title: '推送一张卡的数据', detail: '事件增量，没有重取整块看板', status: 'idle' }
        ]
      }
    }
    return {
      title: 'Recent activity',
      items: [
        { time: '09:12', title: 'Board snapshot synced', detail: 'Cards and library updated together', status: 'ok' },
        { time: '10:40', title: 'Free layout committed', detail: 'Column 2 · 22rem high', status: 'ok' },
        { time: '11:05', title: 'Instance data pushed', detail: 'Event delta, no full snapshot refetch', status: 'idle' }
      ]
    }
  }

  function statusLabel(status) {
    if (isZh()) return status === 'ok' ? '正常' : status === 'warn' ? '注意' : status === 'error' ? '异常' : '空闲'
    return status === 'ok' ? 'OK' : status === 'warn' ? 'Warning' : status === 'error' ? 'Error' : 'Idle'
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
      if (item === null || typeof item !== 'object' || typeof item.title !== 'string') continue
      var row = document.createElement('div')
      row.className = 'timeline-card__row'
      var status = item.status === 'ok' || item.status === 'warn' || item.status === 'error' ? item.status : 'idle'
      row.dataset.status = status
      var time = document.createElement('p')
      time.className = 'timeline-card__time'
      time.textContent = typeof item.time === 'string' ? item.time : ''
      var title = document.createElement('p')
      title.className = 'timeline-card__title'
      title.textContent = item.title
      var state = document.createElement('span')
      state.className = 'w-sr'
      state.textContent = statusLabel(status)
      row.append(time, title, state)
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
    var items = base.items
    if (Array.isArray(data.items)) items = data.items.length === 0 && isPreview() ? base.items : data.items
    var count = render(items)
    var meta = applyProps(widget === undefined ? {} : widget.props)
    write(el.meta, meta !== '' ? meta : isZh() ? count + ' 个事件' : count + (count === 1 ? ' event' : ' events'))
  }

  applyProps(widget === undefined ? {} : widget.props)
  applyData(widget === undefined ? null : widget.data)
  if (widget !== undefined) {
    widget.onProps(function (props) {
      applyProps(props)
      applyData(widget.data)
    })
    widget.onData(applyData)
    // 位置变了要重画：缩略画面里空清单画样例，看板上画空态。
    widget.onSize(function () { applyData(widget.data) })
  }
})()
