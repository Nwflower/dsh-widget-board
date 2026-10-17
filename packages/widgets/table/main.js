/*
 * 表格卡的脚本：data.columns 决定表头，data.rows 按列的 key 取值；所有文字按纯文本写入。
 */
(function () {
  var card = document.querySelector('.table-card')
  if (!card) return

  var widget = window.widget
  var el = {
    kicker: card.querySelector('[data-field="kicker"]'),
    title: card.querySelector('[data-field="title"]'),
    meta: card.querySelector('[data-field="meta"]'),
    head: card.querySelector('[data-role="head"]'),
    body: card.querySelector('[data-role="body"]'),
    wrap: card.querySelector('[data-role="wrap"]'),
    empty: card.querySelector('[data-role="empty"]')
  }
  var MAX_COLUMNS = 12
  var MAX_ROWS = 200

  function isZh() {
    return widget === undefined || String(widget.lang || 'zh').toLowerCase().indexOf('zh') === 0
  }

  function emptyLabel() {
    if (widget === undefined) return isZh() ? '暂无行' : 'No rows'
    var label = widget.t('empty')
    return label === 'empty' ? (isZh() ? '暂无行' : 'No rows') : label
  }

  function defaults() {
    if (isZh()) {
      return {
        kicker: 'TABLE · 03',
        title: '服务状态',
        columns: [
          { key: 'name', label: '服务' },
          { key: 'state', label: '状态' },
          { key: 'latency', label: '延迟', align: 'right' }
        ],
        rows: [
          { name: '宿主', state: '在线', latency: '12 ms' },
          { name: '组件库', state: '在线', latency: '4 ms' },
          { name: '事件推送', state: '重连中', latency: '—' },
          { name: '数据源', state: '未绑定', latency: '—' }
        ]
      }
    }
    return {
      kicker: 'TABLE · 03',
      title: 'Services',
      columns: [
        { key: 'name', label: 'Service' },
        { key: 'state', label: 'State' },
        { key: 'latency', label: 'Latency', align: 'right' }
      ],
      rows: [
        { name: 'Host', state: 'Online', latency: '12 ms' },
        { name: 'Library', state: 'Online', latency: '4 ms' },
        { name: 'Events', state: 'Reconnecting', latency: '—' },
        { name: 'Data source', state: 'Not bound', latency: '—' }
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

  function render(columns, rows) {
    var cells = columns.slice(0, MAX_COLUMNS).filter(function (column) {
      return column !== null && typeof column === 'object' && typeof column.key === 'string' && column.key !== ''
    })
    var bodyRows = rows.slice(0, MAX_ROWS).filter(function (row) {
      return row !== null && typeof row === 'object'
    })
    var head = []
    cells.forEach(function (column) {
      var th = document.createElement('th')
      th.textContent = typeof column.label === 'string' ? column.label : column.key
      if (column.align === 'right') th.dataset.align = 'right'
      head.push(th)
    })
    el.head.replaceChildren.apply(el.head, head)
    var body = []
    bodyRows.forEach(function (row) {
      var tr = document.createElement('tr')
      cells.forEach(function (column) {
        var td = document.createElement('td')
        var value = row[column.key]
        td.textContent = value === null || value === undefined ? '' : String(value)
        if (column.align === 'right') td.dataset.align = 'right'
        if (typeof value === 'number') td.dataset.numeric = 'true'
        tr.appendChild(td)
      })
      body.push(tr)
    })
    el.body.replaceChildren.apply(el.body, body)
    var empty = cells.length === 0 || bodyRows.length === 0
    el.empty.textContent = emptyLabel()
    el.wrap.hidden = empty
    el.empty.hidden = !empty
    return { columns: cells.length, rows: bodyRows.length }
  }

  function applyData(source) {
    var base = defaults()
    var data = source !== null && typeof source === 'object' ? source : {}
    var columns = Array.isArray(data.columns) ? data.columns : base.columns
    var rows = Array.isArray(data.rows) ? data.rows : base.rows
    var counts = render(columns, rows)
    var meta = applyProps(widget === undefined ? {} : widget.props)
    write(el.meta, meta !== '' ? meta : counts.columns + ' COLS · ' + counts.rows + ' ROWS')
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
