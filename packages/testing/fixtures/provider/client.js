/**
 * 冒烟用的提供方（浏览器半边）：为组件库里的 `test-native` 登记一个原生组件（D3、D17）。
 *
 * 原生组件画在父页面里，收到与 `window.widget` 同形的参数；这里把数据源给的数字、一个发出动作的
 * 按钮与动作的结果画出来，冒烟据此核对数据源、动作与授权闸门。
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
      // 客户端服务也拒绝版本对不上的注册。
      let refusedVersion = false
      try {
        service.registerWidgetType({ apiVersion: service.apiVersion + 1, provider: exports.name, id: 'test-version', component: () => null })
      } catch {
        refusedVersion = true
      }
      if (!refusedVersion) throw new Error('widgetBoard 客户端服务没有拒绝版本对不上的注册')

      // 同 id 的第二次注册要被拒绝，先到的那一个继续画。
      const probe = service.registerWidgetType({ apiVersion: service.apiVersion, provider: exports.name, id: 'test-duplicate', component: () => null })
      let refusedDuplicate = false
      try {
        service.registerWidgetType({ apiVersion: service.apiVersion, provider: exports.name, id: 'test-duplicate', component: () => null })
      } catch {
        refusedDuplicate = true
      }
      probe()
      if (!refusedDuplicate) throw new Error('widgetBoard 客户端服务没有拒绝重复的组件 id')

      const dispose = service.registerWidgetType({
        apiVersion: service.apiVersion,
        provider: exports.name,
        id: 'test-native',
        component: (props) => React.createElement(
          'div',
          { 'data-test-native': '', style: { display: 'grid', placeItems: 'center', gap: '8px', height: '100%', font: '600 24px/1 system-ui' } },
          React.createElement('span', { 'data-test-native-count': '' }, String(props.data?.count ?? '')),
          React.createElement(
            'button',
            {
              'data-test-native-run': '',
              type: 'button',
              onClick: () => { props.action('dsh-widget-board-test-provider:test.run') },
            },
            'run',
          ),
        ),
      })
      ctx.effect(() => () => { dispose() })
    }

    return module.exports
  },
})
