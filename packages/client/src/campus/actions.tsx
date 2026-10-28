/** 公共内容管理动作只操作发消息的实例；预览和一次性快照由调用层拒绝。 */
import { createRoot } from 'react-dom/client'
import type { FrameHost } from '../frame-host'
import type { ShellTheme } from '../theme'
import { fetchCardContent, fetchWorkspace, saveCardContent } from '../snapshot'
import { campusState, setCampusStatus, isCampusSchema } from '@dsh-widget-board/model/campus/model'

const dialogs = new Map<string, () => void>()
export function closeCampusDialog(instance: string): void { dialogs.get(instance)?.() }
export async function campusAction(id: string, action: string, payload: unknown, anchor: HTMLElement, theme: ShellTheme, frames: FrameHost, live: () => boolean): Promise<void> {
  const content = await fetchCardContent(id)
  if (!live()) return
  if (action === 'widget-board:campus-status') {
    if (!isCampusSchema(content.widget.stateSchema)) throw new Error('此组件未声明校园事项结构')
    if (!payload || typeof payload !== 'object' || !('itemId' in payload) || typeof payload.itemId !== 'string' || !('status' in payload) || !['todo', 'done', 'cancelled'].includes(String(payload.status))) throw new Error('事项动作无效')
    const state = setCampusStatus(campusState(content.instance.state), payload.itemId, payload.status as 'todo' | 'done' | 'cancelled', new Date().toISOString())
    await saveCardContent(id, { expectedRevision: content.revision, state })
    return
  }
  if (dialogs.has(id)) return
  const snapshot = await fetchWorkspace()
  const board = snapshot.boards.find(entry => entry.instances.some(item => item.id === id))
  if (!board || !live()) return
  const { ContentEditor } = await import('../composer/content-editor')
  if (!live() || dialogs.has(id)) return
  const container = document.createElement('div')
  anchor.append(container)
  const root = createRoot(container)
  const close = (): void => { dialogs.delete(id); root.unmount(); container.remove() }
  dialogs.set(id, close)
  root.render(<ContentEditor instanceId={id} board={board} widgets={snapshot.widgets} library={snapshot.library} theme={theme} frames={frames} anchor={anchor} onSaved={() => { /* 宿主变更通知更新看板 */ }} onClose={close} onDone={close} />)
}
