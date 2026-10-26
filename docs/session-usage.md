# 会话实时用量

内置数据源 `widget-board:session.usage` 报告「从插件启动起」这台机器上各会话消耗的 token：所选会话、本地当天与全部三个窗口的合计，加最近一次调用与最近 30 个点。按天折会话日志的历史汇总仍由用量能力 `widget-board:usage` 负责，两者在同一个 `registerUsage` 里建立、在同一个释放函数里撤下。服务名、事件名与读到的形状登记在 `packages/contracts/src/host.ts`，核实结论见本文的「实时事件的核实结论」一节。

## 数据来源

宿主广播的 `session/event`：每条追加进会话日志的事件都交给订阅者。数据源只取 `type` 为 `assistant/message` 且 `data.usage` 存在的那一种——一次模型调用的 token 结算（`TokenUsage`：`inputTokens`、`outputTokens`，可选的 `totalTokens`、`cacheReadTokens`、`cacheWriteTokens`、`reasoningTokens`）。

订阅一次并带 `{ global: true }`：宿主按作用域筛选分发，不带这一项时只收到本上下文进入过的会话。看板所有页面共用这一个订阅，拆除时退订。

`sessions` 服务只用来判断有没有活着的会话：`list()` 回此刻活着的会话，每个只取 `id`。数据源不调 `eventAt`、`snapshotEvents` 与 `ownEvents`，不扫会话日志，不读消息正文、工具结果与会话标题。

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
  trend: Array<{ at: number, value: number }>
}
```

字段全部必需，对象都没有额外字段；`trend` 最多 30 项，按时间从旧到新。

## 统计口径

| 窗口 | 选中范围 | `session` 字段 | 说明 |
|---|---|---|---|
| `session`（默认） | 一个会话 | 该会话 id 的前 8 位 | `props.session` 写了完整 id 时固定这个会话；没写时取最近有带用量调用的那个会话 |
| `today` | 宿主本地时区的当天 | `null` | 按每次调用的本地日期分桶，读取时取当天那一个桶 |
| `all` | 本次启动以来 | `null` | 全部会话的合计 |

- 一次调用的规范化总量：宿主的 `usage.totalTokens` 存在时用它，缺了按 `inputTokens + outputTokens` 推算，并把这一次记为推算。`totals.total` 是窗口内规范化总量的和，`totals.estimated` 表示窗口里有没有任何一次是推算的，`recent.estimated` 只描述最新那一次。
- `input`、`output`、`cacheRead`、`cacheWrite` 是四个互不重叠的分桶，缺的字段按 0 记。`reasoningTokens` 不另立分桶：按 issue 的计数口径，合计只看这四个分桶。
- `recent` 是所选窗口里 `at` 最新的一次调用，同一毫秒里的两次按到达次序取后者；`trend` 是同一窗口最近 30 次，按 `at` 从旧到新，超过上限时丢掉最旧的那一端。
- 事件按会话日志的次序到达，时间可能比已经收下的更早：合计按次相加，`recent`、`trend` 与「最近的会话」按 `at` 判定，同一毫秒才比到达次序。
- 跨零点不需要定时器：`date` 与 `today` 每读一次按当时的本地日期算，写入时按事件的本地日期分桶。本地日期的算法只有一份，在 `packages/host/src/local-date.ts`，按天折日志的用量能力与这里的实时聚合都调它；时刻无效（算不出日期）的事件在写任何累计之前被跳过。

## 起点

`startedAt` 是这次注册实时订阅的时刻，也是累计的起点。订阅之前发生的事件一概不计，也不回头读日志：那一段由用量能力按天折出来。`today` 与 `all` 都只覆盖 `startedAt` 之后的事件，所以宿主刚启动时两者的数字相同，跨过零点之后才分开。

## 去重

每个会话记一个序号水位：`event.seq` 在会话内单调，重复投递的同一条事件（序号不大于水位）直接跳过。水位按会话分开，所以不同会话里相同的序号各算一次。

## 空态

判定次序固定：

1. `sessions` 服务缺席：`available: false`、`reason: "sessions-unavailable"`、`empty` 与 `totals`、`recent` 为 `null`、`trend` 是空数组。数据源照旧注册着，卡片据此画「会话服务不可用」。
2. `sessions.list()` 为空：`empty: "no-sessions"`，`session` 与 `totals` 同样是 `null`。
3. 有会话，但所选窗口里没有带用量的调用：`empty: "no-usage"`，`totals` 为 `null`。

两种空态都不用零值冒充合计：零次调用与「调用了但没有报用量」在卡片上是两件事。

## 隐私

- 快照里只出现会话 id 的前 8 位；完整 id 只用于匹配 `props.session`，不进任何返回字段。
- 读事件时只看 `type`、`seq`、`time` 与 `data.usage`：消息正文、工具结果、会话标题都不读，也不进内存。
- 数据源不声明额外权限：它只读宿主自己的会话事件与活着的会话列表，与用量能力同一档（D6、D24）。

## 不可得的部分

- 插件启动之前的历史：这部分在会话日志里，由用量能力的按天汇总给出，实时数据源不补。
- 已结束的会话：`sessions.list()` 只回活着的会话，所以会话列表为空时那一份快照判成 `no-sessions`，即便内存里还留着刚才的累计。这样卡片上的「有没有会话」与宿主一致。
- 适配器没有报用量的调用：不计数，也不进趋势。
- 别的宿主机上的用量：只统计本机宿主进程收到的会话事件。

## 实时事件的核实结论

- 事件签名是 `(session: Session, event: SessionEvent)`，按作用域筛选分发，`{ global: true }` 的监听器绕过筛选（`packages/core/scope/README.md` 与宿主 `packages/core/session/src/index.ts` 里 `session/event` 的声明）。
- `SessionEvent` 带 `type`、`seq`（会话内单调序号）、`time`（Unix 毫秒）与 `data`；`assistant/message` 的 `data.usage` 是 `TokenUsage`，适配器没有报告时整项缺席（宿主 `packages/core/session/src/types.ts` 与 `packages/llm/llm/src/types.ts`）。
- `SessionStore.list()` 回的是活着的会话，按创建次序，每次给一个新数组（宿主 `packages/core/session/src/index.ts`）。
- 这三条按宿主的类型声明与实现核对过：`HOST_SESSIONS_SERVICE`、`HOST_SESSION_EVENT`、`sessionsOf` 与 `onSessionEvent` 把名字与读取形状登记在 `packages/contracts/src/host.ts`。订阅是实时用量的必需项：上下文没有 `on`、或 `on` 不给退订函数时，在注册处抛出带原因的错误（D11）。真实宿主里的端到端观察属于集成验收，尚未由本任务的测试覆盖。

## 内存，不落盘

累计留在宿主进程的内存里：每个会话一份合计与最近 30 个点、每个本地自然日一份合计与最近 30 个点、全局最近 30 个点，还有一个每会话的序号水位。没有持久化，也没有把大数组写进卡片的状态：

- 这份数据只描述本次运行，`startedAt` 是它的坐标；落盘之后重启再读回一段旧累计，与 `startedAt` 的含义冲突。
- 历史用量已经有按天缓存在磁盘上的那一份（`usage-cache.json`），两处各存一份会让「今天用了多少」出现两个来源。
- 卡片状态受 64 KB 额度约束（D23），趋势与合计留在宿主侧，卡片只拿到这一份快照。

## 单卡可见性刷新

数据源不往卡片推数据、不给自己设定时器：刷新的时机由看板已有的通用链路决定——组件 manifest 声明刷新策略，宿主唯一的调度器只在有人看着时按间隔读，卡片离开视口后暂停、回到视口时恢复并补读一次。数据源每次被读到就按当下的账本算一份新快照，所以暂停期间不丢数据，恢复时的读数已经包含期间的调用。

## 检查

- 单元测试：`packages/host/test/session-usage.test.ts` 覆盖三个窗口、指定会话、缺失 `totalTokens` 的推算、缓存分桶、30 点上限、序号去重、乱序时间与同一毫秒下的新旧判定、算不出本地日期的时间被跳过、三种空态、非用量事件的忽略与 id 前缀。
- 宿主接入面契约测试：`packages/testing/test/host-surfaces.test.ts` 核对服务名、事件名、服务缺席时的读数、订阅参数 `{ global: true }` 与退订，以及缺少事件接口或退订函数时的抛出。
- 聚焦命令：`npx vitest run packages/host/test/session-usage.test.ts packages/testing/test/host-surfaces.test.ts`。

## 边界

- 不做跨进程或跨机器的用量汇总，不读宿主的 `/api` 路由。
- 不统计未报用量的调用，不估算模型侧的 token。
- 卡片拿到的只有这份快照；会话标题、消息正文与工具结果都不出宿主。
