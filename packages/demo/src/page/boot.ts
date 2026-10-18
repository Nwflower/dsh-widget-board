/**
 * 启动演示宿主：注册 Service Worker，等它接管页面，再把插件的浏览器半边装进演示页（D25）。
 */
import type { Context } from '@deepseek-ai/cordis'
import { apply } from '@dsh-widget-board/client'
import { createHost } from './host'
import type { DemoHost } from './host'

/** 接管页面的 Service Worker 的脚本，相对演示页；作用域是演示页所在的目录。 */
const WORKER_SCRIPT = 'sw.js'

/**
 * 等页面被 Service Worker 接管。
 *
 * 第一次访问时 Service Worker 装好后会 `claim` 页面；强制刷新（Shift + 刷新）的页面不受任何
 * Service Worker 管，这时让已经在跑的那个 Service Worker 再接管一次。
 *
 * @param registration - Service Worker 的注册。
 */
async function controlled(registration: ServiceWorkerRegistration): Promise<void> {
  if (navigator.serviceWorker.controller !== null) return
  const taken = new Promise<void>((resolve) => {
    navigator.serviceWorker.addEventListener('controllerchange', () => { resolve() }, { once: true })
  })
  registration.active?.postMessage('claim')
  await taken
}

/**
 * 启动。
 *
 * @returns 装好插件的演示宿主。
 * @throws {Error} 浏览器没有 Service Worker，或者它没能启动。
 */
export async function startHost(): Promise<DemoHost> {
  if (!('serviceWorker' in navigator)) throw new Error('navigator.serviceWorker is not available')
  await navigator.serviceWorker.register(WORKER_SCRIPT)
  await controlled(await navigator.serviceWorker.ready)
  const host = createHost()
  apply(host.context as Context)
  return host
}
