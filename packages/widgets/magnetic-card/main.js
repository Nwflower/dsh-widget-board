/*
 * 磁吸卡的脚本：把 props 里的文案填进卡片。
 *
 * 指针跟随由运行时套件负责；这里不挂指针事件。
 */
(function () {
  var card = document.querySelector('.magnetic-card')
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
    title: '磁吸卡',
    text: '把指针移到卡片上，它会跟过来；移开再弹回去。',
    meta: '指针跟随与回弹'
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
