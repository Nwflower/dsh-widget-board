# 提供方接入

其他插件把组件、数据源、动作、能力与市场交给看板，走宿主进程与浏览器页面各一个 cordis 服务 `widgetBoard`。这一页写服务面现在的形状、一个提供方按什么次序接入、两侧各自的边界，以及服务面升版本时提供方要改哪里。

服务面的类型在 [service-types.ts](../packages/contracts/src/service-types.ts)，运行时常量与版本判定在 [service.ts](../packages/contracts/src/service.ts)，`./provider` 的值构造函数在 [provider.ts](../packages/contracts/src/provider.ts)。

## 两个入口

| 入口 | 在哪一侧 | 接受的版本 |
|---|---|---|
| `registerProvider` | 宿主侧服务、浏览器侧服务 | 3，只有这一个 |
| `registerWidgetType`、`registerDataSource`、`registerAction`、`registerCapability`、`registerMarketProvider` | 宿主侧服务 | 2 或 3 |
| `registerWidgetType` | 浏览器侧服务 | 2 或 3 |

`registerProvider` 报身份与用途，拿回一个把手；组件目录、数据源、动作、能力、市场与原生组件都经这个把手逐个挂上。旧入口一次注册一样东西，各自返回释放函数，其中组件目录的入口返回这一次目录注册的把手。

版本从服务上读：`service.apiVersion` 是这一侧现在的主版本，`service.supportedApiVersions` 是旧入口接受的版本集合，升序。版本常量留在运行时文件里，`./service` 只有类型，所以提供方不导入常量。

版本不在集合里时，注册处的错误写明这一侧接受的版本与带来的是哪一个，看板照常服务；新入口收到 2 时给出 `widgetBoard 服务版本是 3，注册时带来的是 2` 这一类说明。

## 一个提供方一个活动把手

同一侧、同一个提供方包名，同一时刻只有一个活动把手。两条路各占一种：

| 情形 | 结果 |
|---|---|
| 已经有 `registerProvider` 的把手，再调旧入口 | 抛出，说明这个提供方已经用 `registerProvider` 注册过，改用把手上的方法 |
| 旧入口还有没释放的注册，再调 `registerProvider` | 抛出，说明这个提供方已经经旧入口注册过，先释放旧的注册 |
| 浏览器侧已经经 `registerProvider` 拿到把手，再调 `registerWidgetType` | 抛出，说明新旧入口不能混用 |
| 同一个提供方第二次调 `registerProvider` | 抛出，说明先 `dispose` 再注册新的 |

混用被拒绝，是因为撤下与授权清理按提供方名归并：一次卸载要撤下同一个提供方名下的全部注册，两条路各记一份就分不清哪些属于这一次卸载。旧入口名下的注册全部释放之后，同一个提供方可改用新入口。

`dispose()` 之后可以重新注册同一个提供方。宿主侧的 `dispose()` 返回 Promise：组件目录、名下的数据源、动作、能力、市场、这个提供方留下的授权与它的目录监视一并撤下，随后重读组件库。浏览器侧没有要撤的宿主资源，`dispose()` 是同步的。

## 宿主侧把手

`registerProvider({ apiVersion: 3, provider: '<包名>', features: [...] })` 返回 [WidgetProviderHandle](../packages/contracts/src/service-types.ts)：

| 成员 | 做什么 |
|---|---|
| `provider` | 注册时报的包名 |
| `supportedApiVersions`、`features`、`supports()` | 这一侧接受的版本、声明的功能、逐项查询 |
| `directories` | 已经挂上的组件目录，按注册顺序 |
| `widgets` | 这次注册名下的组件 id，按注册顺序 |
| `registerWidgets({ directory })` | 再挂一个组件目录，读一次，返回这一次目录注册的把手 |
| `registerDataSource()`、`registerAction()`、`registerCapability()` | 挂一份数据源、动作或能力，返回撤下这一份的函数 |
| `registerMarketProvider()` | 挂一份市场，返回撤下这一份的函数 |
| `dispose()` | 把上面这些一次全部撤下 |

