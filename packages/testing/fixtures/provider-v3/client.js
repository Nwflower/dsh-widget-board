/**
 * 冒烟用的 v3 提供方（浏览器半边，D3 的原生级、D31）：一个 registerProvider 把手挂两个原生组件。
 *
 * 原生组件画在父页面里，收到与 `window.widget` 同形的参数；组件甲把数据源给的数字、一枚发出动作的按钮
 * 画出来，组件乙只画一个标记，证明同一个把手能挂第二个原生组件。模块的形状与构建产物一致：加载器按
 * `id` 取回 `factory` 的导出。
 */
window.__ModuleLoader__.load({
  id: 'dsh-widget-board-test-provider-v3',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')

    exports.name = 'dsh-widget-board-test-provider-v3'
    exports.inject = ['widgetBoard']

    /** 声明的用途：只写浏览器半边真做得到的项（D31）。 */
    const FEATURES = ['eventData', 'pushData']

    /** 两个组件共用的盒子：卡片里居中。 */
    const box = { display: 'grid', placeItems: 'center', gap: '8px', height: '100%', font: '600 20px/1 system-ui' }

    /**
     * 组件甲：画出数据源给的数字，并有一枚发出动作的按钮。
     *
     * @param props - 原生组件参数。
     */
    const Alpha = (props) => React.createElement(
      'div',
      { 'data-testv3': 'alpha', style: box },
      React.createElement('span', { 'data-testv3-count': '' }, String(props.data?.count ?? '')),
      React.createElement(
        'button',
        { 'data-testv3-run': '', type: 'button', onClick: () => { props.action('testv3.run') } },
        'run',
      ),
    )

    /**
     * 组件乙：只画一个标记。
     */
    const Beta = () => React.createElement('div', { 'data-testv3': 'beta', style: box }, 'v3')

    /**
     * 装好登记。
     *
     * @param ctx - 浏览器半边的根上下文。
     */
    exports.apply = (ctx) => {
      const service = ctx.widgetBoard
      // 新入口只收版本 3；旧入口那一条路留给扁平的 id（D31）。
      let refusedVersion = false
      try {
        service.registerProvider({ apiVersion: 2, provider: `${exports.name}-wrong-version` })
      } catch {
        refusedVersion = true
      }
      if (!refusedVersion) throw new Error('widgetBoard 客户端服务的 registerProvider 没有拒绝版本 2')

      const provider = service.registerProvider({ apiVersion: 3, provider: exports.name, features: FEATURES })
      for (const feature of FEATURES) {
        if (!provider.supports(feature)) throw new Error(`浏览器侧的把手没有报出 ${feature}`)
      }
      // 浏览器半边没有能力元数据与市场：问它们得到的是「这一侧没有」，注册照常（D31）。
      if (provider.supports('marketProvider') || provider.supports('capabilityMetadata')) {
        throw new Error('浏览器侧的把手不该报出市场或能力元数据')
      }
      // 原生组件的 id 必须带作者域：扁平的留给旧入口（D8、D30）。
      let refusedFlat = false
      try {
        provider.registerNativeWidget({ id: 'testv3-flat', component: Beta })
      } catch {
        refusedFlat = true
      }
      if (!refusedFlat) throw new Error('原生组件把手没有拒绝不带作者域的 id')

      provider.registerNativeWidget({ id: 'testv3.alpha', component: Alpha })
      provider.registerNativeWidget({ id: 'testv3.beta', component: Beta })
      if (provider.widgets.length !== 2) throw new Error(`一个把手下应有两个原生组件：${provider.widgets.length}`)
      ctx.effect(() => () => { provider.dispose() })
    }

    return module.exports
  },
})
