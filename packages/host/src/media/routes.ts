/** 仅人工界面通过已有请求栅栏上传与整理。沙箱读取仍走 capability。 */
import { MEDIA_INPUT_BYTES, type MediaBinding, type MediaRole } from '@dsh-widget-board/contracts'
import { readBody, readJson } from '../body'
import { isRecord } from '../guards'
import { Refusal } from '../refusal'
import { json } from '../response'
import type { Route, RouteContext } from '../routes'
import type { MediaStore } from './store'

export function mediaOf(context: RouteContext): MediaStore {
  if (!context.media) throw new Refusal(503, '媒体存储尚未启动')
  return context.media
}
export function mediaRoutes(): Route[] {
  return [
    { method: 'POST', pattern: /^\/media\/preview$/, limit: 1024, async handle(context, request, response) {
      const raw = await readJson(request, 1024)
      if (!isRecord(raw) || typeof raw.session !== 'string' || typeof raw.ticket !== 'string') throw new Refusal(400, '图片预览缺少会话或ticket')
      const bytes = await mediaOf(context).preview(raw.session, raw.ticket)
      response.writeHead(200, { 'content-type': 'image/webp', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
      response.end(bytes)
    } },
    { method: 'POST', pattern: /^\/media\/copy$/, limit: 4096, async handle(context, request, response) {
      const raw = await readJson(request, 4096)
      if (!isRecord(raw) || typeof raw.source !== 'string' || typeof raw.board !== 'string' || !context.workspace.has(raw.board)) throw new Refusal(400, '媒体复制目标不合法')
      json(response, 200, await mediaOf(context).copy(raw.source, `board:${raw.board}`, raw as MediaBinding))
    } },
    { method: 'POST', pattern: /^\/media\/sessions$/, limit: 1024, async handle(context, request, response) {
      const raw = await readJson(request, 1024)
      if (!isRecord(raw) || typeof raw.target !== 'string') throw new Refusal(400, '媒体会话缺少目标')
      const board = raw.target.startsWith('board:') ? raw.target.slice(6) : undefined
      if (board === undefined ? !context.workspace.findInstance(raw.target) : !context.workspace.has(board)) throw new Refusal(404, '媒体编辑目标不存在')
      json(response, 201, { session: mediaOf(context).session(raw.target) })
    } },
    { method: 'POST', pattern: /^\/media$/, limit: MEDIA_INPUT_BYTES, async handle(context, request, response) {
      const url = new URL(request.url ?? '/', 'http://board.invalid')
      const role = url.searchParams.get('role')
      if (role !== 'background' && role !== 'icon') throw new Refusal(400, '不支持的媒体角色')
      const bytes = await readBody(request, MEDIA_INPUT_BYTES)
      json(response, 201, await mediaOf(context).upload(url.searchParams.get('session') ?? '', role as MediaRole, bytes, String(request.headers['content-type'] ?? '').split(';')[0] as string))
    } },
    { method: 'POST', pattern: /^\/media\/collect$/, limit: 1024, async handle(context, request, response) {
      await readJson(request, 1024)
      json(response, 200, { removed: await mediaOf(context).collect() })
    } },
  ]
}
