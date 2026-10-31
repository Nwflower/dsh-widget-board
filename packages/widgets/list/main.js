/*
 * 列表卡的脚本：按 data.items 重建行，props 改标题区；没有数据时用一份双语示例。
 */
(function () {
  var card = document.querySelector('.list-card')
  if (!card) return

  var widget = window.widget
  var el = {
    kicker: card.querySelector('[data-field="kicker"]'),
    title: card.querySelector('[data-field="title"]'),
    meta: card.querySelector('[data-field="meta"]'),
    list: card.querySelector('[data-role="list"]'),
    empty: card.querySelector('[data-role="empty"]')
  }
  var LIMIT = 100

  function isZh() {
    return widget === undefined || String(widget.lang || 'zh').toLowerCase().indexOf('zh') === 0
  }

  function emptyLabel() {
    if (widget === undefined) return isZh() ? '暂无条目' : 'Nothing here yet'
    var label = widget.t('empty')
    return label === 'empty' ? (isZh() ? '暂无条目' : 'Nothing here yet') : label
  }

  function defaults() {
    if (isZh()) {
      return {
        title: '最近事件',
        meta: '',
        items: [
          { title: '合并事件增量', meta: '12ms', status: 'ok' },
          { title: '等待授权的脚本', meta: '1 项', status: 'warn' },
          { title: '组件库重载', meta: '3 个版本', status: 'idle' }
        ]
      }
    }
    return {
      title: 'Recent events',
      meta: '',
      items: [
        { title: 'Merged event deltas', meta: '12ms', status: 'ok' },
        { title: 'Script waiting for approval', meta: '1 item', status: 'warn' },
        { title: 'Widget library reloaded', meta: '3 versions', status: 'idle' }
      ]
    }
  }

  /** 接上实时数据没有别的标志：数据源给的是一份会话与工作区的清单，标题跟着换。 */
  var live = false

  function defaultTitle() {
    if (!live) return defaults().title
    return isZh() ? '会话与工作区' : 'Sessions and workspace'
  }

  function statusLabel(status) {
    if (isZh()) return status === 'ok' ? '正常' : status === 'warn' ? '注意' : status === 'error' ? '异常' : '空闲'
    return status === 'ok' ? 'OK' : status === 'warn' ? 'Warning' : status === 'error' ? 'Error' : 'Idle'
  }

  function write(node, value) {
    if (node !== undefined && node !== null) node.textContent = value === null || value === undefined ? '' : String(value)
  }

  function applyProps(source) {
    var props = source !== null && typeof source === 'object' ? source : {}
    write(el.kicker, typeof props.kicker === 'string' ? props.kicker : '')
    write(el.title, typeof props.title === 'string' && props.title.trim() !== '' ? props.title : defaultTitle())
    return typeof props.meta === 'string' && props.meta.trim() !== '' ? props.meta : ''
  }

  function render(items) {
    var rows = []
    for (var index = 0; index < items.length && rows.length < LIMIT; index += 1) {
      var item = items[index]
      if (item === null || typeof item !== 'object' || typeof item.title !== 'string' || item.title.trim() === '') continue
      var row = document.createElement('div')
      row.className = 'list-card__row'
      var status = item.status === 'ok' || item.status === 'warn' || item.status === 'error' ? item.status : 'idle'
      row.dataset.status = status
      var dot = document.createElement('span')
      dot.className = 'list-card__dot'
      dot.setAttribute('aria-hidden', 'true')
      var title = document.createElement('span')
      title.className = 'list-card__title'
      title.textContent = item.title
      var state = document.createElement('span')
      state.className = 'w-sr'
      state.textContent = statusLabel(status)
      var meta = document.createElement('span')
      meta.className = 'list-card__meta'
      meta.textContent = typeof item.meta === 'string' ? item.meta : ''
      row.append(dot, title, state, meta)
      rows.push(row)
    }
    el.list.replaceChildren.apply(el.list, rows)
    el.empty.textContent = emptyLabel()
    el.empty.hidden = rows.length > 0
    el.list.hidden = rows.length === 0
    return rows.length
  }

  function applyData(source) {
    var base = defaults()
    var data = source !== null && typeof source === 'object' ? source : {}
    live = Array.isArray(data.items)
    var items = live ? data.items : base.items
    var count = render(items)
    var meta = applyProps(widget === undefined ? {} : widget.props)
    write(el.meta, meta !== '' ? meta : isZh() ? count + ' 项' : count + (count === 1 ? ' item' : ' items'))
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