把手发出的子注册只写自己的名字与行为：`apiVersion` 与 `provider` 由把手注入，类型上是 `Omit<..., 'apiVersion' | 'provider'>`。旧入口的 `WidgetTypeHandle.register()` 收完整的注册，并且 `provider` 必须与把手相同，写错会抛出。

一个提供方最多挂 128 个组件（按去重后的 id 计）、64 个数据源、64 个动作、64 个能力；同一个目录重复注册会抛出，读不出来的那一次不留下来源条目与目录监视。市场同一时刻只有一个，撤下之后才能换新的。

## 浏览器侧把手

`registerProvider` 在浏览器侧收同一份身份，返回 [WidgetNativeProviderHandle](../packages/contracts/src/service-types.ts)：

| 成员 | 做什么 |
|---|---|
| `provider`、`widgets` | 包名与这次注册名下的组件 id |
| `supportedApiVersions`、`features`、`supports()` | 与宿主侧同形的三项 |
| `registerNativeWidget({ id, component })` | 登记一个画在父页面里的 React 组件，返回撤下它的函数 |
| `dispose()` | 撤下这次注册名下的全部原生组件 |

原生组件的 `id` 必须写成 `<作者域>.<名字>`；一个提供方最多 128 个。同 id 先到者胜，后到的注册抛出并说明已有提供方，先到的那一个继续画。

原生组件与组件库里的同 id 组件对上之后由它渲染，组件照常从宿主拿到 props、data、state 与尺寸。

## 功能与 supports

功能与版本分开数：同一个版本里某一侧可能没有某一项。

| 功能 | 说明 | 宿主侧 | 浏览器侧 |
|---|---|---|---|
| `capabilityMetadata` | 能力的标题、说明、参数与结果 schema | 有 | 没有 |
| `eventData` | `instance` 事件带 `data`，页面就地合并 | 有 | 有 |
| `marketProvider` | 市场提供的条目与取包 | 有 | 没有 |
| `pushData` | 页面把数据推给一张卡 | 有 | 有 |

`features` 是注册时对用途的声明，不改变这一侧提供什么：声明里少一两项不影响注册，某一侧真没有的那一项按项降级。这里有两处会抛出：

- 声明里出现清单之外的功能名，整次注册失败。拼错的名字会被静默读成「不支持」，所以在这里就拒绝。
- `supports()` 收到清单之外的名字时抛出，不返回 `false`。

`supports()` 由这一侧自己回答，不替另一侧回答：宿主进程有没有市场和浏览器页面有没有市场是两件事。宿主侧四项都返回真；浏览器侧只有 `eventData` 与 `pushData`。

## 类型入口与 SDK

根包发布两个入口，用途不同：

| 入口 | 是什么 | 怎么用 |
|---|---|---|
| `dsh-widget-board/service` | 只有类型的入口，导出条件只有 `types` | `import type` 取服务与注册的形状；编译时被抹掉，不产生模块请求 |
| `dsh-widget-board/provider` | 纯值 SDK | 构造并校验入参对象：`defineProvider`、`providerRegistration`、`nativeProviderRegistration`、`sourceRegistration`、`actionRegistration`、`capabilityRegistration`、`marketRegistration`、`nativeRegistration` |

`./provider` 不导入宿主实现、不读全局状态，宿主进程与浏览器页面都能打包同一份入口；它返回的对象都是冻结的，要加字段就展开成新对象。SDK 负责把入参校验在一处做完，与看板通信仍然只经服务。

有类型检查的提供方把本包加进开发依赖，用 `import type { WidgetBoardClientService } from 'dsh-widget-board/service'` 取类型，在自己包里 `declare module '@deepseek-ai/cordis'` 把服务挂到 `Context` 上。没有类型检查的纯 JS 提供方在自己包里写同形的声明。运行时不做值导入，也不为功能包添加 `dsh.client.external`。

## 组件 id 与作者域

组件 id 有两种写法，出现在哪些来源由来源决定：

