/** 卡片创建、内容读取与保存；失败沿用快照层的统一响应解码。 */
import type { CardContentModel, CardContentSaved, ContentIssue, InstanceComposeRequest, InstanceContentRequest, WidgetFormModel, WorkspaceSnapshot } from '@dsh-widget-board/contracts'
import { boardComposePath, instanceContentPath, libraryFormPath } from '@dsh-widget-board/contracts'
import { failureBodyOf, isWorkspace } from './snapshot'

/**
 * 内容写入被宿主拒绝：带着逐字段的原因，界面按路径把原因放到对应的那一行上。
 *
 * `subject` 是被拒的那一份（props、data 或 state）：宿主的路径从这一份的根算起，界面要按它分节。
 * 与 `PropsRejectedError` 分开，因为内容写入还会因为额度与修订号失败；那两种不该被画成字段错误。
 */
export class ContentRejectedError extends Error {
  constructor(message: string, readonly issues: ContentIssue[], readonly subject?: ContentIssueSubject) {
    super(message)
    this.name = 'ContentRejectedError'
  }
}

/** 内容写入的三份内容；宿主逐字段原因从各自那一份的根算起。 */
export type ContentIssueSubject = 'props' | 'data' | 'state'

/** 编辑器读到的那份修订号已经过期：宿主给了当前快照与最新修订号。 */
export class ContentStaleError extends Error {
  constructor(message: string, readonly revision: number | undefined, readonly snapshot: WorkspaceSnapshot | undefined) {
    super(message)
    this.name = 'ContentStaleError'
  }
}

/**
 * 读一份内容写入的失败响应：字段原因、修订号过期与普通失败分开。
 *
 * @param response - 失败的响应。
 * @param subject - 出错的这件事，写在消息开头。
 * @returns 抛出去的错误。
 */
async function contentFailureOf(response: Response, subject: string): Promise<Error> {
  const { body, message } = await failureBodyOf(response, subject)
  if (body.code === 'stale-revision') {
    return new ContentStaleError(message, typeof body.revision === 'number' ? body.revision : undefined, isWorkspace(body.snapshot) ? body.snapshot : undefined)
  }
  if (Array.isArray(body.issues)) return new ContentRejectedError(message, body.issues, body.subject)
  return new Error(message)
}

/**
 * 一次创建一张完整的卡片（技术契约 3）。
 *
 * @param boardId - 看板 id。
 * @param body - 组件、编辑器预览的那一版、props、data 与盒子。
 * @returns 新卡片的 id 与建完之后的工作区。
 * @throws {Error} 字段原因、修订号过期或普通失败。
 */
export async function composeInstance(boardId: string, body: InstanceComposeRequest): Promise<{ id: string, snapshot: WorkspaceSnapshot }> {
  const response = await fetch(boardComposePath(boardId), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw await contentFailureOf(response, '建不了这张卡片')
  const payload = await response.json() as { id?: unknown, snapshot?: unknown }
  if (!isWorkspace(payload.snapshot) || typeof payload.id !== 'string') throw new Error('建不了这张卡片：响应形状不对')
  return { id: payload.id, snapshot: payload.snapshot }
}

/**
 * 读一个组件的表单模型（技术契约 3）：创建器在还没建出实例时按它画表单与预览。
 *
 * @param id - 组件 id。
 * @returns 组件的 schema、文案与盒子。
 * @throws {Error} 请求失败或响应形状不对。
 */
export async function fetchWidgetForm(id: string): Promise<WidgetFormModel> {
  const response = await fetch(libraryFormPath(id), { headers: { accept: 'application/json' } })
  if (!response.ok) throw await contentFailureOf(response, '读不了这个组件的表单')
  const body = await response.json() as { widget?: WidgetFormModel }
  if (typeof body?.widget !== 'object' || body.widget === null) throw new Error('读不了这个组件的表单：响应形状不对')
  return body.widget
}

/**
 * 读一张卡的内容读模型（技术契约 3）。
 *
 * @param id - 卡片实例的 id。
 * @returns 实例、看板修订号与组件表单。
 * @throws {Error} 请求失败或响应形状不对。
 */
export async function fetchCardContent(id: string): Promise<CardContentModel> {
  const response = await fetch(instanceContentPath(id), { headers: { accept: 'application/json' } })
  if (!response.ok) throw await contentFailureOf(response, '读不了这张卡的内容')
  const model = await response.json() as CardContentModel
  if (typeof model?.instance !== 'object' || model.instance === null || typeof model.widget !== 'object' || model.widget === null) {
    throw new Error('读不了这张卡的内容：响应形状不对')
  }
  return model
}

/**
 * 保存一张卡的内容（技术契约 3）。
 *
 * @param id - 卡片实例的 id。
 * @param body - 读到的修订号与要改的那几项。
 * @returns 写入之后的修订号与存下来的内容。
 * @throws {Error} 字段原因、修订号过期或普通失败。
 */
export async function saveCardContent(id: string, body: InstanceContentRequest): Promise<CardContentSaved> {
  const response = await fetch(instanceContentPath(id), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw await contentFailureOf(response, '存不下这张卡的内容')
  const saved = await response.json() as CardContentSaved
  if (typeof saved?.revision !== 'number') throw new Error('存不下这张卡的内容：响应形状不对')
  return saved
}
