# 宿主接入面

方案依赖的宿主能力，以及每一项的出处。核实时的宿主是全局安装的 `@deepseek-ai/dsh` 0.2.1-rc.1，宿主包在它的 `node_modules/@deepseek-ai/` 下，类型声明在各包的 `lib/types/`。下文的「任务看板」指 `dsh-web` 仓库的 `packages/dsh-task-board`（本机只读副本：`D:\DSH\dsh-claude-style\.debug\dsh-web\packages\dsh-task-board`）。

这些条目在 `packages/contracts` 的契约表建立后搬进契约表，各带一条契约测试（D1），本文件随之删去对应条目。

## 已核实

### 插件形态

- 一个包两个半边：`exports["."]` 是宿主半边，`exports["./client"]` 是浏览器半边；`package.json` 的 `dsh.client`（`inject`、`platform: "web"`）声明浏览器半边，它由宿主在 `/plugins/<id>/client.js` 提供；`dsh.bundle.patch` 指向 `cordis.patch.yml`，向 profile 插入一行 `{ id, name: <包名> }`。出处：任务看板 `package.json` 与 `cordis.patch.yml`。
- 宿主配置：`Config` 用 schemastery 声明，可热改的字段标 `Volatile<…>`；改动经 `loader/volatile-update` 事件生效，不重新挂载。出处：任务看板 `src/index.ts`。
- 浏览器半边外部化 `react`、`react-dom/client`、`@deepseek-ai/dsh-client-ui-primitives`。出处：`D:\DSH\dsh-claude-style\scripts\build.mjs` 的 `HOST_PACKAGES`。
- **浏览器半边读宿主服务前必须在插件上声明 `inject`**：cordis 只允许读声明过的服务，`apply` 里读未声明的属性会抛 `cannot get property "<名字>" without inject`，插件整条变成 failed，宿主的启动检查只说那一条没起来。声明之后 cordis 等到服务出现才调用 `apply`，服务不出现时插件停在 pending，检查报出在等哪一项。本仓库在 0.2.1-rc.1 上实证：未声明时 `dsh-widget-board: failed`，声明 `inject = ['slots']` 后侧栏入口与中栏页面都出现。出处：宿主启动检查报出的那条错误与 `packages/testing/smoke.cjs`。
- 浏览器半边的脚本由宿主按内容组合成一条 combo 地址（`/plugins/??<包名>/client.js&rev=<哈希>`），单包的 `/plugins/<包名>/client.js` 不是路由。出处同上。
- **客户端模块表与平台种子**：`window.__DSH_BOOT__` 是宿主组合的 entry 图；Web shell 启动时建一张冻结的 lazy CJS 模块表，平台种子是 `react`、`react/jsx-runtime`、`react-dom`、`react-dom/client`、`@deepseek-ai/cordis`、`@deepseek-ai/dsh-client-store`、`@deepseek-ai/dsh-client-ui-slots`、`@deepseek-ai/dsh-client-ui-primitives`、`@deepseek-ai/dsh-client-ui-dockkit`。`dsh.client.external` 是请求非基线模块行的字段；功能插件不添加它，跨包行为走 cordis 服务，跨包界面走插槽。`import type` 在编译时被抹掉，不产生模块请求。出处：宿主 `dsh-client-modules/README.md`、Web shell 的 `staticModules`、`dsh-package-manifest` 的 `DshClientManifest`；本仓库的 `scripts/build.mjs`、`scripts/lint.mjs` 与 `packages/testing/fixtures/provider-types/`。
- **两个 `inject` 不是一回事**：`package.json` 的 `dsh.client.inject` 只排模块行的到达次序（包名，供 entry 组合与 factory 到达），不注入任何服务；服务注入写在插件导出的 `inject` 上。把服务名写进前者不会报错，也不会生效。出处：`DshClientManifest` 的注释、`WebBootEntry` 的 `inject`；本仓库的 `packages/testing/fixtures/provider/package.json` 与 `client.js`。
- **提供方的类型入口只含类型**：根包 `exports["./service"]` 的条件只有 `types`，指向 `tsc --emitDeclarationOnly` 从 `packages/contracts/src` 写出的声明；提供方用 `import type` 取类型，运行时读 `service.apiVersion`，不导入版本常量或 `versionMismatch`。出处：本仓库的 `package.json`、`tsconfig.types.json`、`scripts/check-provider-types.mjs`。
- **插件页的开关能停用与启用提供方**：插件管理页的 bundle 开关调用 `pluginManager/setBundleEnabled`，行开关调用 `setPluginEnabled`；本仓库的冒烟经行开关停用与启用提供方，核对组件库、数据源、动作与授权的撤下和恢复。出处：`dsh-client-ui-plugin-manager/lib/client.js` 的 `setEnabled`/`setRowEnabled` 与 `data-plugin-package`/`data-plugin-row` 标记；本仓库的 `packages/testing/provider.cjs`。