| 来源 | id 形状 | 谁在用 |
|---|---|---|
| 内置、我的、示例 | 扁平名字，如 `weather` | 本地目录，包括用户手写的组件 |
| 市场 | `<作者域>.<名字>`，如 `acme.weather` | 市场安装的组件 |
| 插件，经 `registerProvider` 的 `registerWidgets` | `<作者域>.<名字>` | 新把手的组件目录 |
| 插件，经旧入口 `registerWidgetType` | 扁平名字 | 既有提供方 |
| 原生组件，经浏览器侧 `registerProvider` | `<作者域>.<名字>` | 新把手的原生组件 |

本地来源里的组件用带点的 id 会在读取时被拒绝，原因写明这类 id 只用于带作者域的来源；旧入口登记带点的原生组件同样抛出，并指出带点的 id 走 `registerProvider`。

已经装在用户目录里的扁平 id 记录不改名，看板上的卡片按 id 解析，照常显示。作者域只决定新目录里每个组件归谁，不触发既有记录迁移。

## 读取与执行的上限

数据源的 `read`、动作的 `run` 与能力的 `call` 走同一套执行器，按提供方记账：

| 项目 | 数值 | 越界时 |
|---|---|---|
| 一次读取或一次动作 | 15 秒 | 对调用方判失败并按超时计数，同时中止提供方 |
| 一次能力调用 | 注册里声明的 `timeoutMs`，1 到 25 秒，缺省 15 秒 | 同上 |
| 同时进行的调用 | 每个提供方 8 个 | 立即返回 `provider-busy`，不排队 |
| 组件、数据源、动作、能力 | 128、64、64、64，各按提供方累计 | 注册处抛出，说明上限与现有数量 |

执行槽在提供方的 promise 真正结束之后才释放：忽略中止信号的提供方不能靠超时多占一个槽。调用方自己的中止信号与超时合成一个信号交给提供方，谁先到都中止它。

三种拒绝带原因码：`provider-timeout` 走 504，`provider-busy` 走 429，`provider-cancelled` 是调用方已经取消。响应里带着原因码与提供方名，卡片按现有的故障显示画出来，看得出是哪个提供方、等了多久。数据不合组件 schema 算提供方的一次失败；失败只记在读取路径上，写回卡片时不再重复计数。

## 健康记录

宿主按提供方记一份健康记录，随工作区快照的 `providers` 发给页面：

| 字段 | 含义 |
|---|---|
| `provider` | 提供方的包名 |
| `features` | 这次注册声明的功能；没有声明时是空数组 |
| `registrations` | 累计成功的注册数：组件目录、数据源、动作、能力、市场各算一项 |
| `failures` | 累计失败的次数，含提供方抛出的异常与不合格的结果 |
| `timeouts` | 累计超时的次数 |
| `available` | 现在有没有活着的注册；全部撤下之后为假 |
| `lastError` | 最近一次失败或超时，形如 `provider-timeout：数据源 weather.now 在 15000 毫秒内没有答完` |

拿到新把手就算可用，但不算一项注册；目录、数据源这些挂上来时各自再记一次。可用性与计数分开记：撤下之后 `available` 变假，计数不清零，重新注册就恢复可用。

设置页的看板那一节列出这张表：每一行写能不能用、声明了哪些功能、累计注册、失败与超时，以及最近一次错误。看板上的卡片照自己的故障显示，一次读取被拒绝只影响那张卡，其余卡片与其余提供方不受影响。

## 停用、卸载与恢复

插件被停用或卸载时，看板按提供方名撤下它留下的一切：

- 组件目录、名下的数据源、动作、能力与市场，随 `dispose` 一起走，组件库随后重读。
- 这个提供方留下的授权一并清掉，装回来之后要重新给一次。
- 目录监视停下，之后这个目录的改动不再触发重读。
- 已经放在看板上的卡片保留，画成不可用的占位并写明原因；它们在快照里仍然存在，属于哪个看板也不变。
- 原生组件撤下时，组件库里的记录还在，那张卡回退到沙箱组件；提供方整体停用或卸载时组件目录一起撤下，卡片显示不可用。

重新启用之后组件、数据源、动作、能力与市场回来，卡片恢复显示；健康记录里的累计计数接着往上走，不因为一次停用清零。

## 兼容表与 requires

看板把版本与功能的判定放在一张表里，写在 [compatibility.ts](../packages/contracts/src/compatibility.ts)：

