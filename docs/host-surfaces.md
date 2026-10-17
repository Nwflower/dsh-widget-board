# 宿主接入面

方案依赖的宿主能力，以及每一项的出处。核实时的宿主是全局安装的 `@deepseek-ai/dsh` 0.2.1-rc.1，宿主包在它的 `node_modules/@deepseek-ai/` 下，类型声明在各包的 `lib/types/`。下文的「任务看板」指 `dsh-web` 仓库的 `packages/dsh-task-board`（本机只读副本：`D:\Build\dsh-claude-style\.debug\dsh-web\packages\dsh-task-board`）。

这些条目在 `packages/contracts` 的契约表建立后搬进契约表，各带一条契约测试（D1），本文件随之删去对应条目。

## 已核实

### 插件形态

- 一个包两个半边：`exports["."]` 是宿主半边，`exports["./client"]` 是浏览器半边；`package.json` 的 `dsh.client`（`inject`、`platform: "web"`）声明浏览器半边，它由宿主在 `/plugins/<id>/client.js` 提供；`dsh.bundle.patch` 指向 `cordis.patch.yml`，向 profile 插入一行 `{ id, name: <包名> }`。出处：任务看板 `package.json` 与 `cordis.patch.yml`。
- 宿主配置：`Config` 用 schemastery 声明，可热改的字段标 `Volatile<…>`；改动经 `loader/volatile-update` 事件生效，不重新挂载。出处：任务看板 `src/index.ts`。
- 浏览器半边外部化 `react`、`react-dom/client`、`@deepseek-ai/dsh-client-ui-primitives`。出处：`D:\Build\dsh-claude-style\scripts\build.mjs` 的 `HOST_PACKAGES`。
- **浏览器半边读宿主服务前必须在插件上声明 `inject`**：cordis 只允许读声明过的服务，`apply` 里读未声明的属性会抛 `cannot get property "<名字>" without inject`，插件整条变成 failed，宿主的启动检查只说那一条没起来。声明之后 cordis 等到服务出现才调用 `apply`，服务不出现时插件停在 pending，检查报出在等哪一项。本仓库在 0.2.1-rc.1 上实证：未声明时 `dsh-widget-board: failed`，声明 `inject = ['slots']` 后侧栏入口与中栏页面都出现。出处：宿主启动检查报出的那条错误与 `packages/testing/smoke.cjs`。
- 浏览器半边的脚本由宿主按内容组合成一条 combo 地址（`/plugins/??<包名>/client.js&rev=<哈希>`），单包的 `/plugins/<包名>/client.js` 不是路由。出处同上。

### 界面表面

- **侧栏入口**：`ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id, order, label: () => 文案 }, Icon))`。`Icon` 收到 `{ size, active }`，只画图形；行的盒子、标签、高亮、收起后的图标栏归宿主外壳。已占用的排位：插件页 0、定时任务 10、任务看板 20。出处：任务看板 `src/client/native-panel.tsx`。
- **中栏页面**：`ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: <面板 id>, children: { '<子插槽>': { kind: 'list', scope: 'root' } }, inject: () => ({ … }) }, Page))`。只在该面板被选中时挂载；声明的子插槽经组件收到的 `renderSlot(key, ownerProps)` 渲染。出处：同上，以及 `src/client/seats.tsx`。
- **会话里的工具视图**：插槽 `tool.call.toolview`，`kind: 'keyed'`、`scope: 'session'`，按线上工具名分派，任何名字都可以注册，包括本插件注册的工具；注册已占用的键会替换原视图。视图的 owner 属性带 `callId`、`toolName`、`useDisclosure`，以及按阶段区分的 `{ phase: 'preparing' | 'start' | 'result', block }`。出处：`dsh-client-ui-tool/lib/types/client/contract/slots.d.ts`。
- **右侧栏标签页**：插槽 `sidebar.right.pane.tab`（`kind: 'keyed'`、`scope: 'session'`）按标签页类型定义的 `id` 分派；类型定义 `SidebarRightTabDefinition` 有 `id`、`kind`、`multiple`、`keepMounted`、`patterns`、`priority`、`canOpen`、标题函数；标题另有 `sidebar.right.pane.tab.title` 插槽。停靠与浮动两种形态都由这个插槽画。出处：`dsh-client-ui-sidebar-right/lib/types/client/contract/slots.d.ts`、`tab-registry.d.ts`。

