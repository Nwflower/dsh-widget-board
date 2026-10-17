# D3. 组件隔离与信任分级

## 背景

组件代码的作者可能是用户、会话里的 agent、导入文件的陌生人。宿主页面持有会话 cookie，能驱动执行命令的 agent；与它同源运行的代码可以读到这一切。另一方面，已安装的插件本来就在宿主里运行，给它们的组件再套一层沙箱没有带来安全收益，只增加成本。

## 决定

- 两级信任。沙箱组件：用户、agent、导入与内置的组件，运行在 iframe 里。原生组件：已安装的插件经 `widgetBoard` 服务注册的 React 组件，画在父页面里。两级共用同一份 manifest、同一套尺寸族与同一个尺寸矩阵。
- iframe 只给 `sandbox="allow-scripts"`，不给 same-origin、forms、popups、top-navigation。文档的来源是不透明的，读不到宿主的 cookie 与存储，它发出的请求过不了宿主的请求栅栏。
- 组件文档由插件路由按内容哈希提供，响应头带 CSP：`default-src 'none'; script-src 'nonce-…'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'`。运行时、组件脚本与精选库都以同一个 nonce 内联进文档。不用 srcdoc：srcdoc 文档继承父页面的 CSP，组件能否运行会取决于宿主的 CSP 设置。
- 组件拿不到网络。它需要的数据全部由宿主的数据源推进来（D6）。
- 桥：iframe 加载后父页面递给它一个 `MessagePort`，握手只认 `event.source === iframe.contentWindow`，之后的通信只走这个端口。两端都按 `contracts` 里的消息结构校验，限制载荷大小与频率；超限的消息被拒绝并报告。
- 插件的私有路由先问宿主的 `connection.requestRejection(req)`，被拒绝即不处理；宿主没有这项服务时只放行本机回环来的请求，判定以对端地址为准。
- 外来字符串一律当数据：manifest 里的名字、描述、文案在父页面只以文本节点或属性写入。

## 后果

- 每张卡片是一个独立文档，内存成本随卡片数增长；离开视口的卡片暂停，非当前看板的卡片卸载（D16）。
- 组件不能直接调用第三方接口，访问网络要经 `http` 数据源并由用户批准主机。
- 原生组件在父页面里运行，它的失败与性能问题由提供它的插件负责；看板只用错误边界隔离它。
- 放弃的方案：Shadow DOM 隔离（脚本仍在宿主的来源里运行）；只允许声明式卡片描述（表现力不够做出参考链接那种动效）。

## 重审条件

- 宿主提供插件级的 iframe 托管或独立来源的组件域名时，文档改由宿主托管。
