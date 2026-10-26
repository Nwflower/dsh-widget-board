/*
 * 最近 Token 用量卡的脚本：把数据源给的 SessionUsageSnapshot 排成一张趋势仪表。
 *
 * 卡片不自己计时：刷新由 manifest 的 refresh 交给宿主调度器按观众启停（D6）。读数换算、分项占比、
 * 走势路径与状态判定都在 `view.js`（有单元测试），这里只把模型写到 DOM，并在状态变化时换文案。
 * 组件库的缩略画面没有数据，画一份固定样例并标成示例数据，不冒充宿主读数。
 */
;(function () {
  'use strict'

  var card = document.querySelector('.usage')
  if (card === null) return

  var widget = window.widget
  var view = window.SessionUsageView
  var root = document.documentElement

  /** 缩略画面用的固定样例：只出现在组件库的 inert 预览里。 */
  var PREVIEW = {
    available: true,
    reason: null,
    startedAt: 1773900000000,
    scope: 'session',
    date: '2026-03-19',
    session: 'a41f7c02',
    empty: null,
    totals: {
      input: 412880,
      output: 96840,
      cacheRead: 1531200,
      cacheWrite: 74200,
      total: 2115120,
      calls: 216,
      estimated: false
    },
    recent: {
      at: 1773900840000,
      session: 'a41f7c02',
      input: 3120,
      output: 780,
      total: 12940,
      estimated: false
    },
    trend: []
  }

  /** 样例走势每次调用的规范化总量，按时间从旧到新。 */
  var PREVIEW_VALUES = [
    148200, 96200, 210400, 174800, 88200, 232600, 119400,
    205800, 141600, 168200, 97300, 224400, 188600, 12940
  ]

  var fields = {}
  var labels = {}
  var pieces = {}
  var index = 0

  for (index = 0; index < PREVIEW_VALUES.length; index += 1) {
    PREVIEW.trend.push({ at: PREVIEW.startedAt + (index + 1) * 60000, value: PREVIEW_VALUES[index] })
  }

  var nodes = card.querySelectorAll('[data-field]')
  for (index = 0; index < nodes.length; index += 1) fields[nodes[index].dataset.field] = nodes[index]
  nodes = card.querySelectorAll('[data-label]')
  for (index = 0; index < nodes.length; index += 1) labels[nodes[index].dataset.label] = nodes[index]
  nodes = card.querySelectorAll('[data-piece]')
  for (index = 0; index < nodes.length; index += 1) pieces[nodes[index].dataset.piece] = nodes[index]

  var preview = false

  /** 当前语言：宿主把界面语言写在文档的 lang 上。 */
  function lang() {
    return root.lang === '' ? 'zh-CN' : root.lang
  }

  /** manifest 的 text 里的一条；没有时用调用方给的兜底。 */
  function label(key, fallback) {
    if (widget === undefined || typeof widget.t !== 'function') return fallback
    var value = widget.t(key)
    return value === key ? fallback : value
  }

  /** 一条带占位符的文案：`{name}` 换成值。 */
  function template(key, fallback, values) {
    var text = label(key, fallback)
    for (var name in values) {
      if (Object.prototype.hasOwnProperty.call(values, name)) text = text.split('{' + name + '}').join(String(values[name]))
    }
    return text
  }

  function write(node, value) {
    if (node !== undefined && node !== null) node.textContent = value === null || value === undefined ? '' : String(value)
  }

  function show(node, visible) {
    if (node !== undefined && node !== null) node.hidden = !visible
  }

  /** props 里的范围；没声明或写错时按默认的所选会话。 */
  function scopeOf(props) {
    var scope = props !== null && typeof props === 'object' ? props.scope : undefined
    return scope === 'today' || scope === 'all' ? scope : 'session'
  }

  function scopeLabel(scope) {
    if (scope === 'today') return label('kickerToday', '今天')
    if (scope === 'all') return label('kickerAll', '全部会话')
    return label('kickerSession', '所选会话')
  }

  /** 五种非 ready 状态各自的说法，互不相同，也都不是 0。 */
  function stateText(state) {
    if (state === 'unavailable') return label('unavailable', '会话服务不可用，读不到用量')
    if (state === 'no-sessions') return label('noSessions', '还没有任何会话')
    if (state === 'no-usage') return label('noUsage', '所选范围还没有用量')
    if (state === 'invalid') return label('invalid', '用量数据不完整')
    return label('loading', '正在读取用量…')
  }

  /** 总量从哪来：合并了历史、只有实时，以及历史读不到的两种原因。 */
  function sourceText(source) {
    if (source === 'history') return label('historySource', '历史 dsh-usage')
    if (source === 'not-installed') return label('historyMissing', '历史未接入')
    if (source === 'unavailable') return label('historyUnavailable', '历史不可用')
    return label('realtimeSource', '仅实时')
  }

  /** 固定文案先放好，读数随数据到来再写；语言切换后重画时会再走一遍。 */
  function setLabels(scope) {
    write(fields.title, label('title', '最近 Token 用量'))
    write(fields.kicker, scopeLabel(scope))
    write(fields.totalLabel, label('total', '总量'))
    write(fields.estimated, label('estimated', '含推算'))
    write(fields.recentTitle, label('recent', '最近一次调用'))
    write(labels.input, label('input', '输入'))
    write(labels.output, label('output', '输出'))
    write(labels.cacheRead, label('cacheRead', '缓存读'))
    write(labels.cacheWrite, label('cacheWrite', '缓存写'))
  }

  /** 四项分项：读数、占比与读屏用的完整数字，另把占比写进顶部那条读数条。 */
  function paintParts(model) {
    for (var at = 0; at < model.parts.length; at += 1) {
      var part = model.parts[at]
      write(fields[part.key], part.compact.text)
      write(fields[part.key + 'Share'], template('share', '{pct}%', { pct: String(part.share) }))
      write(fields[part.key + 'Full'], template('partAria', '{label} {value} 个 token，占四项分项合计的 {pct}%', {
        label: label(part.key, part.key),
        value: part.full,
        pct: String(part.share)
      }))
      if (pieces[part.key] !== undefined) pieces[part.key].style.setProperty('--share', String(Math.max(0, part.share)))
    }
  }

  /** 走势：说明一行、面积与折线两条路径、末点圆点；没有两个点时不画，也不留空的 role。 */
  function paintTrend(model) {
    var trend = model.trend
    show(fields.trend, trend !== null)
    if (trend === null) {
      show(fields.end, false)
      if (fields.plot !== undefined) fields.plot.removeAttribute('aria-label')
      return
    }
    write(fields.trendCaption, template('trend', '最近 {n} 次调用 · 自 {time} 起', {
      n: view.formatCount(trend.count, lang()),
      time: model.started
    }))
    if (fields.line !== undefined) fields.line.setAttribute('d', trend.line)
    if (fields.area !== undefined) fields.area.setAttribute('d', trend.area)
    show(fields.end, true)
    if (fields.end !== undefined) {
      fields.end.style.left = trend.last.x + '%'
      fields.end.style.top = (trend.last.y / 32) * 100 + '%'
    }
    if (fields.plot !== undefined) {
      fields.plot.setAttribute('aria-label', template('trendAria', '用量走势：最近 {n} 次调用，最高 {high} 个 token，最新 {latest} 个 token', {
        n: view.formatCount(trend.count, lang()),
        high: trend.highFull,
        latest: trend.latestFull
      }))
    }
  }

  /** 最近一次调用：读数用完整数字，时间、会话与推算按有没有依次接在后面。 */
  function paintRecent(model) {
    var meta = []
    if (model.recent.time !== '') meta.push(model.recent.time)
    if (model.recent.session !== null) meta.push(template('sessionLabel', '会话 {id}', { id: model.recent.session }))
    if (model.recent.estimated) meta.push(label('estimatedCall', '推算'))
    write(fields.recentValue, model.recent.full)
    write(fields.recentMeta, meta.join(' · '))
  }

  /** 一次读数画到卡片上：主读数、走势、分项、次读依次落位。 */
  function paintReady(model) {
    write(fields.meta, model.date + ' · ' + sourceText(model.source))
    write(fields.total, model.total.compact.value)
    write(fields.unit, model.total.compact.unit)
    write(fields.calls, template('calls', '{n} 次调用', { n: model.callsText }))
    show(fields.estimated, model.estimated)
    var totalText = template('totalAria', '总量 {total} 个 token，{calls} 次调用', {
      total: model.total.full,
      calls: model.callsText
    })
    write(fields.totalFull, model.estimated ? totalText + '，' + label('estimatedNote', '部分调用没有总数，总量按输入与输出推算') : totalText)
    paintTrend(model)
    paintParts(model)
    if (model.recent !== null) paintRecent(model)
  }

  /** 状态与文案一起落位；非 ready 时收起全部读数，只留一条说明。 */
  function render(data) {
    var model = view.viewOf(data, lang())
    var ready = model.state === 'ready'
    setLabels(scopeOf(widget === undefined ? undefined : widget.props))
    card.dataset.state = model.state
    card.setAttribute('aria-busy', model.state === 'loading' ? 'true' : 'false')
    show(fields.hero, ready)
    show(fields.parts, ready)
    // 最近一次调用只来自实时事件：这段时间只有历史用量时整块收起来，不报数据不完整。
    show(fields.recent, ready && model.recent !== null)
    show(fields.empty, !ready)
    if (!ready) {
      write(fields.meta, '')
      show(fields.trend, false)
      show(fields.end, false)
      if (fields.plot !== undefined) fields.plot.removeAttribute('aria-label')
      write(fields.empty, stateText(model.state))
      return
    }
    paintReady(model)
  }

  /** 盒子是不是组件库的缩略画面；是的话换成固定样例。 */
  function consider(size) {
    if (size === null || typeof size !== 'object') return
    if (size.placement === 'preview') {
      if (!preview) {
        preview = true
        render(PREVIEW)
        write(fields.kicker, label('previewKicker', '示例数据'))
      }
      return
    }
    if (preview) {
      preview = false
      render(widget === undefined ? null : widget.data)
    }
  }

  setLabels(scopeOf(widget === undefined ? undefined : widget.props))
  if (widget !== undefined) {
    widget.onData(function (data) {
      if (!preview) render(data)
    })
    widget.onProps(function () {
      if (!preview) render(widget.data)
    })
    widget.onSize(consider)
    consider(widget.size)
    if (!preview) render(widget.data)
  }
})()