### 宿主服务

- **存储域**：`ctx.storage.domain.open(spec)` 返回带类型的域；`defineDomain({ name, version, layout?, compatibleVersions?, invalidRecords?, global?, tables })`，表由 `domainTable<K, V>(zodSchema)` 声明。读是同步的内存读；写排在每个域唯一的写入链上，先等持久化，再改内存，再发出 `domain/changed`；表提供 `get`、`entries`、`put`、`delete`、`update(key, fn)`。同名域重复打开会失败。出处：`dsh-storage-domain/lib/types/spec.d.ts`、`domain.d.ts`、`index.d.ts`。
- **工具**：`defineTool({ name, description, parameters, output: { schema, render }, execute(args, exec) })`（`@deepseek-ai/dsh-tools`），经工具注册表的 `register(tool)` 注册并返回释放函数。注册表按可选服务解析，并经 `ctx.inject(['tools'], …)` 跟随它的出现与更换。出处：任务看板 `src/index.ts`、`src/host/agent-tools.ts`。
- **系统提示**：`ctx.systemPrompt.section({ name, order, text })` 返回释放函数；同名重复注册会抛出，所以要先释放旧的。出处：任务看板 `src/index.ts`。
- **skill**：`ctx.skills.register(SkillRegistration)` 注册运行时 skill。出处：`dsh-skill/lib/types/index.d.ts`。
- **路由**：`ctx.webServer.register(route)`（`WebRoute` 来自 `@deepseek-ai/dsh-host-webserver`）交给插件原始请求，宿主的 `/api` 栅栏不覆盖插件路由。插件自己调用 `ctx.get('connection')?.requestRejection(req)` 借用宿主的栅栏与认证；没有这项服务时只放行本机回环。出处：`D:\Build\dsh-claude-style\packages\engine\node\http.ts`。
- **组件文档路由与 CSP 在真实宿主里跑通**（D3）：`kind: 'prefix'` 的一条路由交给插件整棵子树；`sandbox="allow-scripts"` 的 iframe 指向按哈希寻址的文档，文档里的运行时与组件脚本以内联 `<script nonce=…>` 运行，响应头的 CSP 是 `default-src 'none'`、`connect-src 'none'`；iframe 的导航请求带着会话 cookie，`requestRejection({ headers })` 放行。出处：本仓库的 `packages/host/src/routes.ts` 与 `packages/testing/smoke.cjs`（在 0.2.1-rc.1 上实证）。
- **插件的私有路由必须放在 `/api/` 下，浏览器半边用文档相对的地址**（D1）：桌面外壳的页面来源是 `dsh-app://app`，它的协议处理器只把 `/api/*` 转给宿主的 web 服务——`api/task-board/state` 回 200，`plugins/…` 回 404，随包发布的客户端脚本地址也是文档相对的（`plugins/??<包名>/client.js` 没有开头斜杠）。前缀因此定成 `/api/widget-board`，客户端只从 `CLIENT_ROUTE` 拼地址。同一协议下的沙箱 iframe 指向 `api/…` 能正常加载（`load` 事件与 `contentWindow` 都正常）。出处：任务看板 `src/protocol.ts` 与 `src/client/host-api.ts` 的「DOCUMENT-RELATIVE」注释；本仓库在桌面外壳的页面里实测。
- **宿主令牌不跨 iframe**（D10）：组件文档是不透明来源，宿主的 `--dsw-*` 变量传不过去；令牌要由父页面解析成字面值，经桥的 `init` 消息递进去。解析读 `document.body` 的计算值（主题可能把变量写在根节点或 body 上，两者都能读到继承后的值）。出处：本仓库的 `packages/client/src/tokens.ts` 与 `packages/runtime/src/index.ts`。
- **批准**：`ctx.approval.request(req)` 返回 `ApprovalOutcome`；请求必须带 `agent`（代表哪个会话询问）与 `toolName`，可带 `callId`、`reason`、`displayReason`。没有会话 agent 的界面动作不能用它。出处：`dsh-user-approval/lib/types/index.d.ts`、`types.d.ts`。
- **程序执行**：`ctx.ptcRuntime` 运行受沙箱策略约束的程序，宿主函数以命名空间绑定给程序，参数与返回值必须是无损 JSON。本机宿主只带了 node 后端（`dsh-ptc-runtime-node`）。出处：`dsh-ptc-runtime/lib/types/types.d.ts`。
- **子进程**：`ctx.subprocess` 管理进程组、有界的输出与升级终止。出处：`dsh-subprocess/package.json` 的描述。
- **主题**：浏览器侧 `ctx.theme` 是 `ThemeRuntime`：`getTheme()`、`exportInspectTokens()`、`register(definition)`、`overrideTokens(source, tokens)`；状态变化发出 `theme/change(snapshot)`。宿主令牌是 `--dsw-*`。出处：`dsh-client-ui-theme/lib/types/client/index.d.ts`。
- **宿主自己的 HTML 预览**用 `<iframe srcDoc sandbox="">`，完全不允许脚本。出处：`dsh-client-ui-sidebar-documentpreview/lib/client.js`。
- **类型化远程调用**（`typertGateway`）要求生成的定义，第三方插件不能直接使用。出处：`dsh-api-gateway/lib/types/index.d.ts`。

