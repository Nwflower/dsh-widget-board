/*
 * 全息卡的脚本：把 props 里的文案填进卡片。
 *
 * 彩虹与高光由运行时套件负责；这里不挂指针事件。
 */
(function () {
  var card = document.querySelector('.holo-card')
  if (!card) return

  var widget = window.widget
  var fields = {}
  var nodes = card.querySelectorAll('[data-field]')
  for (var index = 0; index < nodes.length; index += 1) {
    var key = nodes[index].getAttribute('data-field')
    if (key !== null) fields[key] = nodes[index]
  }

  var defaults = {
    kicker: '',
    title: '全息卡',
    text: '移动指针，彩虹和高光跟着走。',
    meta: '彩虹与高光'
  }

  function apply(props) {
    var next = props !== null && typeof props === 'object' ? props : {}
    for (var key in defaults) {
      if (!Object.prototype.hasOwnProperty.call(defaults, key)) continue
      var candidate = next[key]
      var text = typeof candidate === 'string' && candidate.trim() !== '' ? candidate : defaults[key]
      var node = fields[key]
      if (node) node.textContent = text
    }
  }

  apply(widget === undefined ? {} : widget.props)
  if (widget !== undefined) widget.onProps(apply)
})()
