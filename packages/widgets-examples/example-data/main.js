/*
 * 数据示例的脚本：widget.data 为 null 时画空态，否则渲染 items 列表；widget.onData 订阅推送。
 */
(function () {
  var card = document.querySelector('.example-data')
  if (!card) return

  var widget = window.widget
  var elEmpty = card.querySelector('#example-data-empty')
  var elHint = card.querySelector('#example-data-hint')
  var elList = card.querySelector('#example-data-list')

  /** manifest 里的一条文案；没有宿主时退回键名。 */
  function label(key) { return widget === undefined ? key : widget.t(key) }

  /** 一行：标签在左、数值在右，数值用 tabular-nums 对齐。 */
  function row(item) {
    var li = document.createElement('li')
    li.className = 'example-data__row'

    var name = document.createElement('span')
    name.className = 'example-data__label'
    name.textContent = item.label

    var value = document.createElement('span')
    value.className = 'example-data__value'
    value.textContent = String(item.value)

    li.append(name, value)
    return li
  }

  /** 按 data 重画：null 或没有 items 时画空态。 */
  function render() {
    var data = widget === undefined ? null : widget.data
    var items = data !== null && typeof data === 'object' && Array.isArray(data.items)
      ? data.items
      : null

    var has = items !== null && items.length > 0
    elEmpty.hidden = has
    elHint.hidden = has
    elEmpty.textContent = label('empty')
    elHint.textContent = label('hint')

    elList.replaceChildren()
    if (items === null) return
    for (var index = 0; index < items.length; index += 1) {
      var item = items[index]
      if (item === null || typeof item !== 'object') continue
      elList.appendChild(row(item))
    }
  }

  if (widget !== undefined) widget.onData(render)
  render()
})()
