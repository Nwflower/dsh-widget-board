/**
 * 看板的管理动作（D21、B1）：标签菜单与设置页读同一份标题规则与同一份计数，写也走同两条请求。
 *
 * 标题合不合规矩由 contracts 判定，宿主与界面因此不会各说各的；这里只把原因翻成当前语言的
 * 一句话。删除确认要说的「几格、几张卡」也从这里算：组卡是一格两张卡（D19）。
 */
import type { Board, BoardTitleProblem, WorkspaceSnapshot } from '@dsh-widget-board/contracts'
import { BOARD_TITLE_LIMIT, boardTitleLength, boardTitleProblem } from '@dsh-widget-board/contracts'
import { t } from '../copy'
import { groupCards } from '../group'
import { removeBoard, renameBoard } from '../snapshot'

/** 一块看板在删除确认里要报的两个数。 */
export interface BoardFacts {
  /** 排列格数：一组翻面卡算一格。 */
  cells: number
  /** 卡片实例数：一组翻面卡算两张。 */
  cards: number
}

/**
 * 数一块看板有几格、几张卡。
 *
 * @param board - 要看的那块看板。
 * @returns 格子与实例两个数。
 */
export function factsOf(board: Board): BoardFacts {
  return { cells: groupCards(board.instances).length, cards: board.instances.length }
}

/**
 * 把标题不合规矩的原因翻成一句话。
 *
 * @param problem - contracts 给出的原因。
 * @returns 当前语言下写给人看的一句话。
 */
export function titleProblemText(problem: BoardTitleProblem): string {
  if (problem === 'too-long') return t('boardTitleTooLong').replace('{n}', String(BOARD_TITLE_LIMIT))
  return t('boardTitleEmpty')
}

/**
 * 改一块看板的名字：先按同一份规则校验，再去掉首尾空白交给宿主。
 *
 * @param id - 看板 id。
 * @param title - 输入框里的原文。
 * @returns 改完之后的工作区。
 * @throws {Error} 标题不合规矩时带原因；宿主拒绝时带宿主的原因。
 */
export async function renameBoardTo(id: string, title: string): Promise<WorkspaceSnapshot> {
  const problem = boardTitleProblem(title)
  if (problem !== null) throw new Error(titleProblemText(problem))
  return await renameBoard(id, title.trim())
}

/**
 * 删除一块看板。宿主决定之后哪一块是当前看板；删到最后一块时它补一块空的。
 *
 * @param id - 看板 id。
 * @returns 删除之后的工作区。
 * @throws {Error} 宿主拒绝时带原因。
 */
export async function deleteBoardById(id: string): Promise<WorkspaceSnapshot> {
  return await removeBoard(id)
}

export { BOARD_TITLE_LIMIT, boardTitleLength, boardTitleProblem }
