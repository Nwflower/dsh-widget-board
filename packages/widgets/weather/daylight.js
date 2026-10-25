/*
 * 窗外这一刻的天光阶段：从当地钟点与日出日落算出黎明、白昼、黄金时刻、暮色与夜幕。
 *
 * 只是纯计算，不碰画布；主脚本把结果交给 world.js，让同一套窗景在一天里连续变化。未来几天沿用
 * 此刻的钟点，只换那一天的日出日落。
 */
;(function (root) {
  'use strict'

  var PHASES = {
    night: { zh: '夜幕', en: 'Night' },
    dawn: { zh: '黎明', en: 'Dawn' },
    day: { zh: '白昼', en: 'Daylight' },
    golden: { zh: '黄金时刻', en: 'Golden hour' },
    dusk: { zh: '暮色', en: 'Dusk' },
  }

  function clamp(value, low, high) { return value < low ? low : value > high ? high : value }
  function lerp(from, to, t) { return from + (to - from) * t }

  /** `2026-10-25T17:32` 或 `17:32` 读成当地分钟数。 */
  function clockFromIso(value) {
    if (typeof value !== 'string') return null
    var match = value.match(/T(\d{2}):(\d{2})/) || value.match(/^(\d{1,2}):(\d{2})/)
    if (!match) return null
    return Math.min(1439, Number(match[1]) * 60 + Number(match[2]))
  }

  /** `06:32` 读成分钟数，读不出时用兜底值。 */
  function parseClock(value, fallback) {
    var minutes = clockFromIso(value)
    return minutes === null ? fallback : minutes
  }

  function phaseFor(minutes, sunrise, sunset) {
    var rise = Number.isFinite(sunrise) ? sunrise : 380
    var set = Number.isFinite(sunset) ? sunset : 1100
    if (set < rise) set = rise + 600
    var dayLength = Math.max(300, set - rise)
    var dawnStart = rise - 72
    var dawnEnd = rise + 58
    var goldenStart = set - 118
    var duskEnd = set + 92
    var key
    var progress
    var sunAlt
    if (minutes < dawnStart || minutes >= duskEnd) {
      key = 'night'
      progress = 0
      sunAlt = -18
    } else if (minutes < dawnEnd) {
      key = 'dawn'
      progress = clamp((minutes - dawnStart) / Math.max(1, dawnEnd - dawnStart), 0, 1)
      sunAlt = lerp(-10, 7, progress)
    } else if (minutes < goldenStart) {
      key = 'day'
      progress = clamp((minutes - rise) / dayLength, 0, 1)
      sunAlt = Math.max(8, Math.sin(progress * Math.PI) * 64)
    } else if (minutes < set) {
      key = 'golden'
      progress = clamp((minutes - goldenStart) / Math.max(1, set - goldenStart), 0, 1)
      sunAlt = lerp(13, 0.5, progress)
    } else {
      key = 'dusk'
      progress = clamp((minutes - set) / Math.max(1, duskEnd - set), 0, 1)
      sunAlt = lerp(-0.2, -13, progress)
    }
    return {
      key: key,
      label: PHASES[key],
      sunAlt: sunAlt,
      // 太阳刚落到地平线以下时仍按暮色/黎明画暖光；再低才交给星月与深色文字。
      night: sunAlt < -6,
      progress: progress,
      minutes: minutes,
      sunrise: rise,
      sunset: set,
    }
  }

  /** 没有数据时按本机此刻给一个阶段，至少不会永远停在白天。 */
  function localPhase() {
    var now = new Date()
    return phaseFor(now.getHours() * 60 + now.getMinutes(), 6 * 60 + 20, 18 * 60 + 20)
  }

  root.WxDaylight = {
    PHASES: PHASES,
    phaseFor: phaseFor,
    clockFromIso: clockFromIso,
    parseClock: parseClock,
    localPhase: localPhase,
  }
})(window)