| 字段 | 含义 |
|---|---|
| `boardVersion` | 看板自己的版本，与根 `package.json` 相同 |
| `serviceApiVersions` | 服务面接受的注册版本，与 `supportedApiVersions` 是同一份 |
| `features` | 服务面提供的功能 |
| `dsh` | 最低 DSH 版本，一条 semver 范围 |

组件 manifest 的 `requires` 与市场索引版本的 `requires` 同形：`serviceApiVersion` 填一个版本，`dsh` 填一条 semver 范围。

- `serviceApiVersion` 不在兼容表的集合里时，这个组件读不出来，原因写明它要的版本与这一侧接受的版本。
- `dsh` 只判范围写得对不对，不拿它与宿主自报的版本比较。
- 市场安装时核对索引里的 `requires` 与包内 manifest 的相同；两边一边写了、一边没写也算不一致。装上之后生效的是包里那一份。

## 迁移规则

### 版本 2 到版本 3

| 项目 | 版本 2 | 版本 3 |
|---|---|---|
| 注册入口 | `registerWidgetType`、`registerDataSource`、`registerAction` | 增加 `registerProvider` 与 `registerCapability` |
| 能力 | 没有 | 组件经 `widget.call` 按名字调用，带参数与结果 schema、权限、凭据与中止信号 |
| 服务与把手的共同成员 | 没有 | `supportedApiVersions`、`features`、`supports()` |

旧入口在版本 3 上继续工作，注册时带 2 或 3 都行。

### 旧入口到新把手

1. 把 `registerWidgetType({ apiVersion, provider, directory })` 换成 `registerProvider({ apiVersion: 3, provider, features })`，再对返回的把手调 `registerWidgets({ directory })`。
2. 把每次 `registerDataSource`、`registerAction`、`registerCapability`、`registerMarketProvider` 换成把手上的同名方法，入参去掉 `apiVersion` 与 `provider`。
3. 把每个返回的释放函数收进同一个 `dispose()`：卸载时调把手的 `dispose()`，不必自己逐项释放。
4. 浏览器侧把 `registerWidgetType({ apiVersion, provider, id, component })` 换成 `registerProvider` 加 `registerNativeWidget({ id, component })`，并给 `id` 补上作者域。

同一侧不能同时占两条路，所以要把旧入口的注册全部释放之后才能启用新把手。迁移按提供方各自安排：旧入口继续接受它所属的版本，没有统一的期限，不同提供方可以停在不同阶段。

### 组件目录到作者域

新把手挂的目录、市场来源的目录与浏览器侧的原生组件都用 `<作者域>.<名字>`。既有提供方继续经旧入口挂扁平 id 的目录，已经装好的组件不改名，卡片照常解析。改到新把手的目录里，每个组件的 id 要一起改成带作者域的形式，manifest 与看板上的记录按新 id 重新读。

### 服务面升到下一个主版本

新增方法或可选字段不升主版本：这类变化落在当前主版本里，既有提供方不改注册版本就能继续工作。

主版本只在移除一个旧方法、或改变一个既有方法或字段的语义时增加。这时升 `WIDGET_BOARD_API_VERSION`，同时改 `WIDGET_BOARD_PROVIDER_API_VERSION` 与 `WIDGET_BOARD_SUPPORTED_API_VERSIONS`，差异按现有写法记进 `service.ts` 的版本注释。新入口只认最新的主版本，旧入口按集合接受的版本继续工作；因此升到 4 的提供方只能从 `registerProvider` 进来。

弃用期按主版本算，一次完整的过程分三段：

1. 在某个主版本里把一个方法标上弃用，记进 `service.ts` 的版本注释，写明替代它的方法与新位置，例如 `registerWidgetType` 换成把手上的 `registerWidgets`。
2. 这个主版本之内，旧入口继续接受它、按原样工作，既有提供方不动代码；集合里保留它所属的版本。
3. 至少到下一个主版本才移除。移除之后旧入口不再接受它，调用处抛出的错误写出替代方法与新位置；只报版本不符指不出该改哪一行。

标弃用的时点与移除的时点各记在版本注释里，与那一次的版本差异写在同一处。
