# 会话实时用量

内置数据源 `widget-board:session.usage` 报告这台机器上各会话消耗的 token：所选会话、本地当天与全部三个窗口的合计，加最近一次调用与最近 30 个点。`session` 窗口只覆盖插件启动之后的实时事件；`today` 与 `all` 另外合并 `dsh-usage` 启动前折好的历史合计。按天折会话日志的历史汇总仍由用量能力 `widget-board:usage` 负责，三者在同一个 `registerUsage` 里建立、在同一个释放函数里撤下。服务名、事件名与读到的形状登记在 `packages/contracts/src/host.ts`，核实结论见本文的「实时事件的核实结论」一节。

插件可能在宿主绑上端口之前启动，那一次历史读会失败；`today` 与 `all` 因此可以在后续的读里补读，最多三次尝试（含注册时那一次）。补读成功时实时起点移到读完之后、这之间的实时累计整份清空，两段来源仍然不重复计数。

## 数据来源

宿主广播的 `session/event`：每条追加进会话日志的事件都交给订阅者。数据源只取 `type` 为 `assistant/message` 且 `data.usage` 存在的那一种——一次模型调用的 token 结算（`TokenUsage`：`inputTokens`、`outputTokens`，可选的 `totalTokens`、`cacheReadTokens`、`cacheWriteTokens`、`reasoningTokens`）。

订阅一次并带 `{ global: true }`：宿主按作用域筛选分发，不带这一项时只收到本上下文进入过的会话。看板所有页面共用这一个订阅，拆除时退订。

`sessions` 服务只用来判断有没有活着的会话：`list()` 回此刻活着的会话，每个只取 `id`。数据源不调 `eventAt`、`snapshotEvents` 与 `ownEvents`，不扫会话日志，不读消息正文、工具结果与会话标题。

### 启动前的历史

`dsh-usage` 的 `/api/dsh-usage/overview`：一条 exact 路由，只取 `usage.today`（当天的 `date` 与 `totals`）与全部保留窗口。协议由对方的 `UsageOverviewView` 定，本插件只读它。根地址取自宿主 web 服务的 `getOrigin()`（`HostWebServer` 的可选方法）：它在端口绑定之前抛出，拿不到根地址时不发请求，历史记为 `unavailable`。

全部保留窗口的读取依次退：先看 `usage.all`，没有就退回 `usage.range`，两者都没有时按 `usage.days` 求和，边界取其中最早与最晚的那一天。合计按 `inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens` 算，`calls` 原样取；`reasoningTokens` 与宿主自己折的 `cost` 都不读。`capturedAt` 取 `updatedAt`，`from` 与 `to` 取所选窗口的边界：`today` 用 `usage.today.date`，`all` 用 `all`、`range` 或 `days` 的边界。

历史那一份只有两份合计与它们的边界：会话 id、最近调用与逐点趋势都不来自历史，`recent` 与 `trend` 仍只来自实时事件。

## 数据契约

```ts
SessionUsageSnapshot = {
  available: boolean,
  reason: string | null,
  startedAt: number,
  scope: "session" | "today" | "all",
  date: string,
  session: string | null,
  empty: "no-sessions" | "no-usage" | null,
  totals: null | {
    input: number, output: number, cacheRead: number, cacheWrite: number,
    total: number, calls: number, estimated: boolean
  },
  recent: null | {
    at: number, session: string | null,
    input: number, output: number, total: number, estimated: boolean
  },
  trend: Array<{ at: number, value: number }>,
  history: null | {
    source: "dsh-usage",
    available: boolean,
    reason: "not-installed" | "unavailable" | "invalid" | null,
    capturedAt: number | null,
    from: string | null,
    to: string | null
  }
}
```

`history` 可以缺省，旧样例因此仍读得通；宿主总是写入。`scope` 为 `session` 时它永远是 `null`，不合并任何历史；`today` 与 `all` 时它总是对象，用来说明历史这一路的状态。这个对象没有额外字段；`available` 为 `true` 时 `capturedAt` 是有限非负时间戳，`from` 与 `to` 是 `YYYY-MM-DD` 或 `null`。其余字段全部必需，对象都没有额外字段；`trend` 最多 30 项，按时间从旧到新。

## 统计口径

| 窗口 | 选中范围 | `session` 字段 | 说明 |
|---|---|---|---|
| `session`（默认） | 一个会话 | 该会话 id 的前 8 位 | `props.session` 写了完整 id 时固定这个会话；没写时取最近有带用量调用的那个会话。只用实时事件 |
| `today` | 宿主本地时区的当天 | `null` | 按每次调用的本地日期分桶，读取时取当天那一个桶，再并入历史当天的合计 |
| `all` | 本次启动以来，并入全部保留窗口 | `null` | 全部会话的实时合计，再并入历史那份全部保留窗口的合计 |

