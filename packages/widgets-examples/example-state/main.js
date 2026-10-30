/*
 * 状态示例的脚本。
 *
 * 计数存在宿主保存的 widget.state 里：切走再回来还在。按钮点击用 setState 合入一份补丁，
 * onState 在状态落地后重渲染画面。卡片离开视口时被暂停，onPause 更新状态说明行。
 * 看板卡片的高度由用户给的盒子决定，不需要调 widget.fit()——它只在会话内联显示时报高。
 */
(function () {
  var widget = window.widget
  var count = document.getElementById('example-state-count')
  var status = document.getElementById('example-state-status')
  if (!count || !status) return

  // 初始计数：宿主没有存过状态时从 0 开始。
  if (!widget.state || typeof widget.state.count !== 'number') {
    widget.setState({ count: 0 })
  }

  function render() {
    count.textContent = String((widget.state && widget.state.count) || 0)
  }

  document.getElementById('example-state-add').addEventListener('click', function () {
    widget.setState({ count: (widget.state.count || 0) + 1 })
  })

  widget.onState(render)

  widget.onPause(function (paused) {
    status.textContent = paused ? '已暂停' : ''
  })

  render()
  if (widget.paused) status.textContent = '已暂停'
})()
