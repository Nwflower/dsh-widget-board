/**
 * 高级源码、草稿与预览的宿主接口（技术契约 4—5）。
 *
 * 这一份只管与宿主说话：读源码、写组件、存草稿与开预览会话。看板、卡片与内容那几组调用在
 * `snapshot.ts` 里，两边都不写对方的读模型（技术契约 3 与 4—5 的形状各写一次）。
 */
import type {
  PreviewCreateRequest,
  PreviewSession,
  WidgetDefineRequest,
  WidgetDefined,
  WidgetDraft,
  WidgetDraftSummary,
  WidgetSourceModel,
} from '@dsh-widget-board/contracts'
import {
  draftPath,
  draftsPath,
  libraryDefinePath,
  librarySourcePath,
  previewPath,
} from '@dsh-widget-board/contracts'
import { isRecord } from './schema'

/**
 * 读一份失败响应里的原因。
 *
 * @param response - 失败的响应。
 * @param subject - 出错的这件事，写在消息开头。
 * @returns 拼好的消息。
 */
async function errorOf(response: Response, subject: string): Promise<string> {
  let body: { error?: string, code?: string, current?: string } = {}
  try {
    body = await response.json() as typeof body
  } catch {
    return `${subject}：HTTP ${response.status}`
  }
  return body.error === undefined ? `${subject}：HTTP ${response.status}` : `${subject}：${body.error}`
}

/**
 * 写一个组件类型时撞上了并发：宿主说这一版已经变了（技术契约 4）。
 *
 * 界面据此重读组件库并保留人的输入：不能静默覆盖别人刚写的那一版。
 */
export class SourceConflictError extends Error {
  constructor(message: string, readonly current: string | undefined) {
    super(message)
    this.name = 'SourceConflictError'
  }
}

/**
 * 读一个组件类型的全部源码（技术契约 4）。
 *
 * @param id - 组件 id。
 * @returns 源码读模型。
 * @throws {Error} 请求失败或响应形状不对。
 */
export async function fetchWidgetSource(id: string): Promise<WidgetSourceModel> {
  const response = await fetch(librarySourcePath(id), { headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(await errorOf(response, '读不了这个组件的源码'))
  const model = await response.json() as WidgetSourceModel
  if (typeof model?.id !== 'string' || typeof model?.hash !== 'string' || !isRecord(model.files)) {
    throw new Error('读不了这个组件的源码：响应形状不对')
  }
  return model
}

/**
 * 写一个用户组件类型（技术契约 4）。
 *
 * @param body - 组件 id、manifest、文件与读到的哈希。
 * @returns 写下的组件。
 * @throws {SourceConflictError | Error} 版本对不上，或请求失败。
 */
export async function defineWidget(body: WidgetDefineRequest): Promise<WidgetDefined> {
  const response = await fetch(libraryDefinePath(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const failureResponse = response.clone()
    const message = await errorOf(response, '存不下这个组件')
    let current: string | undefined
    try {
      const failure = await failureResponse.json() as { code?: string, current?: string }
      if (failure.code === 'stale-hash') {
        current = typeof failure.current === 'string' ? failure.current : undefined
        throw new SourceConflictError(message, current)
      }
    } catch (caught) {
      if (caught instanceof SourceConflictError) throw caught
    }
    throw new Error(message)
  }
  const written = await response.json() as WidgetDefined
  if (typeof written?.id !== 'string' || typeof written?.hash !== 'string') {
    throw new Error('存不下这个组件：响应形状不对')
  }
  return written
}

/**
 * 列出全部草稿（技术契约 4）。
 *
 * @returns 草稿摘要，按更新时间从新到旧。
 * @throws {Error} 请求失败。
 */
export async function fetchDrafts(): Promise<WidgetDraftSummary[]> {
  const response = await fetch(draftsPath(), { headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(await errorOf(response, '读不了草稿列表'))
  const body = await response.json() as { drafts?: unknown }
  if (!Array.isArray(body.drafts)) throw new Error('读不了草稿列表：响应形状不对')
  return body.drafts as WidgetDraftSummary[]
}

/**
 * 写一份草稿（技术契约 4）。
 *
 * @param draft - 草稿内容；`draftId` 省略时新造一份。
 * @returns 存下来的那一份。
 * @throws {Error} 请求失败；草稿已满或含凭据值时带上宿主给的原因。
 */
export async function saveDraft(draft: Omit<WidgetDraft, 'draftId' | 'updatedAt'> & { draftId?: string, updatedAt?: string }): Promise<WidgetDraft> {
  const response = await fetch(draftsPath(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(draft),
  })
  if (!response.ok) throw new Error(await errorOf(response, '存不下这份草稿'))
  const saved = await response.json() as WidgetDraft
  if (typeof saved?.draftId !== 'string') throw new Error('存不下这份草稿：响应形状不对')
  return saved
}

/**
 * 读一份草稿（技术契约 4）。
 *
 * @param id - 草稿 id。
 * @returns 那份草稿。
 * @throws {Error} 请求失败或没有这一份。
 */
export async function fetchDraft(id: string): Promise<WidgetDraft> {
  const response = await fetch(draftPath(id), { headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(await errorOf(response, '读不了这份草稿'))
  const draft = await response.json() as WidgetDraft
  if (typeof draft?.draftId !== 'string') throw new Error('读不了这份草稿：响应形状不对')
  return draft
}

/**
 * 删掉一份草稿（技术契约 4）。
 *
 * @param id - 草稿 id。
 * @returns 删掉了没有。
 * @throws {Error} 请求失败。
 */
export async function removeDraft(id: string): Promise<boolean> {
  const response = await fetch(draftPath(id), { method: 'DELETE' })
  if (!response.ok) throw new Error(await errorOf(response, '删不掉这份草稿'))
  const body = await response.json() as { removed?: unknown }
  return body.removed === true
}

/**
 * 新建一个预览会话（技术契约 5）。
 *
 * @param body - 预览的文件与数据。
 * @returns 会话。
 * @throws {Error} 请求失败；文件不合法或同时的会话已满时带上宿主给的原因。
 */
export async function createPreview(body: PreviewCreateRequest): Promise<PreviewSession> {
  const response = await fetch(previewPath(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(await errorOf(response, '开不了这个预览'))
  const session = await response.json() as PreviewSession
  if (typeof session?.previewId !== 'string') throw new Error('开不了这个预览：响应形状不对')
  return session
}

/**
 * 释放一个预览会话（技术契约 5）。
 *
 * @param id - 预览 id。
 * @returns 释放了没有。
 * @throws {Error} 请求失败。
 */
export async function releasePreview(id: string): Promise<boolean> {
  const response = await fetch(`${previewPath()}/${encodeURIComponent(id)}`, { method: 'DELETE' })
  if (!response.ok) throw new Error(await errorOf(response, '关不掉这个预览'))
  const body = await response.json() as { released?: unknown }
  return body.released === true
}