- 一次调用的规范化总量：宿主的 `usage.totalTokens` 存在时用它，缺了按 `inputTokens + outputTokens` 推算，并把这一次记为推算。`totals.total` 是窗口内规范化总量的和，`totals.estimated` 表示窗口里有没有任何一次是推算的，`recent.estimated` 只描述最新那一次。
- `input`、`output`、`cacheRead`、`cacheWrite` 是四个互不重叠的分桶，缺的字段按 0 记。`reasoningTokens` 不另立分桶：按 issue 的计数口径，合计只看这四个分桶。
- `recent` 是所选窗口里 `at` 最新的一次调用，同一毫秒里的两次按到达次序取后者；`trend` 是同一窗口最近 30 次，按 `at` 从旧到新，超过上限时丢掉最旧的那一端。
- 事件按会话日志的次序到达，时间可能比已经收下的更早：合计按次相加，`recent`、`trend` 与「最近的会话」按 `at` 判定，同一毫秒才比到达次序。
- 跨零点不需要定时器：`date` 与 `today` 每读一次按当时的本地日期算，写入时按事件的本地日期分桶。本地日期的算法只有一份，在 `packages/host/src/local-date.ts`，按天折日志的用量能力与这里的实时聚合都调它；时刻无效（算不出日期）的事件在写任何累计之前被跳过。

## 合并的口径

| 情形 | `totals` | `recent` | `trend` | `empty` |
|---|---|---|---|---|
| 历史可用，两边都有调用（today、all） | 历史与实时相加 | 实时最新那一次 | 实时最近 30 次 | `null` |
| 历史可用，只有历史有调用 | 历史那一份 | `null` | `[]` | `null` |
| 历史可用，只有实时有调用 | 实时那一份 | 实时最新那一次 | 实时最近 30 次 | `null` |
| 历史不可用 | 实时那一份 | 实时最新那一次 | 实时最近 30 次 | 按实时判 |

- `estimated` 是两边有没有推算的或：历史那份按四个分桶相加，永远是精确的，所以它只反映实时这一边。
- `sessions.list()` 为空时，`today` 与 `all` 只要历史里有调用就照旧显示合计；历史也没有调用才判 `no-sessions`。`session` 窗口没有这条退路，它只用实时事件。
- 历史不可用时不虚构零值：实时那一份与空态按原样给出，`history.reason` 区分没装、读不到与形状不合格。

## 失败分类

| 情形 | `history.reason` |
|---|---|
| 根地址拿不到、网络失败、超时、401 与 404 之外的 HTTP 失败（含 403） | `unavailable` |
| 路由不存在（404），或这个地址上的兜底鉴权先答 401：这个部署没装 `dsh-usage` | `not-installed` |
| 正文不是 JSON、缺 `usage.today` 或 `updatedAt`、分桶不是非负数字、`all`/`range`/`days` 都不成形状 | `invalid` |

401 归到没装，依据是 `dsh-usage` 自己的放行规则：它的 overview 对 loopback 请求一律放行，装上之后不会对这个地址答 401。没装时先说话的是宿主自己的兜底鉴权——插件内部发起的请求没有页面 token，得到 401，带页面 token 的同一地址得到 404。两者是同一件事的两种答法，所以都记为 `not-installed`。这条判定依赖 `dsh-usage` 的 loopback 语义：换一个对 loopback 也要求鉴权的部署，401 同样会落在这一栏，而那时它的含义是「被拒绝」。

每一种都只隔离历史这一层：实时订阅照旧建立，卡片上的合计退回实时那一份。读取的等待上限是 2 秒，等不到按 `unavailable` 记，启动不会停在一次网络请求上。

`not-installed` 与 `unavailable` 都是「这一趟没读到」：启动竞态让根地址暂时拿不到时也是这样，没装时的 401 会随着插件装上而变成真实读数，所以这两类会按下面的规则补读。`invalid` 不补读——同一份形状不合格的文档再读一次还是同一个结果。每次补读都重新取一次根地址，宿主绑上端口之后的那一次因此能成功。

## 起点与先后

`startedAt` 是这次注册实时订阅的时刻，也是实时累计的起点。注册先读历史快照，再订阅 `session/event`：`startedAt` 因此落在历史快照之后，两段来源不重叠，同一段用量不会被两边各算一次。`session` 窗口从 `startedAt` 之后才开始，`today` 与 `all` 的合计是历史那一份加大这之后的实时那一份。补读成功时 `startedAt` 会移到读完之后，它描述的始终是当前账本这一段。

