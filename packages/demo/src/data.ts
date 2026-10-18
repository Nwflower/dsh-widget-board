/**
 * 演示页的构建步骤与演示宿主共用的约定：静态数据放在哪儿、长什么样、文档按什么名字存（D25）。
 *
 * 构建时把「第一次启动的默认看板」「组件清单」和每份组件文档写成静态文件；演示宿主在浏览器里
 * 按这些名字取回，不再需要任何服务进程。
 */
import type { LocalizedText, WidgetManifest, WorkspaceSnapshot } from '@dsh-widget-board/contracts'
import { CLIENT_ROUTE, WIDGET_ROUTE } from '@dsh-widget-board/contracts'

/** 静态数据目录，相对演示页的根。 */
export const DATA_DIR = 'demo-data'

/** 宿主数据文件：快照、组件清单与演示宿主不提供的组件。 */
export const HOST_DATA_FILE = `${DATA_DIR}/host.json`

/** 演示宿主为一个组件保存的信息：内容哈希与 manifest。 */
export interface DemoWidget {
  hash: string
  manifest: WidgetManifest
}

/** 演示宿主不提供的组件，以及它们需要而演示宿主没有的东西。 */
export interface UnsupportedWidget {
  id: string
  title: LocalizedText
  /** 需要宿主的哪一类能力。 */
  needs: 'source' | 'capability' | 'action' | 'credential'
}

/** `host.json` 的内容。 */
export interface HostData {
  /** 这份默认看板的身份：浏览器里存着的看板来自别的 `seed` 时，丢掉它重新开始。 */
  seed: string
  /** 第一次启动时的工作区快照。 */
  snapshot: WorkspaceSnapshot
  /** 演示宿主提供的组件，按组件 id 索引。 */
  widgets: Record<string, DemoWidget>
  unsupported: UnsupportedWidget[]
}

/**
 * 一份预生成文档的路径。
 *
 * 真实宿主在 `widget/<hash>/document` 这个路由上动态拼文档；演示页上它是静态托管的 `document/`
 * 目录下的 `index.html`，请求 `…/document?lang=…` 时静态托管把它重定向到目录、查询串被忽略。
 * 组件 iframe 带 `sandbox="allow-scripts"`，来源不透明，它的导航请求不经过 Service Worker，所以
 * 文档必须是服务器上真实存在的文件。
 *
 * @param hash - 组件内容的哈希。
 * @returns 相对演示页根的路径。
 */
export function documentFile(hash: string): string {
  return `${CLIENT_ROUTE}${WIDGET_ROUTE}/${hash}/document/index.html`
}
