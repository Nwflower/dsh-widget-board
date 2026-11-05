/*
 * 链接卡的脚本：按 data.items 铺出每一行，域名从地址里取；用户加的书签存在卡片状态里。
 *
 * 每一行的主体是一个按钮：点它把地址交给 `widget.open`，由包着它的页面在新标签页里打开（D26）。
 * 浏览器只认跟在用户操作后面的那一次打开，所以检查与调用都写在点击处理里。
 *
 * 用户加的书签经 `widget.setState` 交给宿主存下来（D5）：切走再切回、页面重挂之后还在。存下来的
 * 书签排在数据源给的清单前面。
 */
(function () {
  var card = document.querySelector('.links-card')
  if (!card) return

  var widget = window.widget
  var LIMIT = 40
  var MAX_CUSTOM = 40
  var MAX_TITLE = 80
  var MAX_URL = 400

  var el = {
    kicker: card.querySelector('[data-field="kicker"]'),
    title: card.querySelector('[data-field="title"]'),
    meta: card.querySelector('[data-field="meta"]'),
    rows: card.querySelector('[data-role="rows"]'),
    empty: card.querySelector('[data-role="empty"]'),
    adder: card.querySelector('[data-role="adder"]'),
    toggle: card.querySelector('[data-role="toggle"]'),
    newTitle: card.querySelector('[data-role="new-title"]'),
    newUrl: card.querySelector('[data-role="new-url"]'),
    save: card.querySelector('[data-role="new-save"]'),
    close: card.querySelector('[data-role="new-close"]')
  }

  var custom = []
  var props = {}
  var data = null
  /** 存下的书签只在第一次收到状态时接过来；之后的回声不覆盖正在改的那一份。 */
  var restored = false

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
    if (node !== null && node !== undefined) node.textContent = value === null || value === undefined ? '' : String(value)
  }

  /** 只有 http 与 https 的地址能交给宿主打开。 */
  function openable(url) {
    return /^https?:\/\//i.test(url)
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

  /** 存下的书签：标题与地址都要有，其余丢掉。 */
  function sanitize(raw) {
    if (!Array.isArray(raw)) return []
    var cleaned = []
    for (var index = 0; index < raw.length && cleaned.length < MAX_CUSTOM; index += 1) {
      var item = raw[index]
      if (item === null || typeof item !== 'object') continue
      var title = typeof item.title === 'string' ? item.title.trim().slice(0, MAX_TITLE) : ''
      var url = typeof item.url === 'string' ? item.url.trim().slice(0, MAX_URL) : ''
      if (title === '' || url === '') continue
      cleaned.push({ title: title, url: url })
    }
    return cleaned
  }

  function sameItems(left, right) {
    if (left.length !== right.length) return false
    for (var index = 0; index < left.length; index += 1) {
      if (left[index].title !== right[index].title || left[index].url !== right[index].url) return false
    }
    return true
  }

  /** 行里的主体：能打开的地址做成按钮，其余是一段不能点的文字。 */
  function openPart(item) {
    var canOpen = openable(item.url)
    var node = document.createElement(canOpen ? 'button' : 'div')
    node.className = canOpen ? 'links-card__open' : 'links-card__static'
    if (canOpen) {
      node.type = 'button'
      node.dataset.url = item.url
      node.setAttribute('aria-label', (isZh() ? '打开 ' : 'Open ') + item.title)
    }
    var mark = document.createElement('span')
    mark.className = 'links-card__mark'
    mark.setAttribute('aria-hidden', 'true')
    mark.textContent = markOf(item.title)
    var body = document.createElement('span')
    body.className = 'links-card__body'
    var title = document.createElement('span')
    title.className = 'links-card__title'
    title.textContent = item.title
    var host = document.createElement('span')
    host.className = 'links-card__host'
    host.textContent = hostOf(item.url)
    body.append(title, host)
    node.append(mark, body)
    return node
  }

  function rowOf(item, isCustom, index) {
    var row = document.createElement('div')
    row.className = 'links-card__row'
    if (isCustom) row.dataset.custom = ''
    row.appendChild(openPart(item))
    if (typeof item.note === 'string' && item.note.trim() !== '') {
      var note = document.createElement('span')
      note.className = 'links-card__note'
      note.textContent = item.note
      row.appendChild(note)
    }
    if (isCustom) {
      var remove = document.createElement('button')
      remove.type = 'button'
      remove.className = 'links-card__remove'
      remove.dataset.index = String(index)
      remove.setAttribute('aria-label', isZh() ? '移除书签' : 'Remove bookmark')
      remove.textContent = '×'
      row.appendChild(remove)
    }
    return row
  }

  function render() {
    var base = defaults()
    var source = data !== null && typeof data === 'object' ? data : {}
    var items = Array.isArray(source.items) ? source.items : base.items
    var rows = []
    for (var index = 0; index < custom.length; index += 1) rows.push(rowOf(custom[index], true, index))
    for (var sourceIndex = 0; sourceIndex < items.length && rows.length < LIMIT; sourceIndex += 1) {
      var item = items[sourceIndex]
      if (item === null || typeof item !== 'object') continue
      if (typeof item.title !== 'string' || typeof item.url !== 'string') continue
      rows.push(rowOf(item, false, sourceIndex))
    }
    el.rows.replaceChildren.apply(el.rows, rows)
    el.empty.textContent = emptyLabel()
    // 清单空了就把行收起来，空状态占住中间；滚动区本身留着，加号与输入行始终够得着。
    el.rows.hidden = rows.length === 0
    el.empty.hidden = rows.length > 0
    write(el.kicker, typeof props.kicker === 'string' ? props.kicker : '')
    write(el.title, typeof props.title === 'string' && props.title.trim() !== '' ? props.title : base.title)
    var meta = typeof props.meta === 'string' && props.meta.trim() !== '' ? props.meta : rows.length + (isZh() ? ' 条' : ' links')
    write(el.meta, meta)
  }

  function applyProps(source) {
    props = source !== null && typeof source === 'object' ? source : {}
    render()
  }

  function applyData(source) {
    data = source !== null && typeof source === 'object' ? source : {}
    render()
  }

  /** 存下用户加的书签。 */
  function save() {
    if (widget !== undefined) widget.setState({ customItems: custom })
  }

  /** 读回存着的书签；和手上的一份一样就不重画。 */
  function applyState(value) {
    if (restored) return
    if (value === null || typeof value !== 'object') return
    restored = true
    var next = sanitize(value.customItems)
    if (sameItems(next, custom)) return
    custom = next
    render()
  }

  function setAdder(open) {
    el.adder.hidden = !open
    el.toggle.setAttribute('aria-expanded', open ? 'true' : 'false')
    if (open) el.newTitle.focus()
  }

  function addCustom() {
    var title = el.newTitle.value.trim().slice(0, MAX_TITLE)
    var url = el.newUrl.value.trim().slice(0, MAX_URL)
    if (title === '' || url === '') return
    custom = custom.concat([{ title: title, url: url }]).slice(0, MAX_CUSTOM)
    el.newTitle.value = ''
    el.newUrl.value = ''
    setAdder(false)
    render()
    save()
  }

  function removeCustom(index) {
    if (index < 0 || index >= custom.length) return
    custom = custom.filter(function (item, position) { return position !== index })
    render()
    save()
  }

  el.rows.addEventListener('click', function (event) {
    var target = event.target
    if (!(target instanceof Element)) return
    var remove = target.closest('.links-card__remove')
    if (remove !== null) {
      removeCustom(Number(remove.dataset.index))
      return
    }
    var open = target.closest('.links-card__open')
    if (open === null) return
    var url = open.dataset.url === undefined ? '' : open.dataset.url
    if (!openable(url)) return
    if (widget !== undefined && typeof widget.open === 'function') widget.open(url)
  })

  el.toggle.addEventListener('click', function () { setAdder(el.adder.hidden) })
  el.save.addEventListener('click', addCustom)
  el.close.addEventListener('click', function () { setAdder(false) })

  el.newUrl.addEventListener('keydown', function (event) {
    if (event.key === 'Enter') {
      event.preventDefault()
      addCustom()
      return
    }
    if (event.key === 'Escape') setAdder(false)
  })

  el.newTitle.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') setAdder(false)
  })

  el.newTitle.placeholder = isZh() ? '标题' : 'Title'
  el.newUrl.placeholder = 'https://example.com'
  el.save.textContent = isZh() ? '保存' : 'Save'
  el.toggle.setAttribute('aria-label', isZh() ? '添加书签' : 'Add bookmark')
  el.close.setAttribute('aria-label', isZh() ? '关闭' : 'Close')

  if (widget !== undefined) {
    widget.onProps(applyProps)
    widget.onData(applyData)
    widget.onState(applyState)
  }

  applyProps(widget === undefined ? {} : widget.props)
  applyData(widget === undefined ? null : widget.data)
  applyState(widget === undefined ? null : widget.state)
  setAdder(false)
})()