## 启动竞态与有界重读

宿主绑上端口之前 `getOrigin()` 抛出，那一刻读不到历史与「这个部署读不到」在读数上都是 `unavailable`。只读一次会让这个竞态永久留在一个错误的分类上，所以 `today` 与 `all` 的读可以补读：

| 项目 | 规则 |
|---|---|
| 谁补读 | 只有 `scope` 为 `today` 或 `all` 的读；`session` 窗口不合并历史，从不补读 |
| 什么时候补 | 当前历史不可用，且 `reason` 不是 `invalid` |
| 最多几次 | 三次，含注册时那一次，也就是最多两次补读；到上限就停，不再尝试 |
| 并发 | 同一个补读同时只跑一次；同时到达的读等它回来，不各自发起 |
| 成功 | 先把 `startedAt` 移到读完成之后的当下，再清空 `sessions`、`recent`、`days` 与到达次序（含每个会话的序号水位），然后按新的历史继续 |
| 失败 | 只换掉 `history` 与它的 `reason`，`startedAt` 与实时账本都不动 |

补读成功时清空实时账本是有意的：订阅建立之后、补读完成之前收到的那些事件都落在这份历史的覆盖范围里，与新历史相加会算两次。起点先移到当下、再清空账本，重定之后到达的事件才都算在新的一段里，序号水位也从零开始。

补读不保证成功：宿主一直不给根地址、或 `dsh-usage` 一直答不出来时，历史停在 `unavailable`，卡片照旧显示实时那一段，原因写在读数里。

## 去重

每个会话记一个序号水位：`event.seq` 在会话内单调，重复投递的同一条事件（序号不大于水位）直接跳过。水位按会话分开，所以不同会话里相同的序号各算一次。历史快照不进水位：它与实时事件的重叠由「先读历史、再订阅」与「补读成功就清空账本」两点挡住。

## 空态

判定次序固定：

1. `sessions` 服务缺席：`available: false`、`reason: "sessions-unavailable"`、`empty` 与 `totals`、`recent` 为 `null`、`trend` 是空数组。数据源照旧注册着，卡片据此画「会话服务不可用」；`today` 与 `all` 仍带出 `history`。
2. 没有活着的会话：`empty: "no-sessions"`，`session` 与 `totals` 同样是 `null`。`today` 与 `all` 例外——历史里有调用时照旧给合计，`recent` 为 `null`、`trend` 是空数组。
3. 所选窗口里既没有历史调用也没有带用量的实时调用：`empty: "no-usage"`，`totals` 为 `null`。

三种空态都不用零值冒充合计：零次调用与「调用了但没有报用量」在卡片上是两件事。

## 隐私

- 快照里只出现会话 id 的前 8 位；完整 id 只用于匹配 `props.session`，不进任何返回字段。
- 读事件时只看 `type`、`seq`、`time` 与 `data.usage`：消息正文、工具结果、会话标题都不读，也不进内存。
- 读 overview 时只看 `updatedAt` 与 `usage` 里的合计与边界：会话 id、最近调用与逐点趋势都不取，凭据与服务商信息也不读。
- 数据源不声明额外权限：它只读宿主自己的会话事件、活着的会话列表与 `dsh-usage` 的用量总览，与用量能力同一档（D6、D24）。

## 不可得的部分

- 插件启动之前的历史：`today` 与 `all` 由 `dsh-usage` 的启动前快照补上；没装、读不到或形状不合格时这一段仍然缺席，卡片上写明原因。补读到上限仍未成功时同样缺席——补读只增加机会，不保证成功。`session` 窗口始终只有实时数字。
- 已结束的会话：`sessions.list()` 只回活着的会话，所以会话列表为空时 `session` 窗口判成 `no-sessions`，即便内存里还留着刚才的累计。`today` 与 `all` 的合计与这份列表无关。
- 适配器没有报用量的调用：不计数，也不进趋势。
- 别的宿主机上的用量：只统计本机宿主进程收到的会话事件，历史只统计 `dsh-usage` 自己保留的那一段。
- 逐会话的历史：`dsh-usage` 的 overview 只给按天的合计与按提供方的行，没有逐会话的分桶，所以 `session` 窗口不合并历史。

## 实时事件的核实结论

