/**
 * 运行成本的数据源（issue #5）：宿主进程的内存，以及看板与组件库自身的体积。
 *
 * 卡片能拿到的东西分两类：宿主进程的内存读数，与宿主自己知道的计数。渲染进程、GPU 与单张卡片的
 * 内存拿不到——它们不在宿主进程的 `process.memoryUsage()` 里，也没有给插件的接口——所以这里不
 * 编造数字，卡片上写明这一点。
 *
 * 看板与组件库的体积每次读都按当下的工作区与组件库算：卡片数、状态序列化后的字节、每张卡当前
 * 版本文档拼出来的字节。文档字节按组件版本缓存到下一次组件库重读（资产换了一份就清掉），5 秒一次
 * 的采样因此不会反复拼几十份文档。
 */
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

/** 宿主进程的内存读数，单位字节；范围是整个宿主进程。 */
export interface HostMemory {
  rss: number
  heapUsed: number
  heapTotal: number
  external: number
  arrayBuffers: number
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
  host: HostMemory
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
}

/** 拼一份文档时用的界面语言：只影响 <html lang> 与标题，几百字节以内。 */
const DOCUMENT_LANG = 'zh-CN'

/**
 * 建出运行成本的数据源。
 *
 * @param deps - 工作区、组件库、版本库与当前资产。
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

  return {
    apiVersion: WIDGET_BOARD_API_VERSION,
    provider: SYSTEM_METRICS_PROVIDER,
    id: SYSTEM_METRICS_SOURCE,
    async read(_instance: InstanceFace): Promise<SystemMetrics> {
      const boards = deps.workspace.list()
      const records = deps.records()
      const assets = deps.assets()
      const memory = process.memoryUsage()
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
        host: {
          rss: memory.rss,
          heapUsed: memory.heapUsed,
          heapTotal: memory.heapTotal,
          external: memory.external,
          arrayBuffers: memory.arrayBuffers,
        },
        board: { cards, boards: boards.length, stateBytes: state, documentsBytes: documents },
        library: { widgets: records.size, versions: await deps.versions.count() },
      }
    },
  }
}
