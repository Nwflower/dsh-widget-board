/**
 * 看板题头：manifest 里的文案是默认值，props 只覆盖用户改过的那几项。
 *
 * 组件不挂指针事件，拖动、缩放与移除都由看板外壳负责（D16）。
 */
const widget = window.widget

/** 一条文案：props 优先，其次 manifest 的 text。 */
function value(key) {
  const override = widget.props?.[key]
  if (typeof override === 'string' && override !== '') return override
  return widget.t(key)
}

/** 把标题与说明写进节点。 */
function paint() {
  for (const node of document.querySelectorAll('[data-hero-part]')) {
    const key = node.getAttribute('data-hero-part')
    if (key === null) continue
    node.textContent = value(key)
  }
}

paint()
widget.onProps(paint)
