/*
 * 今日宜休卡片的脚本：经 `widget.call('github.issues')` 读令牌所属账号名下还开着的 issue（D24）。
 *
 * 账号由令牌决定，卡片上没有用户名可填。读之前不需要授权：令牌是人自己填进卡片设置的。四种结果
 * 各有画法：读到列表、没有配令牌（指路去卡片设置）、令牌被 GitHub 拒绝（让人换一个）、这一次没读成
 * （写出原因）。令牌本身永远不进这张卡。
 *
 * 一行按 GitHub 工作台那种排法：左边状态点，中间标题加副行（仓库、编号、谁开的、标签、回复数），
 * 右边一列写「更新」与其下的时刻。整行是一个按钮：点一下用 `widget.open` 把它交给父页面开（D26）。
 * 组件自己导航不了，也不弹窗。刷新按钮跳过宿主侧的缓存。
 *
 * 组件库的缩略画面不调用宿主：那里画一份静态样例，形状与真实的一条 issue 相同。
 */
;(function () {
  var card = document.querySelector('.gh')
  if (!card) return

  var widget = window.widget
  var CAPABILITY = 'github.issues'
  var DEFAULT_LIMIT = 8
  var LIMIT_MIN = 3
  var LIMIT_MAX = 30
  var DAY = 86400000

  var fields = {
    kicker: card.querySelector('[data-field="kicker"]'),
    title: card.querySelector('[data-field="title"]'),
    account: card.querySelector('[data-field="account"]'),
    refresh: card.querySelector('[data-field="refresh"]'),
    sr: card.querySelector('[data-field="sr"]')
  }
  var list = card.querySelector('[data-role="list"]')
  var note = card.querySelector('[data-role="note"]')
  var count = card.querySelector('[data-role="count"]')

  /** 文案：manifest 的 `text` 有就用它，组件单独打开时用这里的两份。 */
  var COPY = {
    title: { zh: '今日宜休', en: 'Rest today' },
    refresh: { zh: '重新读一次', en: 'Read again' },
    loading: { zh: '读取 issue…', en: 'Reading issues…' },
    empty: { zh: '自己维护的仓库里没有还开着的 issue', en: 'No open issues on your repositories' },
    unconfigured: { zh: '在卡片设置里填入 GitHub 令牌，就能看到自己维护的仓库里还开着的 issue。', en: 'Add a GitHub token in the card settings to see the open issues on the repositories you maintain.' },
    rejected: { zh: 'GitHub 不认这个令牌：它可能过期、被撤掉了，或者没有读这些仓库的权限。', en: 'GitHub rejected this token: it may be expired, revoked, or unable to read these repositories.' },
    failed: { zh: '读不到 issue', en: 'Issues unavailable' },
    open: { zh: '开放', en: 'open' },
    updated: { zh: '更新', en: 'Updated' },
    opend: { zh: '创建', en: 'Opened' },
    more: { zh: '最近的 {n} 条 · 共 {total} 条', en: 'latest {n} of {total}' },
    replies: { zh: '{n} 条回复', en: '{n} replies' },
    reply: { zh: '1 条回复', en: '1 reply' }
  }

  function isZh() {
    if (widget !== undefined && typeof widget.lang === 'string' && widget.lang !== '') {
      return widget.lang.toLowerCase().indexOf('zh') === 0
    }
    return true
  }

  function t(key) {
    if (widget !== undefined && typeof widget.t === 'function') {
      var value = widget.t(key)
      if (value !== key && value !== '') return value
    }
    var entry = COPY[key]
    if (entry === undefined) return key
    return isZh() ? entry.zh : entry.en
  }

  function put(node, value) {
    if (node !== null && node !== undefined) node.textContent = value === null || value === undefined ? '' : String(value)
  }

  /** 这一版 props 读成的整数：超出范围按上下限收，读不出来时用默认值。 */
  function limitOf() {
    var props = widget !== undefined && widget.props !== null && typeof widget.props === 'object' ? widget.props : {}
    var raw = props.limit
    if (typeof raw !== 'number' || !isFinite(raw)) return DEFAULT_LIMIT
    return Math.max(LIMIT_MIN, Math.min(LIMIT_MAX, Math.round(raw)))
  }

  /** 标题与眉题：props 里写了就用，没写时用文案里的默认值。 */
  function applyProps() {
    var props = widget !== undefined && widget.props !== null && typeof widget.props === 'object' ? widget.props : {}
    var title = typeof props.title === 'string' && props.title.trim() !== '' ? props.title.trim() : t('title')
    var kicker = typeof props.kicker === 'string' ? props.kicker.trim() : ''
    put(fields.title, title)
    put(fields.kicker, kicker)
    if (fields.kicker !== null) fields.kicker.hidden = kicker === ''
    if (list !== null) list.setAttribute('aria-label', title)
  }

  /** 一个时刻离现在几天：用当前语言的说法，今天与昨天不说「0 天前」。 */
  function ageOf(stamp) {
    var then = Date.parse(stamp)
    if (isNaN(then)) return ''
    var days = Math.round((then - Date.now()) / DAY)
    if (typeof Intl === 'undefined' || typeof Intl.RelativeTimeFormat !== 'function') {
      return String(-days) + (isZh() ? ' 天前' : ' days ago')
    }
    return new Intl.RelativeTimeFormat(isZh() ? 'zh-CN' : 'en', { numeric: 'auto' }).format(days, 'day')
  }

  /** 列表上方那一行：像工作台的「12 / 40 open」。 */
  function countLine(total, shown) {
    if (total > shown) return t('more').replace('{n}', String(shown)).replace('{total}', String(total))
    if (isZh()) return String(shown) + ' 条' + t('open')
    return shown === 1 ? '1 open' : String(shown) + ' open'
  }

  /** 回复数那一小段：图标加数字，一到三条回复都不摆成一句长话。 */
  function repliesOf(count) {
    var wrap = document.createElement('span')
    wrap.className = 'gh__replies'
    wrap.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M2 3.5h12M2 8h12M2 12.5h8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>'
    var number = document.createElement('span')
    number.textContent = String(count)
    wrap.appendChild(number)
    wrap.title = count === 1 ? t('reply').replace('{n}', '1') : t('replies').replace('{n}', String(count))
    return wrap
  }

  /**
   * 一条 issue：状态点、标题与副行（仓库、编号、谁开的、标签、回复），右边一列是更新的时刻。
   *
   * 整行是一个按钮：点一下请父页面开 issue 自己的页（D26）。组件在沙箱里导航不了，能开新页的
   * 只有包着它的页面，所以这里只发一步。
   */
  function rowOf(item) {
    var row = document.createElement('button')
    row.className = 'gh__row'
    row.type = 'button'
    row.setAttribute('aria-label', item.title)
    row.dataset.state = item.state === 'closed' ? 'closed' : 'open'

    var state = document.createElement('span')
    state.className = 'gh__state'
    state.setAttribute('aria-hidden', 'true')

    var text = document.createElement('div')
    text.className = 'gh__text'

    var title = document.createElement('div')
    title.className = 'gh__row-title'
    title.textContent = item.title
    title.title = item.title

    var sub = document.createElement('div')
    sub.className = 'gh__sub'
    var repo = document.createElement('span')
    repo.className = 'gh__repo'
    repo.textContent = item.repository
    var number = document.createElement('span')
    number.className = 'gh__number'
    number.textContent = '#' + String(item.number)
    sub.append(repo, number)

    // 谁开的：工作台在副行里写一行，卡片里一样只占一小段。
    if (typeof item.author === 'string' && item.author !== '') {
      var who = document.createElement('span')
      who.className = 'gh__who'
      who.textContent = item.author
      who.title = item.author
      sub.appendChild(who)
    }

    var names = Array.isArray(item.labels) ? item.labels : []
    if (names.length > 0) {
      var labels = document.createElement('span')
      labels.className = 'gh__labels'
      for (var at = 0; at < names.length; at += 1) {
        var label = names[at]
        var chip = document.createElement('span')
        chip.className = 'gh__label'
        chip.textContent = typeof label === 'string' ? label : label.name
        // GitHub 的标签自带颜色：实心圆牌，字色按底色亮度选黑或白；没带颜色的用主色的淡底。
        var hex = typeof label === 'object' && label !== null ? String(label.color || '').replace('#', '') : ''
        if (/^[0-9a-fA-F]{6}$/.test(hex)) {
          chip.style.background = '#' + hex
          chip.style.color = labelInk(hex)
          chip.style.borderColor = 'color-mix(in srgb, #' + hex + ' 70%, var(--w-color-border, #d5dae1))'
        } else {
          chip.style.background = 'color-mix(in srgb, var(--w-color-accent, #2563eb) 12%, transparent)'
          chip.style.color = 'color-mix(in srgb, var(--w-color-accent, #2563eb) 82%, var(--w-color-fg, #0b1016))'
          chip.style.borderColor = 'color-mix(in srgb, var(--w-color-accent, #2563eb) 30%, transparent)'
        }
        labels.appendChild(chip)
      }
      sub.appendChild(labels)
    }

    if (typeof item.comments === 'number' && item.comments > 0) sub.appendChild(repliesOf(item.comments))

    text.append(title, sub)

    var meta = document.createElement('span')
    meta.className = 'gh__meta'
    var what = document.createElement('span')
    what.textContent = t('updated')
    var when = document.createElement('span')
    when.className = 'gh__meta-when'
    when.textContent = ageOf(item.updatedAt || item.createdAt)
    meta.append(what, when)

    row.append(state, text, meta)
    // 整行的提示语是标题与地址：缩略画面与屏幕阅读器都能读出这一行是什么。
    if (typeof item.url === 'string' && item.url !== '') {
      row.dataset.url = item.url
    } else {
      // 没有地址的一行不装作能点：按钮仍然占位，按下什么也不会发生。
      row.disabled = true
    }
    return row
  }

  /** 一个十六进制底色该配黑字还是白字：按相对亮度算，阈值与 GitHub 的做法一致。 */
  function labelInk(hex) {
    var r = parseInt(hex.slice(0, 2), 16)
    var g = parseInt(hex.slice(2, 4), 16)
    var b = parseInt(hex.slice(4, 6), 16)
    var luma = 0.299 * r + 0.587 * g + 0.114 * b
    return luma > 160 ? '#0b1016' : '#ffffff'
  }

  /** 列表与说明只显示一个；状态与色调落在根节点上。 */
  function paint(state, tone) {
    card.dataset.state = state
    card.dataset.tone = tone
  }

  function setRows(rows) {
    if (list !== null) {
      list.replaceChildren.apply(list, rows)
      list.hidden = rows.length === 0
    }
    if (note !== null) note.hidden = rows.length > 0
  }

  function setNote(message) {
    put(note, message)
  }

  /** 上方那一行计数：只有读到列表时才出现。 */
  function setCount(text) {
    if (count === null) return
    count.hidden = text === ''
    put(count, text)
  }

  function render(result) {
    applyProps()
    var status = result !== null && typeof result === 'object' ? result.status : undefined
    if (status === 'ready') {
      var items = Array.isArray(result.items) ? result.items : []
      put(fields.account, typeof result.account === 'string' && result.account !== '' ? '@' + result.account : '')
      var rows = []
      for (var at = 0; at < items.length; at += 1) rows.push(rowOf(items[at]))
      paint('ready', 'neutral')
      setRows(rows)
      var total = typeof result.total === 'number' ? result.total : items.length
      setCount(rows.length === 0 ? '' : countLine(total, rows.length))
      setNote(rows.length === 0 ? t('empty') : '')
      put(fields.sr, rows.length === 0 ? t('empty') : countLine(total, rows.length))
      return
    }
    put(fields.account, '')
    paint(status === 'unconfigured' ? 'ready' : 'failed', status === 'unconfigured' ? 'neutral' : 'error')
    setRows([])
    setCount('')
    var message = status === 'rejected'
      ? t('rejected')
      : status === 'unconfigured'
        ? t('unconfigured')
        : typeof result.reason === 'string' && result.reason !== ''
          ? t('failed') + '：' + result.reason
          : t('failed')
    setNote(message)
    put(fields.sr, message)
  }

  function renderLoading() {
    applyProps()
    put(fields.account, '')
    paint('loading', 'neutral')
    setRows([])
    setCount('')
    setNote(t('loading'))
    put(fields.sr, t('loading'))
  }

  /** 缩略画面里的一份静态样例：三条还开着的 issue，与真实读到的形状相同。 */
  function renderSample() {
    applyProps()
    var now = Date.now()
    var rows = [
      { number: 120, title: '输入框占位符是否应跟随界面语言：现在是写死英文', repository: 'lxjs15330849733-max/dsh', author: 'lxjs15330849733-max', createdAt: new Date(now - 18 * 60000).toISOString(), updatedAt: new Date(now - 18 * 60000).toISOString(), comments: 1, labels: [{ name: '建议', color: 'd4c5f9' }], url: 'https://github.com/lxjs15330849733-max/dsh/issues/120' },
      { number: 117, title: '流式输出思考内容时，中文输入法候选框被打断', repository: 'awaslllll0317/dsh', author: 'awaslllll0317', createdAt: new Date(now - 3600000).toISOString(), updatedAt: new Date(now - 3600000).toISOString(), comments: 1, labels: [{ name: 'bug', color: 'd73a4a' }], url: 'https://github.com/awaslllll0317/dsh/issues/117' },
      { number: 108, title: '功能建议：增加鼠标悬停侧边栏时显示', repository: '1rgg/dsh', author: '1rgg', createdAt: new Date(now - 22 * 3600000).toISOString(), updatedAt: new Date(now - 22 * 3600000).toISOString(), comments: 0, labels: [{ name: 'enhancement', color: 'a2eeef' }], url: 'https://github.com/1rgg/dsh/issues/108' }
    ]
    var nodes = []
    for (var at = 0; at < rows.length; at += 1) nodes.push(rowOf(rows[at]))
    put(fields.account, '@octocat')
    paint('ready', 'neutral')
    setRows(nodes)
    setCount(countLine(nodes.length, nodes.length))
    setNote('')
    if (fields.refresh !== null) fields.refresh.disabled = true
  }

  var pending = null
  var started = false
  var sampled = false
  var askedLimit = 0
  /** 读取途中 props 改了条数：读回来再看一遍，不把旧条数的结果当成新的。 */
  var stale = false

  function settle() {
    pending = null
    if (fields.refresh !== null) fields.refresh.disabled = false
  }

  function load(again) {
    if (widget === undefined || typeof widget.call !== 'function') {
      renderSample()
      return
    }
    if (pending !== null) return
    askedLimit = limitOf()
    renderLoading()
    if (fields.refresh !== null) fields.refresh.disabled = true
    // 人按的刷新跳过宿主那一侧的缓存，剩下的读取先给上一次的结果（D24）。
    pending = widget.call(CAPABILITY, again === true ? { limit: askedLimit, refresh: true } : { limit: askedLimit })
    pending.then(function (result) {
      settle()
      render(result)
    }, function (error) {
      settle()
      render({ status: 'failed', reason: error !== null && error !== undefined && error.message ? error.message : '' })
    }).then(function () {
      if (stale) {
        stale = false
        load()
      }
    })
  }

  function consider(size) {
    if (size === null || size === undefined) return
    if (size.placement === 'preview') {
      if (!sampled) {
        sampled = true
        renderSample()
      }
      return
    }
    if (started) return
    started = true
    load()
  }

  if (fields.refresh !== null) {
    fields.refresh.setAttribute('aria-label', t('refresh'))
    fields.refresh.addEventListener('click', function () {
      if (pending === null) load(true)
    })
  }
  // 行是按钮：点哪一行就让父页面开哪一条 issue（D26）。认按钮本身的地址，不改状态。
  if (list !== null) {
    list.addEventListener('click', function (event) {
      var target = event.target
      if (!(target instanceof Element)) return
      var row = target.closest('.gh__row')
      if (row === null || row.disabled) return
      var url = row.dataset.url
      if (typeof url !== 'string' || url === '') return
      if (widget !== undefined && typeof widget.open === 'function') widget.open(url)
    })
  }
  applyProps()
  if (widget !== undefined) {
    consider(widget.size)
    if (typeof widget.onSize === 'function') widget.onSize(consider)
    if (typeof widget.onProps === 'function') {
      widget.onProps(function () {
        applyProps()
        // 条数变了要重新问一次；只改标题时不动已经读到的列表。
        if (sampled || limitOf() === askedLimit) return
        if (pending !== null) stale = true
        else load()
      })
    }
  } else {
    renderSample()
  }
})()
