# 实施计划

一次性文档：每一步完成后在这里勾掉，全部完成后删除本文件（D14）。步骤按依赖排序，每一步交付的都是完整的能力，带完成判据；判据全部满足才算完成。设计依据见 `docs/adr/`，宿主接入的出处见 `docs/host-surfaces.md`。

步骤 3 完成之后，步骤 4、5、6 只依赖 `contracts` 与 `model`，可以在不同会话里并行，各自只改自己的包。

## 现状（2026-10-17）

下面各步的勾选记的是写这一步时的判据；后来又有几轮改动落在「已经勾上」的步骤之外，所以按这一节
看整体进度，各步正文只当判据清单用。

| 步骤 | 状态 |
|---|---|
| 1 核实宿主假设 | 待核实项剩三条（`docs/host-surfaces.md`）；工具注册（`ctx.inject`、直接注册原始 JSON Schema 工具）、虚拟 skill 可列出、`presentationMeta` → `block.meta` 已在 0.2.1-rc.2 上核实 |
| 2 工程底座 | 完成 |
| 3 契约与模型 | 完成；列宽与高度的数字表还没生成进编写指南 |
| 4 宿主核心 | 完成（来源、blobs、服务、路由、变更通知、文档、配置都在）；冒烟覆盖到 |
| 5 组件运行时 | 完成（`window.widget`、端口握手、消息校验与限流、CSS 套件、精选库、检查器）；浏览器单元层还没建 |
| 6 看板界面 | 卡片栅格、拖动缩放、组卡、组件库、菜单、多块看板的标签页都在；展开浮层、右侧栏**没有** |
| 7 检查器与内置组件 | 尺寸矩阵已进 `verify` 并铺满组件库；检查器搬进组件运行时，自检用它；内置组件 22 个 |
| 8 数据源、动作与授权 | 授权（D6）、刷新调度（D6）、`http` 数据源完成；`program`、`command` 数据源与 `service:taskBoard` **没有** |
| 9 面向会话 | 七个工具（含 `widget_show`）、虚拟 skill、两个工具视图与 `widget_define` 的自检完成；`widget_library` **没有**；会话里的端到端要有人在场 |
| 10 右侧栏与独立页面 | 没有 |
| 11 组件库、分享与导入 | 导出导入（`.dshw`、`.dshboard`）完成；版本历史、回退、`url` 导入、检查更新、blob 清理**没有** |
| 12 扩展契约与任务看板 | 服务面（版本 2）、原生组件、目录、数据源、动作、提供方生命周期完成；`service:taskBoard` 与任务组件**没有** |
| 13 跨包边界与提供方契约 | 完成 |
| 14 端到端与发布 | 冒烟与矩阵在 `verify` 里跑；云端 CI 没跑过（没有 remote 推送之外的触发）；本文件还在 |

## 1. 核实宿主假设

在 `.debug/` 里写探针，逐条核实 `docs/host-surfaces.md`「待在真实宿主上核实」一节，使用 `.debug/` 下独立的 `DSH_HOME`。

完成判据：
- [ ] 每一条都有结论，移到「已核实」一节并写明出处；结论与某条 ADR 不符时，先按 D14 改写或取代那条 ADR。
- [ ] 探针脚本删除；值得保留的写成 `packages/testing/` 的场景。

## 2. 工程底座

