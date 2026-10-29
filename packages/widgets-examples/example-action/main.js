/*
 * 动作示例的脚本。
 *
 * 按钮点击发出 manifest 里声明过的 example.ping。看板上没有提供方注册这个动作时，
 * 宿主会把失败原因直接写到卡片上——组件不需要也不应该自己再画一份错误提示，
 * 所以这里只有成功路径：结果区显示一条「已发出」。
 */
(function () {
  var widget = window.widget
  var result = document.getElementById('example-action-result')

  document.getElementById('example-action-ping').addEventListener('click', function () {
    widget.action('example.ping')
    result.textContent = widget.t('sent')
  })
})()
