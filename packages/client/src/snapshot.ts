/**
 * 快照：从宿主读看板与它用到的组件（D5）。
 *
 * 宿主是唯一权威；看板页打开时取一次，之后随变更通知重取（D7 的热重载）。
 */
import type { BoardSnapshot, InstanceStateRequest } from '@dsh-widget-board/contracts'
import { BOARD_PATH, CLIENT_ROUTE, instanceStatePath } from '@dsh-widget-board/contracts'

/**
 * 读一次看板快照。
 *
 * @returns 宿主上的看板与组件元信息。
 * @throws {Error} 请求失败或响应不是快照。
 */
export async function fetchSnapshot(): Promise<BoardSnapshot> {
  const response = await fetch(`${CLIENT_ROUTE}${BOARD_PATH}`, { headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(`看板快照读不出来：HTTP ${response.status}`)
  const snapshot = await response.json() as BoardSnapshot
  if (!Array.isArray(snapshot?.board?.instances)) throw new Error('看板快照的形状不对：没有 instances')
  return snapshot
}

/**
 * 把一张卡的界面状态交给宿主存下来（D5）：切走再切回来、组件热重载之后都还接得上。
 *
 * @param id - 卡片实例的 id。
 * @param patch - 组件送来的补丁。
 * @throws {Error} 请求失败。
 */
export async function saveInstanceState(id: string, patch: unknown): Promise<void> {
  const body: InstanceStateRequest = { patch }
  const response = await fetch(instanceStatePath(id), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`存不下这张卡的状态：HTTP ${response.status}`)
}
