/** 看板排列切换：保存屏幕阅读顺序并沿用布局修订号。 */
import { useCallback, type MutableRefObject } from 'react'
import type { Arrangement, Board, WorkspaceSnapshot } from '@dsh-widget-board/contracts'
import { readOrderOf, resolveLayout, type GridMetrics } from '@dsh-widget-board/model'
import { groupCards, layoutItemsOf } from './group'
import { saveBoardArrangement } from './snapshot'

interface ArrangementControls {
  activeBoard: Board | null
  metrics: GridMetrics | null
  busyRef: MutableRefObject<boolean>
  setBusy: (busy: boolean) => void
  apply: (snapshot: WorkspaceSnapshot) => void
  onArrangement: (boardId: string, revision: number, arrangement: Arrangement) => void
  setFailure: (message: string) => void
  refetch: () => void
}

/** 两道忙碌闸门与看板保持同一份引用。 */
export function useBoardArrangement({ activeBoard, metrics, busyRef, setBusy, apply, onArrangement, setFailure, refetch }: ArrangementControls): () => void {
  /** 在两种排列模式之间切换：第一次切到整齐时把屏幕上的阅读顺序存成顺序（B2、D31）。 */
  return useCallback(() => {
    if (busyRef.current || activeBoard === null || metrics === null) return
    const arrangement = nextArrangementOf(activeBoard, metrics)
    busyRef.current = true
    setBusy(true)
    void saveBoardArrangement(activeBoard.id, activeBoard.layoutRevision, arrangement).then((result) => {
      if (result.kind === 'stale') apply(result.snapshot)
      else onArrangement(activeBoard.id, result.saved.layoutRevision, result.saved.arrangement)
    }, (error: Error) => {
      setFailure(error.message)
      refetch()
    }).finally(() => {
      busyRef.current = false
      setBusy(false)
    })
  }, [activeBoard, metrics, busyRef, setBusy, apply, onArrangement, setFailure, refetch])
}

/** 首次按实际屏幕阅读顺序建立偏好，后续切换恢复已存顺序与期望尺寸。 */
export function nextArrangementOf(board: Board, metrics: GridMetrics): Arrangement {
  if (board.arrangement?.mode === 'aligned') return { ...board.arrangement, mode: 'free' }
  if (board.arrangement?.aligned !== undefined) return { ...board.arrangement, mode: 'aligned' }
  const items = layoutItemsOf(groupCards(board.instances))
  const screen = resolveLayout(items, metrics)
  const ordered = readOrderOf(items.map(item => ({ id: item.id, layout: screen.layouts[item.id] ?? item.layout })))
  return {
    mode: 'aligned',
    aligned: {
      order: ordered.map(item => item.id),
      boxes: Object.fromEntries(ordered.map(item => [item.id, { w: item.layout.w, h: item.layout.h }])),
    },
  }
}
