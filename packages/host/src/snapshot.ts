/**
 * 工作区快照（D5、D21）：全部看板、当前选中、卡片要用的组件元信息、组件库与授权。
 *
 * 每次 `GET /boards`、写入之后与组卡换槽都从同一处拼出来；设置弹窗的读模型不在这里，它按需单独取
 * （D27）。
 */
import type { WidgetManifest, WidgetProviderHealth, WidgetSummary, WorkspaceSnapshot } from '@dsh-widget-board/contracts'
import type { CapabilityResolver } from './capability-metadata'
import { capabilityMetadataOf } from './capability-metadata'
import { isRecord } from './guards'
import type { GrantStore } from './grants'
import type { Live } from './live'
import type { WidgetRecord } from './library'
import type { MarketSection } from './market'
import type { RouteContext } from './routes'
import type { Workspace } from './workspace'

/** 拼快照要读的那几样：组件库、看板与授权表。路由上下文满足它，演示页的构建步骤也只提供这几样。 */
export type SnapshotContext = Pick<RouteContext, 'records' | 'entries'> & {
  workspace: Pick<Workspace, 'list' | 'activeId'>
  grants: Pick<GrantStore, 'all'>
  /** 变更通知：快照带上它已经推到的修订号（D18）；没有通知的构建步骤（演示页）按 0。 */
  live?: Pick<Live, 'revision'>
  /** 市场区（D8 之后的市场契约）；没有市场注册表的构建步骤（演示页）省略。 */
  market?: { sections(): MarketSection[] }
  /**
   * 能力注册表与提供方的健康记录（D24、D31、D32）：前者按声明的名字解析出这张卡的能力面，后者投影成
   * `WorkspaceSnapshot.providers`；演示页的构建步骤省略。
   */
  sources?: { resolveCapability: CapabilityResolver, health: { snapshot(): WidgetProviderHealth[] } }
}

/**
 * 一个组件有没有设置弹窗要展示的项（D27）：非空 props schema 或凭据声明。
 *
 * @param manifest - 组件 manifest。
 * @returns 有可配置项时为真。
 */
export function hasSettings(manifest: WidgetManifest): boolean {
  const properties = isRecord(manifest.props) ? manifest.props.properties : undefined
  const hasProps = isRecord(properties) && Object.keys(properties).length > 0
  return hasProps
    || (manifest.credentials?.length ?? 0) > 0
    || (manifest.capabilities?.length ?? 0) > 0
    // 绑了数据源的卡片没有可改的项，但它的日志看得见（D28）。
    || manifest.source !== undefined
}

/**
 * 一张卡片要用的组件元信息（D5）。
 *
 * 工作区快照与内联视图读同一份：两处各写一遍时，组件改了标题、尺寸族或最小盒子就会分叉。
 *
 * 能力面就在这里投影成三份（D32）：`capabilities` 是 manifest 声明过的白名单，`availableCapabilities`
 * 是其中现在解析得到的那些，`capabilityMetadata` 带着每一项的标题与 schema。三份由同一次解析得出，
 * 判断一项能不能调只看后两份里的 `available`，不靠名字比对——点名提供方的 `提供方:名字` 在名字
 * 比对里永远对不上。
 *
 * @param record - 组件库里读出来的一条记录。
 * @param resolveCapability - 按声明的名字解析能力；省略时（演示页的构建步骤）不投影能力面。
 * @returns 快照里的那一份形状。
 */
export function widgetSummaryOf(record: WidgetRecord, resolveCapability?: CapabilityResolver): WidgetSummary {
  const declared = record.manifest.capabilities
  const metadata = declared === undefined || resolveCapability === undefined
    ? undefined
    : capabilityMetadataOf(declared, resolveCapability)
  return {
    hash: record.hash,
    title: record.manifest.title,
    sizes: record.manifest.sizes,
    ...(record.manifest.text === undefined ? {} : { text: record.manifest.text }),
    source: record.source,
    ...(record.provider === undefined ? {} : { provider: record.provider }),
    ...(declared === undefined ? {} : { capabilities: declared }),
    ...(metadata === undefined
      ? {}
      : {
          availableCapabilities: metadata.filter((item) => item.available).map((item) => item.id),
          capabilityMetadata: metadata,
        }),
    ...(record.manifest.minBox === undefined ? {} : { minBox: record.manifest.minBox }),
    ...(hasSettings(record.manifest) ? { settings: true } : {}),
  }
}

/**
 * 工作区快照：全部看板与当前选中，外加它们用到的组件元信息、整个组件库与看板上用得到的授权（D21、D6）。
 *
 * @param context - 路由上下文。
 * @returns 工作区快照。
 */
export function workspaceSnapshot(context: SnapshotContext): WorkspaceSnapshot {
  const widgets: WorkspaceSnapshot['widgets'] = {}
  const sources = context.sources
  const resolveCapability = sources === undefined ? undefined : (id: string) => sources.resolveCapability(id)
  for (const [id, record] of context.records) {
    widgets[id] = widgetSummaryOf(record, resolveCapability)
  }
  // 只带工作区里出现的那些版本：授权表会一直长，页面只关心眼前这些卡（D6）。
  const hashes = new Set(context.workspace.list().flatMap((board) => board.instances.map((instance) => instance.hash)))
  const grants = context.grants.all().filter((grant) => hashes.has(grant.hash))
  return {
    revision: context.live?.revision ?? 0,
    active: context.workspace.activeId(),
    boards: context.workspace.list(),
    widgets,
    library: context.entries,
    ...(context.market === undefined ? {} : { market: context.market.sections() }),
    ...(context.sources === undefined ? {} : { providers: context.sources.health.snapshot() }),
    grants,
  }
}