- 事件签名是 `(session: Session, event: SessionEvent)`，按作用域筛选分发，`{ global: true }` 的监听器绕过筛选（`packages/core/scope/README.md` 与宿主 `packages/core/session/src/index.ts` 里 `session/event` 的声明）。
- `SessionEvent` 带 `type`、`seq`（会话内单调序号）、`time`（Unix 毫秒）与 `data`；`assistant/message` 的 `data.usage` 是 `TokenUsage`，适配器没有报告时整项缺席（宿主 `packages/core/session/src/types.ts` 与 `packages/llm/llm/src/types.ts`）。
- `SessionStore.list()` 回的是活着的会话，按创建次序，每次给一个新数组（宿主 `packages/core/session/src/index.ts`）。
- 这三条按宿主的类型声明与实现核对过：`HOST_SESSIONS_SERVICE`、`HOST_SESSION_EVENT`、`sessionsOf` 与 `onSessionEvent` 把名字与读取形状登记在 `packages/contracts/src/host.ts`。订阅是实时用量的必需项：上下文没有 `on`、或 `on` 不给退订函数时，在注册处抛出带原因的错误（D11）。真实宿主里的端到端观察属于集成验收，尚未由本任务的测试覆盖。
- `/api/dsh-usage/overview` 的形状按 `dsh-usage` 的 `UsageOverviewView` 核对：`updatedAt`、`usage.today`、`usage.days`、`usage.range`、`usage.all` 都在，路由本身是 `kind: 'exact'` 且回环请求放行。`ctx.webServer.getOrigin()` 在端口绑定之前抛出，这一条按宿主的 `dsh-host-webserver` 声明核对。

## 内存，不落盘

累计留在宿主进程的内存里：每个会话一份合计与最近 30 个点、每个本地自然日一份合计与最近 30 个点、全局最近 30 个点、一个每会话的序号水位，加启动时取到、必要时补读到的历史合计。没有持久化，也没有把大数组写进卡片的状态：

- 这份数据只描述本次运行，`startedAt` 是它的坐标；落盘之后重启再读回一段旧累计，与 `startedAt` 的含义冲突。
- 历史用量已经有按天缓存在磁盘上的那一份（`usage-cache.json`），两处各存一份会让「今天用了多少」出现两个来源。
- 卡片状态受 64 KB 额度约束（D23），趋势与合计留在宿主侧，卡片只拿到这一份快照。

## 单卡可见性刷新

数据源不往卡片推数据、不给自己设定时器：刷新的时机由看板已有的通用链路决定——组件 manifest 声明刷新策略，宿主唯一的调度器只在有人看着时按间隔读，卡片离开视口后暂停、回到视口时恢复并补读一次。数据源每次被读到就按当下的账本算一份新快照，所以暂停期间不丢数据，恢复时的读数已经包含期间的调用。历史那一份同样只在读的时候取：注册时那一次，加上按上面规则最多两次补读。

## 检查

- 单元测试：`packages/host/test/session-usage.test.ts` 覆盖三个窗口、指定会话、缺失 `totalTokens` 的推算、缓存分桶、30 点上限、序号去重、乱序时间与同一毫秒下的新旧判定、算不出本地日期的时间被跳过、三种空态、非用量事件的忽略、id 前缀，历史合并的七种情形（两边都有调用、只有历史、只有实时、历史不可用、没有活着的会话、历史快照先于订阅、输出的来源元数据），以及有界重读的六种情形（补读成功重定起点并清空、`not-installed` 会补读、`invalid` 不再试、三次上限、并发只跑一次、可用时与 `session` 窗口从不补读）。
- 历史读取的单元测试：`packages/host/test/dsh-usage.test.ts` 覆盖 `usage.today` 与 `usage.all` 的字段映射、all 退回 range、再退回 days 求和、401 与 404 记为没装、403 等其它 HTTP 与网络失败记为读不到、形状不合格记为 `invalid`、根地址的三种来路，以及输出那份来源元数据的字段。
- 宿主接入面契约测试：`packages/testing/test/host-surfaces.test.ts` 核对服务名、事件名、服务缺席时的读数、订阅参数 `{ global: true }` 与退订，以及缺少事件接口或退订函数时的抛出。
- 聚焦命令：`npx vitest run packages/host/test/dsh-usage.test.ts packages/host/test/session-usage.test.ts packages/testing/test/host-surfaces.test.ts`。

## 边界

- 不做跨进程或跨机器的用量汇总；除 `dsh-usage` 的 overview 之外不读任何 `/api` 路由，也不读宿主的会话日志做实时累计。
- 不统计未报用量的调用，不估算模型侧的 token。
- 卡片拿到的只有这份快照；会话标题、消息正文与工具结果都不出宿主。