### 界面表面

- **侧栏入口**：`ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id, order, label: () => 文案 }, Icon))`。`Icon` 收到 `{ size, active }`，只画图形；行的盒子、标签、高亮、收起后的图标栏归宿主外壳。已占用的排位：插件页 0、定时任务 10、任务看板 20。出处：任务看板 `src/client/native-panel.tsx`。
- **中栏页面**：`ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: <面板 id>, children: { '<子插槽>': { kind: 'list', scope: 'root' } }, inject: () => ({ … }) }, Page))`。只在该面板被选中时挂载；声明的子插槽经组件收到的 `renderSlot(key, ownerProps)` 渲染。出处：同上，以及 `src/client/seats.tsx`。
- **Windows 桌面端的标题栏**：桌面壳打开 Window Controls Overlay，`navigator.windowControlsOverlay.visible` 为真，`getTitlebarAreaRect()` 给出标题栏的高度与系统窗口按钮的起点；宿主同时把标题栏那一条从页面内容里让出来（frame 的 `padding-top` 等于标题栏高度）。插件不读宿主 DOM，只按这两项与看板根节点的位置判断标题栏里有没有空位；Desktop preload 在标题栏左端画自己的菜单（`[data-windows-menu]`，收起侧栏时从 84px 起排），展开按钮与新会话按钮占到 76px，插件左端按 300px 让开，标签条靠左挂在菜单之后。出处：`dsh-claude-style/packages/engine/src/desktop-band.ts`、宿主 `dsh-client-ui-layout/lib/client.js` 的 `[data-windows-titlebar]` 样式与桌面 preload 的 `installWindowsMenu`，在 0.2.1-rc.2 上按桌面壳替身核实（`packages/testing/titlebar.cjs`）。
- **会话里的工具视图**：插槽 `tool.call.toolview`，`kind: 'keyed'`、`scope: 'session'`，按线上工具名分派，任何名字都可以注册，包括本插件注册的工具；注册已占用的键会替换原视图。注册选项是 `{ name: 'tool.call.toolview', key: '<工具名>' }`，`key` 写错永远不会被派发。视图的 owner 属性带 `callId`、`toolName`、`useDisclosure`，以及按阶段区分的 `{ phase: 'preparing' | 'start' | 'result', block }`；结果阶段的 `block` 是 `ToolResultNode`，带这次调用的 `content`、`isError` 与工具自己投影的 `meta`。出处：`dsh-client-ui-tool/lib/types/client/contract/slots.d.ts`、`dsh-client-ui-conversation/lib/types/client/contract/records.d.ts`；本仓库的注册在 `packages/client/src/toolview.ts`。
- **右侧栏标签页**：插槽 `sidebar.right.pane.tab`（`kind: 'keyed'`、`scope: 'session'`）按标签页类型定义的 `id` 分派；类型定义 `SidebarRightTabDefinition` 有 `id`、`kind`、`multiple`、`keepMounted`、`patterns`、`priority`、`canOpen`、标题函数；标题另有 `sidebar.right.pane.tab.title` 插槽。停靠与浮动两种形态都由这个插槽画。出处：`dsh-client-ui-sidebar-right/lib/types/client/contract/slots.d.ts`、`tab-registry.d.ts`。
- **设置页里的一节**：插槽 `settings.section`（`kind: 'list'`、`scope: 'root'`）。它由设置外壳的占用者（`dsh-client-ui-settings-general`）在运行时经 `children` 声明，只在侧栏「设置」那一行挂载期间存在，所以注册要经 `ctx.slots.inject('settings.section', …)` 等它出现，不能直接 `register`。注册选项是 `{ name, id, order?, label? }`：`id` 是必填的节 key，同时是导航选中的那一项；`label` 可以是函数，导航每次投影时重读。组件收到的 owner 属性只有 `close()`（关掉设置面板），一次只挂载 `id` 等于当前导航项的那一节。出处：`dsh-client-ui-settings/lib/types/client/contract/slots.d.ts`（`:73`、`:154`）与 `dsh-client-ui-settings-general/lib/client.js`（`:1258`、`:1293`、`:337`、`:1140`），在 0.2.1-rc.2 上按类型声明与实现核实；本仓库的注册在 `packages/client/src/panel.ts`。

