/**
 * 构建时的数据：用真实宿主的组件库、第一次启动的看板和文档拼装写出演示页的静态数据（D25）。
 *
 * 默认看板不是另写的一份：它由宿主的 `openWorkspace` 在一个全新的目录里第一次启动时铺出来，
 * 快照由宿主的 `workspaceSnapshot` 拼出来，文档由宿主的 `buildDocument` 拼出来。演示宿主只是
 * 把这些结果存成静态文件。
 */
import { createHash } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { WidgetManifest } from '@dsh-widget-board/contracts'
import { CLIENT_ROUTE } from '@dsh-widget-board/contracts'
import { gridMetrics, tidyLayout } from '@dsh-widget-board/model'
import { loadAssets } from '../../../host/src/assets'
import { buildDocument, contentSecurityPolicy, freshNonce } from '../../../host/src/document'
import { loadLibrary } from '../../../host/src/library'
import type { WidgetRecord } from '../../../host/src/library'
import { workspaceSnapshot } from '../../../host/src/snapshot'
import { instanceOf } from '../../../host/src/state'
import { openWorkspace } from '../../../host/src/workspace'
import { DATA_DIR, HOST_DATA_FILE, documentFile } from '../data'
import type { DemoWidget, HostData, UnsupportedWidget } from '../data'

/** 演示页两块看板的标题，按第一次启动的次序：不分语言，中英文界面下都读得通。 */
const BOARD_TITLES = ['Widget Board', 'Gallery'] as const

/**
 * 精选看板上演示宿主兑现不了的卡，换成哪个组件：放在同一个盒子里，第一屏的版面不缺一块。
 * 画廊里的这几张直接去掉，其余的卡片按阅读顺序收紧。
 *
 * 每个组件给的是候选而不是一个：第一个在演示页上可用的候选算数。替身自己有了数据源时（例如表盘
 * 指向容量表盘），版面仍然不缺一块。
 */
const STAND_INS: Readonly<Record<string, readonly string[]>> = {
  weather: ['year-progress'],
  'dsh-balance': ['gauge', 'flip-card'],
  heatmap: ['chart', 'stat'],
}

/**
 * 演示页上照样站得住的内置数据源。
 *
 * 这些数据源都由插件自己在宿主上兑现，演示宿主是只读的：一个都不兑现。它们名下的组件自带样例与
 * 兜底渲染，因此演示页上照样画得出来。专为宿主实时采样设计的两张卡不在其中：离了宿主它们就没有
 * 意义（`system-metrics` 与 `session-usage`）。
 */
const DEMO_SUPPORTED_SOURCES = new Set([
  'widget-board:git.diff',
  'widget-board:git.log',
  'widget-board:repo.links',
  'widget-board:markdown.doc',
  'widget-board:sessions.list',
  'widget-board:usage.chart',
  'widget-board:usage.stat',
  'widget-board:capacity.items',
  'widget-board:providers.table',
  'widget-board:runtime.kv',
  'widget-board:board.json',
])

/** 画廊按三列排（D17）；收紧时按三列的栅格算。 */
const GALLERY_METRICS = gridMetrics(1120)

/** 静态文档的语言：运行时握手后按页面的语言改写 `<html lang>`。 */
const DOCUMENT_LANG = 'zh-CN'

/**
 * 把真实宿主放在响应头里的 CSP 放进文档自己的 `<meta>`。
 *
 * 静态托管不能按请求设响应头。策略的文本来自宿主的 `contentSecurityPolicy`，nonce 是这份文档
 * 构建时生成的那一个；`script-src`、`connect-src` 等限制对文档里的脚本照样生效（D3）。
 *
 * @param html - 宿主拼出来的文档。
 * @param nonce - 文档里内联脚本用的 nonce。
 * @returns 带 CSP 的文档。
 */
function withMetaPolicy(html: string, nonce: string): string {
  return html.replace('<head>', `<head>
<meta http-equiv="content-security-policy" content="${contentSecurityPolicy(nonce)}">`)
}

/** 一次构建的位置：`lib` 是 `npm run build` 的产物，`home` 是铺默认看板用的临时目录，`out` 是演示页根。 */
export interface SeedOptions {
  lib: string
  home: string
  out: string
}

