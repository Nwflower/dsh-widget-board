# D2. 按依赖分包，TypeScript 与 esbuild

## 背景

上一个插件在仓库长大之后才把与外观无关的机制拆成独立的包，拆分本身花了大量的移动与核对。组件看板一开始就有三个运行位置（宿主进程、宿主页面、组件 iframe），还有一份两半都要用的布局逻辑：agent 调用工具放置组件时可能没有任何浏览器在线，宿主必须自己算出每个断点上的位置。

## 决定

- 对外只发布一个 npm 包，宿主半边在 `exports["."]`，浏览器半边在 `exports["./client"]`，`package.json` 的 `dsh.client` 声明浏览器半边，`cordis.patch.yml` 向 profile 插入一行。
- 仓库内部按「被谁依赖」分包：`contracts`、`model`、`host`、`client`、`runtime`、`widgets`、`testing`。依赖方向由 lint 执行：`model` 不碰 DOM、不导入 `host` 与 `client`；`runtime` 不导入 `client`；`widgets` 只用运行时的公开接口。
- 源码是严格模式下的 TypeScript；类型检查是构建的一步。打包用 esbuild，三个产物各自一个入口：宿主半边、浏览器半边、组件运行时。
- React、`react-dom/client` 与宿主包外部化，由宿主提供。其余运行时库（gridstack、Ajv、fflate）在构建时内联进产物，包的 `dependencies` 保持为空。
- 不为避开依赖而重造轮子：栅格交互用 gridstack，JSON Schema 校验用 Ajv，zip 读写用 fflate，存储记录的结构用宿主存储域要求的 zod。
- `lib/` 是构建产物，被 gitignore，从不提交；发布由持续集成构建。
- 一个源文件接近 750 行时停下拆分；重复代码由 jscpd 检查；两条都写进 lint。

## 后果

- 加一段代码先回答「谁依赖它」，答案决定它进哪个包。
- 内联的库让产物变大，升级它们要重新跑尺寸矩阵与端到端场景。
- 选 gridstack 的直接原因是它不依赖 `react-dom`：宿主只确定提供 `react-dom/client`，依赖整个 `react-dom` 的栅格库能否从宿主取得没有把握。

## 重审条件

- 宿主确定向插件提供整个 `react-dom` 时，可以重新比较基于 React 的栅格库。
- 宿主加载器支持插件内的模块分块与资源地址时，组件运行时与内置组件改走加载器的机制。
