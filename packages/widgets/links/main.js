/*
 * 链接卡的脚本：按 data.items 铺出每一行，域名从地址里取。
 *
 * 地址只用来显示：行内没有做成按钮，键盘焦点也不会停在上面（要开链接的卡片可用 `widget.open`，
 * D26）。读不出来的地址原样显示，不让整张卡空掉。
 */
(function () {
  var card = document.querySelector('.links-card')
  if (!card) return

  var widget = window.widget
  var LIMIT = 40

  var el = {
    kicker: card.querySelector('[data-field="kicker"]'),
    title: card.querySelector('[data-field="title"]'),
    meta: card.querySelector('[data-field="meta"]'),
    list: card.querySelector('[data-role="list"]'),
    rows: card.querySelector('[data-role="rows"]'),
    empty: card.querySelector('[data-role="empty"]')
  }

  function isZh() {
    return widget === undefined || String(widget.lang || 'zh').toLowerCase().indexOf('zh') === 0
  }

  function emptyLabel() {
    if (widget === undefined) return isZh() ? '暂无链接' : 'No links'
    var value = widget.t('empty')
    return value === 'empty' ? (isZh() ? '暂无链接' : 'No links') : value
  }

  function defaults() {
    if (isZh()) {
      return {
        title: '书签',
        items: [
          { title: 'DeepSeek Harness', url: 'https://github.com/deepseek-ai/dsh', note: '宿主' },
          { title: '组件格式', url: 'https://github.com/Nwflower/dsh-widget-board', note: '文档' },
          { title: '本地宿主', url: 'http://127.0.0.1:54904', note: '开发' },
          { title: '设计参考', url: 'https://transitions.dev', note: '动效' }
        ]
      }
    }
    return {
      title: 'Bookmarks',
      items: [
        { title: 'DeepSeek Harness', url: 'https://github.com/deepseek-ai/dsh', note: 'Host' },
        { title: 'Widget format', url: 'https://github.com/Nwflower/dsh-widget-board', note: 'Docs' },
        { title: 'Local host', url: 'http://127.0.0.1:54904', note: 'Dev' },
        { title: 'Design reference', url: 'https://transitions.dev', note: 'Motion' }
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

  /** 从地址里取域名；读不出来时退回原串，去掉协议头。 */
  function hostOf(url) {
    try {
      var parsed = new URL(url)
      return parsed.hostname.replace(/^www\./, '')
    } catch (error) {
      return url.replace(/^[a-z]+:\/\//i, '').replace(/\/.*$/, '')
    }
  }

  function markOf(title) {
    var trimmed = title.trim()
    return trimmed === '' ? '#' : trimmed.slice(0, 1)
  }

  function render(items) {
    var rows = []
    for (var index = 0; index < items.length && rows.length < LIMIT; index += 1) {
      var item = items[index]
      if (item === null || typeof item !== 'object') continue
      if (typeof item.title !== 'string' || typeof item.url !== 'string') continue
      var row = document.createElement('div')
      row.className = 'links-card__row'
      var mark = document.createElement('span')
      mark.className = 'links-card__mark'
      mark.setAttribute('aria-hidden', 'true')
      mark.textContent = markOf(item.title)
      var body = document.createElement('div')
      body.className = 'links-card__body'
      var title = document.createElement('div')
      title.className = 'links-card__title'
      title.textContent = item.title
      var host = document.createElement('div')
      host.className = 'links-card__host'
      host.textContent = hostOf(item.url)
      body.append(title, host)
      row.append(mark, body)
      if (typeof item.note === 'string' && item.note.trim() !== '') {
        var note = document.createElement('span')
        note.className = 'links-card__note'
        note.textContent = item.note
        row.appendChild(note)
      }
      row.title = item.url
      rows.push(row)
    }
    el.rows.replaceChildren.apply(el.rows, rows)
    el.empty.textContent = emptyLabel()
    el.list.hidden = rows.length === 0
    el.empty.hidden = rows.length > 0
    var meta = applyProps(widget === undefined ? {} : widget.props)
    write(el.meta, meta !== '' ? meta : rows.length + (isZh() ? ' 条' : ' links'))
    return rows.length
  }

  function applyData(source) {
    var base = defaults()
    var data = source !== null && typeof source === 'object' ? source : {}
    render(Array.isArray(data.items) ? data.items : base.items)
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
