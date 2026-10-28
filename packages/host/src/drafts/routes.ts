/**
 * 草稿的三条路由（技术契约 4）。
 *
 * `POST /drafts` 写一份草稿，`GET /drafts/<id>` 读一份，`DELETE /drafts/<id>` 删一份。另有
 * `GET /drafts` 列出全部草稿的摘要。它们只操作插件自己的 `drafts/` 目录：客户端给的文件路径一律
 * 不接受。
 */
import type { WidgetDraft } from '@dsh-widget-board/contracts'
import { readJson } from '../body'
import { isRecord } from '../guards'
import { Refusal } from '../refusal'
import { json } from '../response'
import type { Route, RouteContext } from '../routes'
import type { DraftStore } from './store'

/** 写一份草稿的请求体上限：一个组件目录的大小。 */
export const DRAFT_LIMIT_BYTES = 16 * 1024 * 1024

/**
 * 读请求里的草稿内容。
 *
 * @param value - 解出来的请求体。
 * @returns 草稿内容。
 * @throws {Refusal} 形状不对。
 */
function draftOf(value: unknown): Omit<WidgetDraft, 'draftId' | 'updatedAt'> & { draftId?: string } {
  if (!isRecord(value)) throw new Refusal(400, '草稿要是一个 JSON 对象')
  if (!isRecord(value.target)) throw new Refusal(400, '草稿要写明 target')
  const target = value.target
  if (target.kind !== 'instance' && target.kind !== 'widget') {
    throw new Refusal(400, '草稿的 target.kind 只能是 instance 或 widget')
  }
  if (target.kind === 'instance' && typeof target.instanceId !== 'string') {
    throw new Refusal(400, '草稿的 target 要写明 instanceId')
  }
  if (target.kind === 'widget' && typeof target.widgetId !== 'string') {
    throw new Refusal(400, '草稿的 target 要写明 widgetId')
  }
  if (value.files !== undefined && !isRecord(value.files)) throw new Refusal(400, '草稿的 files 要是一个对象')
  if (value.form !== undefined && !isRecord(value.form)) throw new Refusal(400, '草稿的 form 要是一个对象')
  if (value.base !== undefined && !isRecord(value.base)) throw new Refusal(400, '草稿的 base 要是一个对象')
  return {
    ...(typeof value.draftId === 'string' ? { draftId: value.draftId } : {}),
    target: target.kind === 'instance'
      ? { kind: 'instance', instanceId: target.instanceId as string }
      : { kind: 'widget', widgetId: target.widgetId as string },
    base: value.base === undefined ? {} : value.base as WidgetDraft['base'],
    ...(value.files === undefined ? {} : { files: value.files as Record<string, string> }),
    ...(value.binaryFiles === undefined ? {} : { binaryFiles: value.binaryFiles as Record<string, string> }),
    ...(value.form === undefined ? {} : { form: value.form as WidgetDraft['form'] }),
  }
}

/**
 * 草稿的三条路由。
 *
 * @param drafts - 草稿的存储。
 * @returns 路由表。
 */
export function draftRoutes(drafts: DraftStore): Route[] {
  return [
    {
      method: 'GET',
      pattern: /^\/drafts$/,
      limit: 0,
      async handle(_context, _request, response) {
        json(response, 200, { drafts: await drafts.list() })
      },
    },
    {
      method: 'POST',
      pattern: /^\/drafts$/,
      limit: DRAFT_LIMIT_BYTES,
      async handle(_context, request, response) {
        const body = await readJson(request, DRAFT_LIMIT_BYTES)
        const saved = await drafts.save(draftOf(body))
        json(response, 201, saved)
      },
    },
    {
      method: 'GET',
      pattern: /^\/drafts\/([^/]+)$/,
      limit: 0,
      async handle(_context, _request, response, match) {
        const id = decodeURIComponent(match[1] as string)
        const draft = await drafts.get(id)
        if (draft === undefined) throw new Refusal(404, `没有这一份草稿：${id}`)
        json(response, 200, draft)
      },
    },
    {
      method: 'DELETE',
      pattern: /^\/drafts\/([^/]+)$/,
      limit: 0,
      async handle(_context, _request, response, match) {
        const id = decodeURIComponent(match[1] as string)
        const removed = await drafts.remove(id)
        json(response, 200, { removed })
      },
    },
  ]
}