### 任务看板的服务

- 宿主与浏览器两侧都发布 cordis 服务 `taskBoard`，版本常量 `TASK_BOARD_API_VERSION = 1`。宿主侧的提供方能力面：`tasks.{ list, get, create, patchContent, setStatus, linked }`、`integration.{ read, write }`、`events.{ onStatusChanged, onExecutionSettled, onTaskDeleted }`、`publish`、`registerTool`；浏览器侧：`dispatch`、`registerVisibility`、`subscribe`、`snapshot`。出处：任务看板 `AGENTS.md` 的「外部提供方扩展契约」一节与 `src/core/extension.ts`。

### 工作坊

- dsh-web 的工作坊（`dsh-market`）在设置里声明子插槽 `dsh-workshop.panel`，各类资源面板注册进去。出处：dsh-web 仓库根目录的 `AGENTS.md`。

## 待在真实宿主上核实

每一项写明它影响哪个决定，以及怎么核实。核实之后移到上一节，或者按结果改写对应的 ADR。

- **右侧栏标签页类型的注册入口**（D1）：类型声明里只看到外壳读取的 `tabTypes`，注册类型定义的方法要在 `dsh-client-ui-sidebar-right` 的 `client/service.d.ts` 与实现里找到，并在页面上打开一个自定义类型的标签页。
- **gridstack 在宿主页面里的行为**（D2、D4）：在中栏页面里挂一个 gridstack，确认拖拽、缩放、`column(n, 'none')` 与 `load()` 正常，指针经过 iframe 时的处理有效。
- **存储域对第三方插件可用**（D5）：本插件内联打包的 zod 交给宿主的存储域后能正确校验，同名域在插件重新挂载时能关闭再打开。
- **`ctx.skills.register` 的虚拟 skill 能被模型列出并加载**（D9）。
- **工具视图能否在会话重新打开后按工具结果重画**（D9）：`result` 阶段的 `block` 里能否读到工具返回的完整 JSON。
- **`theme/change` 与 `--dsw-*` 计算值**（D10）：切换浅色、深色与皮肤时事件是否触发，从页面根节点读到的值是否已经是皮肤改写后的值。
- **iframe 的进程与内存成本**（D4）：一页放 30 张卡片时的内存占用，以及暂停与卸载策略的效果。
