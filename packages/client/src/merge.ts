/**
 * 把一条变更通知并进页面上的快照（D18）。
 *
 * 状态与数据的写入就地合并，布局的提交就地换掉，两者都不再重取整份快照；卡片增删与组件库变化
 * 返回原快照，调用处据此重取。合并只认通知里带来的字段，缺的字段保留原值。
 */
import type { BoardEventFrame, BoardSnapshot, CardLayout } from '@dsh-widget-board/contracts'

/**
 * 合并一条通知。
 *
 * @param snapshot - 页面上的快照。
 * @param frame - 收到的一条通知。
 * @returns 合并后的快照；需要重取时是同一个对象。
 */
export function mergeEvent(snapshot: BoardSnapshot, frame: BoardEventFrame): BoardSnapshot {
  const { event } = frame
  if (event.type === 'instance') {
    return {
      ...snapshot,
      board: {
        ...snapshot.board,
        instances: snapshot.board.instances.map((instance) => {
          if (instance.id !== event.id) return instance
          return {
            ...instance,
            ...(event.state === undefined ? {} : { state: event.state }),
            ...(event.data === undefined ? {} : { data: event.data }),
          }
        }),
      },
    }
  }
  if (event.type === 'layout') {
    return {
      ...snapshot,
      board: {
        ...snapshot.board,
        layoutRevision: event.layoutRevision,
        instances: snapshot.board.instances.map((instance) => {
          const layout = event.layouts[instance.id] as CardLayout | undefined
          return layout === undefined ? instance : { ...instance, layout }
        }),
      },
    }
  }
  return snapshot
}

/**
 * 一条通知是不是需要重取快照。
 *
 * @param frame - 收到的一条通知。
 * @returns 卡片增删或组件库变化时为真。
 */
export function needsSnapshot(frame: BoardEventFrame): boolean {
  return frame.event.type === 'board'
}
