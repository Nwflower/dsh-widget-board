/*
 * 翻转卡的脚本：把 props 里的文案填进两张脸。
 *
 * 翻面本身由运行时套件的指针与键盘行为负责；这里只处理内容，不挂事件。
 */
(function () {
  var card = document.querySelector('.flip-card')
  if (!card) return

  var widget = window.widget
  var fields = {}
  var nodes = card.querySelectorAll('[data-field]')
  for (var index = 0; index < nodes.length; index += 1) {
    var key = nodes[index].getAttribute('data-field')
    if (key !== null) fields[key] = nodes[index]
  }

  var defaults = {
    frontKicker: 'FLIP · 01',
    frontTitle: '一张会翻面的卡片',
    frontText: '正面放一句结论，背面放细节。内容由 props 填进来，模板本身不认主题。',
    backKicker: 'BACK · 02',
    backTitle: '背面',
    backText: '背面适合放解释、清单或下一件事。再翻一次回到正面。'
  }

  /** 一条 prop 是字符串且不为空白时用它，否则用模板里的默认文案。 */
  function value(props, key) {
    var candidate = props[key]
    return typeof candidate === 'string' && candidate.trim() !== '' ? candidate : defaults[key]
  }

  function apply(props) {
    var next = props !== null && typeof props === 'object' ? props : {}
    for (var key in defaults) {
      if (!Object.prototype.hasOwnProperty.call(defaults, key)) continue
      var node = fields[key]
      if (node) node.textContent = value(next, key)
    }
    if (widget !== undefined) {
      var hint = fields.hint
      var backHint = fields.backHint
      if (hint) hint.textContent = widget.t('hint')
      if (backHint) backHint.textContent = widget.t('backHint')
    }
  }

  apply(widget === undefined ? {} : widget.props)
  if (widget !== undefined) widget.onProps(apply)
})()
