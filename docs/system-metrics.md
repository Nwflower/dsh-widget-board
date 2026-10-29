# 运行成本

内置组件 `system-metrics`（「运行成本」）报告宿主进程、整台机器与看板自身的可测量成本。单张卡片、渲染进程与 GPU 的内存不可测，这些数字不进入数据，卡片上也不画。数据源在宿主半边（`packages/host/src/system-metrics.ts`），组件在 `packages/widgets/system-metrics/`；宿主接入面的核实结论见 [host-surfaces.md](host-surfaces.md)。

## 数据源

名字是 `widget-board:system.metrics`，由本插件在宿主启动时注册，不声明权限：它只读宿主自己的内存、机器读数、工作区与组件库（D6）。数据源声明了 `subscribe`：卡片可见时宿主订上，`subscribe` 立刻读一次、之后每 5 秒读一次；manifest 不写刷新策略，这张卡因此不进定时刷新链（D32）。

```ts
interface SystemMetrics {
  sampledAt: string
  readMs: number
  host: {
    rss: number
    heapUsed: number
    heapTotal: number
    external: number
    arrayBuffers: number
  }
  system: {
    platform: string
    cpus: number
    loadAverage: number | null
    totalMemory: number
    freeMemory: number
    disk: { available: number, total: number } | null
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

所有字节数都按字节给；组件按当前语言格式化成 B、KB、MB、GiB（1 KB = 1024 字节），数值与单位分开排。`loadAverage` 在 Windows 上是 `null`，`disk` 读不出来时是 `null`；两者在卡片上都有可见的说法。

## 指标

| 指标 | 来源 | 范围与可信度 |
|---|---|---|
| `host.rss`、`heapUsed`、`heapTotal`、`external`、`arrayBuffers` | 宿主进程的 `process.memoryUsage()` | 整个宿主进程，包含会话、其他插件与看板以外的工作。不含浏览器页面、渲染进程与 GPU。 |
| `system.totalMemory`、`freeMemory` | `node:os` 的 `totalmem()`、`freemem()` | 整台机器的物理内存；已用是总量减空闲。 |
| `system.cpus` | `node:os` 的 `cpus().length` | 逻辑处理器数。 |
| `system.loadAverage` | `node:os` 的 `loadavg()[0]` | 一分钟平均负载，只在有这一项的系统上给。Windows 上 `loadavg()` 恒为 0，数据源写成 `null`，卡片写「负载不可用」。 |
| `system.disk` | `node:fs/promises` 的 `statfs`，路径是看板数据目录所在的卷 | 看板数据所在卷的可用与总容量；读不出来时整项 `null`，卡片写「不可用」。不暴露路径。 |
| `system.platform` | Windows 用 `os.version()`，macOS 用 `os.release()`，其余用 `os.type()` 与 `os.release()` | 给人看的系统名，例如 Windows 11 Pro、macOS 15.1、Linux 6.8.0。 |
| `readMs` | 宿主这一次读取自己的耗时 | 包含第一次采样时拼文档的时间，面板上写「耗时」。 |
| `board.cards`、`board.boards` | 宿主的工作区快照 | 精确：每张卡片是一个 iframe，翻面组按两个实例算。 |
| `board.stateBytes` | 各实例 `state` 的 JSON 序列化长度，复用 D23 写入额度里的同一份 `stateBytes` | 精确：与宿主判定 64 KB 单卡额度时读的是同一份数据。 |
| `board.documentsBytes` | `buildDocument` 按每张卡的当前组件版本拼出的 HTML 字节数，加上令牌、套件、运行时与精选库 | 近似：按中文界面拼装、省略 nonce，实际请求因语言与 nonce 有几字节到几百字节的差；同一版本被多张卡使用时按张数累加，因为每张卡各自加载一份文档。 |
| `library.widgets` | 组件库里可用的组件数 | 精确。 |
| `library.versions` | 版本库 `blobs/` 下的版本文件数 | 精确：磁盘上留着的版本，含旧版本。 |
| 单张卡片的内存 | 没有受支持的接口 | 拿不到，不进入数据；卡片不画每卡内存的数字。 |
| 浏览器页面 JS 堆 | Chromium 的 `performance.memory` | 页面级近似，沙箱卡片读不到父页面，不进入数据。 |
| 渲染进程与 GPU 内存 | Electron 进程不向插件暴露 | 拿不到，不进入数据。 |

## 刷新、历史与「再测一次」

- 采样在宿主侧完成，组件只画。组件自己不设定时器。
- 订阅只在至少一位观众看得见这张卡时运行：卡片离开视口、页面隐藏、观众走光都退订，计时器与在途的那一次一起收掉；回到视口时重新订阅，第一拍立刻给一份新读数（D32）。
- 上一拍还没回来时这一拍跳过：读数自带 `sampledAt`，跳过一拍只是让卡片晚 5 秒看到新数，不会让更旧的读数排在更新的读数之后。
- 推上来的数据按组件 manifest 的 `data` schema 核对，写入走与手动读同一条路径与同一套修订号规则（D5、D23）。
- 卡片上的「再测一次」调用宿主能力 `widget-board:data.read`，不带参数时读卡片自己绑定的源；这次读只把数据交回组件，卡片存着的那份数据仍然只由订阅写（D32）。能力不声明权限；失败时宿主的拒绝原样回到组件，卡片把原因写进故障提示。
- 组件在 `state.samples` 里留最近 60 个 `{ at, rss }`，每次追加后裁掉最旧的。60 个采样约 2 KB，远低于 64 KB 的单卡额度（D23）。
- 卡片离开视口时父页面发 `pause`，页面隐藏时 iframe 自己的 `visibilityState` 变 `hidden`。两种情况都停止绘制与状态写入；恢复时用最后一份数据重画一次，下一份采样到来时继续追加。
- 组件库的缩略画面（`placement: preview`）画一份固定样例，标为「示例数据」，不读宿主状态也不写状态。

## 卡片文案

| 位置 | 中文 | English |
|---|---|---|
| 标题 | 运行成本 | Running cost |
| 范围标签 | 整个宿主进程 | Whole host process |
| 主读数说明 | 宿主进程常驻内存 · 含看板以外的工作 | Host process RSS · includes work outside the board |
| 面板头 | Windows 11 Pro · 采样完成 | Windows 11 Pro · Sample complete |
| 面板元信息 | 采样于 {time} · 第 {n} 次采样 · 耗时 {ms} ms | Sampled at {time} · Sample {n} · {ms} ms |
| 分项 | 堆、系统内存、CPU、磁盘、系统、看板、组件库 | Heap, RAM, CPU, Disk, System, Board, Library |
| 堆的说明 | 外部内存 {size} · ArrayBuffer {size} | External {size} · ArrayBuffer {size} |
| 系统内存说明 | 已用 | used |
| CPU | {n} 核 / 负载 {load} / 负载不可用 | {n} cores / load {load} / load unavailable |
| 磁盘 | 可用 {size} / 总 {size} / 不可用 | free {size} / total {size} / unavailable |
| 看板 | {cards} 张卡 · {boards} 块看板；状态 {size} · 文档 {size} | cards {cards} · boards {boards}; state {size} · documents {size} |
| 组件库 | {widgets} 类 · {versions} 版本 | types {widgets} · versions {versions} |
| 按钮 | 再测一次 / 采样中… | Measure again / Sampling… |
| 走势 | 最近 {n} 次采样 | Last {n} samples |
| 空态 | 等待第一次采样 | Waiting for the first sample |
| 预览 | 示例数据 | Sample data |

## 核实结论

1. **进程结构**：宿主半边由宿主加载器在自己的 Node 进程里 `apply`，注册路由、读写看板；浏览器半边由宿主页面加载，组件在 `sandbox="allow-scripts"` 的 iframe 里运行（D1、D3）。因此 `process.memoryUsage()` 覆盖的是 DSH 宿主进程，包含看板以外的工作；桌面壳与服务端形态下都是同一个宿主进程，差别只在谁托管它。浏览器页面、渲染进程与 GPU 不在这个读数里。机器读数（CPU、系统内存、磁盘、系统名）来自宿主进程所在的那台机器。在真实临时宿主里没有登录也能读到这份数据，因为数据源不碰账号。
2. **状态总量**：宿主原先只有写入额度在比对单卡与整板状态，没有可读的总量。这里把 `state.ts` 的 `stateBytes` 导出复用，作为唯一一份序列化规则；5 秒对几十张卡各序列化一次的成本可接受。本机量到 60 张卡、每张约 1.7 KB 状态时，一次求和约 0.19 毫秒、序列化约 101 KB；相对 5 秒的间隔可以忽略。
3. **文档体积**：现有拼装路径 `buildDocument` 能直接拿到一份文档的完整 HTML，资产来自 `live.assets`，不需要在构建时另记一份。数据源按组件内容哈希缓存尺寸，资产换新（组件库重读或运行时重载）时清空缓存；第一次采样之后，同版本只拼一次。
4. **机器读数**：CPU 核数、系统内存、磁盘容量与系统名都由 Node 内置模块直接读；Windows 的负载平均值没有意义，写成 `null`；磁盘在 `statfs` 失败时是 `null`，卡片分别显示「负载不可用」与「不可用」。这些读数不带路径、不含用户名，卡片拿到的只是数字与系统名。

## 在真实宿主上核对

- 临时宿主（0.2.1-rc.2，独立的 `$DSH_HOME`，没有登录与会话）里卡片进入 `ready`：面板显示 Windows 11 Pro、16 核、负载不可用、系统内存 20/47 GiB、磁盘可用 666 GiB（总 930 GiB），以及宿主进程的堆、外部内存与 ArrayBuffer。
- 「再测一次」按下后宿主按需读一次，卡片上的采样时间与次数更新；这次读不改写卡片存着的那份数据，也没有额外权限。
- 卡片滚进视口时第一份读数到达（同时写进工作区快照），之后每 5 秒一份新读数；滚出视口后 8 秒内 `sampledAt` 不变，滚回来立刻来一份新的。
- 浅色中文与深色英文各核对一次：默认 2×18rem、1×12rem 与 2×30rem 三个盒子都没有溢出或截断；高盒子里走势出现，矮盒子保留四行带条形图的读数（堆、系统内存、CPU、磁盘）。
- 卡片移出视口后根节点带 `data-paused`，7 秒内状态里的采样数不变；页面隐藏（iframe 的 `visibilityState` 为 `hidden`）同样不变，恢复后继续增长。2 到 5 个采样时状态是 163 到 263 字节，60 个采样由单元测试核对低于 64 KB。
- 单元测试与尺寸矩阵都是可重复的检查；这一段记的是 issue #5 与后续机器体检扩展的验收核对，命令见下一节。

## 检查

- 单元测试：`packages/host/test/system-metrics.test.ts` 核对计数、状态字节、文档体积、机器读数与组件 manifest 的 data schema；`packages/testing/test/system-metrics-view.test.ts` 覆盖字节格式化、历史裁剪、空态、系统读数与走势路径。
- 尺寸矩阵：`npm run matrix` 把组件放进一列、两列、四列与 6 到 30rem 的高度，检查溢出、截断、空白与脚本错误。
- 真实宿主：`npm run smoke` 在临时宿主里打开看板，`packages/testing/data-cards.cjs` 把卡片滚进视口后核对首份读数、5 秒节奏、离开与恢复可见、按需读的成功与白名单之外的拒绝，以及拒绝在卡片上的可见提示。

## 边界

- 不报告渲染进程、GPU、单张卡片的内存，不调用 Electron 私有接口。
- 不读宿主的 `/api` 路由，不做任意的 `process` 访问；数据由宿主半边的数据源提供，组件只拿到上面的结构。
- 磁盘只报看板数据所在卷的容量，不报路径；系统名只报给人看的版本名。
- 不设告警阈值：不同机器与不同宿主负载的基线不同，固定数字会误导；卡片只给事实与走势（沿用 issue #5 的范围）。
- 组件库与看板本身的开销算在卡片里：`board.documentsBytes` 含每一张卡的文档与内联运行时，看板一行同时给出卡片数、状态与文档体积。
