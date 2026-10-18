/*
 * DSH 余额卡的脚本：经 `widget.call('dsh.account.balance')` 读当前账号的充值钱包与赠送钱包（D24）。
 *
 * 组件库的缩略画面不调用宿主：没有观众，也不该在预览里弹授权；那里画一份静态样例。
 *
 * 能力回 `status: 'failed'` 表示宿主这时没有可读的账号（账户服务缺席、没有登录、查询期间账号变了），
 * 这是一个正常的空态：`data-state` 仍是 `failed`，`data-tone` 取 `neutral`，显示中性的「登录后显示余额」；
 * 只有调用本身被拒绝或出错才是故障，`data-tone` 取 `error`，用错误色并给出原因（D11、D24）。
 *
 * 读数按金额分三档排：零头收成两位、亿元降到整数，整数部分上千位分组，小数部分降一档字号。
 * 字号按容器宽度在样式里取（`cqi`）；盒子变了重排一次，全值写进读数的提示框。
 */
;(function () {
  var card = document.querySelector('.balance')
  if (!card) return

  var widget = window.widget
  var CAPABILITY = 'dsh.account.balance'
  var NAMES = ['kicker', 'title', 'refresh', 'amount', 'aside', 'bonus', 'note', 'sr']
  var fields = {}
  for (var index = 0; index < NAMES.length; index += 1) fields[NAMES[index]] = card.querySelector('[data-field="' + NAMES[index] + '"]')

  /** 金额从细到粗试的几种排法。 */
  var STYLES = [
    { digits: 2, approx: false },
    { digits: 0, approx: true },
  ]

  var shown = null
  var started = false
  var pending = null
  var queued = false

  function tr(fallback, key) {
    var value = widget !== undefined && typeof widget.t === 'function' ? widget.t(key) : key
    return value === key ? fallback : value
  }

  function put(node, value) {
    if (node !== undefined && node !== null) node.textContent = value === null || value === undefined ? '' : String(value)
  }

  function show(node, visible) {
    if (node !== undefined && node !== null) node.hidden = !visible
  }

  function symbol(currency) {
    return currency === 'USD' ? '$' : currency === 'CNY' ? '¥' : ''
  }

  function wallets(list) {
    return Array.isArray(list) ? list : []
  }

  /** 同名币种的钱包合计；一个都读不出来时是 `undefined`。 */
  function total(list, currency) {
    var sum = 0
    var any = false
    for (var i = 0; i < list.length; i += 1) {
      if (list[i].currency !== currency) continue
      var parsed = parseFloat(list[i].balance)
      if (!isFinite(parsed)) continue
      sum += parsed
      any = true
    }
    return any ? sum : undefined
  }

  function grouped(text) {
    return text.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  }

  function money(amount, currency) {
    var text = parts(amount, currency, STYLES[0])
    return text.head + text.tail
  }

  /** 按排法把金额拆成主串与要降一档字号的小数尾巴。 */
  function parts(amount, currency, style) {
    var scale = Math.pow(10, style.digits)
    var rounded = Math.round(Math.abs(amount) * scale)
    var whole = Math.floor(rounded / scale)
    var sign = amount < 0 ? '-' : ''
    var exact = String(Math.round(amount * 100) / 100)
    return {
      head: sign + symbol(currency) + grouped(String(whole)),
      tail: style.digits === 0 ? '≈' : '.' + String(rounded % scale).padStart(style.digits, '0'),
      full: symbol(currency) + exact,
    }
  }

  /** 金额越大留的小数越少：万元以下到分，亿元以下保留两位，再往上只留整数。 */
  function styleFor(amount) {
    return Math.abs(amount) >= 1e8 ? STYLES[STYLES.length - 1] : STYLES[0]
  }

  function renderAmount() {
    var amount = fields.amount
    if (amount === null) return
    amount.textContent = ''
    if (shown === null || shown.amount === undefined) {
      amount.textContent = '—'
      amount.title = ''
      return
    }
    var chosen = parts(shown.amount, shown.currency, styleFor(shown.amount))
    amount.appendChild(document.createTextNode(chosen.head))
    if (chosen.tail !== '') {
      var tail = document.createElement('span')
      tail.className = 'balance__fraction'
      tail.textContent = chosen.tail
      amount.appendChild(tail)
    }
    amount.title = chosen.full
  }

  function render() {
    var state = shown === null ? 'loading' : shown.state
    card.dataset.state = state
    card.dataset.tone = shown === null || shown.tone === undefined ? 'neutral' : shown.tone
    renderAmount()
    var aside = shown === null ? '' : shown.aside
    var bonus = shown === null ? '' : shown.bonus
    var note = shown === null ? '' : shown.note
    put(fields.aside, aside)
    show(fields.aside, aside !== '')
    put(fields.bonus, bonus)
    show(fields.bonus, bonus !== '')
    put(fields.note, note)
    put(fields.sr, shown === null ? '' : shown.sr)
  }

  function paint(next) {
    shown = {
      state: next.state,
      tone: next.tone === undefined ? 'neutral' : next.tone,
      amount: next.amount,
      currency: next.currency === undefined ? '' : next.currency,
      aside: next.aside === undefined ? '' : next.aside,
      bonus: next.bonus === undefined ? '' : next.bonus,
      note: next.note === undefined ? '' : next.note,
      sr: next.sr === undefined ? '' : next.sr,
    }
    if (fields.refresh !== null) fields.refresh.disabled = pending !== null
    render()
  }

  function renderPreview() {
    var value = 1280.5
    paint({
      state: 'ready',
      amount: value,
      currency: 'CNY',
      aside: 'CNY',
      bonus: tr('赠送', 'bonus') + ' ¥20.00',
      note: tr('当前登录的 DSH 账号', 'note'),
      sr: money(value, 'CNY') + ' CNY',
    })
  }

  function renderAccounts(balance) {
    if (balance === null || typeof balance !== 'object' || balance.status !== 'ready') {
      paint({ state: 'failed', amount: '—', note: tr('登录后显示余额', 'signedOut'), sr: tr('登录后显示余额', 'signedOut') })
      return
    }
    var recharge = wallets(balance.value)
    var currencies = []
    for (var i = 0; i < recharge.length; i += 1) {
      if (total(recharge, recharge[i].currency) !== undefined && currencies.indexOf(recharge[i].currency) < 0) currencies.push(recharge[i].currency)
    }
    if (currencies.length === 0) {
      paint({ state: 'ready', amount: '—', note: tr('账号没有钱包记录', 'empty'), sr: tr('账号没有钱包记录', 'empty') })
      return
    }
    var main = currencies[0]
    var amount = total(recharge, main)
    var bonus = total(wallets(balance.bonusWallets), main)
    paint({
      state: 'ready',
      amount: amount,
      currency: main,
      aside: main,
      bonus: bonus === undefined || bonus === 0 ? '' : tr('赠送', 'bonus') + ' ' + money(bonus, main),
      note: tr('当前登录的 DSH 账号', 'note'),
      sr: money(amount, main) + ' ' + main,
    })
  }

  function failed(error) {
    var message = error !== null && error !== undefined && error.message ? error.message : tr('读不到余额', 'failed')
    paint({ state: 'failed', amount: '—', note: message, tone: 'error', sr: message })
  }

  /** 一次查询在途时刷新按钮停用：重复点不会发出第二次调用。 */
  function settle(next) {
    pending = null
    // 先换画面再放开按钮：画面里读「在途」决定按钮的停用状态。
    if (next !== undefined) next()
    if (fields.refresh !== null) fields.refresh.disabled = false
  }

  function load() {
    if (widget === undefined || typeof widget.call !== 'function') {
      paint({ state: 'failed', amount: '—', note: tr('登录后显示余额', 'signedOut'), sr: tr('登录后显示余额', 'signedOut') })
      return
    }
    if (pending !== null) return
    paint({ state: 'loading', amount: undefined, note: tr('读取账户…', 'loading'), sr: tr('读取账户…', 'loading') })
    pending = widget.call(CAPABILITY, {})
    if (fields.refresh !== null) fields.refresh.disabled = true
    pending.then(function (balance) {
      settle(function () { renderAccounts(balance) })
    }, function (error) {
      settle(function () { failed(error) })
    })
  }

  // 盒子换了，字数能不能放下跟着变；一次布局里连着来的几条尺寸事件只重排一次。
  function remeasure() {
    if (shown === null) return
    if (queued) return
    queued = true
    requestAnimationFrame(function () {
      queued = false
      render()
    })
  }

  function consider(size) {
    if (size === null || size === undefined) return
    if (size.placement === 'preview') {
      renderPreview()
      return
    }
    if (started) {
      remeasure()
      return
    }
    started = true
    load()
  }

  put(fields.title, tr('DSH 余额', 'title'))
  if (fields.refresh !== null) {
    fields.refresh.setAttribute('title', tr('刷新余额', 'refresh'))
    fields.refresh.setAttribute('aria-label', tr('刷新余额', 'refresh'))
    fields.refresh.addEventListener('click', function () {
      if (pending === null) load()
    })
  }
  if (widget !== undefined) {
    consider(widget.size)
    widget.onSize(consider)
    if (widget.props !== undefined && widget.props !== null && typeof widget.props.kicker === 'string' && widget.props.kicker.trim() !== '') {
      put(fields.kicker, widget.props.kicker)
    }
  } else {
    renderPreview()
  }
})()
