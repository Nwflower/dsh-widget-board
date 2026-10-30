/*
 * props 示例的脚本：读 widget.props 渲染一次，再用 widget.onProps 订阅设置弹窗的改动。
 */
(function () {
  var card = document.querySelector('.example-props')
  if (!card) return

  var widget = window.widget
  var elLabel = card.querySelector('#example-props-label')
  var elHint = card.querySelector('#example-props-hint')
  var elDots = card.querySelector('#example-props-dots')

  var TONES = ['ok', 'warn', 'danger']

  /** manifest 里的一条文案；没有宿主时退回键名。 */
  function label(key) { return widget === undefined ? key : widget.t(key) }

  /** 按 props 重画：标题、提示与一排状态色圆点。 */
  function render() {
    var props = widget === undefined || widget.props === null || typeof widget.props !== 'object'
      ? {}
      : widget.props
    var text = typeof props.label === 'string' && props.label !== '' ? props.label : '样例标题'
    var count = typeof props.count === 'number' && isFinite(props.count)
      ? Math.min(9, Math.max(1, Math.round(props.count)))
      : 3
    var tone = TONES.indexOf(props.tone) >= 0 ? props.tone : 'ok'

    elLabel.textContent = text
    elHint.textContent = label('hint')
    elDots.dataset.tone = tone
    elDots.replaceChildren()
    for (var index = 0; index < count; index += 1) {
      var dot = document.createElement('span')
      dot.className = 'example-props__dot'
      elDots.appendChild(dot)
    }
  }

  if (widget !== undefined) widget.onProps(render)
  render()
})()