### 宿主服务

- **存储域**：`ctx.storage.domain.open(spec)` 返回带类型的域；`defineDomain({ name, version, layout?, compatibleVersions?, invalidRecords?, global?, tables })`，表由 `domainTable<K, V>(zodSchema)` 声明。读是同步的内存读；写排在每个域唯一的写入链上，先等持久化，再改内存，再发出 `domain/changed`；表提供 `get`、`entries`、`put`、`delete`、`update(key, fn)`。同名域重复打开会失败。出处：`dsh-storage-domain/lib/types/spec.d.ts`、`domain.d.ts`、`index.d.ts`。
- **工具**：`defineTool({ name, description, parameters, output: { schema, render }, execute(args, exec) })`（`@deepseek-ai/dsh-tools`），经工具注册表的 `register(tool)` 注册并返回释放函数。注册表按可选服务解析，并经 `ctx.inject(['tools'], …)` 跟随它的出现与更换。注册的形状是 `ToolDefinition`：`output` 除 `schema` 与 `render` 外还可以带 `presentationMeta(args, value)`，它的返回值存进这次调用的 `tool/result` 事件的 `meta`，会话里的工具视图从 `ToolResultNode.meta` 读它；`meta` 只对顶层调用投影（经 `run_code` 派发的内层调用没有），并且必须是无损 JSON。出处：`dsh-tools/lib/types/index.d.ts` 的 `ToolOutputDefinition`、`dsh-tools/lib/index.js`（`presentationMeta` 的接线与 `exec.parent === void 0` 判定）、`dsh-client-ui-chat/lib/client.js`（`meta` 进 `ToolResultNode`）。
- **直接注册原始 JSON Schema 工具也能用**：注册表读的是 `{ name, description, parameters, output: { schema, render }, execute }`，`parameters` 是给模型看的 JSON Schema 对象，输入校验由工具自己做；`defineTool` 只是在这一层之上加了参数推导与校验。本仓库构建时拿不到 `@deepseek-ai/dsh-tools`（它由宿主进程提供），因此按这个形状直接注册。出处：`dsh-tools/lib/types/index.d.ts` 的 `ToolDefinition`、`ToolOutputDefinition` 与 `dsh-llm` 的 `ToolSchema`；本仓库的 `packages/contracts/src/tools.ts` 与 `packages/testing/smoke.cjs`（在 0.2.1-rc.2 上实证：宿主输出里出现 `widget-board: 注册了 widget_catalog、…`）。
- **`ctx.inject` 是读可选服务的唯一路子**：上下文是代理，读未声明的服务会抛；`ctx.inject(['tools'], cb)` 在服务出现时回调，服务缺席时插件照常起来。同一个上下文上可以再 `inject` 别的服务（本仓库用它把 `systemPrompt` 与 `skills` 挂成可选）。出处：`@deepseek-ai/cordis` 的 `RegistryService.inject`；本仓库的 `packages/host/src/tools/index.ts`。
- **系统提示**：`ctx.systemPrompt.section({ name, order, text })` 返回释放函数；同名重复注册会抛出，所以要先释放旧的。出处：任务看板 `src/index.ts`。
- **skill**：`ctx.skills.register(SkillRegistration)` 注册运行时 skill。出处：`dsh-skill/lib/types/index.d.ts`。
- **虚拟 skill 会被列出来、模型能加载**（D9）：注册的 `widget-authoring` 在一个空的临时会话里输入 `/` 之后出现在「技能」一节；`invocation.modelInvocable` 与 `userInvocable` 都为真。出处：本仓库的 `packages/host/src/tools/index.ts`，在 0.2.1-rc.2 的真实临时宿主里核实（`packages/testing/dsh-web.cjs` 起的实例，打开新会话输入 `/`）。
- **工具视图在 `result` 阶段读得到工具写的那一份数据**（D9）：工具注册项可以用 `output.presentationMeta(args, value)` 把一份 JSON 交给 `tool/result` 的 `meta`，视图的 `result` 阶段从 `block.meta` 读到同一份（`ToolResultNode` 的 `meta`）。出处：`dsh-tools/lib/types/index.d.ts` 的 `ToolOutputDefinition.presentationMeta` 与 `dsh-client-ui-conversation/lib/types/client/contract/records.d.ts` 的 `ToolResultNode`（0.2.1-rc.2，按类型声明核实）。会话重新打开时按同一份重画与视图在真实会话里的样子，还没有人在场的端到端核对（D9 的完成判据）。
- **路由**：`ctx.webServer.register(route)`（`WebRoute` 来自 `@deepseek-ai/dsh-host-webserver`）交给插件原始请求，宿主的 `/api` 栅栏不覆盖插件路由。插件自己调用 `ctx.get('connection')?.requestRejection(req)` 借用宿主的栅栏与认证；没有这项服务时只放行本机回环。出处：`D:\DSH\dsh-claude-style\packages\engine\node\http.ts`。
- **组件文档路由与 CSP 在真实宿主里跑通**（D3）：`kind: 'prefix'` 的一条路由交给插件整棵子树；`sandbox="allow-scripts"` 的 iframe 指向按哈希寻址的文档，文档里的运行时与组件脚本以内联 `<script nonce=…>` 运行，响应头的 CSP 是 `default-src 'none'`、`connect-src 'none'`；iframe 的导航请求带着会话 cookie，`requestRejection({ headers })` 放行。出处：本仓库的 `packages/host/src/routes.ts` 与 `packages/testing/smoke.cjs`（在 0.2.1-rc.1 上实证）。
- **插件的私有路由必须放在 `/api/` 下，浏览器半边用文档相对的地址**（D1）：桌面外壳的页面来源是 `dsh-app://app`，它的协议处理器只把 `/api/*` 转给宿主的 web 服务——`api/task-board/state` 回 200，`plugins/…` 回 404，随包发布的客户端脚本地址也是文档相对的（`plugins/??<包名>/client.js` 没有开头斜杠）。前缀因此定成 `/api/widget-board`，客户端只从 `CLIENT_ROUTE` 拼地址。同一协议下的沙箱 iframe 指向 `api/…` 能正常加载（`load` 事件与 `contentWindow` 都正常）。出处：任务看板 `src/protocol.ts` 与 `src/client/host-api.ts` 的「DOCUMENT-RELATIVE」注释；本仓库在桌面外壳的页面里实测。
- **凭据**：`ctx.get('credentials')` 是凭据接缝，`describe(ref)` 回 `{ configured, source?, writable }`（永不回值），`set(ref, value)` 与 `unset(ref)` 写提供方管理的存储。来源层由提供方定义（本地提供方用 `env`、`file`、`project-env`、`user-env`），启动环境供值的项是只读的。形状按本插件用到的部分记在 `packages/contracts/src/host.ts` 的 `credentialsOf`。出处：`dsh-credentials/lib/types/index.d.ts` 与 `dsh-credentials-local` 的 README（0.2.1-rc.2）。
- **凭据的值只有宿主半边读得到**：`resolve(ref)` 回 `{ value, source }` 或 `undefined`，每次操作现取、不跨操作缓存（改过的值下一次就生效）。本地提供方的文件是 `<DSH_HOME>/.credentials.yaml`，`refs:` 下按环境变量名存值，改完自动重载。看板只在代发外部请求时读值，卡片与设置弹窗读的都是 `describe`。出处：`dsh-credentials/lib/types/index.d.ts` 的 `CredentialProvider.resolve` 与 `dsh-credentials-local` 的 README（本地文件格式与重载）。
- **GitHub 的 REST 接口**：`GET /user` 回令牌所属账号（`login`），`GET /search/issues?q=author:@me is:issue` 回这个账号创建的 issue 与 `total_count`；`/issues?filter=created` 会带上 PR，不用于列表。搜索接口返回的是精简过的条目，仓库在 `repository_url` 里是 `.../repos/<owner>/<name>`。令牌无效与配额用完都是 401/403，后者带 `x-ratelimit-remaining: 0`。出处：本仓库对 `api.github.com` 的实际请求（带令牌），2026-10-20。
- **DeepSeek 账户**：`ctx.get('deepseekAccount')` 是 Host 侧账户接缝，`getBalance(client)` 回 `{ status: 'ready', value, bonusWallets }` 或 `{ status: 'failed' }`，未登录与账号变化时回 `null`；`client` 带 `version`、`locale` 与 `timezoneOffsetSeconds`，返回值不含 token。形状按本插件用到的部分记在 `packages/contracts/src/host.ts` 的 `accountOf`。出处：安装包 `@deepseek-ai/dsh-deepseek-account` 的 `lib/types/types.d.ts`（0.2.1-rc.1）。
- **宿主令牌不跨 iframe**（D10）：组件文档是不透明来源，宿主的 `--dsw-*` 变量传不过去；令牌要由父页面解析成字面值，经桥的 `init` 消息递进去，之后变化时经 `theme` 消息再推一次（D18）。解析读 `document.body` 的计算值（主题可能把变量写在根节点或 body 上，两者都能读到继承后的值）。出处：本仓库的 `packages/client/src/theme.ts` 与 `packages/runtime/src/index.ts`。
- **组件目录里的图片与字体要内联**（D3）：文档的 CSP 只放行 `data:` 与 `blob:` 的图片与字体，组件自己发请求又过不了栅栏。作者写 `{{asset:相对路径}}`，宿主拼文档时换成 `data:` 地址；路径越出组件目录或文件不存在时拒绝拼装。出处：本仓库的 `packages/host/src/document.ts` 与 `packages/host/test/document.test.ts`。
- **配置表单**：`Config` 用 schemastery 声明，可热改的字段标 `.volatile()`，运行时拿到的可能是活的引用（`.get()`）。同一个名字在配置文件里是普通值，所以另声明 `ConfigInput`，schema 写成 `z<ConfigInput, Config>`，读值用 `readConfigField`（两种形态都接受）。出处：任务看板 `src/index.ts`；本仓库 `packages/host/src/index.ts` 照此实现。
- **批准**：`ctx.approval.request(req)` 返回 `ApprovalOutcome`；请求必须带 `agent`（代表哪个会话询问）与 `toolName`，可带 `callId`、`reason`、`displayReason`。没有会话 agent 的界面动作不能用它。出处：`dsh-user-approval/lib/types/index.d.ts`、`types.d.ts`。
- **界面上的授权由看板自己记录**：`ctx.approval.request` 要一个未结束的轮次与一个会话 agent，界面上的点击没有这两样，所以人给出的授权记在 `$DSH_HOME/widget-board/grants.json` 里，与看板同一个写入者；工具触发的动作在已有授权之外再经 `ctx.approval.request` 问一次（D6）。出处：本仓库的 `packages/host/src/grants.ts`、`packages/host/src/permissions.ts` 与 `docs/adr/D6-data-sources-and-actions.md`。
- **程序执行**：`ctx.ptcRuntime` 运行受沙箱策略约束的程序，宿主函数以命名空间绑定给程序，参数与返回值必须是无损 JSON。本机宿主只带了 node 后端（`dsh-ptc-runtime-node`）。出处：`dsh-ptc-runtime/lib/types/types.d.ts`。
- **子进程**：`ctx.subprocess` 管理进程组、有界的输出与升级终止。出处：`dsh-subprocess/package.json` 的描述。
- **主题**：浏览器侧 `ctx.theme` 是 `ThemeRuntime`：`getTheme()`、`exportInspectTokens()`、`register(definition)`、`overrideTokens(source, tokens)`；状态变化发出 `theme/change(snapshot)`。宿主令牌是 `--dsw-*`。出处：`dsh-client-ui-theme/lib/types/client/index.d.ts`。
- **宿主自己的 HTML 预览**用 `<iframe srcDoc sandbox="">`，完全不允许脚本。出处：`dsh-client-ui-sidebar-documentpreview/lib/client.js`。
- **类型化远程调用**（`typertGateway`）要求生成的定义，第三方插件不能直接使用。出处：`dsh-api-gateway/lib/types/index.d.ts`。

