/**
 * 插件的私有路由（D1、D3）：看板快照与组件文档。
 *
 * 每条请求先过宿主的请求栅栏；宿主没有这项服务时只放行本机回环来的请求，判定以对端地址为准。
 * 组件文档按内容哈希寻址，响应头带 CSP，一次请求一个 nonce。
 */
import type { Board, BoardSnapshot, HostConnection, HostRequest, HostResponse } from '@dsh-widget-board/contracts'
import { BOARD_PATH, PLUGIN_ROUTE } from '@dsh-widget-board/contracts'
import type { DocumentAssets } from './document'
import { buildDocument, contentSecurityPolicy, freshNonce } from './document'
import type { WidgetRecord } from './library'

/** 路由处理器读到的一切。 */
export interface RouteContext {
  library: Map<string, WidgetRecord>
  board: Board
  assets: DocumentAssets
  connection: HostConnection | undefined
}

/** 回环地址：127/8 与 ::1，含 IPv4 映射。 */
function isLoopback(address: string | undefined): boolean {
  if (address === undefined) return false
  const normalized = address.toLowerCase()
  if (normalized === '::1') return true
  const v4 = normalized.startsWith('::ffff:') ? normalized.slice('::ffff:'.length) : normalized
  const parts = v4.split('.')
  return parts.length === 4 && parts[0] === '127' && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

/**
 * 一条请求能不能进来。
 *
 * @param request - 宿主的请求。
 * @param connection - 宿主的栅栏；没有时按回环地址与同站标记判定。
 * @returns 拒绝时的状态码，放行时是 `undefined`。
 */
function rejectionOf(request: HostRequest, connection: HostConnection | undefined): 401 | 403 | undefined {
  if (connection !== undefined) return connection.requestRejection({ headers: request.headers })
  if (!isLoopback(request.socket?.remoteAddress)) return 403
  return request.headers['sec-fetch-site'] === 'cross-site' ? 403 : undefined
}

/** 回一条 JSON。 */
function json(response: HostResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  response.end(JSON.stringify(body))
}

/** 看板快照：看板本身，外加它用到的组件元信息。 */
function snapshot(context: RouteContext): BoardSnapshot {
  const widgets: BoardSnapshot['widgets'] = {}
  for (const [id, record] of context.library) {
    widgets[id] = {
      hash: record.hash,
      title: record.manifest.title,
      sizes: record.manifest.sizes,
      ...(record.manifest.text === undefined ? {} : { text: record.manifest.text }),
    }
  }
  return { board: context.board, widgets }
}

/**
 * 生成前缀路由的处理器。
 *
 * @param context - 组件库、看板、资产与栅栏。
 * @returns 交给宿主 web 服务的处理器。
 */
export function createHandler(context: RouteContext): (req: HostRequest, res: HostResponse) => Promise<void> {
  return async (request, response) => {
    const rejection = rejectionOf(request, context.connection)
    if (rejection !== undefined) {
      response.writeHead(rejection)
      response.end()
      return
    }
    if (request.method !== 'GET') {
      response.writeHead(405, { allow: 'GET' })
      response.end()
      return
    }
    const url = new URL(request.url ?? '/', 'http://board.invalid')
    const path = url.pathname.startsWith(PLUGIN_ROUTE) ? url.pathname.slice(PLUGIN_ROUTE.length) : ''
    if (path === BOARD_PATH) {
      json(response, 200, snapshot(context))
      return
    }
    const document = /^\/widget\/([0-9a-f]{64})\/document$/.exec(path)
    const hash = document?.[1]
    const record = hash === undefined ? undefined : [...context.library.values()].find((candidate) => candidate.hash === hash)
    if (record === undefined) {
      response.writeHead(404)
      response.end()
      return
    }
    const nonce = freshNonce()
    const html = buildDocument(record, context.assets, nonce)
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': contentSecurityPolicy(nonce),
      // 文档里还内联着运行时与套件，组件哈希并不覆盖它们，所以不能按哈希长期缓存。
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
    })
    response.end(html)
  }
}
