/*
 * 运行成本卡的纯视图逻辑（issue #5）：字节格式化、历史裁剪与走势路径。
 *
 * 这里不碰 DOM，也不发消息；`main.js` 负责排版与状态写入。文件同时以经典脚本内联进组件文档、以
 * 副作用模块被单元测试载入，两处读到的是同一份实现。
 */
;(function (root) {
  'use strict'

  /** 卡片保留的采样数：5 秒一次，5 分钟。 */
  var LIMIT = 60

  /** 1 KB 按 1024 字节算；单位沿用 KB、MB、GiB 的写法（issue #5）。 */
  var UNITS = [
    { unit: 'B', scale: 1 },
    { unit: 'KB', scale: 1024 },
    { unit: 'MB', scale: 1024 * 1024 },
    { unit: 'GiB', scale: 1024 * 1024 * 1024 }
  ]

  /** 是不是一个非负的有限数。 */
  function number(value) {
    return typeof value === 'number' && isFinite(value) && value >= 0
  }

  /** 夹在 0 与 1 之间；读数做进度条的比例时用。 */
  function ratio(value, total) {
    if (!number(value) || !number(total) || total <= 0) return 0
    return Math.min(1, Math.max(0, value / total))
  }

  /**
   * 字节按当前语言格式化。
   *
   * @param {unknown} bytes - 字节数。
   * @param {string} lang - 界面语言，交给 Intl.NumberFormat。
   * @returns {{ value: string, unit: string, text: string }} 分成数值与单位两部分，另给一份连写。
   */
  function formatBytes(bytes, lang) {
    if (!number(bytes)) return { value: '—', unit: '', text: '—' }
    var entry = UNITS[UNITS.length - 1]
    for (var i = 0; i < UNITS.length; i += 1) {
      if (bytes < UNITS[i].scale * 1024) {
        entry = UNITS[i]
        break
      }
    }
    var scaled = bytes / entry.scale
    var digits = entry.unit === 'B' || scaled >= 10 ? 0 : 1
    var value = new Intl.NumberFormat(lang === undefined || lang === '' ? 'en' : lang, {
      maximumFractionDigits: digits,
      minimumFractionDigits: 0
    }).format(scaled)
    return { value: value, unit: entry.unit, text: value + ' ' + entry.unit }
  }

  /** 一份存进 state 的采样：只留时间与常驻内存，几十个数字远低于单卡额度（D23）。 */
  function entryOf(value) {
    if (value === null || typeof value !== 'object') return null
    if (!number(value.rss)) return null
    return { at: typeof value.at === 'string' ? value.at : '', rss: value.rss }
  }

  /** 一次数据里的采样。 */
  function sampleOf(value) {
    if (value === null || typeof value !== 'object') return null
    var host = value.host
    if (host === null || typeof host !== 'object' || !number(host.rss)) return null
    return { at: typeof value.sampledAt === 'string' ? value.sampledAt : '', rss: host.rss }
  }

  /**
   * 只留最近 limit 个采样，顺手丢掉形状不对的。
   *
   * @param {unknown} list - 从 state 或数据里拿到的采样。
   * @param {number} limit - 保留几个。
   * @returns {Array<{ at: string, rss: number }>} 裁好的采样。
   */
  function trimSamples(list, limit) {
    var kept = []
    var keep = number(limit) && limit > 0 ? Math.floor(limit) : LIMIT
    if (!Array.isArray(list)) return kept
    for (var i = 0; i < list.length; i += 1) {
      var entry = entryOf(list[i])
      if (entry !== null) kept.push(entry)
    }
    return kept.length > keep ? kept.slice(kept.length - keep) : kept
  }

  /**
   * 追加一次采样并裁到上限。
   *
   * @param {unknown} list - 已有的采样。
   * @param {unknown} sample - 这一次的采样。
   * @param {number} limit - 保留几个。
   * @returns {Array<{ at: string, rss: number }>} 新的采样数组。
   */
  function appendSample(list, sample, limit) {
    var kept = Array.isArray(list) ? list : []
    return trimSamples(kept.concat([sample]), limit)
  }

  /** 两位小数，避免路径字符串太长。 */
  function round(value) {
    return Math.round(value * 100) / 100
  }

  /**
   * 最近几次采样的折线；两个点才画得出走势。
   *
   * @param {unknown} samples - 采样数组。
   * @returns {{ count: number, line: string, area: string, low: string, high: string } | null} SVG 路径与低高点；不够时是 null。
   */
  function trendOf(samples) {
    var list = trimSamples(samples, LIMIT)
    if (list.length < 2) return null
    var low = list[0].rss
    var high = list[0].rss
    for (var i = 1; i < list.length; i += 1) {
      low = Math.min(low, list[i].rss)
      high = Math.max(high, list[i].rss)
    }
    var span = high - low
    var points = []
    for (var index = 0; index < list.length; index += 1) {
      var x = (index / (list.length - 1)) * 100
      var level = span === 0 ? 0.5 : (list[index].rss - low) / span
      points.push(round(x) + ' ' + round(21 - level * 18))
    }
    var line = 'M' + points.join(' L')
    return {
      count: list.length,
      line: line,
      area: line + ' L100 24 L0 24 Z',
      low: formatBytes(low, 'en').text,
      high: formatBytes(high, 'en').text
    }
  }

  /**
   * 采样时间按当前语言写成时分秒。
   *
   * @param {unknown} iso - ISO 时间串。
   * @param {string} lang - 界面语言。
   * @returns {string} 要显示的时间；读不出来时是空串。
   */
  function stampOf(iso, lang) {
    if (typeof iso !== 'string' || iso === '') return ''
    var date = new Date(iso)
    if (!isFinite(date.getTime())) return ''
    return new Intl.DateTimeFormat(lang === undefined || lang === '' ? 'en' : lang, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }).format(date)
  }

  /**
   * 一次采样读成卡片要画的东西。数据不完整时给空态，绝不补数字。
   *
   * @param {unknown} data - 数据源给的 SystemMetrics。
   * @param {unknown} samples - 最近的采样。
   * @param {string} lang - 界面语言。
   * @returns {object} 空态，或排好版的读数、分项、次读与走势。
   */
  function viewOf(data, samples, lang) {
    var locale = lang === undefined || lang === '' ? 'en' : lang
    if (data === null || typeof data !== 'object') return { state: 'empty' }
    var host = data.host
    var board = data.board
    var library = data.library
    if (host === null || typeof host !== 'object' || board === null || typeof board !== 'object' || library === null || typeof library !== 'object') {
      return { state: 'empty' }
    }
    if (!number(host.rss) || !number(host.heapUsed) || !number(host.heapTotal) || !number(host.external) || !number(host.arrayBuffers)) {
      return { state: 'empty' }
    }
    if (!number(board.cards) || !number(board.boards) || !number(board.stateBytes) || !number(board.documentsBytes)) {
      return { state: 'empty' }
    }
    if (!number(library.widgets) || !number(library.versions)) return { state: 'empty' }

    var parts = [
      { key: 'heap', value: host.heapUsed },
      { key: 'external', value: host.external },
      { key: 'arrayBuffers', value: host.arrayBuffers }
    ].map(function (part) {
      var formatted = formatBytes(part.value, locale)
      return {
        key: part.key,
        value: formatted.value,
        unit: formatted.unit,
        text: formatted.text,
        fill: ratio(part.value, host.rss)
      }
    })

    return {
      state: 'ready',
      stamp: stampOf(data.sampledAt, locale),
      rss: formatBytes(host.rss, locale),
      parts: parts,
      facts: {
        cards: board.cards,
        boards: board.boards,
        state: formatBytes(board.stateBytes, locale),
        documents: formatBytes(board.documentsBytes, locale),
        widgets: library.widgets,
        versions: library.versions
      },
      trend: trendOf(samples)
    }
  }

  root.SystemMetricsView = {
    LIMIT: LIMIT,
    formatBytes: formatBytes,
    sampleOf: sampleOf,
    trimSamples: trimSamples,
    appendSample: appendSample,
    trendOf: trendOf,
    stampOf: stampOf,
    viewOf: viewOf
  }
})(typeof globalThis === 'object' ? globalThis : this)
