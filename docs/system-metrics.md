# 运行成本

内置组件 `system-metrics`（「运行成本」）报告可测量的宿主与看板成本，并写明不可测量的部分。数据源在宿主半边（`packages/host/src/system-metrics.ts`），组件在 `packages/widgets/system-metrics/`；宿主接入面的核实结论见 [host-surfaces.md](host-surfaces.md)。

## 数据源

名字是 `widget-board:system.metrics`，由本插件在宿主启动时注册，不声明权限：它只读宿主自己的内存、工作区与组件库（D6）。组件 manifest 里声明了默认数据源与 `refresh: { "mode": "interval", "everyMs": 5000 }`，刷新走宿主唯一的调度器，没有观众时不读（D6）。

```ts
interface SystemMetrics {
  sampledAt: string
  host: {
    rss: number
    heapUsed: number
    heapTotal: number
    external: number
    arrayBuffers: number
  }
  board: {
    cards: number
    boards: number
    stateBytes: number
    documentsBytes: number
  }
  library: {
    widgets: number
    versions: number
  }
}
```

所有字节数都按字节给；组件按当前语言格式化成 B、KB、MB、GiB（1 KB = 1024 字节），数值与单位分开排。

## 指标

| 指标 | 来源 | 范围与可信度 |
|---|---|---|
| `host.rss`、`heapUsed`、`heapTotal`、`external`、`arrayBuffers` | 宿主进程的 `process.memoryUsage()` | 整个宿主进程，包含会话、其他插件与看板以外的工作。不含浏览器页面、渲染进程与 GPU。 |
| `board.cards`、`board.boards` | 宿主的工作区快照 | 精确：每张卡片是一个 iframe，翻面组按两个实例算。 |
| `board.stateBytes` | 各实例 `state` 的 JSON 序列化长度，复用 D23 写入额度里的同一份 `stateBytes` | 精确：与宿主判定 64 KB 单卡额度时读的是同一份数据。 |
| `board.documentsBytes` | `buildDocument` 按每张卡的当前组件版本拼出的 HTML 字节数，加上令牌、套件、运行时与精选库 | 近似：按中文界面拼装、省略 nonce，实际请求因语言与 nonce 有几字节到几百字节的差；同一版本被多张卡使用时按张数累加，因为每张卡各自加载一份文档。 |
| `library.widgets` | 组件库里可用的组件数 | 精确。 |
| `library.versions` | 版本库 `blobs/` 下的版本文件数 | 精确：磁盘上留着的版本，含旧版本。 |
| 单张卡片的内存 | 没有受支持的接口 | 拿不到。卡片上写明「单张卡片的内存无法从宿主侧测量」。 |
| 浏览器页面 JS 堆 | Chromium 的 `performance.memory` | 页面级近似，沙箱卡片读不到父页面，不进入数据。 |
| 渲染进程与 GPU 内存 | Electron 进程不向插件暴露 | 拿不到。卡片上写明这一句。 |

## 刷新、历史与暂停

- 采样在宿主侧完成，组件只画。组件自己不设定时器。
- 调度器只在有观众时按 5 秒读一次；关闭全部看板页之后停止（D6）。
- 组件在 `state.samples` 里留最近 60 个 `{ at, rss }`，每次追加后裁掉最旧的。60 个采样约 2 KB，远低于 64 KB 的单卡额度（D23）。
- 卡片离开视口时父页面发 `pause`，页面隐藏时 iframe 自己的 `visibilityState` 变 `hidden`。两种情况都停止绘制与状态写入；恢复时用最后一份数据重画一次，下一份采样到来时继续追加。
- 组件库的缩略画面（`placement: preview`）画一份固定样例，标为「示例数据」，不读宿主状态也不写状态。

## 卡片文案

