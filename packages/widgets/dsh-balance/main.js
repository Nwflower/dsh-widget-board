/*
 * DSH 余额卡的脚本：经 `widget.call('dsh.account.balance')` 读当前账号的充值钱包与赠送钱包（D24）。
 *
 * 组件库的缩略画面不调用宿主：没有观众，也不该在预览里弹授权；那里画一份静态样例。
 */
(function () {
  var card = document.querySelector('.balance')
  if (!card) return

  var widget = window.widget
  var CAPABILITY = 'dsh.account.balance'
  var fields = {}
  var nodes = card.querySelectorAll('[data-field]')
  for (var index = 0; index < nodes.length; index += 1) {
    var key = nodes[index].getAttribute('data-field')
    if (key !== null) fields[key] = nodes[index]
  }

  function tr(fallback, key) {
    var value = widget !== undefined && typeof widget.t === 'function' ? widget.t(key) : key
    return value === key ? fallback : value
  }

  function write(node, value) {
    if (node !== undefined && node !== null) node.textContent = value === null || value === undefined ? '' : String(value)
  }

  function symbol(currency) {
    return currency === 'USD' ? '$' : currency === 'CNY' ? '¥' : ''
  }

  function wallets(source) {
    return Array.isArray(source) ? source : []
  }

  function sum(walletsOf, currency) {
    var total = 0
    var any = false
    for (var i = 0; i < walletsOf.length; i += 1) {
      if (walletsOf[i].currency !== currency) continue
      var parsed = parseFloat(walletsOf[i].balance)
      if (isFinite(parsed)) {
        total += parsed
        any = true
      }
    }
    return any ? total.toFixed(2) : ''
  }

  function paint(state, amount, currency, bonus, note) {
    card.dataset.state = state
    write(fields.amount, amount)
    write(fields.currency, currency)
    write(fields.bonus, bonus)
    write(fields.note, note)
  }

  function renderPreview() {
    paint('ready', '¥128.00', 'CNY', tr('赠送', 'bonus') + ' ¥20.00', tr('当前登录的 DSH 账号', 'note'))
  }

  function render(balance) {
    if (balance === null || typeof balance !== 'object' || balance.status !== 'ready') {
      paint('failed', '—', '', '', tr('读不到余额', 'failed'))
      return
    }
    var recharge = wallets(balance.value)
    var bonus = wallets(balance.bonusWallets)
    var first = recharge[0]
    if (first === undefined) {
      paint('ready', '—', '', '', tr('账号没有钱包记录', 'empty'))
      return
    }
    var bonusTotal = sum(bonus, first.currency)
    var bonusText = bonusTotal === '' ? '' : tr('赠送', 'bonus') + ' ' + symbol(first.currency) + bonusTotal
    paint('ready', symbol(first.currency) + String(first.balance), first.currency, bonusText, tr('当前登录的 DSH 账号', 'note'))
  }

  function failed(error) {
    var message = error !== null && error !== undefined && error.message ? error.message : tr('读不到余额', 'failed')
    paint('failed', '—', '', '', message)
  }

  var pending = null
  function load() {
    if (widget === undefined || typeof widget.call !== 'function') {
      failed({ message: '组件运行时没有能力调用接口' })
      return
    }
    if (pending !== null) return
    pending = widget.call(CAPABILITY, {})
    paint('loading', '…', '', '', tr('读取账户…', 'loading'))
    pending.then(function (balance) {
      pending = null
      render(balance)
    }, function (error) {
      pending = null
      failed(error)
    })
  }

  var started = false
  function consider(size) {
    if (size === null || size === undefined) return
    if (size.placement === 'preview') {
      renderPreview()
      return
    }
    if (started) return
    started = true
    load()
  }

  if (fields.refresh !== undefined && fields.refresh !== null) {
    fields.refresh.addEventListener('click', function () {
      if (card.dataset.state !== 'loading') load()
    })
  }
  if (widget !== undefined) {
    consider(widget.size)
    widget.onSize(consider)
  } else {
    renderPreview()
  }
})()
