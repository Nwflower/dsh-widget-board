/*
 * 今日运势的脚本。
 *
 * 分数只由这天的黄历事实加权，不随机、不随刷新变化：起点 50 分，黄道黑道、建除十二值星、星宿
 * 吉凶与宜忌条数各加减一次，落在 5 到 95 之间。事实全部来自 lunar-javascript（`lunar.js`，经
 * manifest 的 `scripts` 在本脚本之前内联），这里不重写历法。
 */
(function () {
  var card = document.querySelector('.fortune-card')
  if (!card) return
  if (typeof Solar === 'undefined') throw new Error('农历库没有加载：Solar 不在全局作用域里')

  var widget = window.widget

  /** 建除十二值星的分量：值日神本身带吉凶，取自《协纪辨方书》的口径。 */
  var ZHI_XING_WEIGHT = { 建: 6, 除: 8, 满: -4, 平: 2, 定: 8, 执: 3, 破: -14, 危: -8, 成: 10, 收: 4, 开: 9, 闭: -9 }

  var el = {
    kicker: card.querySelector('[data-field="kicker"]'),
    title: card.querySelector('[data-field="title"]'),
    seal: card.querySelector('[data-field="seal"]'),
    score: card.querySelector('[data-field="score"]'),
    day: card.querySelector('[data-field="day"]'),
    fill: card.querySelector('[data-role="fill"]'),
    line: card.querySelector('[data-field="line"]'),
    jieqi: card.querySelector('[data-field="jieqi"]'),
    zhixing: card.querySelector('[data-field="zhixing"]'),
    xiu: card.querySelector('[data-field="xiu"]'),
    tianshen: card.querySelector('[data-field="tianshen"]'),
    yiTag: card.querySelector('[data-field="yiTag"]'),
    jiTag: card.querySelector('[data-field="jiTag"]'),
    yi: card.querySelector('[data-field="yi"]'),
    ji: card.querySelector('[data-field="ji"]'),
    note: card.querySelector('[data-field="note"]'),
    spoken: card.querySelector('[data-field="spoken"]')
  }

  function isZh() {
    return widget === undefined || String(widget.lang || 'zh').toLowerCase().indexOf('zh') === 0
  }

  function text(key, fallback) {
    if (widget === undefined) return fallback
    var value = widget.t(key)
    return value === key ? fallback : value
  }

  function write(node, value) {
    if (node !== null && node !== undefined) node.textContent = value === null || value === undefined ? '' : String(value)
  }

  function pad(value) {
    return value < 10 ? '0' + value : String(value)
  }

  /** 今天零点：分数只跟日期走，同一天什么时候打开都是同一个数。 */
  function today() {
    var now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), now.getDate())
  }

  /** 某一天的黄历事实。 */
  function factsOf(date) {
    var solar = Solar.fromYmd(date.getFullYear(), date.getMonth() + 1, date.getDate())
    var lunar = solar.getLunar()
    return {
      jieQi: lunar.getJieQi(),
      nextJieQi: nextJieQiOf(lunar),
      monthName: (lunar.getMonth() < 0 ? '闰' : '') + lunar.getMonthInChinese() + '月',
      dayCn: lunar.getDayInChinese(),
      yearGanZhi: lunar.getYearInGanZhi(),
      yearShengXiao: lunar.getYearShengXiao(),
      zhiXing: lunar.getZhiXing(),
      tianShenType: lunar.getDayTianShenType(),
      xiu: lunar.getXiu(),
      xiuLuck: lunar.getXiuLuck(),
      yi: lunar.getDayYi(),
      ji: lunar.getDayJi()
    }
  }

  /** 最近一个节气：名字与还有几天。 */
  function nextJieQiOf(lunar) {
    var next = lunar.getNextJieQi()
    if (next === null || next === undefined) return null
    var at = next.getSolar()
    var days = Math.round((new Date(at.getYear(), at.getMonth() - 1, at.getDay()) - today()) / 86400000)
    return { name: next.getName(), days: days }
  }

  /**
   * 今天的运势：只由黄历事实加权，不随机。
   *
   * @param info - 黄历事实。
   * @returns 分数、印章字、色调、进度色与一句判词。
   */
  function fortuneOf(info) {
    var score = 50
    if (info.tianShenType === '黄道') score += 16
    else if (info.tianShenType === '黑道') score -= 16
    score += ZHI_XING_WEIGHT[info.zhiXing] || 0
    score += info.xiuLuck === '吉' ? 8 : info.xiuLuck === '凶' ? -8 : 0
    score += Math.max(-10, Math.min(10, (info.yi.length - info.ji.length) * 1.1))
    var raw = Math.round(Math.max(5, Math.min(95, score)))
    var seal = raw >= 72 ? '大吉' : raw >= 58 ? '吉' : raw >= 45 ? '平' : raw >= 32 ? '小凶' : '凶'
    var line = raw >= 58
      ? info.tianShenType + '日 · ' + info.zhiXing + '日，宜' + info.yi.slice(0, 2).join('、')
      : raw >= 45
        ? info.tianShenType + '日，诸事宜守成'
        : info.tianShenType + ' · ' + info.xiu + '宿' + info.xiuLuck + '，宜缓行'
    return {
      score: raw,
      seal: seal.slice(-1),
      tone: raw >= 58 ? 'good' : raw >= 45 ? 'idle' : 'bad',
      meter: raw >= 58 ? 'ok' : raw >= 45 ? 'warn' : 'danger',
      line: line
    }
  }

  function render() {
    var date = today()
    var info = factsOf(date)
    var fortune = fortuneOf(info)
    var weekday = new Intl.DateTimeFormat(isZh() ? 'zh-CN' : 'en', { weekday: 'long' }).format(date)
    var monthName = new Intl.DateTimeFormat(isZh() ? 'zh-CN' : 'en', { month: 'long' }).format(date)
    var jieQi = info.jieQi !== ''
      ? info.jieQi
      : info.nextJieQi === null ? '' : info.nextJieQi.name + ' ' + (info.nextJieQi.days <= 0 ? '就是今天' : info.nextJieQi.days + ' 天')

    write(el.kicker, '')
    write(el.title, text('fortune', '今日运势'))
    write(el.seal, fortune.seal)
    el.seal.dataset.tone = fortune.tone
    write(el.score, String(fortune.score))
    write(el.day, monthName + date.getDate() + '日 ' + weekday + ' · 农历' + info.monthName + info.dayCn + ' · ' + info.yearGanZhi + info.yearShengXiao + '年')
    write(el.line, fortune.line)
    el.fill.style.width = fortune.score + '%'
    el.fill.dataset.tone = fortune.meter
    write(el.jieqi, jieQi)
    write(el.zhixing, info.zhiXing + '日')
    write(el.xiu, info.xiu + '宿' + info.xiuLuck)
    write(el.tianshen, info.tianShenType)
    write(el.yiTag, text('yi', '宜'))
    write(el.jiTag, text('ji', '忌'))
    write(el.yi, info.yi.slice(0, 6).join(' '))
    write(el.ji, info.ji.slice(0, 5).join(' '))
    write(el.spoken, '今日运势 ' + fortune.score + ' 分，' + fortune.seal + '。' + fortune.line)
  }

  function applyProps(source) {
    var props = source !== null && typeof source === 'object' ? source : {}
    write(el.kicker, typeof props.kicker === 'string' && props.kicker.trim() !== '' ? props.kicker : '')
    write(el.title, typeof props.title === 'string' && props.title.trim() !== '' ? props.title : text('fortune', '今日运势'))
  }

  function applyData(source) {
    var data = source !== null && typeof source === 'object' ? source : {}
    write(el.note, typeof data.note === 'string' ? data.note : '')
  }

  applyProps(widget === undefined ? {} : widget.props)
  applyData(widget === undefined ? null : widget.data)
  render()

  if (widget !== undefined) {
    widget.onProps(applyProps)
    widget.onData(applyData)
  }
})()
