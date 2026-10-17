/**
 * 冒烟用的提供方（浏览器半边）：为组件库里的 `test-native` 登记一个原生组件（D3、D17）。
 *
 * 原生组件画在父页面里，收到与 `window.widget` 同形的参数；这里只把数据源给的数字画出来。
 * 模块的形状与构建产物一致：加载器按 `id` 取回 `factory` 的导出。
 */
window.__ModuleLoader__.load({
  id: 'dsh-widget-board-test-provider',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')

    exports.name = 'dsh-widget-board-test-provider'
    exports.inject = ['widgetBoard']

    /**
     * 装好登记。
     *
     * @param ctx - 浏览器半边的根上下文。
     */
    exports.apply = (ctx) => {
      const service = ctx.widgetBoard
      const dispose = service.registerWidgetType({
        apiVersion: service.apiVersion,
        provider: exports.name,
        id: 'test-native',
        component: (props) => React.createElement(
          'div',
          { 'data-test-native': '', style: { display: 'grid', placeItems: 'center', height: '100%', font: '600 32px/1 system-ui' } },
          String(props.data?.count ?? ''),
        ),
      })
      ctx.effect(() => () => { dispose() })
    }

    return module.exports
  },
})