| 位置 | 中文 | English |
|---|---|---|
| 标题 | 运行成本 | Running cost |
| 范围标签 | 整个宿主进程 | Whole host process |
| 主读数说明 | 宿主进程常驻内存 · 含看板以外的工作 | Host process RSS · includes work outside the board |
| 采样时间 | 采样于 {time} | Sampled at {time} |
| 分项 | 堆、外部内存、ArrayBuffer | Heap, External, ArrayBuffer |
| 次读 | 卡片（{boards} 块看板）、状态总量、文档体积、组件库 | Cards ({boards} boards), Card state, Documents, Library |
| 组件库读数 | {widgets} 类 · {versions} 版本 | {widgets} types · {versions} versions |
| 走势 | 最近 {n} 次采样 | Last {n} samples |
| 空态 | 等待第一次采样 | Waiting for the first sample |
| 不可测 | 单张卡片的内存无法从宿主侧测量 | Per-card memory cannot be measured from the host |
| 边界 | 渲染进程与 GPU 内存不向插件开放；每张卡片是一份独立文档与一个 iframe | Renderer and GPU memory are not exposed to plugins; each card is its own document and iframe |
| 预览 | 示例数据 | Sample data |

## 核实结论

1. **进程结构**：宿主半边由宿主加载器在自己的 Node 进程里 `apply`，注册路由、读写看板；浏览器半边由宿主页面加载，组件在 `sandbox="allow-scripts"` 的 iframe 里运行（D1、D3）。因此 `process.memoryUsage()` 覆盖的是 DSH 宿主进程，包含看板以外的工作；桌面壳与服务端形态下都是同一个宿主进程，差别只在谁托管它。浏览器页面、渲染进程与 GPU 不在这个读数里。在真实临时宿主里没有登录也能读到这份数据，因为数据源不碰账号。
2. **状态总量**：宿主原先只有写入额度在比对单卡与整板状态，没有可读的总量。这里把 `state.ts` 的 `stateBytes` 导出复用，作为唯一一份序列化规则；5 秒对几十张卡各序列化一次的成本可接受。本机量到 60 张卡、每张约 1.7 KB 状态时，一次求和约 0.19 毫秒、序列化约 101 KB；相对 5 秒的间隔可以忽略。
3. **文档体积**：现有拼装路径 `buildDocument` 能直接拿到一份文档的完整 HTML，资产来自 `live.assets`，不需要在构建时另记一份。数据源按组件内容哈希缓存尺寸，资产换新（组件库重读或运行时重载）时清空缓存；第一次采样之后，同版本只拼一次。

## 边界

- 不报告渲染进程、GPU、单张卡片的内存，不调用 Electron 私有接口。
- 不读宿主的 `/api` 路由，不做任意的 `process` 访问；数据由宿主半边的数据源提供，组件只拿到上面的结构。
- 不设告警阈值：不同机器与不同宿主负载的基线不同，固定数字会误导；卡片只给事实与走势（沿用 issue #5 的范围）。
- 组件库与看板本身的开销算在卡片里：`board.documentsBytes` 含每一张卡的文档与内联运行时，次读里同时给出卡片数。

## 在真实宿主上核对

- 临时宿主（0.2.1-rc.2，独立的 `$DSH_HOME`，没有登录与会话）里卡片进入 `ready`，读到宿主进程的常驻、堆、外部内存与 ArrayBuffer；次读给出卡片数、状态总量、文档体积与组件库计数。
- 浅色中文与深色英文各核对一次：默认 2×18rem、1×12rem 与 2×30rem 三个盒子都没有溢出或截断；高盒子里走势出现，窄盒子里次读收起。
- 卡片移出视口后根节点带 `data-paused`，7 秒内状态里的采样数不变；页面隐藏（iframe 的 `visibilityState` 为 `hidden`）同样不变，恢复后继续增长。2 到 4 个采样时状态是 113 到 213 字节，60 个采样由单元测试核对低于 64 KB。
- 单元测试与尺寸矩阵都是可重复的检查；这一段记的是 issue #5 的验收核对，命令见下一节。

## 检查

- 单元测试：`packages/host/test/system-metrics.test.ts` 核对计数、状态字节、文档体积与组件 manifest 的 data schema；`packages/widgets/test/system-metrics-view.test.ts` 覆盖字节格式化、历史裁剪、空态与走势路径。
- 尺寸矩阵：`npm run matrix` 把组件放进一列、两列、四列与 6 到 30rem 的高度，检查溢出、截断、空白与脚本错误。
- 真实宿主：`npm run smoke` 在临时宿主里打开看板。
