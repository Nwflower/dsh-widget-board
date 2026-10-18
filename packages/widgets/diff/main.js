/*
 * 改动视图的脚本：按 data.lines 铺出每一行，行首给加减号。
 *
 * 行的类型只有四种：add、remove、context 与 meta（文件路径一类的分节标题）。没写类型时按
 * context 处理，未知类型也收进上下文。meta 行总数显示在右上角的 meta 里。
 */
(function () {
  var card = document.querySelector('.diff-card')
  if (!card) return

  var widget = window.widget
  var LIMIT = 400

  var el = {
    kicker: card.querySelector('[data-field="kicker"]'),
    title: card.querySelector('[data-field="title"]'),
    meta: card.querySelector('[data-field="meta"]'),
    list: card.querySelector('[data-role="list"]'),
    empty: card.querySelector('[data-role="empty"]')
  }

  function isZh() {
    return widget === undefined || String(widget.lang || 'zh').toLowerCase().indexOf('zh') === 0
  }

  function emptyLabel() {
    if (widget === undefined) return isZh() ? '暂无改动' : 'No changes'
    var value = widget.t('empty')
    return value === 'empty' ? (isZh() ? '暂无改动' : 'No changes') : value
  }

  function defaults() {
    return {
      title: isZh() ? '改动' : 'Changes',
      lines: [
        { type: 'meta', text: 'src/board/layout.ts' },
        { type: 'context', text: 'export function place(cards, columns) {' },
        { type: 'remove', text: '  const gap = 8' },
        { type: 'add', text: '  const gap = 12' },
        { type: 'context', text: '  return cards.map((card, index) => ({' },
        { type: 'remove', text: '    x: index % columns,' },
        { type: 'add', text: '    x: index % Math.max(1, columns),' },
        { type: 'context', text: '    y: Math.floor(index / columns)' },
        { type: 'context', text: '  }))' },
        { type: 'context', text: '}' }
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

  function typeOf(line) {
    return line.type === 'add' || line.type === 'remove' || line.type === 'meta' ? line.type : 'context'
  }

  function render(lines) {
    var rows = []
    var added = 0
    var removed = 0
    for (var index = 0; index < lines.length && rows.length < LIMIT; index += 1) {
      var line = lines[index]
      if (line === null || typeof line !== 'object' || typeof line.text !== 'string') continue
      var type = typeOf(line)
      if (type === 'add') added += 1
      if (type === 'remove') removed += 1
      var row = document.createElement('div')
      row.className = 'diff-card__line'
      row.dataset.type = type
      var sign = document.createElement('span')
      sign.className = 'diff-card__sign'
      sign.textContent = type === 'add' ? '+' : type === 'remove' ? '-' : ''
      var text = document.createElement('span')
      text.className = 'diff-card__text'
      text.textContent = line.text
      row.append(sign, text)
      rows.push(row)
    }
    el.list.replaceChildren.apply(el.list, rows)
    el.empty.textContent = emptyLabel()
    el.list.hidden = rows.length === 0
    el.empty.hidden = rows.length > 0
    var meta = applyProps(widget === undefined ? {} : widget.props)
    write(el.meta, meta !== '' ? meta : '+' + added + ' -' + removed)
    return rows.length
  }

  function applyData(source) {
    var base = defaults()
    var data = source !== null && typeof source === 'object' ? source : {}
    var lines = Array.isArray(data.lines) ? data.lines : base.lines
    render(lines)
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