### 任务看板的服务

- 宿主与浏览器两侧都发布 cordis 服务 `taskBoard`，版本常量 `TASK_BOARD_API_VERSION = 1`。宿主侧的提供方能力面：`tasks.{ list, get, create, patchContent, setStatus, linked }`、`integration.{ read, write }`、`events.{ onStatusChanged, onExecutionSettled, onTaskDeleted }`、`publish`、`registerTool`；浏览器侧：`dispatch`、`registerVisibility`、`subscribe`、`snapshot`。出处：任务看板 `AGENTS.md` 的「外部提供方扩展契约」一节与 `src/core/extension.ts`。

### 工作坊

- dsh-web 的工作坊（`dsh-market`）在设置里声明子插槽 `dsh-workshop.panel`，各类资源面板注册进去。出处：dsh-web 仓库根目录的 `AGENTS.md`。

### 提供方

- **浏览器侧的 cordis 服务也能用 `provide` 发布**：与宿主侧同一条写法，`typeof ctx.provide === 'function'` 时调用；提供方在 `apply` 里声明 `inject = ['widgetBoard']` 就能等到它出现。出处：任务看板 `src/client/index.ts`；本仓库的 `packages/client/src/entry.ts` 与 `packages/testing/fixtures/provider/client.js`。
- **一个外部包能同时带宿主半边与浏览器半边**：`package.json` 的 `exports["."]`、`exports["./client"]`、`dsh.bundle.patch` 与 `dsh.client` 四项齐全时，`dsh plugin --profile web add <目录>` 装进去，两半都起来。冒烟把 `packages/testing/fixtures/provider/` 这样一个包装进临时宿主，核对组件库里出现它、原生组件渲染出数据源的数据、要权限的动作在授权前被拦下、在卡片上授权之后放行、撤下后消失。出处：本仓库的 `packages/testing/dsh-web.cjs`（`extras`）与 `packages/testing/smoke.cjs`。
- **服务面版本不匹配要由提供方自己核对**：宿主侧的服务带 `apiVersion`，提供方按自己的版本注册；对不上时注册抛出（`versionMismatch`）。冒烟用的提供方在启动时按一个不存在的版本试注册一次，核对它确实抛出。出处：本仓库的 `packages/contracts/src/service.ts` 与 `packages/testing/fixtures/provider/host.js`。
- **宿主半边与浏览器半边不在同一个进程里，`process.memoryUsage()` 只覆盖宿主进程**（D16）：宿主半边由加载器在 DSH 的 Node 进程里 `apply`，注册路由与看板存储；浏览器半边由宿主页面加载，组件在沙箱 iframe 里。`process.memoryUsage()` 读到的常驻、堆、外部内存与 ArrayBuffer 因此是整个宿主进程，包含看板以外的工作，不含浏览器页面、渲染进程与 GPU。桌面壳与服务端形态都是同一个宿主进程，差别只在谁托管它。出处：本仓库的 `packages/host/src/index.ts`（`ctx.webServer.register`）与 `packages/client/src/entry.ts`；在 0.2.1-rc.2 的真实临时宿主里由「运行成本」卡读到（`packages/host/src/system-metrics.ts`、`packages/testing/matrix.cjs`）。
- **单张 iframe 的内存没有受支持的接口**（D16）：宿主只拿得到整个进程的读数，归不到某张卡；`performance.memory` 是页面级近似，卡片读不到父页面；`measureUserAgentSpecificMemory` 需要跨源隔离，DevTools 协议不对插件开放；渲染进程与 GPU 内存由 Electron 持有，不向插件暴露。「运行成本」卡因此只报整进程读数与每张卡要加载的文档字节，并写明单卡内存不可测。出处：本仓库的 `docs/system-metrics.md` 与 `packages/widgets/system-metrics/`。

## 待在真实宿主上核实

每一项写明它影响哪个决定，以及怎么核实。核实之后移到上一节，或者按结果改写对应的 ADR。

- **右侧栏标签页类型的注册入口**（D1）：类型声明里只看到外壳读取的 `tabTypes`，注册类型定义的方法要在 `dsh-client-ui-sidebar-right` 的 `client/service.d.ts` 与实现里找到，并在页面上打开一个自定义类型的标签页。
- **工具视图在真实会话里的样子与会话重新打开后的重画**（D9）：`presentationMeta` → `tool/result.meta` → `block.meta` 的类型链已经核对；还缺有人在场的一次端到端（让模型调一次 `widget_define` 与 `widget_show`，看视图画出来，刷新之后还在）。
- **`theme/change` 与 `--dsw-*` 计算值**（D10）：切换浅色、深色与皮肤时事件是否触发，从页面根节点读到的值是否已经是皮肤改写后的值。
