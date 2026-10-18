/**
 * 演示宿主的 Service Worker：接住看板页发往 `api/widget-board/…` 的请求（D25）。
 *
 * 页面里跑的是插件真实的浏览器半边，它只认文档相对的路由。这里把这些请求按真实宿主的契约
 * 回答：快照来自构建时的静态数据，写入落在 IndexedDB，变更通知按 D18 的帧推给页面。
 */
import { PLUGIN_ROUTE, WIDGET_ROUTE } from '@dsh-widget-board/contracts'
import { HOST_DATA_FILE } from '../data'
import type { HostData } from '../data'
import { createBoards } from './boards'
import { createLive } from './live'
import { handleRequest } from './routes'
import type { DemoContext } from './routes'

declare const self: ServiceWorkerGlobalScope

const live = createLive()

let context: Promise<DemoContext> | undefined

/** 取宿主数据并装好看板存储；一次唤醒内只做一次。 */
function demoContext(): Promise<DemoContext> {
  context ??= (async () => {
    const scope = self.registration.scope
    const response = await fetch(new URL(HOST_DATA_FILE, scope), { cache: 'no-cache' })
    if (!response.ok) throw new Error(`读不到 ${HOST_DATA_FILE}：${String(response.status)}`)
    const data = await response.json() as HostData
    return { data, boards: createBoards(data, (event) => { live.notify(event) }), live, scope }
  })()
  return context
}

// 页面第一次打开时没有 Service Worker 在管：装好立刻接管，页面不必等下一次刷新。
self.addEventListener('install', () => { void self.skipWaiting() })
self.addEventListener('activate', (event) => { event.waitUntil(self.clients.claim()) })
// 强制刷新的页面不受 Service Worker 管；页面发来 claim 时再接管一次。
self.addEventListener('message', (event) => {
  if (event.data === 'claim') event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  const prefix = new URL(PLUGIN_ROUTE.slice(1), self.registration.scope).pathname
  if (url.origin !== self.location.origin || (url.pathname !== prefix && !url.pathname.startsWith(`${prefix}/`))) return
  // 组件文档是静态文件，由静态托管直接回答。
  if (url.pathname.startsWith(`${prefix}${WIDGET_ROUTE}/`)) return
  event.respondWith(demoContext().then((ready) => handleRequest(ready, event.request)))
})
