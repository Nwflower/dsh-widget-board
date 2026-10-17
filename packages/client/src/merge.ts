/**
 * 把一条变更通知并进页面上的工作区（D18、D21）。
 *
 * 状态与数据的写入就地合并，布局的提交就地换掉那一块看板，换选中的通知只改一个字段；三者都不再
 * 重取整份快照，卡片与看板的增删、组件库变化返回原快照，调用处据此重取。合并只认通知里带来的
 * 字段，缺的字段保留原值；卡片 id 全工作区唯一，所以状态与数据的事件不必带看板。
 */
import type { BoardEventFrame, BoardInstance, CardLayout, WorkspaceSnapshot } from '@dsh-widget-board/contracts'

/**
 * 合并一条通知。
 *
 * @param snapshot - 页面上的工作区。
 * @param frame - 收到的一条通知。
 * @returns 合并后的工作区；没有任何一处被改动时是同一个对象。
 */
export function mergeEvent(snapshot: WorkspaceSnapshot, frame: BoardEventFrame): WorkspaceSnapshot {
  const { event } = frame
  if (event.type === 'instance') {
    let found = false
    const boards = snapshot.boards.map((board) => {
      const index = board.instances.findIndex((instance) => instance.id === event.id)
      if (index === -1) return board
      found = true
      const instances = board.instances.slice()
      const instance = instances[index] as BoardInstance
      instances[index] = {
        ...instance,
        ...(event.state === undefined ? {} : { state: event.state }),
        ...(event.data === undefined ? {} : { data: event.data }),
      }
      return { ...board, instances }
    })
    return found ? { ...snapshot, boards } : snapshot
  }
  if (event.type === 'layout') {
    const boards = snapshot.boards.map((board) => board.id !== event.board ? board : {
      ...board,
      layoutRevision: event.layoutRevision,
      instances: board.instances.map((instance) => {
        const layout = event.layouts[instance.id] as CardLayout | undefined
        return layout === undefined ? instance : { ...instance, layout }
      }),
    })
    return { ...snapshot, boards }
  }
  if (event.type === 'active') return { ...snapshot, active: event.board }
  return snapshot
}

/**
 * 一条通知是不是需要重取快照。
 *
 * @param frame - 收到的一条通知。
 * @returns 卡片或看板增删、组件库变化时为真。
 */
export function needsSnapshot(frame: BoardEventFrame): boolean {
  return frame.event.type === 'board'
}
