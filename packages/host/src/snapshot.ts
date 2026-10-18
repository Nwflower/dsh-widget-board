/**
 * 工作区快照（D5、D21）：全部看板、当前选中、卡片要用的组件元信息、组件库与授权。
 *
 * 每次 `GET /boards`、写入之后与组卡换槽都从同一处拼出来；设置弹窗的读模型不在这里，它按需单独取
 * （D22）。
 */
import type { WidgetManifest, WidgetSummary, WorkspaceSnapshot } from '@dsh-widget-board/contracts'
import { isRecord } from './guards'
import type { WidgetRecord } from './library'
import type { RouteContext } from './routes'

/**
 * 一个组件有没有设置弹窗要展示的项（D22）：非空 props 表单或凭据声明。
 *
 * @param manifest - 组件 manifest。
 * @returns 有可配置项时为真。
 */
export function hasSettings(manifest: WidgetManifest): boolean {
  const properties = isRecord(manifest.props) ? manifest.props.properties : undefined
  const hasProps = isRecord(properties) && Object.keys(properties).length > 0
  return hasProps || (manifest.credentials?.length ?? 0) > 0
}

/**
 * 一张卡片要用的组件元信息（D5）。
 *
 * 工作区快照与内联视图读同一份：两处各写一遍时，组件改了标题、尺寸族或最小盒子就会分叉。
 *
 * @param record - 组件库里读出来的一条记录。
 * @returns 快照里的那一份形状。
 */
export function widgetSummaryOf(record: WidgetRecord): WidgetSummary {
  return {
    hash: record.hash,
    title: record.manifest.title,
    sizes: record.manifest.sizes,
    ...(record.manifest.text === undefined ? {} : { text: record.manifest.text }),
    source: record.source,
    ...(record.provider === undefined ? {} : { provider: record.provider }),
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
export function workspaceSnapshot(context: RouteContext): WorkspaceSnapshot {
  const widgets: WorkspaceSnapshot['widgets'] = {}
  for (const [id, record] of context.records) {
    widgets[id] = widgetSummaryOf(record)
  }
  // 只带工作区里出现的那些版本：授权表会一直长，页面只关心眼前这些卡（D6）。
  const hashes = new Set(context.workspace.list().flatMap((board) => board.instances.map((instance) => instance.hash)))
  const grants = context.grants.all().filter((grant) => hashes.has(grant.hash))
  return { active: context.workspace.activeId(), boards: context.workspace.list(), widgets, library: context.entries, grants }
}
