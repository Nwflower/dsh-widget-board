/**
 * 快照：从宿主读看板与它用到的组件（D5）。
 *
 * 宿主是唯一权威；看板页打开时取一次，之后随变更通知重取（D7 的热重载）。
 */
import type { BoardSnapshot } from '@dsh-widget-board/contracts'
import { BOARD_PATH, CLIENT_ROUTE } from '@dsh-widget-board/contracts'

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
