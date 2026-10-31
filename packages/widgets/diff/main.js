/*
 * 改动视图的脚本：按文件把改动收成组，宽盒子左边给文件清单，窄盒子与常规盒子收成手风琴。
 *
 * 行的类型只有四种：add、remove、context 与 meta（文件路径一类的分节标题）。没写类型时按
 * context 处理，未知类型也收进上下文。meta 行不再画成一行，而是开启一个文件分组：路径归这一组，
 * 后面的改动行也归这一组；第一个 meta 行之前出现的改动行没有归属，收进一个无名分组。
 *
 * 这一份文件有一半是不碰 DOM 的判定：分组、计数、当前选中的文件与展开着的分组。它们挂在全局的
 * DiffView 上，单元测试读的是同一份实现，不是另写一份样例。
 *
 * 组件库的缩略图没有数据源，画面用内置样例；看板上画的是数据源读回来的真实改动：数据还没送到
 * 时是空态，读到一份空的改动列表时也是空态。
 */
;(function (root) {
  'use strict'

  /** 一张卡最多画多少行改动。 */
  var LIMIT = 400

  /** 一行改动的类型：没写类型与写错的类型都算上下文。 */
  function typeOf(line) {
    return line.type === 'add' || line.type === 'remove' || line.type === 'meta' ? line.type : 'context'
  }

  /**
   * 按 meta 行把改动行分成文件分组。
   *
   * @param {unknown} lines - 数据源给的改动行。
   * @param {number} [limit] - 最多收多少行改动；默认是 LIMIT。
   * @returns {Array<{ path: string, added: number, removed: number, lines: Array<{ type: string, text: string }> }>} 分组。
   */
  function groupFiles(lines, limit) {
    var cap = typeof limit === 'number' ? limit : LIMIT
    var files = []
    var current = null
    var count = 0
    if (!Array.isArray(lines)) return files
    for (var index = 0; index < lines.length; index += 1) {
      if (count >= cap) break
      var line = lines[index]
      if (line === null || typeof line !== 'object' || typeof line.text !== 'string') continue
      var type = typeOf(line)
      if (type === 'meta') {
        current = { path: line.text, added: 0, removed: 0, lines: [] }
        files.push(current)
        continue
      }
      if (current === null) {
        // 第一个 meta 行之前的改动行没有文件归属，收进一个无名分组。
        current = { path: '', added: 0, removed: 0, lines: [] }
        files.push(current)
      }
      current.lines.push({ type: type, text: line.text })
      count += 1
      if (type === 'add') current.added += 1
      if (type === 'remove') current.removed += 1
    }
    return files
  }

  /** 文件名：路径的最后一段。 */
  function fileNameOf(path) {
    if (typeof path !== 'string' || path === '') return ''
    var at = path.lastIndexOf('/')
    return at < 0 ? path : path.slice(at + 1)
  }

  /** 文件所在的目录：路径最后一段之前的那一段。 */
  function dirOf(path) {
    if (typeof path !== 'string') return ''
    var at = path.lastIndexOf('/')
    return at < 0 ? '' : path.slice(0, at)
  }

  /** 整张卡的统计：文件数与新增、删除的行数。 */
  function totalsOf(files) {
    var added = 0
    var removed = 0
    for (var index = 0; index < files.length; index += 1) {
      added += files[index].added
      removed += files[index].removed
    }
    return { added: added, removed: removed, files: files.length }
  }

  /** 右上角那行事实：多个文件时先说文件数。 */
  function summaryOf(files, zh) {
    var totals = totalsOf(files)
    var counts = '+' + totals.added + ' −' + totals.removed
    if (totals.files > 1) return totals.files + (zh ? ' 个文件 · ' : ' files · ') + counts
    return counts
  }

  /**
   * 组件记着的东西：当前选中的文件与展开着的分组。
   *
   * open 为 null 表示还没定过；用户收起全部之后是空数组，两种要分得开。
   */
  function createState() {
    return { selected: null, open: null }
  }

  /**
   * 新的改动到达时对状态做的对齐：选中的文件还在就留着，不在就落到第一个文件；展开着的分组
   * 还在就留着。
   */
  function reconcile(state, files) {
    var paths = []
    for (var index = 0; index < files.length; index += 1) paths.push(files[index].path)
    if (paths.indexOf(state.selected) < 0) state.selected = paths.length > 0 ? paths[0] : null
    if (state.open === null) {
      state.open = state.selected === null ? [] : [state.selected]
      return state
    }
    var kept = []
    for (var at = 0; at < state.open.length; at += 1) {
      if (paths.indexOf(state.open[at]) >= 0) kept.push(state.open[at])
    }
    state.open = kept
    return state
  }

  /** 选中一个文件：宽盒子用它决定右边显示哪一个。 */
  function selectFile(state, path) {
    state.selected = path
    return state
  }

  /** 展开或收起一个分组；点开的那个同时成为当前选中的文件。 */
  function toggleFile(state, path) {
    if (state.open === null) state.open = []
    state.selected = path
    var at = state.open.indexOf(path)
    if (at < 0) state.open.push(path)
    else state.open.splice(at, 1)
    return state
  }

  /**
   * 这一帧该画的东西：文件清单与每个文件的展开状态。
   *
   * DOM 那层照着它画，单元测试也照着它断言。
   */
  function viewOf(state, files, options) {
    var wide = options !== undefined && options.wide === true
    var zh = options !== undefined && options.zh === true
    var groups = []
    var active = null
    for (var index = 0; index < files.length; index += 1) {
      var file = files[index]
      var group = {
        path: file.path,
        name: fileNameOf(file.path),
        dir: dirOf(file.path),
        added: file.added,
        removed: file.removed,
        lines: file.lines,
        active: file.path === state.selected,
        expanded: state.open !== null && state.open.indexOf(file.path) >= 0
      }
      groups.push(group)
      if (group.active && active === null) active = group
    }
    return {
      wide: wide,
      multiple: groups.length > 1,
      groups: groups,
      active: active,
      summary: summaryOf(files, zh)
    }
  }

  /**
   * 组件的脑子：记住选中的文件与展开的分组，给出这一帧该画的东西。
   */
  function createController(options) {
    var zh = options === undefined || options.zh !== false
    var state = createState()
    var files = []
    var wide = false
    return {
      /** 数据源推来一份改动：分组并对齐状态。 */
      setData: function (lines) {
        files = groupFiles(lines)
        reconcile(state, files)
      },
      /** 盒子宽度变了：宽盒子左边给文件清单，别的尺寸收成手风琴。 */
      setWide: function (value) {
        wide = value === true
      },
      /** 界面语言：右上角那行事实按它说话。 */
      setLang: function (value) {
        zh = value === true
      },
      /** 点了左边清单里的一个文件。 */
      select: function (path) {
        selectFile(state, path)
      },
      /** 点了手风琴里的一个文件头。 */
      toggle: function (path) {
        toggleFile(state, path)
      },
      /** 这一帧该画的东西。 */
      view: function () {
        return viewOf(state, files, { wide: wide, zh: zh })
      }
    }
  }

  root.DiffView = {
    LIMIT: LIMIT,
    groupFiles: groupFiles,
    fileNameOf: fileNameOf,
    dirOf: dirOf,
    totalsOf: totalsOf,
    summaryOf: summaryOf,
    createState: createState,
    reconcile: reconcile,
    selectFile: selectFile,
    toggleFile: toggleFile,
    viewOf: viewOf,
    createController: createController
  }

  /* 下面这半要 DOM；单元测试在没有 DOM 的环境里载入这一份文件时停在这里。 */
  if (typeof document === 'undefined') return

  var card = document.querySelector('.diff-card')
  if (card === null) return

  var widget = window.widget

  var el = {
    kicker: card.querySelector('[data-field="kicker"]'),
    title: card.querySelector('[data-field="title"]'),
    meta: card.querySelector('[data-field="meta"]'),
    list: card.querySelector('[data-role="list"]'),
    empty: card.querySelector('[data-role="empty"]'),
    files: card.querySelector('[data-role="files"]')
  }

  var controller = createController()

  function isZh() {
    return widget === undefined || String(widget.lang || 'zh').toLowerCase().indexOf('zh') === 0
  }

  /** 宽盒子：左边一列给文件清单，右边只画选中的那个文件。 */
  function isWide() {
    return document.documentElement.dataset.boxWidth === 'wide'
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
        { type: 'context', text: '}' },
        { type: 'meta', text: 'src/board/grid.ts' },
        { type: 'context', text: 'export function columnsOf(width) {' },
        { type: 'remove', text: '  const columns = Math.floor(width / 240)' },
        { type: 'add', text: '  const columns = Math.max(1, Math.floor(width / 200))' },
        { type: 'add', text: '  const gutter = 12' },
        { type: 'context', text: '  return { columns, gutter }' },
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
    write(el.kicker, typeof props.kicker === 'string' && props.kicker.trim() !== '' ? props.kicker : '')
    write(el.title, typeof props.title === 'string' && props.title.trim() !== '' ? props.title : base.title)
    return typeof props.meta === 'string' ? props.meta : ''
  }

  /** 一个文件的新增与删除行数。 */
  function countText(file) {
    return '+' + file.added + ' −' + file.removed
  }

  /** 清单里显示的名字：文件名，没有名字就用整条路径。 */
  function labelOf(file) {
    if (file.name !== '') return file.name
    if (file.path !== '') return file.path
    return isZh() ? '未命名' : 'unnamed'
  }

  function lineNode(line) {
    var row = document.createElement('div')
    row.className = 'diff-card__line'
    row.dataset.type = line.type
    var sign = document.createElement('span')
    sign.className = 'diff-card__sign'
    sign.textContent = line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ''
    var text = document.createElement('span')
    text.className = 'diff-card__text'
    text.textContent = line.text
    row.append(sign, text)
    return row
  }

  function linesNode(file) {
    var box = document.createElement('div')
    box.className = 'diff-card__lines'
    for (var index = 0; index < file.lines.length; index += 1) box.append(lineNode(file.lines[index]))
    return box
  }

  /** 文件路径那一行：宽盒子右边画当前文件，窄盒子只有一个文件时也用它。 */
  function pathNode(file) {
    var head = document.createElement('div')
    head.className = 'diff-card__file-head'
    head.textContent = file.path
    head.title = file.path
    return head
  }

  /** 左列清单里的一个文件：一个按钮，点了右边就换成这个文件。 */
  function fileButton(file, index) {
    var button = document.createElement('button')
    button.type = 'button'
    button.className = 'diff-card__file'
    button.dataset.fileIndex = String(index)
    button.dataset.role = 'file'
    // 选中的那一个用 data-active 标出来：aria-selected 只对列表一类的角色有效，按钮上用 aria-current。
    if (file.active) {
      button.dataset.active = 'true'
      button.setAttribute('aria-current', 'true')
    }
    var name = document.createElement('span')
    name.className = 'diff-card__file-name'
    name.textContent = labelOf(file)
    var count = document.createElement('span')
    count.className = 'diff-card__file-count'
    count.textContent = countText(file)
    button.append(name, count)
    if (file.dir !== '') {
      var dir = document.createElement('span')
      dir.className = 'diff-card__file-dir'
      dir.textContent = file.dir
      button.append(dir)
    }
    return button
  }

  /** 手风琴的一节头：按钮，点了展开或收起这一节。 */
  function groupHead(file, index) {
    var head = document.createElement('button')
    head.type = 'button'
    head.className = 'diff-card__group-head'
    head.dataset.fileIndex = String(index)
    head.dataset.role = 'group'
    head.setAttribute('aria-expanded', file.expanded ? 'true' : 'false')
    var caret = document.createElement('span')
    caret.className = 'diff-card__caret'
    caret.setAttribute('aria-hidden', 'true')
    caret.textContent = file.expanded ? '▾' : '▸'
    var path = document.createElement('span')
    path.className = 'diff-card__group-path'
    path.textContent = file.path
    var count = document.createElement('span')
    count.className = 'diff-card__group-count'
    count.textContent = countText(file)
    head.append(caret, path, count)
    return head
  }

  /** 宽盒子右边：当前文件的路径与它的改动行。 */
  function widePane(view) {
    var nodes = []
    if (view.active === null) return nodes
    nodes.push(pathNode(view.active))
    nodes.push(linesNode(view.active))
    return nodes
  }

  /** 窄盒子与常规盒子右边：每个文件一节，手风琴。 */
  function groupsPane(view) {
    var nodes = []
    for (var index = 0; index < view.groups.length; index += 1) {
      var file = view.groups[index]
      var group = document.createElement('div')
      group.className = 'diff-card__group'
      if (view.multiple) group.append(groupHead(file, index))
      else group.append(pathNode(file))
      var lines = linesNode(file)
      lines.classList.add('diff-card__group-lines')
      if (view.multiple && !file.expanded) lines.hidden = true
      group.append(lines)
      nodes.push(group)
    }
    return nodes
  }

  /**
   * 照着这一帧该画的东西重画一遍。
   *
   * @param {boolean} resetScroll - 用户点了文件之后把右边的滚动条置顶；数据源推来新改动时不置顶。
   */
  function render(resetScroll) {
    var top = resetScroll ? 0 : el.list.scrollTop
    controller.setLang(isZh())
    var view = controller.view()
    var nodes = view.wide ? widePane(view) : groupsPane(view)
    el.list.replaceChildren.apply(el.list, nodes)
    var empty = view.groups.length === 0
    el.list.hidden = empty
    el.empty.hidden = !empty
    el.empty.textContent = emptyLabel()
    var listed = view.wide && view.multiple
    el.files.hidden = !listed
    var buttons = []
    if (listed) {
      for (var index = 0; index < view.groups.length; index += 1) buttons.push(fileButton(view.groups[index], index))
    }
    el.files.replaceChildren.apply(el.files, buttons)
    var meta = applyProps(widget === undefined ? {} : widget.props)
    write(el.meta, meta !== '' ? meta : view.summary)
    el.list.scrollTop = top
  }

  card.addEventListener('click', function (event) {
    var target = event.target
    if (target === null || typeof target.closest !== 'function') return
    var button = target.closest('[data-file-index]')
    if (button === null) return
    var file = controller.view().groups[Number(button.dataset.fileIndex)]
    if (file === undefined) return
    var isGroup = button.dataset.role === 'group'
    if (isGroup) controller.toggle(file.path)
    else controller.select(file.path)
    render(!isGroup)
  })

  /* 组件库里的缩略图：没有数据源，画面用内置样例。 */
  function isPreview() {
    if (widget === undefined || widget.size === undefined || widget.size === null) return false
    return widget.size.placement === 'preview'
  }

  function linesOf(data) {
    if (data === null || typeof data !== 'object') return null
    return Array.isArray(data.lines) ? data.lines : null
  }

  function applyData(source) {
    var lines = linesOf(source)
    controller.setData(lines === null || lines.length === 0 ? (isPreview() ? defaults().lines : []) : lines)
    render(false)
  }

  controller.setWide(isWide())
  applyData(widget === undefined ? null : widget.data)
  if (widget !== undefined) {
    widget.onProps(function (props) {
      applyProps(props)
      applyData(widget.data)
    })
    widget.onData(applyData)
    widget.onSize(function () {
      controller.setWide(isWide())
      render(false)
    })
  }
})(globalThis)
