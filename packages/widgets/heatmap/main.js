/*
 * 活动卡片的脚本：把会话用量画成一张铺满卡片的格子，外加已经消耗的 Token 总量。
 *
 * 读数经宿主能力取：先问 dsh-claude-style（与工作台首页同源），没装它就用看板自己的汇总。格子不按
 * 固定周数画：列数、行数与格子边长由盒子的像素宽高当场算出来，换一个盒子就换一套格子。
 */
(function () {
  var card = document.querySelector('.usage-card')
  if (!card) return

  var widget = window.widget
  var root = document.documentElement
  /**
   * 读数从哪来：先问 dsh-claude-style，它折的与工作台首页同源；没装这个插件时用看板自己的汇总。
   * 两条能力读的是同一批会话日志，先答出来的那份就是读数。
   */
  var CAPABILITIES = ['dsh-claude-style:usage', 'widget-board:usage']
  /** 已读到数字之后，隔多久再看一次；换页回来不会每次都等它现算。 */
  var REFRESH_MS = 120000
  /** 还没读到数字时，隔多久再问一次。 */
  var RETRY_MS = 4000
  var WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  /** 格子之间的缝，与格子边长一起决定一屏放得下多少天。 */
  var GAP = 3

  var el = {
    kicker: card.querySelector('[data-field="kicker"]'),
    title: card.querySelector('[data-field="title"]'),
    meta: card.querySelector('[data-field="meta"]'),
    totalLabel: card.querySelector('[data-field="totalLabel"]'),
    total: card.querySelector('[data-field="total"]'),
    heat: card.querySelector('[data-role="heat"]'),
    grid: card.querySelector('[data-role="grid"]'),
    tip: card.querySelector('[data-role="tip"]'),
    empty: card.querySelector('[data-role="empty"]')
  }

  var usage = { ready: false, summary: null, text: '', loaded: false }
  var loading = false
  var lastReadAt = 0
  var timer = 0
  var settleTimer = 0
  var layoutKey = ''
  var lastDrawn = null

  function isZh() {
    return widget === undefined || String(widget.lang || 'zh').toLowerCase().indexOf('zh') === 0
  }

  function label(name, fallback) {
    if (widget === undefined) return fallback
    var value = widget.t(name)
    return value === name ? fallback : value
  }

  function write(node, value) {
    if (node === undefined || node === null) return
    node.textContent = value === null || value === undefined ? '' : String(value)
  }

  function propText(name, fallback) {
    if (widget === undefined || widget.props === undefined) return fallback
    var value = widget.props[name]
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback
  }

  /** 千分位，不带小数。 */
  function grouped(value) {
    return String(Math.round(Number(value) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  }

  /** token 数按 k / M / B 折，单位挑在四舍五入之后，所以 999,600 读作 1M、不会读成 1000k。 */
  function compact(value) {
    var number = Number(value) || 0
    var units = [[1e9, 'B'], [1e6, 'M'], [1e3, 'k']]
    for (var index = 0; index < units.length; index += 1) {
      var scaled = Math.round((number / units[index][0]) * 10) / 10
      if (scaled >= 1) return String(scaled) + units[index][1]
    }
    return String(Math.round(number))
  }

  function tokensOfDay(day) {
    return (day.input || 0) + (day.output || 0) + (day.cacheRead || 0) + (day.cacheWrite || 0)
  }

  function widthOf(node) {
    if (node === undefined || node === null || typeof node.getBoundingClientRect !== 'function') return 0
    return node.getBoundingClientRect().width
  }

  function heightOf(node) {
    if (node === undefined || node === null || typeof node.getBoundingClientRect !== 'function') return 0
    return node.getBoundingClientRect().height
  }

  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate())
  }

  function addDays(date, count) {
    var next = startOfDay(date)
    next.setDate(next.getDate() + count)
    return next
  }

  function iso(date) {
    var month = date.getMonth() + 1
    var day = date.getDate()
    return date.getFullYear() + '-' + (month < 10 ? '0' + month : month) + '-' + (day < 10 ? '0' + day : day)
  }

  /** 把若干天汇总成面板读的那个数：总量与有记录的天数。 */
  function summaryFrom(days) {
    var totals = { tokens: 0, activeDays: 0 }
    for (var index = 0; index < days.length; index += 1) {
      var tokens = tokensOfDay(days[index])
      totals.tokens += tokens
      if (tokens > 0 || (Number(days[index].calls) || 0) > 0) totals.activeDays += 1
    }
    return { days: days, totals: totals }
  }

  /**
   * 读到的回答有四种：插件算好的汇总；插件还在算（`ready: false`）；插件缺席或调用失败时宿主回的
   * 错误文字；什么都没有。
   */
  function summaryOf(answer) {
    if (typeof answer === 'string') return { problem: answer }
    if (answer === null || typeof answer !== 'object') return { problem: '' }
    if (answer.ready !== true || !Array.isArray(answer.days)) {
      return { problem: typeof answer.error === 'string' ? answer.error : '' }
    }
    var days = []
    for (var index = 0; index < answer.days.length; index += 1) {
      var day = answer.days[index]
      if (day === null || typeof day !== 'object' || typeof day.date !== 'string') continue
      days.push(day)
    }
    return summaryFrom(days)
  }

  /**
   * 演示数据：最近 371 天的固定模式，按日期算出来，不随机。越近的日子越忙，周末低一些，几周一个起伏，
   * 画出来像真的使用记录，不像噪点。
   */
  function demoSummary() {
    var days = []
    var end = startOfDay(new Date())
    for (var index = 0; index < 371; index += 1) {
      var day = addDays(end, -index)
      var weekend = (day.getDay() + 6) % 7 >= 5
      var wave = 5.5 + 2.6 * Math.sin(index / 11) + 1.4 * Math.sin(index / 3.1)
      var recency = 0.45 + 0.55 * (1 - index / 371)
      var settled = weekend ? wave * 0.35 : wave
      var weight = Math.max(0, settled * recency)
      var scale = weight < 1.2 ? 0 : Math.round(weight)
      var tokens = scale === 0 ? 0 : scale * 2600 + 1200
      var input = Math.round(tokens * 0.72)
      days.push({
        date: iso(day),
        input: input,
        output: tokens - input,
        cacheRead: 0,
        cacheWrite: 0,
        calls: scale === 0 ? 0 : Math.max(1, Math.round(scale / 2))
      })
    }
    days.reverse()
    return summaryFrom(days)
  }

  function readUsage(force) {
    if (widget === undefined || typeof widget.call !== 'function') {
      usage.text = label('noHost', isZh() ? '这个卡片不在宿主里，显示的是示例数据' : 'Not inside a host: showing sample data')
      render(true)
      return
    }
    if (loading) return
    if (!force && usage.loaded && usage.ready && Date.now() - lastReadAt < REFRESH_MS) return
    loading = true
    var at = Date.now()
    /** 挨个问：第一个答得出来的就是这份读数，全都答不出来时留下最后一条原因。 */
    var index = 0
    var ask = function () {
      if (index >= CAPABILITIES.length) return Promise.reject(new Error(label('unavailable', isZh() ? '读不到用量：没有提供用量的插件' : 'No usage provider answered')))
      var name = CAPABILITIES[index]
      index += 1
      return widget.call(name, {}).then(function (answer) {
        if (summaryOf(answer).problem !== undefined && index < CAPABILITIES.length) return ask()
        return answer
      }, function (error) {
        if (index < CAPABILITIES.length) return ask()
        throw error
      })
    }
    ask().then(function (answer) {
      lastReadAt = at
      usage.loaded = true
      var summary = summaryOf(answer)
      if (summary.problem !== undefined) {
        usage.ready = false
        usage.summary = null
        usage.text = summary.problem !== '' ? summary.problem : label('pending', isZh() ? '正在汇总会话用量…' : 'Folding session usage…')
      } else {
        usage.ready = true
        usage.summary = summary
        usage.text = ''
      }
    }).catch(function (error) {
      // 两条能力都读不到时把原因写在这张卡上（插件缺席、超时），过一会儿再问。
      lastReadAt = at
      usage.loaded = true
      usage.ready = false
      usage.summary = null
      usage.text = error instanceof Error ? error.message : String(error)
    }).then(function () {
      loading = false
      render(true)
      schedule()
    })
  }

  /** 总量：已经消耗的 Token 合计，按 k / M / B 折，悬停给出确切数字。 */
  function renderTotal(summary) {
    write(el.totalLabel, label('totalLabel', isZh() ? 'Token 总量' : 'Total tokens'))
    write(el.total, summary.totals.tokens > 0 ? compact(summary.totals.tokens) : '0')
    el.total.title = grouped(summary.totals.tokens) + (isZh() ? ' Token' : ' tokens')
  }

  /** 一屏最多铺多少天：再多就成了没有记录的底色。 */
  var MAX_DAYS = 400
  /** 格子总数的上限：盒子再大、记录再久，一屏也不超过这么多格。 */
  var MAX_CELLS = 364
  /** 格子不缩到比这更小：再小就成了一片点，深浅看不出区别。 */
  var MIN_CELL = 13
  /** 格子也不放到比这更大：记录很短时，格子不该大得像色块。 */
  var MAX_CELL = 40

  /**
   * 这一屏要铺多少天：从最早一条记录数到今天，前后各留一点余量；一天的记录都没有时铺一屏的空格子，
   * 让卡片仍是一张图。结果不超过 `MAX_DAYS`。
   *
   * @param summary - 读数。
   * @returns 天数。
   */
  function daysWanted(summary) {
    if (summary.days.length === 0) return 91
    var today = iso(startOfDay(new Date()))
    var earliest = null
    for (var index = 0; index < summary.days.length; index += 1) {
      if (tokensOfDay(summary.days[index]) <= 0) continue
      var date = summary.days[index].date
      if (date > today) continue
      if (earliest === null || date < earliest) earliest = date
    }
    if (earliest === null) return 91
    var first = new Date(earliest + 'T00:00:00')
    var span = Math.round((startOfDay(new Date()) - first) / 86400000) + 1
    // 一周一列，天数向上取整到整周并多给一列余量，右端不至于紧贴今天的格子；再少也铺四周。
    return Math.min(MAX_DAYS, Math.max(28, Math.ceil(span / 7) * 7 + 7))
  }

  /**
   * 格子怎么铺：一周一列，列数与格子边长都取整数像素，格子区不超过可用的宽高，最后一列不会被裁掉。
   * 天数上限是这一屏该铺的天数（`target`）；各种列数都试一遍，取铺得最满的一种。
   *
   * @param room - 格子区能用的宽高，像素。
   * @param target - 这一屏最多铺多少天。
   * @returns `{ cell, gap, columns, rows }`。
   */
  function fitGrid(room, target) {
    for (var days = target; days >= 28; days -= 7) {
      var candidate = tryFit(room, days)
      if (candidate !== null) return candidate
    }
    // 盒子小到放不下四周的常规格子：按最小格子铺，天数由盒子的宽高定。
    return {
      cell: 8,
      gap: 2,
      columns: Math.max(1, Math.floor((room.width + 2) / 10)),
      rows: Math.max(1, Math.floor((room.height + 2) / 10)),
    }
  }

  /**
   * 在给定的天数里挑一种排法：一周一列，列数与格子边长取整数像素，格子区不超过可用宽高。
   *
   * @param room - 格子区能用的宽高。
   * @param target - 最多铺多少天。
   * @returns 铺得最满的一种；放不下时是 null。
   */
  function tryFit(room, target) {
    var best = null
    var maxColumns = Math.max(7, Math.floor((room.width + GAP) / (MIN_CELL + GAP)))
    for (var columns = 7; columns <= maxColumns; columns += 7) {
      var rows = Math.floor(target / columns)
      if (rows < 2) break
      for (var gap = 2; gap <= 6; gap += 1) {
        var byWidth = Math.floor((room.width - (columns - 1) * gap) / columns)
        var byHeight = Math.floor((room.height - (rows - 1) * gap) / rows)
        var cell = Math.min(byWidth, byHeight, MAX_CELL)
        if (cell < MIN_CELL) continue
        var usedArea = (columns * cell + (columns - 1) * gap) * (rows * cell + (rows - 1) * gap)
        if (best === null || usedArea > best.area) {
          best = { cell: cell, gap: gap, columns: columns, rows: rows, area: usedArea }
        }
      }
    }
    return best
  }

  function ariaText(days, total, active) {
    if (isZh()) return '最近 ' + days + ' 天的用量：共 ' + compact(total) + ' Token，' + active + ' 天有记录'
    return 'Usage over the last ' + days + ' days: ' + compact(total) + ' tokens on ' + active + ' active days'
  }

  function tipText(day, tokens) {
    var stamp = isZh()
      ? day.getMonth() + 1 + '月' + day.getDate() + '日 ' + WEEKDAYS[day.getDay()]
      : new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(day)
    return stamp + ' — ' + compact(tokens) + (isZh() ? ' Token' : ' tokens')
  }

  /**
   * 铺格子：先看记录有多久（`daysWanted`），再按格子区的宽高排出最多能铺多少格（`MAX_CELLS` 封顶），
   * 从今天往回取那么多天，按行排开。
   *
   * @param summary - 读数。
   * @returns 铺出来的列数、行数与窗口里的总量。
   */
  function renderGrid(summary) {
    var room = { width: widthOf(el.heat), height: heightOf(el.heat) }
    if (room.width <= 0 || room.height <= 0) return null
    var wanted = daysWanted(summary)
    var fit = fitGrid(room, Math.min(wanted, MAX_CELLS))
    // 记录比这屏能铺的还短：只铺用到的那几行，不画多余的整行空格子。
    fit.rows = Math.max(1, Math.min(fit.rows, Math.ceil(wanted / fit.columns)))
    var drawn = Math.min(wanted, fit.columns * fit.rows)
    var byDate = {}
    for (var index = 0; index < summary.days.length; index += 1) byDate[summary.days[index].date] = summary.days[index]
    var end = startOfDay(new Date())
    var first = addDays(end, -(drawn - 1))
    var peak = 0
    var cursor = 0
    for (cursor = 0; cursor < drawn; cursor += 1) {
      var probe = byDate[iso(addDays(first, cursor))]
      var probeTokens = probe === undefined ? 0 : tokensOfDay(probe)
      if (probeTokens > peak) peak = probeTokens
    }

    var todayKey = iso(end)
    var cells = []
    var windowTotal = 0
    var active = 0
    for (var step = 0; step < drawn; step += 1) {
      var day = addDays(first, step)
      var dayKey = iso(day)
      var entry = byDate[dayKey]
      var tokens = entry === undefined ? 0 : tokensOfDay(entry)
      var cell = document.createElement('span')
      cell.className = 'usage-card__cell'
      cell.dataset.level = String(tokens <= 0 || peak <= 0 ? 0 : Math.max(1, Math.min(4, Math.ceil((tokens / peak) * 4))))
      if (dayKey === todayKey) cell.dataset.today = ''
      if (tokens > 0) {
        windowTotal += tokens
        active += 1
      }
      cell.dataset.tip = tipText(day, tokens)
      // 位置逐格写死：第几行第几列由这一格在窗口里的先后决定，内核不必再推。
      cell.style.setProperty('grid-row', String(Math.floor(step / fit.columns) + 1))
      cell.style.setProperty('grid-column', String((step % fit.columns) + 1))
      cells.push(cell)
    }

    el.grid.replaceChildren.apply(el.grid, cells)
    el.grid.style.setProperty('--usage-cols', String(fit.columns))
    el.grid.style.setProperty('--usage-rows', String(fit.rows))
    el.grid.style.setProperty('--usage-cell', fit.cell.toFixed(2) + 'px')
    el.grid.style.setProperty('--usage-gap', (fit.gap || GAP) + 'px')
    el.grid.style.setProperty('--usage-radius', Math.max(2, Math.min(6, fit.cell * 0.22)).toFixed(1) + 'px')
    el.grid.setAttribute('aria-label', ariaText(drawn, windowTotal, active))
    // 格子一律按数据深浅画；还没读到数字时画的是示例，右上角写着「示例数据」。
    el.heat.removeAttribute('data-skeleton')
    return { days: drawn, columns: fit.columns, rows: fit.rows, total: windowTotal, active: active }
  }

  function render(force) {
    var summary = usage.ready ? usage.summary : demoSummary()
    write(el.kicker, propText('kicker', ''))
    write(el.title, propText('title', label('title', isZh() ? '用量统计' : 'Usage')))
    renderTotal(summary)

    var empty = usage.ready && summary.days.length === 0
    el.heat.hidden = empty
    el.empty.hidden = !empty
    if (empty) {
      write(el.empty, usage.text !== '' ? usage.text : label('empty', isZh() ? '还没有用量记录' : 'Nothing recorded yet'))
      return
    }
    write(el.empty, '')

    var room = { width: widthOf(el.heat), height: heightOf(el.heat) }
    var key = [room.width, room.height].join('|')
    if (force === true || key !== layoutKey || lastDrawn === null || lastDrawn === undefined) {
      lastDrawn = renderGrid(summary)
      layoutKey = key
    }
    if (lastDrawn === null) return
    // 读到数字时右上是范围；没读到时写一句「示例」，原因留在悬停里，卡片不空着也不假装有数。
    if (usage.ready) {
      write(el.meta, (isZh() ? '最近 ' : 'last ') + String(lastDrawn.days) + (isZh() ? ' 天' : ' days'))
      el.meta.title = ''
    } else {
      write(el.meta, label('offline', isZh() ? '示例数据' : 'sample data'))
      el.meta.title = usage.text
    }
    // 格子铺好之后正文的高度可能变了一点：下一轮再按量到的宽高铺一次。
    window.clearTimeout(settleTimer)
    settleTimer = window.setTimeout(function () {
      if (widthOf(el.heat) !== room.width || heightOf(el.heat) !== room.height) render(true)
    }, 0)
  }

  /** 没读到数字时过一会儿再问；读到之后只在牌面重新出现时按时间判断要不要刷新。 */
  function schedule() {
    window.clearTimeout(timer)
    if (!usage.ready) timer = window.setTimeout(function () { readUsage(true) }, RETRY_MS)
  }

  /** 提示贴在格子正上方；格子贴边时往内收，不越出卡片。 */
  function showTip(cell) {
    var text = cell.dataset.tip
    if (text === undefined || text === '') return
    var box = card.getBoundingClientRect()
    var at = cell.getBoundingClientRect()
    el.tip.textContent = text
    el.tip.setAttribute('data-open', '')
    var width = el.tip.offsetWidth
    var left = at.left - box.left + at.width / 2 - width / 2
    el.tip.style.left = Math.max(4, Math.min(box.width - width - 4, left)) + 'px'
    el.tip.style.top = Math.max(4, at.top - box.top - el.tip.offsetHeight - 6) + 'px'
  }

  function hideTip() {
    el.tip.removeAttribute('data-open')
  }

  function cellFrom(target) {
    return target instanceof Element ? target.closest('.usage-card__cell') : null
  }

  card.addEventListener('pointerover', function (event) {
    var cell = cellFrom(event.target)
    if (cell !== null) showTip(cell)
  })
  card.addEventListener('pointerout', function (event) {
    if (cellFrom(event.target) !== null) hideTip()
  })
  card.addEventListener('focusin', function (event) {
    var cell = cellFrom(event.target)
    if (cell !== null) showTip(cell)
  })
  card.addEventListener('focusout', hideTip)

  render(true)
  readUsage()
  schedule()

  if (widget !== undefined) {
    widget.onProps(function () {
      render(false)
    })
    widget.onSize(function () {
      render(true)
    })
    widget.onPause(function (paused) {
      if (paused) window.clearTimeout(timer)
      else readUsage(false)
    })
    widget.onData(function () {
      readUsage(true)
    })
  }
})()
