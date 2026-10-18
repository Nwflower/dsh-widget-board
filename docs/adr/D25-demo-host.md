# D25. 演示页与只读的浏览器端宿主

## 背景

插件要拿给没有安装 DSH 的人看。截图与录屏只能看，评审想拖一张卡、缩放它、翻面、切浅色深色。看板的浏览器半边是 React 页面，它只认两样东西：宿主的插槽注册表，以及文档相对地址 `api/widget-board/…` 上的宿主路由（D1、D5）。把这两样在普通网页里各给一份，真实的看板就能原样跑在静态托管上，不需要重画一份仿品。

## 决定

- 演示页由 `scripts/demo.mjs` 构建，源码在 `packages/demo/`。它不进插件的发布包（`package.json` 的 `files` 不含它，`lib/` 里没有它的任何文件），也不进测试：测试的替身与演示宿主是两回事，测试只读它的产物（`packages/testing/demo.cjs`）。
- 页面扮演宿主页面：给插件的 `apply` 一个只含 `slots`、`effect` 与主题服务的上下文，插件注册到中栏的页面由页面外壳挂载。插件的浏览器半边不改一行，页面里跑的就是 `lib/client.js` 的同一份源码。
- 路由由一个 Service Worker 回答（演示宿主）。它按真实宿主的契约实现看板页用到的那些路由：路径、方法、状态码与响应形状与 `packages/host/src/routes.ts` 一致，布局提交带修订号并在过期时回 409 与当前快照，卡片状态过写入预算（D23），变更通知按 D18 的帧经 `text/event-stream` 推给页面。判定逻辑复用宿主的纯函数（`state.ts`、`schema.ts`、`limits.ts`），不另写第二份。
- 演示宿主是只读宿主。它没有数据源、动作、宿主能力、授权、凭据服务、多块看板的管理与分享。这些路由回 501，响应里写明原因（中英并列），界面按 D11 把它显示出来。需要这些东西的组件（`manifest` 声明了 `source`、`capabilities`、`actions` 或 `credentials`）在构建时被排除，既不在默认看板上，也不在组件库里，所以看板上没有一张读不出数据的卡片，也没有任何一处伪造的数据。
- 默认看板来自真实宿主：构建时在一个全新的目录里调用宿主的 `openWorkspace` 与 `workspaceSnapshot` 铺出第一次启动的看板，写成 `demo-data/host.json`；之后的布局、状态与增删落在浏览器的 IndexedDB。浏览器里存着的看板来自另一份默认看板（`seed` 不同）时丢弃重来。
- 组件文档在构建时由宿主的 `buildDocument` 按内容哈希预生成，放在 `api/widget-board/widget/<hash>/document/index.html`。组件 iframe 带 `sandbox="allow-scripts"`，来源不透明，它的导航请求不经过 Service Worker，所以文档必须是静态托管上真实存在的文件。静态托管不能按请求设响应头，CSP 以同一份策略文本写进文档自己的 `<meta http-equiv>`，nonce 是构建时为这份文档生成的那一个（D3）。
- 宿主模块里 `node:` 的导入在 Service Worker 的构建里指到三个小文件：Web Crypto 兑现的 `randomUUID`、状态额度用的 `Buffer.byteLength`，以及读写磁盘的函数（每个都抛出，构建检查确认它们没有进入产物）。对 `packages/host` 与 `packages/client` 的唯一改动是 `workspaceSnapshot` 的参数类型收窄成它实际读的那几样，行为不变。

## 后果

- 演示页与真实宿主共用一份看板代码，看板改了，演示页下一次构建就跟着变；演示宿主要跟着宿主的路由契约走，路由增删时要同步它的路由表。
- 页面需要 Service Worker 与 IndexedDB。浏览器没有它们时（部分隐私窗口），页面显示启动失败的原因，看板不出现。
- 演示页的组件文档没有真实宿主响应头里的 CSP 全部能力（`<meta>` 里不能写 `frame-ancestors` 与 `sandbox`，宿主的策略也没有用到它们）；`connect-src 'none'` 与 `script-src` 的 nonce 照样生效。
- 页面的部署目录是任意子路径：所有地址都是文档相对的，重定向由静态托管完成。

## 重审条件

- 宿主发布浏览器内可用的宿主实现（无进程的演示或沙盒模式）时，改用它，删掉这里的路由表。
- 评审需要在演示页上体验数据源、动作与宿主能力时，在演示宿主里加一个只读的内置提供方，并重新决定哪些组件放回看板。
