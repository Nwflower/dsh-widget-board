/*
 * 把当前的盒子档位写进卡片底部的一行调试文案，让人直接看到档位随缩放变化。
 * 档位在根节点（documentElement）的 data-box-width / data-box-height 上。
 */
(function () {
  var debug = document.querySelector('[data-role="debug"]')
  if (!debug) return

  var root = document.documentElement

  function paint() {
    var width = root.getAttribute('data-box-width') || 'regular'
    var height = root.getAttribute('data-box-height') || 'regular'
    debug.textContent = width + '/' + height
  }

  paint()
  new MutationObserver(paint).observe(root, {
    attributes: true,
    attributeFilter: ['data-box-width', 'data-box-height']
  })
})()
