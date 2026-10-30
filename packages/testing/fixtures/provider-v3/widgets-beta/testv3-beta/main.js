/*
 * 组件乙的脚本：与原生组件甲暴露同一套可观察标记（D32）。
 *
 * 所有值都从 `window.widget` 读：能力面随握手给一次，数据与状态由宿主推来，暂停状态随卡片进出视口
 * 变化。按钮只发出动作、状态写入、能力调用与按需读，结果写回各自的节点，场景据此取证。
 */
;(function () {
  var widget = window.widget
  var card = document.querySelector('[data-testv3="beta"]')
  if (widget === undefined || card === null) return

  /**
   * 往一个节点写文字；节点不在时什么也不做。
   *
   * @param selector - 卡片内部的标记。
   * @param value - 要写的文字。
   */
  function put(selector, value) {
    var node = card.querySelector(selector)
    if (node !== null) node.textContent = value
  }

  /**
   * 失败的原因：宿主回的错误消息原样写出。
   *
   * @param error - 接到的拒绝。
   * @returns 给人看的一句话。
   */
  function reasonOf(error) {
    if (error && typeof error.message === 'string') return error.message
    return String(error)
  }

  /**
   * 一次调用的结果写成 `ok:<JSON>` 或 `error:<原因>`，与原生那一侧同一个形状。
   *
   * @param ok - 成功还是失败。
   * @param value - 结果或原因。
   * @returns 写进节点的文字。
   */
  function describe(ok, value) {
    return ok ? 'ok:' + JSON.stringify(value) : 'error:' + reasonOf(value)
  }

  /** 把能力面、语言、数据、状态与暂停状态重新写到节点上。 */
  function render() {
    card.setAttribute('data-testv3-lang', widget.lang)
    card.setAttribute('data-testv3-capabilities', JSON.stringify(widget.capabilities.slice()))
    card.setAttribute('data-testv3-metadata', JSON.stringify(widget.capabilityMetadata))
    card.setAttribute('data-testv3-paused', String(widget.paused))
    var data = widget.data !== null && typeof widget.data === 'object' ? widget.data : {}
    var state = widget.state !== null && typeof widget.state === 'object' ? widget.state : {}
    put('[data-testv3-count]', data.count === undefined ? '' : String(data.count))
    put('[data-testv3-state]', typeof state.taps === 'number' ? String(state.taps) : '')
  }

  /** 按需读要读哪个源；`default` 不带参数，读卡片自己绑定的那个。 */
  var READS = [
    ['default', undefined],
    ['extra', 'testv3.extra'],
    ['gated', 'testv3.gated'],
    ['bad', 'testv3.bad'],
    ['undeclared', 'testv3.hidden'],
  ]

  /** 把一次调用的结果写进它自己的槽。 */
  function settle(slot, work) {
    work().then(function (result) {
      put('[data-testv3-read="' + slot + '"]', describe(true, result))
    }, function (error) {
      put('[data-testv3-read="' + slot + '"]', describe(false, error))
    })
  }

  Array.prototype.forEach.call(card.querySelectorAll('[data-testv3-read-button]'), function (button) {
    var slot = button.getAttribute('data-testv3-read-button')
    var picked = READS.filter(function (entry) { return entry[0] === slot })[0]
    if (picked === undefined) return
    button.addEventListener('click', function () {
      // 默认源也要给一个对象：能力的参数按 input schema 校验，空对象是「不点名源」的写法。
      var args = picked[1] === undefined ? {} : { source: picked[1] }
      settle(slot, function () { return widget.call('widget-board:data.read', args) })
    })
  })

  card.querySelector('[data-testv3-run]').addEventListener('click', function () {
    widget.action('testv3.run')
  })
  card.querySelector('[data-testv3-tap]').addEventListener('click', function () {
    var state = widget.state !== null && typeof widget.state === 'object' ? widget.state : {}
    var taps = typeof state.taps === 'number' ? state.taps : 0
    widget.setState({ taps: taps + 1 })
  })
  card.querySelector('[data-testv3-echo]').addEventListener('click', function () {
    widget.call('testv3.echo', { text: 'v3' }).then(function (result) {
      put('[data-testv3-echo-result]', describe(true, result.echo))
    }, function (error) {
      put('[data-testv3-echo-result]', describe(false, error))
    })
  })
  card.querySelector('[data-testv3-gone]').addEventListener('click', function () {
    widget.call('testv3.gone').then(function () {
      put('[data-testv3-gone-result]', 'ok')
    }, function (error) {
      put('[data-testv3-gone-result]', describe(false, error))
    })
  })

  widget.onData(render)
  widget.onState(render)
  widget.onProps(render)
  widget.onPause(render)
  render()
})()