/**
 * 一个组件需要演示宿主没有的哪一类东西。
 *
 * 数据源、动作、宿主能力与凭据都由真实宿主上的提供方或服务兑现；演示宿主只读，不兑现其中任何
 * 一类，所以需要它们的组件不进看板与组件库，而不是带着一张读不出数据的卡片出现。自带样例与兜底
 * 渲染的通用卡例外：它们的组件在演示页上照样画得出来。
 *
 * @param manifest - 组件 manifest。
 * @returns 需要的东西；这个组件在演示宿主上能完整工作时是 `undefined`。
 */
function needsOf(manifest: WidgetManifest): UnsupportedWidget['needs'] | undefined {
  if (manifest.source !== undefined && !DEMO_SUPPORTED_SOURCES.has(manifest.source)) return 'source'
  if ((manifest.capabilities?.length ?? 0) > 0) return 'capability'
  if ((manifest.actions?.length ?? 0) > 0) return 'action'
  if ((manifest.credentials?.length ?? 0) > 0) return 'credential'
  return undefined
}

/**
 * 写出 `host.json` 与每份组件文档。
 *
 * @param options - 产物、临时目录与输出目录。
 * @returns 写出的宿主数据。
 */
export async function writeDemoData({ lib, home, out }: SeedOptions): Promise<HostData> {
  const library = await loadLibrary([{ dir: join(lib, 'widgets'), source: 'builtin' }])
  const supported = new Map<string, WidgetRecord>()
  const unsupported: UnsupportedWidget[] = []
  for (const [id, record] of library.records) {
    const needs = needsOf(record.manifest)
    if (needs === undefined) supported.set(id, record)
    else unsupported.push({ id, title: record.manifest.title, needs })
  }
  const skipped = new Set(unsupported.map((entry) => entry.id))
  const entries = library.entries.filter((entry) => !skipped.has(entry.id))

  await rm(home, { recursive: true, force: true })
  // 第一次启动按完整的内置组件库铺：清单里的组件少一个就抛出（D17），演示宿主兑现不了的卡在铺完之后换掉。
  const workspace = await openWorkspace(home, library.records, () => {})
  const [mine, gallery] = workspace.list()
  if (mine === undefined || gallery === undefined) throw new Error('第一次启动没有铺出两块看板（D17）')
  await workspace.save(mine.id, (board) => ({
    ...board,
    instances: board.instances.map((instance) => {
      if (!skipped.has(instance.widget)) return instance
      const stand = STAND_INS[instance.widget]?.map((id) => supported.get(id)).find((record) => record !== undefined)
      if (stand === undefined) throw new Error(`精选看板上的 ${instance.widget} 在演示页上没有替身`)
      return instanceOf(stand, board.instances, { layout: instance.layout })
    }),
  }), { layoutChanged: true, event: () => ({ type: 'board' }) })
  await workspace.save(gallery.id, (board) => {
    const kept = board.instances.filter((instance) => !skipped.has(instance.widget))
    const layouts = tidyLayout(kept, GALLERY_METRICS)
    return { ...board, instances: kept.map((instance) => ({ ...instance, layout: layouts[instance.id] ?? instance.layout })) }
  }, { layoutChanged: true, event: () => ({ type: 'board' }) })
  for (const [index, board] of workspace.list().entries()) {
    const title = BOARD_TITLES[index]
    if (title !== undefined) await workspace.rename(board.id, title)
  }
  const snapshot = workspaceSnapshot({ records: supported, entries, workspace, grants: { all: () => [] } })

  const widgets: Record<string, DemoWidget> = {}
  for (const [id, record] of supported) widgets[id] = { hash: record.hash, manifest: record.manifest }
  const seed = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex').slice(0, 16)
  const data: HostData = { seed, snapshot, widgets, unsupported }

  const assets = await loadAssets(join(lib, 'runtime'))
  await rm(join(out, DATA_DIR), { recursive: true, force: true })
  await rm(join(out, CLIENT_ROUTE), { recursive: true, force: true })
  await mkdir(join(out, DATA_DIR), { recursive: true })
  for (const record of supported.values()) {
    const file = join(out, documentFile(record.hash))
    await mkdir(dirname(file), { recursive: true })
    const nonce = freshNonce()
    await writeFile(file, withMetaPolicy(buildDocument(record, assets, nonce, { lang: DOCUMENT_LANG }), nonce))
  }
  await writeFile(join(out, HOST_DATA_FILE), JSON.stringify(data))
  return data
}
