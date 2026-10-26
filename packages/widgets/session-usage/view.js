/*
 * 最近 Token 用量卡的纯视图逻辑：数字换算、四项分项的占比、走势路径与状态判定。
 *
 * 这里不碰 DOM，也不发消息；`main.js` 只负责排版。文件同时以经典脚本内联进组件文档、以副作用
 * 模块被单元测试载入，两处读到的是同一份实现。
 *
 * 状态按共享数据契约判定：available 为假只表示会话服务缺席；两种空态的 totals 都是 null，所以这里
 * 不拿 0 顶替缺失的读数（D11）。会话 id 超过 8 位说明提供方漏了截断，按数据不完整处理，组件不替
 * 它悄悄截一刀。
 *
 * history 缺省或为 null 表示只有实时事件；对象里 available 为假时按 reason 分出「历史未接入」与
 * 「历史不可用」，卡上照旧画实时数据。历史只给合计与分项，最近一次调用可以是 null——这段时间只有
 * 历史用量时就是这样。
 */
;(function (root) {
  'use strict'

  /** 走势最多画最近 30 次调用，与数据契约里 trend 的上限一致。 */
  var LIMIT = 30

  /** 走势画在 100 宽、32 高的 viewBox 里，上下各留 3 个单位给端点圆点。 */
  var VIEW_WIDTH = 100
  var TOP = 3
  var BOTTOM = 29

  var SCOPES = ['session', 'today', 'all']

  /** 历史的来源名与它的三种失败原因，与数据契约里的枚举一致。 */
  var HISTORY_SOURCE = 'dsh-usage'
  var HISTORY_REASONS = ['not-installed', 'unavailable', 'invalid']

  /** 四项分项的顺序：读数条、占比条与设置里都用这一个顺序。 */
  var PARTS = ['input', 'output', 'cacheRead', 'cacheWrite']

  var TOTAL_FIELDS = ['input', 'output', 'cacheRead', 'cacheWrite', 'total', 'calls']

  /**
   * 总量单换算用的单位。token 的读数动辄七位，卡面只放换算后的数与单位，完整数字进读屏文本。
   */
  var UNITS = [
    { unit: 'B', scale: 1000000000 },
    { unit: 'M', scale: 1000000 },
    { unit: 'K', scale: 1000 },
    { unit: '', scale: 1 }
  ]

  /** 是不是一个非负的有限数。 */
  function number(value) {
    return typeof value === 'number' && isFinite(value) && value >= 0
  }

  /** 交给 Intl 的语言标记；没给时按英文。 */
  function locale(lang) {
    return lang === undefined || lang === null || lang === '' ? 'en' : String(lang)
  }

  /** 两位小数，路径字符串不必再长。 */
  function round(value) {
    return Math.round(value * 100) / 100
  }

  /** 完整数字：给读屏器、次读与状态文本用，不带换算单位。 */
  function formatCount(value, lang) {
    if (!number(value)) return '—'
    return new Intl.NumberFormat(locale(lang), { maximumFractionDigits: 0 }).format(value)
  }

  /** 换算后的数字与单位分开给，卡面好让单位用另一档字号。 */
  function compactOf(value, lang) {
    if (!number(value)) return { value: '—', unit: '', text: '—' }
    var entry = UNITS[UNITS.length - 1]
    for (var index = 0; index < UNITS.length; index += 1) {
      if (value >= UNITS[index].scale) {
        entry = UNITS[index]
        break
      }
    }
    var scaled = value / entry.scale
    var digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2
    var text = new Intl.NumberFormat(locale(lang), {
      maximumFractionDigits: digits,
      minimumFractionDigits: 0
    }).format(scaled)
    return { value: text, unit: entry.unit, text: text + entry.unit }
  }

  /** 一项占分母多少百分比，保留一位小数；分母为零时是 0。 */
  function shareOf(value, total) {
    if (!number(value) || !number(total) || total <= 0) return 0
    return Math.round((value / total) * 1000) / 10
  }

  /** 时分，24 小时制；时间读不出来时是空串。 */
  function timeOf(at, lang) {
    if (!number(at)) return ''
    var date = new Date(at)
    if (!isFinite(date.getTime())) return ''
    return new Intl.DateTimeFormat(locale(lang), {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }).format(date)
  }

  /**
   * 会话 id：契约只给前 8 位。超过 8 位说明提供方漏了截断，由调用方按数据不完整处理。
   *
   * @param value - 数据里的 session 字段。
   * @returns ok 为假表示形状不对；session 为 null 表示这一段不指会话。
   */
  function sessionOf(value) {
    if (value === null || value === undefined || value === '') return { ok: true, session: null }
    if (typeof value !== 'string' || value.length > 8) return { ok: false, session: null }
    return { ok: true, session: value }
  }

  /** 宿主本地时区的当天，YYYY-MM-DD。 */
  function dateOf(value) {
    return typeof value === 'string' && new RegExp('^[0-9]{4}-[0-9]{2}-[0-9]{2}$').test(value)
  }

  /** 概览里的六个数字与推算标记；缺一项就不是完整读数。 */
  function totalsOf(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
    for (var index = 0; index < TOTAL_FIELDS.length; index += 1) {
      if (!number(value[TOTAL_FIELDS[index]])) return null
    }
    if (typeof value.estimated !== 'boolean') return null
    return value
  }

  /** 最近一次调用：窗口里最新的一条，空态时是 null。 */
  function recentOf(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
    if (!number(value.at) || !number(value.input) || !number(value.output) || !number(value.total)) return null
    if (typeof value.estimated !== 'boolean') return null
    var session = sessionOf(value.session)
    if (!session.ok) return null
    return {
      at: value.at,
      session: session.session,
      input: value.input,
      output: value.output,
      total: value.total,
      estimated: value.estimated
    }
  }

  /** 只收形状对的走势点；超过上限时留最近的 30 个。 */
  function pointsOf(list) {
    var kept = []
    if (!Array.isArray(list)) return kept
    for (var index = 0; index < list.length; index += 1) {
      var point = list[index]
      if (point === null || typeof point !== 'object') continue
      if (!number(point.at) || !number(point.value)) continue
      kept.push({ at: point.at, value: point.value })
    }
    return kept.length > LIMIT ? kept.slice(kept.length - LIMIT) : kept
  }

  /**
   * 总量从哪来：会话范围永远只有实时事件，今天与全部可能合并了 dsh-usage 的历史。
   *
   * @param history - 数据里的 history 字段。
   * @returns history、realtime、not-installed 或 unavailable，卡面据此换来源说法。
   */
  function sourceOf(history) {
    if (history === null || history === undefined) return 'realtime'
    if (typeof history !== 'object' || Array.isArray(history)) return 'realtime'
    if (history.available === true) return 'history'
    if (history.reason === 'not-installed') return 'not-installed'
    return 'unavailable'
  }

  /**
   * 历史来源的形状：缺省与 null 都合法（旧数据没有这一段），对象要整份都对。
   *
   * @param value - 数据里的 history 字段。
   * @returns ok 为假表示形状不对；history 为 null 表示没有历史这一段。
   */
  function historyOf(value) {
    if (value === null || value === undefined) return { ok: true, history: null }
    if (typeof value !== 'object' || Array.isArray(value)) return { ok: false, history: null }
    if (value.source !== HISTORY_SOURCE) return { ok: false, history: null }
    if (typeof value.available !== 'boolean') return { ok: false, history: null }
    if (value.reason !== null && HISTORY_REASONS.indexOf(value.reason) < 0) return { ok: false, history: null }
    if (value.capturedAt !== null && !number(value.capturedAt)) return { ok: false, history: null }
    if (value.from !== null && !dateOf(value.from)) return { ok: false, history: null }
    if (value.to !== null && !dateOf(value.to)) return { ok: false, history: null }
    // 说可用却给不出读取时间，就没法说明这份历史是什么时候的。
    if (value.available && !number(value.capturedAt)) return { ok: false, history: null }
    return {
      ok: true,
      history: { available: value.available, reason: value.available ? null : value.reason }
    }
  }

  /**
   * 走势的折线与面积路径；少于两个点时不画，卡上不留假折线。
   *
   * @param list - trend 数组，按时间从旧到新。
   * @param lang - 界面语言。
   * @returns 路径、点数、末点坐标与最高最低的读法；不足两个点时是 null。
   */
  function trendOf(list, lang) {
    var points = pointsOf(list)
    if (points.length < 2) return null
    var low = points[0].value
    var high = points[0].value
    for (var index = 1; index < points.length; index += 1) {
      low = Math.min(low, points[index].value)
      high = Math.max(high, points[index].value)
    }
    var span = high - low
    var coordinates = points.map(function (point, at) {
      var level = span === 0 ? 0.5 : (point.value - low) / span
      return {
        x: round((at / (points.length - 1)) * VIEW_WIDTH),
        y: round(BOTTOM - level * (BOTTOM - TOP))
      }
    })
    var line = 'M' + coordinates.map(function (point) {
      return point.x + ' ' + point.y
    }).join(' L')
    var last = coordinates[coordinates.length - 1]
    var latest = points[points.length - 1].value
    return {
      count: points.length,
      line: line,
      area: line + ' L' + VIEW_WIDTH + ' ' + BOTTOM + ' L0 ' + BOTTOM + ' Z',
      last: { x: last.x, y: last.y },
      low: compactOf(low, lang),
      high: compactOf(high, lang),
      highFull: formatCount(high, lang),
      latest: compactOf(latest, lang),
      latestFull: formatCount(latest, lang)
    }
  }

  /**
   * 一份数据落在哪个状态。
   *
   * @param data - 数据源给的 SessionUsageSnapshot；还没读到时是 null 或 undefined。
   * @returns loading、unavailable、no-sessions、no-usage、invalid 或 ready。
   */
  function stateOf(data) {
    if (data === null || data === undefined) return 'loading'
    if (typeof data !== 'object' || Array.isArray(data)) return 'invalid'
    if (typeof data.available !== 'boolean') return 'invalid'
    if (!number(data.startedAt)) return 'invalid'
    if (SCOPES.indexOf(data.scope) < 0) return 'invalid'
    if (!dateOf(data.date)) return 'invalid'
    if (!sessionOf(data.session).ok) return 'invalid'
    if (!Array.isArray(data.trend)) return 'invalid'
    if (!historyOf(data.history).ok) return 'invalid'
    if (!data.available) {
      if (data.reason !== 'sessions-unavailable') return 'invalid'
      if (data.totals !== null || data.recent !== null || data.trend.length > 0) return 'invalid'
      return 'unavailable'
    }
    if (data.empty === 'no-sessions' || data.empty === 'no-usage') {
      if (data.totals !== null || data.recent !== null || data.trend.length > 0) return 'invalid'
      return data.empty
    }
    if (data.empty !== null) return 'invalid'
    if (totalsOf(data.totals) === null) return 'invalid'
    // 最近一次调用来自实时事件：这段时间只有历史用量时它是 null，总量与分项照旧画。
    if (data.recent !== null && recentOf(data.recent) === null) return 'invalid'
    return 'ready'
  }

  /**
   * 一次读数读成卡片要画的东西。不是 ready 时只给状态，卡面据此换文案。
   *
   * @param data - 数据源给的 SessionUsageSnapshot。
   * @param lang - 界面语言。
   * @returns 状态，或排好版的读数、分项、次读与走势。
   */
  function viewOf(data, lang) {
    var state = stateOf(data)
    if (state !== 'ready') return { state: state }
    var totals = totalsOf(data.totals)
    var recent = recentOf(data.recent)
    // 占比的分母是四项之和，不是 totals.total：没有 totalTokens 时总量按输入与输出推算，缓存两项
    // 仍单独累计，拿它当分母会让四项相加超过 100%。主读数照旧用 totals.total。
    var partTotal = 0
    for (var at = 0; at < PARTS.length; at += 1) partTotal += totals[PARTS[at]]
    var parts = []
    for (var index = 0; index < PARTS.length; index += 1) {
      var key = PARTS[index]
      parts.push({
        key: key,
        full: formatCount(totals[key], lang),
        compact: compactOf(totals[key], lang),
        share: shareOf(totals[key], partTotal)
      })
    }
    return {
      state: 'ready',
      scope: data.scope,
      source: sourceOf(data.history),
      date: data.date,
      session: sessionOf(data.session).session,
      started: timeOf(data.startedAt, lang),
      total: { full: formatCount(totals.total, lang), compact: compactOf(totals.total, lang) },
      calls: totals.calls,
      callsText: formatCount(totals.calls, lang),
      estimated: totals.estimated,
      parts: parts,
      recent: recent === null ? null : {
        time: timeOf(recent.at, lang),
        session: recent.session,
        full: formatCount(recent.total, lang),
        compact: compactOf(recent.total, lang),
        estimated: recent.estimated
      },
      trend: trendOf(data.trend, lang)
    }
  }

  root.SessionUsageView = {
    LIMIT: LIMIT,
    PARTS: PARTS,
    formatCount: formatCount,
    compactOf: compactOf,
    shareOf: shareOf,
    timeOf: timeOf,
    sessionOf: sessionOf,
    sourceOf: sourceOf,
    historyOf: historyOf,
    stateOf: stateOf,
    trendOf: trendOf,
    viewOf: viewOf
  }
})(typeof globalThis === 'object' ? globalThis : this)
