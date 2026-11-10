/** 校园事项与文件交换共用的日期和内容形状。 */
export type Due = { kind: 'date', date: string, timeZone: string } | { kind: 'instant', at: string, timeZone: string }
export type CampusStatus = 'todo' | 'done' | 'cancelled'
export interface CampusItem {
  id: string
  kind: 'deadline' | 'milestone'
  title: string
  category: string
  due: Due
  status: CampusStatus
  url?: string
  note?: string
  source: string
  sourceUid?: string
  createdAt: string
  updatedAt: string
}
