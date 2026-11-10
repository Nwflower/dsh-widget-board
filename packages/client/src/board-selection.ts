/**
 * 看板标签的切换（D21）：先按本地换过去，宿主的答复到了再以它为准。
 *
 * 请求带序号：连点多块标签或与改名、新建交错时，先发后到的旧答复不能把选中改回去。
 */
import { useCallback } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { WorkspaceSnapshot } from '@dsh-widget-board/contracts'
import { activateBoard } from './snapshot'

export function useBoardSelection(
  snapshot: WorkspaceSnapshot | null,
  busyRef: MutableRefObject<boolean>,
  editorOpen: boolean,
  closeEditor: () => void,
  activationRef: MutableRefObject<number>,
  apply: (next: WorkspaceSnapshot) => void,
  refetch: () => void,
  setFailure: (message: string) => void,
  setSnapshot: Dispatch<SetStateAction<WorkspaceSnapshot | null>>,
): (id: string) => void {
  return useCallback((id: string) => {
    if (snapshot === null || id === snapshot.active || busyRef.current) return
    if (editorOpen) closeEditor()
    const activation = activationRef.current + 1
    activationRef.current = activation
    setSnapshot((previous) => previous === null ? previous : { ...previous, active: id })
    activateBoard(id).then((next) => {
      if (activation !== activationRef.current) return
      apply(next)
    }, (error: Error) => {
      if (activation !== activationRef.current) return
      setFailure(error.message)
      refetch()
    })
  }, [apply, busyRef, closeEditor, editorOpen, refetch, setFailure, setSnapshot, snapshot, activationRef])
}
