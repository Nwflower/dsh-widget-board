/**
 * 运行成本的数据源（issue #5）：宿主进程的内存、机器层面的读数，以及看板与组件库自身的体积。
 *
 * 卡片能拿到的东西分两类：宿主进程与机器上读得到的数，以及宿主自己知道的计数。渲染进程、GPU 与
 * 单张卡片的内存拿不到——它们不在宿主进程的 `process.memoryUsage()` 里，也没有给插件的接口——
 * 所以这里不编造数字，卡片上写明这一点。
 *
 * 机器读数来自 `node:os` 与看板数据所在卷的 `statfs`：CPU 核数、系统内存、磁盘余量、系统版本。
 * Windows 的 `os.loadavg()` 只回零，卡片据此写「负载不可用」（D11 的可见说法）。磁盘读不出来时
 * 这一项是 null，其余读数照常给。
 *
 * 看板与组件库的体积每次读都按当下的工作区与组件库算：卡片数、状态序列化后的字节、每张卡当前
 * 版本文档拼出来的字节。文档字节按组件版本缓存到下一次组件库重读（资产换了一份就清掉），5 秒一次
 * 的采样因此不会反复拼几十份文档。
 *
 * 取样由订阅驱动（D32）：卡片可见时宿主订上，`subscribe` 立刻读一次、之后每 5 秒读一次；上一拍还
 * 没回来时这一拍跳过。卡片离开视口、props 变了或提供方撤下时宿主退订，退订之后不再回调。卡片上的
 * 「再测一次」走 `widget-board:data.read`：读一次把数据交回组件，卡片的那份数据仍然只由订阅写。
 */
import os from 'node:os'
import { statfs } from 'node:fs/promises'
import type { DataSourceRegistration, InstanceFace } from '@dsh-widget-board/contracts'
import { WIDGET_BOARD_API_VERSION } from '@dsh-widget-board/contracts'
import { buildDocument } from './document'
import type { DocumentAssets } from './document'
import type { WidgetRecord } from './library'
import type { VersionStore } from './blobs'
import type { Workspace } from './workspace'
import { stateBytes } from './state'

/** 数据源的 id 与提供方：组件 manifest 里写成 `widget-board:system.metrics`。 */
export const SYSTEM_METRICS_PROVIDER = 'widget-board'
export const SYSTEM_METRICS_SOURCE = 'system.metrics'

/** 组件 manifest 里点名这个数据源时写的全名。 */
export const SYSTEM_METRICS_NAME = `${SYSTEM_METRICS_PROVIDER}:${SYSTEM_METRICS_SOURCE}`

/** 订阅里的采样间隔，毫秒：卡片可见时每这么多个毫秒读一次。 */
export const SYSTEM_METRICS_INTERVAL_MS = 5000

/** 宿主进程的内存读数，单位字节；范围是整个宿主进程。 */
export interface HostMemory {
  rss: number
  heapUsed: number
  heapTotal: number
  external: number
  arrayBuffers: number
}

/** 看板数据所在卷的容量，单位字节；读不到时整项是 null。 */
export interface SystemDisk {
  available: number
  total: number
}

/** 机器层面的读数；读的是宿主进程所在的那台机器。 */
export interface SystemInfo {
  /** 给读者看的系统名，例如 Windows 11 Pro、macOS 15.1、Linux 6.8.0。 */
  platform: string
  /** 逻辑处理器数。 */
  cpus: number
  /** 一分钟平均负载；Windows 上这一项没有意义，是 null。 */
  loadAverage: number | null
  totalMemory: number
  freeMemory: number
  /** 看板数据所在卷；读不出来时是 null。 */
  disk: SystemDisk | null
}

/** 看板自身的计数与体积，全部来自宿主的工作区。 */
export interface BoardCost {
  cards: number
  boards: number
  stateBytes: number
  documentsBytes: number
}

/** 组件库的计数。 */
export interface LibraryCost {
  widgets: number
  versions: number
}

/** 一次采样。组件只读这个结构，不接触宿主。 */
export interface SystemMetrics {
  sampledAt: string
  /** 这一次读取本身花了多少毫秒：面板上的「耗时」。 */
  readMs: number
  host: HostMemory
  system: SystemInfo
  board: BoardCost
  library: LibraryCost
}

/** 算一次采样要读的东西；`records` 与 `assets` 都是活引用，组件库热重载之后读到新的那一份。 */
export interface SystemMetricsDeps {
  /** 工作区：全部看板与卡片。 */
  workspace: Pick<Workspace, 'list'>
  /** 当前可用的组件，按 id 索引。 */
  records: () => ReadonlyMap<string, WidgetRecord>
  /** 版本库：历史版本数。 */
  versions: Pick<VersionStore, 'count'>
  /** 当前资产：文档拼装要内联的令牌、套件、运行时与精选库。 */
  assets: () => DocumentAssets
  /** 看板数据所在的目录；磁盘余量按它所在的卷算。 */
  diskPath: string
}

/** 拼一份文档时用的界面语言：只影响 <html lang> 与标题，几百字节以内。 */
const DOCUMENT_LANG = 'zh-CN'

/** 给读者看的系统名。 */
function platformName(): string {
  if (process.platform === 'win32') return os.version()
  if (process.platform === 'darwin') return `macOS ${os.release()}`
  return `${os.type()} ${os.release()}`.trim()
}

/**
 * 看板数据所在卷的容量。
 *
 * @param path - 卷上的任一目录。
 * @returns 可用与总字节数；读不出来时是 null，卡片把这一项写成「不可用」。
 */
