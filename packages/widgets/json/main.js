/*
 * JSON 卡片的脚本：把 data.value 递归画成一棵树。
 *
 * 对象与数组前面是折叠按钮，前两层默认展开；再深的层收起，点按钮逐层展开。节点数与深度都有上限，
 * 超大值只画前一部分。key 为空的那一层是根，不显示键名。
 */
(function () {
  var card = document.querySelector('.json-card')
  if (!card) return

  var widget = window.widget
  var LIMIT = 200
  var MAX_DEPTH = 5

  var el = {
    kicker: card.querySelector('[data-field="kicker"]'),
    title: card.querySelector('[data-field="title"]'),
    meta: card.querySelector('[data-field="meta"]'),
    tree: card.querySelector('[data-role="tree"]'),
    caption: card.querySelector('[data-field="caption"]')
  }

  var state = { value: undefined, caption: '' }
  var count = 0

  function isZh() {
    return widget === undefined || String(widget.lang || 'zh').toLowerCase().indexOf('zh') === 0
  }

  function defaults() {
    return {
      title: isZh() ? '配置' : 'Config',
      value: {
        name: 'widget-board',
        version: '0.2.0',
        enabled: true,
        cards: 21,
        sizes: ['s', 'l'],
        limits: { cards: 200, dataBytes: 60000 },
        owner: null
      },
      caption: ''
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

  function truncate(text) {
    return text.length > 120 ? text.slice(0, 120) + '…' : text
  }

  function keyNode(key, array) {
    var node = document.createElement('span')
    node.className = 'json-card__key'
    if (array) node.textContent = '[' + key + ']'
    else if (key !== '') node.textContent = '"' + key + '"'
    return node
  }

  function buildLeaf(key, value, array) {
    count += 1
    var node = document.createElement('div')
    node.className = 'json-card__row'
    if (array) node.appendChild(keyNode(key, true))
    else if (key !== '') node.appendChild(keyNode(key, false))
    var literal = document.createElement('span')
    literal.className = 'json-card__value'
    if (typeof value === 'string') {
      literal.dataset.type = 'string'
      literal.textContent = '"' + truncate(value) + '"'
    } else if (typeof value === 'number') {
      literal.dataset.type = 'number'
      literal.textContent = String(value)
    } else if (typeof value === 'boolean') {
      literal.dataset.type = 'boolean'
      literal.textContent = String(value)
    } else if (value === null) {
      literal.dataset.type = 'null'
      literal.textContent = 'null'
    } else {
      literal.textContent = String(value)
    }
    node.appendChild(literal)
    return node
  }

  function buildBranch(key, value, depth, array) {
    count += 1
    var entries = array
      ? value.map(function (item, index) { return [index, item] })
      : Object.keys(value).map(function (name) { return [name, value[name]] })
    var open = depth < 2
    var wrapper = document.createElement('div')
    wrapper.className = 'json-card__branch'

    var head = document.createElement('div')
    head.className = 'json-card__head'
    var toggle = document.createElement('button')
    toggle.type = 'button'
    toggle.className = 'json-card__toggle'
    toggle.setAttribute('aria-expanded', String(open))
    toggle.setAttribute('aria-label', (array ? 'array ' : 'object ') + (key === '' ? 'root' : key))
    toggle.textContent = open ? '▾' : '▸'
    head.appendChild(toggle)
    if (!array && key !== '') head.appendChild(keyNode(key, false))
    var summary = document.createElement('span')
    summary.className = 'json-card__summary'
    summary.textContent = (array ? '[' : '{') + '…' + (array ? ']' : '}') + ' ' + entries.length + (isZh() ? ' 项' : ' items')
    head.appendChild(summary)

    var children = document.createElement('div')
    children.className = 'json-card__children'
    children.hidden = !open

    if (depth >= MAX_DEPTH) {
      summary.textContent = '…'
      wrapper.appendChild(head)
      return wrapper
    }

    var index = 0
    while (index < entries.length && count < LIMIT) {
      var entry = entries[index]
      var child = entry[1] !== null && typeof entry[1] === 'object'
        ? buildBranch(entry[0], entry[1], depth + 1, Array.isArray(entry[1]))
        : buildLeaf(entry[0], entry[1], array)
      children.appendChild(child)
      index += 1
    }

    toggle.addEventListener('click', function () {
      var expanded = toggle.getAttribute('aria-expanded') === 'true'
      toggle.setAttribute('aria-expanded', String(!expanded))
      toggle.textContent = expanded ? '▸' : '▾'
      children.hidden = expanded
    })

    wrapper.append(head, children)
    return wrapper
  }

  function render() {
    count = 0
    var value = state.value
    var node = value !== null && typeof value === 'object'
      ? buildBranch('', value, 0, Array.isArray(value))
      : buildLeaf('', value, false)
    el.tree.replaceChildren(node)
    var meta = applyProps(widget === undefined ? {} : widget.props)
    if (meta === '') {
      var isArray = Array.isArray(value)
      var size = value !== null && typeof value === 'object' ? (isArray ? value.length : Object.keys(value).length) : 1
      meta = isArray
        ? size + (isZh() ? ' 项' : ' items')
        : size + (isZh() ? ' 个键' : ' keys')
    }
    write(el.meta, meta)
    if (state.caption !== '') {
      write(el.caption, state.caption)
      el.caption.hidden = false
    } else {
      el.caption.textContent = ''
      el.caption.hidden = true
    }
  }

  function applyData(source) {
    var base = defaults()
    var data = source !== null && typeof source === 'object' ? source : {}
    state.value = 'value' in data ? data.value : base.value
    state.caption = typeof data.caption === 'string' && data.caption.trim() !== '' ? data.caption : ''
    render()
  }

  applyProps(widget === undefined ? {} : widget.props)
  applyData(widget === undefined ? null : widget.data)
  if (widget !== undefined) {
    widget.onProps(function (props) {
      applyProps(props)
      render()
    })
    widget.onData(applyData)
  }
})()
