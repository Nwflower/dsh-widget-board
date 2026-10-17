/*
 * 待办的脚本。
 *
 * 条目经 `widget.setState` 交给宿主存下来（D5）：切走再切回、页面重挂之后清单还在。文字一律按
 * 纯文本写进节点，不拼 HTML——清单是用户写的内容。
 */
(function () {
  var card = document.querySelector('.todo')
  if (!card) return

  var widget = window.widget
  var MAX_ITEMS = 200
  var MAX_TEXT = 200

  var el = {
    title: card.querySelector('#todo-title'),
    count: card.querySelector('#todo-count'),
    progress: card.querySelector('#todo-progress'),
    list: card.querySelector('#todo-list'),
    empty: card.querySelector('#todo-empty'),
    input: card.querySelector('#todo-input'),
    submit: card.querySelector('#todo-submit')
  }

  var items = []
  /** 存下的清单只在第一次收到状态时接过来；之后的回声不覆盖正在改的那份。 */
  var restored = false

  /** manifest 里的一条文案；没有宿主时退回键名。 */
  function label(key) { return widget === undefined ? key : widget.t(key) }

  /** 一个不会重复的条目 id。 */
  function nextId() { return `i${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}` }

  /** 把存下的清单收成这次能画的样子：条文、去空白、限长、限条数。 */
  function sanitize(raw) {
    if (!Array.isArray(raw)) return []
    var cleaned = []
    for (var index = 0; index < raw.length && cleaned.length < MAX_ITEMS; index += 1) {
      var row = raw[index]
      if (row === null || typeof row !== 'object') continue
      var text = typeof row.text === 'string' ? row.text.trim().slice(0, MAX_TEXT) : ''
      if (text === '') continue
      cleaned.push({
        id: typeof row.id === 'string' && row.id !== '' ? row.id : nextId(),
        text: text,
        done: row.done === true
      })
    }
    return cleaned
  }

  /** 交给宿主存下来。 */
  function save() {
    if (widget !== undefined) widget.setState({ items: items })
  }

  /** 计数与进度条：这一处单独刷新，勾选时不用整条重画。 */
  function paintSummary() {
    var total = items.length
    var done = 0
    for (var index = 0; index < items.length; index += 1) if (items[index].done) done += 1
    el.count.textContent = total === 0 ? '' : `${done} / ${total}`
    el.progress.style.transform = `scaleX(${total === 0 ? 0 : done / total})`
    el.empty.hidden = total > 0
  }

  /** 一行：勾选框、文字、删除按钮。 */
  function row(item) {
    var li = document.createElement('li')
    li.className = 'todo-row'
    li.dataset.id = item.id
    li.dataset.done = item.done ? 'true' : 'false'

    var check = document.createElement('label')
    check.className = 'todo-check'

    var input = document.createElement('input')
    input.type = 'checkbox'
    input.checked = item.done
    input.dataset.id = item.id

    var box = document.createElement('span')
    box.className = 'todo-box'
    box.setAttribute('aria-hidden', 'true')

    var text = document.createElement('span')
    text.className = 'todo-text'
    text.textContent = item.text

    check.append(input, box, text)

    var remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'todo-remove'
    remove.dataset.id = item.id
    remove.setAttribute('aria-label', label('remove'))
    remove.textContent = '×'

    li.append(check, remove)
    return li
  }

  /** 整条清单重画。 */
  function render() {
    el.list.replaceChildren()
    for (var index = 0; index < items.length; index += 1) el.list.appendChild(row(items[index]))
    paintSummary()
  }

  /** 找到一条。 */
  function find(id) {
    for (var index = 0; index < items.length; index += 1) if (items[index].id === id) return items[index]
    return undefined
  }

  /** 文案落到界面上；语言变化后重新走一遍。 */
  function paintLabels() {
    el.title.textContent = label('title')
    el.empty.textContent = label('empty')
    el.input.placeholder = label('add')
    el.input.setAttribute('aria-label', label('add'))
    el.submit.setAttribute('aria-label', label('add'))
    var removeLabel = label('remove')
    var buttons = el.list.querySelectorAll('.todo-remove')
    for (var index = 0; index < buttons.length; index += 1) buttons[index].setAttribute('aria-label', removeLabel)
  }

  el.list.addEventListener('change', function (event) {
    var input = event.target
    if (!(input instanceof HTMLInputElement) || input.type !== 'checkbox') return
    var item = find(input.dataset.id ?? '')
    if (item === undefined) return
    item.done = input.checked
    var li = input.closest('.todo-row')
    if (li !== null) li.dataset.done = item.done ? 'true' : 'false'
    paintSummary()
    save()
  })

  el.list.addEventListener('click', function (event) {
    var target = event.target
    if (!(target instanceof Element)) return
    var button = target.closest('.todo-remove')
    if (!(button instanceof HTMLButtonElement)) return
    var id = button.dataset.id ?? ''
    items = items.filter(function (item) { return item.id !== id })
    render()
    save()
  })

  /** 把输入框里的一条加到清单末尾。沙箱不给 allow-forms（D3），所以回车与按钮都直接调它。 */
  function add() {
    var text = el.input.value.trim().slice(0, MAX_TEXT)
    if (text === '') return
    items.push({ id: nextId(), text: text, done: false })
    el.input.value = ''
    render()
    save()
    el.input.focus()
    el.list.scrollTop = el.list.scrollHeight
  }

  el.submit.addEventListener('click', add)

  el.input.addEventListener('keydown', function (event) {
    if (event.key === 'Enter') {
      event.preventDefault()
      add()
      return
    }
    if (event.key === 'Escape') el.input.value = ''
  })

  if (widget !== undefined) {
    widget.onState(function (value) {
      if (restored) return
      restored = true
      if (value === null || typeof value !== 'object') return
      items = sanitize(value.items)
      render()
    })
    widget.onSize(function () { paintLabels() })
  }

  paintLabels()
  render()
})()
