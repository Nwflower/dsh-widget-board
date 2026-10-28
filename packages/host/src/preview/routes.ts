/**
 * 预览的三条路由（技术契约 5）。
 *
 * `POST /preview` 上传一份已校验的文件与预览数据，返回一个不可猜测的会话 id；`GET /preview/<id>/document`
 * 输出由 `buildDocument` 生成的预览文档；`DELETE /preview/<id>` 释放。
 *
 * 预览的一切都只留在会话里：不写正式的 widgets、versions、boards 或 grants（技术契约 5）。
 */
import { readJson } from '../body'
import { contentSecurityPolicy } from '../document'
import { isRecord } from '../guards'
import { Refusal } from '../refusal'
import { json } from '../response'
import type { Route, RouteContext } from '../routes'
import type { PreviewStore } from './store'

/** 上传预览内容的请求体上限：与一个组件目录同量。 */
export const PREVIEW_LIMIT = 16 * 1024 * 1024

/**
 * 读预览请求里的文件表。
 *
 * @param value - 请求里的 files。
 * @returns 相对路径到内容的映射。
 * @throws {Refusal} 形状不对。
 */
function filesOf(value: unknown): Record<string, string> {
  if (!isRecord(value)) throw new Refusal(400, '预览的文件要是一个对象')
  const files: Record<string, string> = {}
  for (const [path, content] of Object.entries(value)) {
    if (typeof content !== 'string') throw new Refusal(400, `预览的文件 ${path} 的内容要是字符串`)
    files[path] = content
  }
  return files
}

/**
 * 预览的三条路由。
 *
 * @param previews - 预览会话的管理处。
 * @returns 路由表。
 */
export function previewRoutes(previews: PreviewStore): Route[] {
  return [
    {
      method: 'POST',
      pattern: /^\/preview$/,
      limit: PREVIEW_LIMIT,
      async handle(context, request, response) {
        const body = await readJson(request, PREVIEW_LIMIT)
        if (!isRecord(body)) throw new Refusal(400, '预览要是一个 JSON 对象')
        const props = body.props === undefined ? {} : body.props
        if (!isRecord(props)) throw new Refusal(400, '预览的 props 要是一个对象')
        const session = await previews.create({
          files: filesOf(body.files),
          ...(body.binaryFiles === undefined ? {} : { binaryFiles: filesOf(body.binaryFiles) }),
          props,
          data: body.data ?? null,
          state: body.state ?? null,
        }, context.live.assets)
        json(response, 201, session)
      },
    },
    {
      method: 'GET',
      pattern: /^\/preview\/([^/]+)\/document$/,
      limit: 0,
      async handle(context, request, response, match) {
        const id = decodeURIComponent(match[1] as string)
        const lang = new URL(request.url ?? '/', 'http://board.invalid').searchParams.get('lang') ?? 'zh-CN'
        const { html, nonce } = previews.document(id, context.live.assets, lang)
        // 预览与正式卡片用同一份 CSP：不给 same-origin，不放开网络（D3、技术契约 5）。
        response.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'content-security-policy': contentSecurityPolicy(nonce),
          'cache-control': 'no-store',
          'referrer-policy': 'no-referrer',
        })
        response.end(html)
      },
    },
    {
      method: 'DELETE',
      pattern: /^\/preview\/([^/]+)$/,
      limit: 0,
      async handle(_context, _request, response, match) {
        const id = decodeURIComponent(match[1] as string)
        const released = previews.release(id)
        json(response, 200, { released })
      },
    },
  ]
}
