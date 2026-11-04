/**
 * 冒烟用的 v3 提供方（浏览器半边，D3 的原生级、D31、D32）：一个 registerProvider 把手挂原生组件甲；
 * 第二个目录的组件乙由沙箱那一侧画（`widget.json` 与 `main.js`），两种写法对照着核对。
 *
 * 两侧暴露同一套可观察标记：能力面、语言、数据、状态、暂停状态，以及动作、状态写入、能力调用与
 * 按需读的结果各写在自己的节点上。场景对同一份标记取证，原生与沙箱的语义是否一致按它判（D32）。
 *
 * 模块的形状与构建产物一致：加载器按 `id` 取回 `factory` 的导出。
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

    /** 组件甲的盒子：竖排，按钮一行。 */
    const box = { display: 'grid', gap: '6px', height: '100%', padding: '8px', font: '600 13px/1.3 system-ui', alignContent: 'start' }

    /**
     * 一次按需读要读哪个源；名字与沙箱那一侧的按钮一一对应（D32）。
     *
     * `default` 不带参数，读卡片自己绑定的那个源。
     */
    const READS = [
      ['default', undefined],
      ['extra', 'testv3.extra'],
      ['gated', 'testv3.gated'],
      ['bad', 'testv3.bad'],
      ['undeclared', 'testv3.hidden'],
    ]

    /** 一次调用的结果写成 `ok:<JSON>` 或 `error:<原因>`，两种写法用同一个形状。 */
    function describe(ok, value) {
      return ok ? 'ok:' + JSON.stringify(value) : 'error:' + reasonOf(value)
    }

    /**
     * 失败的原因：宿主回的错误消息原样写出，别把它折成 `[object Object]`。
     *
     * @param error - 接到的拒绝。
     * @returns 给人看的一句话。
     */
    function reasonOf(error) {
      if (error && typeof error.message === 'string') return error.message
      return String(error)
    }

    /**
     * 组件甲：原生组件，一个把手挂的第一个目录里的那一个。
     *
     * @param props - 原生组件参数。
     */
    const Alpha = (props) => {
      const [echo, setEcho] = React.useState('')
      const [gone, setGone] = React.useState('')
      const [reads, setReads] = React.useState({})
      const data = props.data !== null && typeof props.data === 'object' ? props.data : {}
      const state = props.state !== null && typeof props.state === 'object' ? props.state : {}
      const taps = typeof state.taps === 'number' ? state.taps : undefined

      /** 把一次调用的结果写进对应的槽。 */
      const settle = (slot, work) => {
        work().then((result) => {
          setReads((current) => ({ ...current, [slot]: describe(true, result) }))
        }, (error) => {
          setReads((current) => ({ ...current, [slot]: describe(false, error) }))
        })
      }

      return React.createElement(
        'div',
        {
          'data-testv3': 'alpha',
          'data-testv3-lang': props.lang ?? '',
          'data-testv3-capabilities': JSON.stringify([...(props.capabilities ?? [])]),
          'data-testv3-metadata': JSON.stringify([...(props.capabilityMetadata ?? [])]),
          'data-testv3-paused': String(props.paused),
          style: box,
        },
        React.createElement('span', { 'data-testv3-count': '' }, data.count === undefined ? '' : String(data.count)),
        React.createElement('span', { 'data-testv3-state': '' }, taps === undefined ? '' : String(taps)),
        React.createElement(
          'div',
          { style: { display: 'flex', flexWrap: 'wrap', gap: '4px' } },
          React.createElement('button', { 'data-testv3-run': '', type: 'button', onClick: () => { props.action('testv3.run') } }, 'run'),
          React.createElement('button', { 'data-testv3-tap': '', type: 'button', onClick: () => { props.setState({ taps: (taps ?? 0) + 1 }) } }, 'tap'),
          React.createElement('button', {
            'data-testv3-echo': '',
            type: 'button',
            onClick: () => {
              props.call('testv3.echo', { text: 'v3' }).then((result) => { setEcho(describe(true, result.echo)) }, (error) => { setEcho(describe(false, error)) })
            },
          }, 'echo'),
          React.createElement('button', {
            'data-testv3-gone': '',
            type: 'button',
            onClick: () => {
              props.call('testv3.gone').then(() => { setGone('ok') }, (error) => { setGone(describe(false, error)) })
            },
          }, 'gone'),
          ...READS.map(([slot, source]) => React.createElement(
            'button',
            {
              'data-testv3-read-button': slot,
              type: 'button',
              key: slot,
              onClick: () => {
                settle(slot, () => props.call('widget-board:data.read', source === undefined ? {} : { source }))
              },
            },
            'read ' + slot,
          )),
        ),
        React.createElement('span', { 'data-testv3-echo-result': '' }, echo),
        React.createElement('span', { 'data-testv3-gone-result': '' }, gone),
        ...READS.map(([slot]) => React.createElement('span', { 'data-testv3-read': slot, key: 'out-' + slot }, reads[slot] ?? '')),
      )
    }

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
        provider.registerNativeWidget({ id: 'testv3-flat', component: Alpha })
      } catch {
        refusedFlat = true
      }
      if (!refusedFlat) throw new Error('原生组件把手没有拒绝不带作者域的 id')

      provider.registerNativeWidget({ id: 'testv3.alpha', component: Alpha })
      if (provider.widgets.length !== 1) throw new Error(`一个把手下应有一个原生组件：${provider.widgets.length}`)
      ctx.effect(() => () => { provider.dispose() })
    }

    return module.exports
  },
})