- 根目录 `package.json`（包名、`exports`、`dsh.client`、`dsh.bundle.patch`、`files`、`engines`、开发依赖）、`cordis.patch.yml`、各包的 `tsconfig`。
- esbuild 构建三个产物：`lib/host/index.js`、`lib/client.js`、`lib/runtime/`（按内容哈希命名）；类型检查是构建的一步。
- 从 `D:\DSH\dsh-claude-style\scripts\` 移植并改写：lint（750 行停止线、jscpd、包之间的依赖方向、禁止在插件根节点之外查询文档、禁止带 try/catch 的导入）、ADR 索引生成与核对、`docs/changes/` 生成 CHANGELOG、AGENTS 命令表生成与核对、`verify` 单一入口。
- 一个把本仓库链接进临时 DSH profile 并启动宿主的脚本，`DSH_HOME` 在 `.debug/` 下。
- 持续集成工作流：检查、构建、单元层；`required` 汇总任务。

完成判据：
- [x] 空插件在真实宿主上加载，侧栏出现入口，点开是一页空看板，控制台无错误。
- [x] `npm run verify` 跑通；故意写一个 760 行的文件、一段重复代码、一个反向依赖，lint 各自失败。
- [x] `AGENTS.md` 的命令一节由脚本生成；`docs/adr/README.md` 由脚本生成。

## 3. 契约与模型

- `contracts`：`tokens.json` 及其生成的样式表；尺寸族表；manifest 的 JSON Schema；桥消息、路由与 SSE 协议；工具名；`WIDGET_BOARD_API_VERSION`；宿主契约表（插槽、服务、事件，每项带契约测试的写法）。
- `model`：卡片栅格的列数与列宽（按容器宽度连续变化）；卡片布局的重叠整理；新实例的默认位置。

完成判据：
- [x] `model` 的单元测试覆盖列数的边界、重叠卡片的推开、新卡片的默认位置与确定性（同样的输入得到同样的布局）。
- [ ] 列宽、间距与高度边界的数字表由 `model` 生成进编写指南，任何地方都不手写这些数字。

## 4. 宿主核心

- 看板存储：`board.json`，带格式版本与两个修订号（D5）。
- 组件库：三个来源（包内、用户目录、插件注册），校验 manifest，计算哈希，写 blob，监视目录并热重载（D17）。
- 宿主服务：看板与实例的全部操作只在这里，带修订号；`widgetBoard` 服务向外发布注册面。
- 路由：快照、加卡片与移除卡片、卡片状态与数据、布局提交、变更通知（心跳、事件增量）、组件文档（按哈希寻址，CSP 加 nonce，内联运行时与资源）；每条路由先过 `requestRejection`。

完成判据：
- [ ] 重启宿主后看板与实例完整恢复；无法接受的旧记录让启动明确报错并保留原文件。
- [x] 来自非本机且未认证的请求被拒绝；修订号冲突的提交被拒绝并返回当前状态。
- [ ] 没有客户端连接时，宿主上没有任何轮询与刷新在运行。

## 5. 组件运行时

- `window.widget` 的全部接口；与父页面的端口握手；消息结构校验与限流。
- CSS 套件：令牌、动效原语、基础件；动画档位与 `prefers-reduced-motion`。
- 精选库架子：`marked`、`uplot`，各带许可。

完成判据：
- [ ] 浏览器单元层覆盖握手、每个接口、CSP 违规的捕获、减弱动效下的静置。
- [ ] 一个用参考链接同类写法（数字滚动、图标切换、背景过渡）实现的样例组件在两种配色下显示正确。

## 6. 看板界面

- 侧栏入口与中栏页面；多块看板的标签页；工具栏（编辑、刷新、全屏、更多）。
- 看板视图：唯一的 `ResizeObserver` 判定列数，`model` 整理每张卡片的盒子；用户拖动与缩放改盒子，松手带布局修订号提交；拖动时 iframe 不接收指针。
- 卡片外壳：顶部把手、展开浮层（View Transitions，iframe 不换父节点）、故障显示与「交给 agent 修复」、等待授权状态。
- iframe 宿主：按哈希加载组件文档，递交端口，推送 props、data、state、尺寸族、令牌、语言、动画档位；唯一的 `IntersectionObserver` 负责暂停；非当前看板卸载。
- 主题：`theme/change` 时读 `--dsw-*` 计算值推进每个 iframe。

完成判据：
- [ ] 拖动窗口宽度、收起侧栏、打开右侧栏时列数在 1 到 4 之间变化，卡片宽度跟着变而高度不变形（D16）。
- [ ] 两个窗口同时打开同一块看板，一边的改动在另一边出现；同时拖动时以宿主为准。
- [ ] 一张卡片抛错不影响其他卡片，错误原因显示在那张卡片上。
- [ ] 用户在浅色与深色、中文与英文下核对过外观。

## 7. 检查器、尺寸矩阵与内置组件

- 检查器：按尺寸族的像素两端渲染，收集脚本错误、CSP 违规、溢出、空白、静置；同一个模块供矩阵与自检调用。
- 尺寸矩阵：组件 × 尺寸族 × 两端 × 配色 × 语言，加一次减弱动效；截图写到运行的输出目录。
- 内置组件：`stat`、`list`、`table`、`chart`、`markdown`、`progress`、`kv`、`timeline`、`image`，每个都有全部尺寸族的样例。
- 卡片动效模板：`flip-card`、`magnetic-card`、`holographic-card`，复用套件的翻转、磁吸与全息原语；每个都有 `s` 与 `l` 的样例。
- `packages/testing/fixtures/`：故意溢出、抛错、违反 CSP、空白的组件。

完成判据：
- [ ] 全部内置组件通过矩阵；每个故意出错的组件都被检查器抓住，并给出对应的原因。

## 8. 数据源、动作与授权

- 数据源注册表：`static`、`push`、`service:<name>`、`program`、`command`、`http`；结果按 data 的 schema 校验。
- 唯一的刷新调度器，按观众与刷新策略启停。
- 动作分派：`refresh`、`run`、`prompt`、`openSession`、`setState`；未声明的动作拒绝。
- 授权确认页：列出 manifest 声明的权限，按哈希记录；工具触发的动作另经 `ctx.approval.request`。

完成判据：
- [ ] 一个「运行本机 Python 并显示结果」的组件在授权前显示等待授权，授权后运行，组件代码变化且权限变化后重新要求授权。
- [ ] `http` 数据源访问未声明的主机被拒绝。
- [ ] 关掉所有显示某实例的页面后，它的刷新停止。

## 9. 面向会话

- 七个工具（D9），跟随总开关注册；拒绝以 `ok: false` 返回；英文描述。
- `widget_define` 与 `widget_show` 的工具视图；`widget_show` 结果里的哈希与数据快照。
- 自检：草稿、在线客户端的隐藏画廊、报告回到工具结果；无客户端时为 `unverified`。
- 虚拟 skill `widget-authoring`；只在工具可见时出现的系统提示段。

完成判据：
- [ ] 在真实宿主的会话里，让 agent 写一个新组件：它加载 skill、定义组件、读到自检报告、修正溢出、放上看板，全程不需要人转述问题。
- [ ] 会话重新打开后，内联显示过的组件按当时的版本重画。

## 10. 右侧栏与独立页面

- 右侧栏标签页类型：停靠与浮动，按 `rail` 尺寸族显示。
- 每个实例的独立页面路由。

完成判据：
- [ ] 同一个实例同时出现在看板、右侧栏与会话里，三处数据同步，状态一致。

## 11. 组件库、分享与导入

- 组件库页面（D8）：分组、预览、权限、版本历史、使用情况；复制、导出、检查更新、回退、删除、清理。
- `.dshw` 与 `.dshboard` 的导出与导入；路径与扩展名与大小校验；同 id 冲突的差异与选择。
- `url` 与 git 目录导入，检查更新；编辑导入组件时自动复制并记录 `forkedFrom`。
- `widget_library` 工具。

完成判据：
- [ ] 一块看板导出后在另一个 `DSH_HOME` 导入，外观与布局一致，`data` 与 `state` 只在勾选时带上。
- [ ] 带 `../` 路径、超限、含白名单之外扩展名的包被拒绝并说明原因。
- [ ] 回退到历史版本后实例按旧版本显示。

## 12. 扩展契约与任务看板

- 两侧的 `widgetBoard` 服务与版本协商；`registerWidgetType`、`registerDataSource`、`registerAction`。
- `service:taskBoard` 数据源与任务组件（任务列、运行中、计数），动作转给任务看板的 `dispatch`。

完成判据：
- [x] 一个测试用的外部插件注册原生组件与数据源，卸载后它们从组件库与看板上撤下（步骤 13 的冒烟兑现）。
- [ ] 装有任务看板时，任务组件实时反映任务状态，从组件里执行任务等同于在任务看板里执行。

## 13. 跨包边界与提供方契约

客户端插件的模块表在启动时冻结：除平台种子外，跨包的值只能经注入的 cordis 服务或宿主声明的插槽到达；`import type` 在编译时被抹掉，不产生模块请求。看板两侧的服务已经是唯一的运行路径；这一步把类型契约、边界检查与提供方卸载补到同一强度，并把步骤 12 的「提供方卸载」从判据变成冒烟里的场景。

- **服务类型独立成只有类型的模块。** `packages/contracts/src/service-types.ts` 放全部接口与类型别名（`InstanceFace`、`ProviderRegistration`、`ActionPermission`、`DataSourceRegistration`、`ActionRegistration`、`WidgetTypeRegistration`、`WidgetTypeHandle`、`WidgetBoardHostService`、`WidgetNativeProps`、`NativeWidgetRegistration`、`WidgetBoardClientService`），`service.ts` 只留 `WIDGET_BOARD_SERVICE_NAME`、`WIDGET_BOARD_API_VERSION`、`versionMismatch`，并再导出这些类型供本包使用；类型模块里不出现运行时代码。
- **发布只有类型的入口。** 根 `package.json` 增加 `exports["./service"]`，导出条件只有 `types`，指向构建写出的声明（`lib/types/`），没有 `default` 与 `import`；构建用 `tsc --emitDeclarationOnly` 从 `contracts` 写出声明。有类型检查的提供方把本包加进开发依赖，用 `import type { WidgetBoardClientService } from 'dsh-widget-board/service'` 取类型，在自己包里 `declare module '@deepseek-ai/cordis'` 把服务挂到 `Context` 上；版本从 `service.apiVersion` 读，不导入版本常量，也不导入 `versionMismatch`。纯 JS 提供方仍按同形声明写，运行时同样只走服务。
- **类型入口有编译测试。** `packages/testing/fixtures/provider-types/` 放一个只做类型检查的提供方（不进临时宿主）：它用 `import type` 取服务类型、声明 `Context`、按 `apiVersion` 协商；同一目录里用 `@ts-expect-error` 核对从 `dsh-widget-board/service` 取值导入会报错。`verify` 跑它的 `tsc`；再用 esbuild 打一次，核对产物里没有 `require('dsh-widget-board/service')`。
- **客户端边界由检查执行。** `scripts/lint.mjs` 增加一条：`packages/client` 里凡是从 `@deepseek-ai/*` 导入，必须是 `import type`；`require('@deepseek-ai/*')` 一律失败。`scripts/build.mjs` 增加一条：根 `package.json` 的 `dsh.client.external` 必须缺失或为空；`lib/client.js` 里 `require` 的字面量只能是平台种子（`react`、`react/jsx-runtime`、`react-dom`、`react-dom/client`）或本包的分块。两条检查都要有反例：往客户端源码里加一个值导入、往 `dsh.client.external` 加一项，各自失败。
- **提供方卸载进入冒烟。** 提供方 fixture 的 `package.json` 去掉误写在 `dsh.client.inject` 里的 `widgetBoard`（那一项只排模块行，服务注入由 `client.js` 的 `inject` 声明）；冒烟在现有的卡片场景之后，经插件页的行开关（`pluginManager/setPluginEnabled`）停用提供方，核对组件从组件库消失、已经放着的卡片保留并显示不可用、数据源与动作不再解析、这个提供方留下的授权被清掉；再启用之后组件、数据源与动作回来，卡片恢复。停用与启用各核对一次；客户端服务再补一次错版本拒绝。
- **客户端的重名注册与宿主一致。** `packages/client/src/native.ts` 的注册处遇到已经存在的组件 id 时抛出并说明已有提供方，保留先到的那一个，与宿主组件库「同 id 先到者为准」一致；把手注册的数据源与动作的 `provider` 必须与把手相同，撤下时按同一个名字清授权。提供方 fixture 各用一次重名注册与错 provider 子注册核对拒绝。
- **文档与决策。** 两份 README 的提供方一节按版本 2 重写：类型入口、`service.apiVersion`、客户端产物只依赖平台种子、功能包不添加 `dsh.client.external`。`docs/host-surfaces.md` 记下模块表、平台种子、`import type` 被抹掉、`dsh.client.external` 的禁令与两个 `inject` 的区别。D12 改写提供方那一条：类型可以经只含类型的入口导入，纯 JS 提供方仍按同形声明写；运行时只走服务，`external` 不用于功能包；运行时只走服务这条方向不变，不另写取代 D12 的 ADR，改完跑 `npm run docs:index`。`docs/changes/` 记一条行为变化，跑 `npm run changelog`。

完成判据：
- [x] `dsh-widget-board/service` 只导出类型；值导入在 `tsc` 处失败，类型导入的 esbuild 产物里没有 `require('dsh-widget-board/service')`。
- [x] 提供方类型 fixture 编译通过；现有提供方 fixture 在临时宿主里注册的组件、数据源与动作能用。
- [x] 客户端源码的值导入与 `dsh.client.external` 各有一个反例被 lint 或构建拦下；`import type` 通过。
- [x] 提供方停用后组件库、数据源、动作与授权都撤下，卡片保留并显示不可用；启用后恢复。
- [x] 同 id 的第二次原生组件注册被拒绝，先到的那一个继续画；错 provider 的子注册被把手拒绝。
- [x] 两份 README、`docs/host-surfaces.md`、D12 与 `docs/changes/` 更新；`npm run verify`、`docs:check`、`changelog:check`、`agents:check` 通过。

## 14. 端到端与发布

- 端到端场景（D13）覆盖步骤 2 到 13 的判据，持续集成里分片运行。
- 双语 README 与用户文档、`docs/changes/`、发布工作流。

完成判据：
- [ ] 推送后的云端运行全部通过。
- [ ] 本文件删除。
