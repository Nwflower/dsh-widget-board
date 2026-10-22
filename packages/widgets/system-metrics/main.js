/*
 * 运行成本卡的脚本（issue #5）：数据源每 5 秒给一份 SystemMetrics，这里只排版，并把最近 60 次
 * 常驻内存留在卡片状态里画走势。字节换算、历史裁剪与路径计算在 `view.js`，那份逻辑有单元测试。
 *
 * 卡片不自己计时：刷新由宿主调度器按观众启停（D6）。离开视口时父页面发 `pause`，页面隐藏时
 * iframe 自己的 `visibilityState` 变 hidden；两种情况都停止绘制与状态写入，恢复时把最后一份数据
 * 重画一次。组件库的缩略画面没有观众，画一份固定样例，也不写状态。
 */
;(function () {
  'use strict'

  var card = document.querySelector('.metrics')
  if (card === null) return

  var widget = window.widget
  var view = window.SystemMetricsView
  var root = document.documentElement
  var MB = 1024 * 1024
  var KB = 1024

  /** 组件库缩略画面的样例：只在这个 inert 的预览里出现，不冒充宿主读数。 */
  var PREVIEW = {
    sampledAt: '',
    host: { rss: 184 * MB, heapUsed: 42 * MB, heapTotal: 58 * MB, external: 11 * MB, arrayBuffers: 4 * MB },
    board: { cards: 24, boards: 3, stateBytes: 18 * KB, documentsBytes: Math.round(7.2 * MB) },
    library: { widgets: 27, versions: 61 }
  }

  var fields = {}
  var labels = {}
  var fills = {}
  var nodes = card.querySelectorAll('[data-field]')
  for (var index = 0; index < nodes.length; index += 1) fields[nodes[index].dataset.field] = nodes[index]
  nodes = card.querySelectorAll('[data-label]')
  for (var at = 0; at < nodes.length; at += 1) labels[nodes[at].dataset.label] = nodes[at]
  nodes = card.querySelectorAll('[data-fill]')
  for (var slot = 0; slot < nodes.length; slot += 1) fills[nodes[slot].dataset.fill] = nodes[slot]

  var samples = []
  var lastData = null
  var lastStamp = ''
  var paused = false
  var hidden = document.visibilityState === 'hidden'
  var preview = false

  /** 当前语言：宿主把界面语言写在文档的 lang 上。 */
  function lang() {
    return root.lang === '' ? 'zh-CN' : root.lang
  }

  /** manifest 的 text 里的一条；没有时用调用方给的中文兜底。 */
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

  /** 计数按当前语言分组。 */
  function count(value) {
    return new Intl.NumberFormat(lang()).format(value)
  }

  /** 先把固定文案放好；读数随数据到来再写。 */
  function setLabels() {
    write(fields.title, label('title', '运行成本'))
    write(fields.kicker, label('kicker', '整个宿主进程'))
    write(fields.scope, label('scope', '宿主进程常驻内存 · 含看板以外的工作'))
    write(fields.empty, label('empty', '等待第一次采样'))
    write(fields.unmeasurable, label('unmeasurable', '单张卡片的内存无法从宿主侧测量'))
    write(fields.boundary, label('boundary', '渲染进程与 GPU 内存不向插件开放；每张卡片是一份独立文档与一个 iframe'))
    write(labels.heap, label('heap', '堆'))
    write(labels.external, label('external', '外部内存'))
    write(labels.arrayBuffers, label('arrayBuffers', 'ArrayBuffer'))
    write(labels.state, label('stateLabel', '状态总量'))
    write(labels.documents, label('documentsLabel', '文档体积'))
    write(labels.library, label('libraryLabel', '组件库'))
  }

  /** 没有数据时的样子：读数留空，限制说明照旧在。 */
  function renderEmpty() {
    card.dataset.state = 'empty'
    show(fields.empty, true)
    show(fields.stamp, false)
    show(fields.parts, false)
    show(fields.facts, false)
    show(fields.trend, false)
    write(fields.rss, '—')
    write(fields.rssUnit, '')
  }

  /** 一次采样画到卡片上；预览也走这一条，只是数据换成固定样例。 */
  function render(data) {
    var model = view.viewOf(data, samples, lang())
    if (model.state !== 'ready') {
      renderEmpty()
      return
    }
    card.dataset.state = 'ready'
    show(fields.empty, false)
    show(fields.stamp, model.stamp !== '')
    show(fields.parts, true)
    show(fields.facts, true)
    write(fields.stamp, template('stamp', '采样于 {time}', { time: model.stamp }))
    write(fields.rss, model.rss.value)
    write(fields.rssUnit, model.rss.unit)
    for (var index = 0; index < model.parts.length; index += 1) {
      var part = model.parts[index]
      write(fields[part.key], part.text)
      var bar = fills[part.key]
      if (bar !== undefined && bar !== null) bar.style.setProperty('--fill', String(part.fill))
    }
    write(labels.cards, template('cardsLabel', '卡片（{boards} 块看板）', { boards: count(model.facts.boards) }))
    write(fields.cards, count(model.facts.cards))
    write(fields.state, model.facts.state.text)
    write(fields.documents, model.facts.documents.text)
    write(fields.library, template('libraryValue', '{widgets} 类 · {versions} 版本', {
      widgets: count(model.facts.widgets),
      versions: count(model.facts.versions)
    }))
    var trend = model.trend
    show(fields.trend, trend !== null)
    if (trend !== null) {
      write(fields.trendCaption, template('trend', '最近 {n} 次采样', { n: count(trend.count) }))
      if (fields.trendLine !== undefined) fields.trendLine.setAttribute('d', trend.line)
      if (fields.trendArea !== undefined) fields.trendArea.setAttribute('d', trend.area)
    }
  }

  /** 把最后一份数据重画一次；暂停或页面隐藏时不画。 */
  function paint() {
    if (paused || hidden) return
    if (preview) {
      renderPreview()
      return
    }
    render(lastData)
  }

  /** 一次数据到来：先记采样，再画。暂停、页面隐藏与预览里都不写状态。 */
  function accept(data) {
    lastData = data
    if (preview) return
    // 组件脚本先于握手运行：首帧的文案是兜底值，语言在数据到来时才一定读得到。
    setLabels()
    var sample = view.sampleOf(data)
    if (sample !== null && !paused && !hidden && sample.at !== lastStamp) {
      samples = view.appendSample(samples, sample, view.LIMIT)
      lastStamp = sample.at
      if (widget !== undefined && typeof widget.setState === 'function') widget.setState({ samples: samples })
    }
    paint()
  }

  /** 预览里的走势：一组固定起伏，画出来只是让人看见这张卡长什么样。 */
  function previewSamples() {
    var list = []
    for (var index = 0; index < 18; index += 1) {
      var wave = Math.sin(index / 2.4) * 9 + Math.cos(index / 5) * 4
      list = view.appendSample(list, { at: '', rss: Math.round((168 + wave + index * 0.7) * MB) }, view.LIMIT)
    }
    return list
  }

  function renderPreview() {
    write(fields.kicker, label('previewKicker', '示例数据'))
    render(PREVIEW)
  }

  /** 盒子是不是组件库的缩略画面；是的话换成固定样例。 */
  function consider(size) {
    if (size === null || typeof size !== 'object') return
    if (size.placement === 'preview') {
      if (!preview) {
        preview = true
        samples = previewSamples()
      }
      setLabels()
      renderPreview()
      return
    }
    if (preview) {
      preview = false
      setLabels()
      paint()
    }
  }

  setLabels()
  if (widget !== undefined) {
    samples = view.trimSamples(widget.state === null || typeof widget.state !== 'object' ? [] : widget.state.samples, view.LIMIT)
    lastStamp = samples.length > 0 ? samples[samples.length - 1].at : ''
    widget.onData(accept)
    widget.onPause(function (next) {
      paused = next === true
      if (!paused) paint()
    })
    widget.onSize(consider)
    consider(widget.size)
    if (widget.data !== undefined && widget.data !== null) accept(widget.data)
    else renderEmpty()
  }
  // 页面隐藏时父页面不一定发 pause；iframe 自己的可见性跟着顶层页面走，这里补上。
  document.addEventListener('visibilitychange', function () {
    hidden = document.visibilityState === 'hidden'
    if (!hidden) paint()
  })
})()