async function diskOf(path: string): Promise<SystemDisk | null> {
  try {
    const stats = await statfs(path)
    const total = stats.blocks * stats.bsize
    const available = stats.bavail * stats.bsize
    return total > 0 ? { total, available } : null
  } catch {
    // 磁盘是次读：这一项失败时卡片显示不可用，内存与看板读数照常给（D11）。
    return null
  }
}

/**
 * 机器层面的读数。
 *
 * @param diskPath - 看板数据所在的目录。
 * @returns 系统名、CPU、负载、内存与磁盘。
 */
async function systemInfo(diskPath: string): Promise<SystemInfo> {
  // Windows 的 os.loadavg() 恒为 0，写「负载 0」会误导；这一项按不可用给。
  const loadAverage = process.platform === 'win32' ? null : Math.round(os.loadavg()[0] * 100) / 100
  return {
    platform: platformName(),
    cpus: Math.max(1, os.cpus().length),
    loadAverage,
    totalMemory: os.totalmem(),
    freeMemory: os.freemem(),
    disk: await diskOf(diskPath),
  }
}

/**
 * 建出运行成本的数据源。
 *
 * @param deps - 工作区、组件库、版本库、当前资产与看板数据目录。
 * @returns 数据源注册项；不声明权限，它只读宿主自己的东西（D6）。
 */
export function createSystemMetricsSource(deps: SystemMetricsDeps): DataSourceRegistration {
  /** 上一次算文档字节时用的资产；资产换了一份，缓存的文档尺寸就作废。 */
  let measuredAssets: DocumentAssets | undefined
  const documentBytes = new Map<string, number>()

  /**
   * 一张卡当前版本要加载的文档字节数。
   *
   * 按内容哈希缓存；同一个版本被多张卡用时只拼一次。
   *
   * @param record - 组件记录。
   * @param assets - 当前资产。
   * @returns 文档的字节数；拼不出来时是 0。
   */
  const bytesOf = (record: WidgetRecord, assets: DocumentAssets): number => {
    if (measuredAssets !== assets) {
      measuredAssets = assets
      documentBytes.clear()
    }
    const known = documentBytes.get(record.hash)
    if (known !== undefined) return known
    let size = 0
    try {
      size = Buffer.byteLength(buildDocument(record, assets, '', { lang: DOCUMENT_LANG }), 'utf8')
    } catch {
      // 一份拼不出来的文档由它自己的卡片显示故障；成本卡只把它记作 0，不因为一个组件整张读不出来（D11、D17）。
      size = 0
    }
    documentBytes.set(record.hash, size)
    return size
  }

  /**
   * 读一次采样。订阅与按需读走同一条路，读数因此只有一处算法。
   *
   * @returns 宿主内存、机器读数与看板自己的计数。
   */
  const sample = async (): Promise<SystemMetrics> => {
    const started = performance.now()
    const boards = deps.workspace.list()
    const records = deps.records()
    const assets = deps.assets()
    const memory = process.memoryUsage()
    const system = await systemInfo(deps.diskPath)
    let cards = 0
    let state = 0
    let documents = 0
    for (const board of boards) {
      for (const instance of board.instances) {
        cards += 1
        state += stateBytes(instance.state)
        const record = records.get(instance.widget)
        if (record !== undefined) documents += bytesOf(record, assets)
      }
    }
    return {
      sampledAt: new Date().toISOString(),
      readMs: Math.round((performance.now() - started) * 10) / 10,
      host: {
        rss: memory.rss,
        heapUsed: memory.heapUsed,
        heapTotal: memory.heapTotal,
        external: memory.external,
        arrayBuffers: memory.arrayBuffers,
      },
      system,
      board: { cards, boards: boards.length, stateBytes: state, documentsBytes: documents },
      library: { widgets: records.size, versions: await deps.versions.count() },
    }
  }

  return {
    apiVersion: WIDGET_BOARD_API_VERSION,
    provider: SYSTEM_METRICS_PROVIDER,
    id: SYSTEM_METRICS_SOURCE,
    read(_instance: InstanceFace): Promise<SystemMetrics> {
      return sample()
    },
    /**
     * 卡片可见期间持续采样（D32）：先给一份当下的读数，之后每 5 秒一份。
     *
     * 采样是异步的（磁盘与版本库各要一次 await），两拍之间会重叠：上一拍还没回来时这一拍直接跳过。
     * 排队的做法会让后到的一拍读到更晚的时刻却排在更旧的一份之后，而读数自带 `sampledAt`，跳过一拍
     * 只让卡片晚 5 秒看到新数。
     *
     * @param _instance - 订阅这张卡片；读数按工作区整体算，不按单张卡。
     * @param emit - 推一份采样给宿主。
     * @returns 退订函数：同步停表，在途的那一次回来之后也不再回调。
     */
    subscribe(_instance: InstanceFace, emit: (data: unknown) => void): () => void {
      let stopped = false
      /** 上一拍还在读：一次只跑一次的闸门。 */
      let sampling = false
      const tick = (): void => {
        if (stopped || sampling) return
        sampling = true
        void sample().then((metrics) => {
          sampling = false
          if (!stopped) emit(metrics)
        }, (error: unknown) => {
          // 这一拍失败时不抛出也不停表：定时回调没有调用方可以接住它，抛出去会把整张看板带下来。
          // 下一拍照常读，卡片留着上一份读数（与定时链里单张卡读失败同一处理，D11）。
          sampling = false
          console.error(`widget-board: 运行成本采样失败：${error instanceof Error ? error.message : String(error)}`)
        })
      }
      const timer = setInterval(tick, SYSTEM_METRICS_INTERVAL_MS)
      // 定时器不拽住进程：宿主的退出时机不该由一张卡决定（与定时链同一个约定）。
      timer.unref()
      tick()
      return () => {
        stopped = true
        clearInterval(timer)
      }
    },
  }
}
