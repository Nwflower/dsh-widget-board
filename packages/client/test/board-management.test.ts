/**
 * 看板管理的纯逻辑（D21、B1）：标题规则与删除确认要报的两个数。
 *
 * 判定函数住在 contracts，宿主与界面读同一份；这里核对界面这一侧不会自己发明另一套说法。
 */
import { describe, expect, it } from 'vitest'
import type { Board, BoardInstance } from '@dsh-widget-board/contracts'
import { BOARD_TITLE_LIMIT, boardTitleLength, boardTitleProblem } from '../src/board-management/actions'
import { factsOf } from '../src/board-management/actions'

/** 一张普通卡。 */
function card(id: string, group?: { id: string, side: 'front' | 'back' }): BoardInstance {
  return {
    id,
    widget: 'weather',
    hash: 'a'.repeat(64),
    props: {},
    data: null,
    state: null,
    layout: { x: 0, y: 0, w: 1, h: 22 },
    ...(group === undefined ? {} : { group: { ...group, template: 'flip' as const } }),
  }
}

/** 一块装着这些卡的看板。 */
function boardWith(instances: BoardInstance[]): Board {
  return { version: 2, id: 'board', title: '看板', revision: 1, layoutRevision: 1, instances }
}

describe('看板标题规则', () => {
  it('去掉首尾空白之后不能是空的', () => {
    expect(boardTitleProblem('   ')).toBe('empty')
    expect(boardTitleProblem('')).toBe('empty')
    expect(boardTitleProblem(' 工作 ')).toBeNull()
  })

  it('不是文字时说不是文字', () => {
    expect(boardTitleProblem(42)).toBe('not-text')
    expect(boardTitleProblem(undefined)).toBe('not-text')
  })

  it('上限之内与正好到上限都收下', () => {
    expect(boardTitleProblem('好'.repeat(BOARD_TITLE_LIMIT))).toBeNull()
    expect(boardTitleProblem('好'.repeat(BOARD_TITLE_LIMIT + 1))).toBe('too-long')
  })

  it('按字符数，星号表情只算一个', () => {
    expect(boardTitleLength('📌📌')).toBe(2)
    expect(boardTitleProblem('📌'.repeat(BOARD_TITLE_LIMIT))).toBeNull()
    expect(boardTitleProblem('📌'.repeat(BOARD_TITLE_LIMIT + 1))).toBe('too-long')
  })

  it('首尾空白不占额度', () => {
    expect(boardTitleProblem(` ${'好'.repeat(BOARD_TITLE_LIMIT)} `)).toBeNull()
  })
})

describe('删除确认里的两个数', () => {
  it('空看板是零格零卡', () => {
    expect(factsOf(boardWith([]))).toEqual({ cells: 0, cards: 0 })
  })

  it('普通卡一格一张', () => {
    expect(factsOf(boardWith([card('a'), card('b')]))).toEqual({ cells: 2, cards: 2 })
  })

  it('一组翻面卡算一格、两张卡', () => {
    const group = boardWith([
      card('front', { id: 'g', side: 'front' }),
      card('back', { id: 'g', side: 'back' }),
      card('plain'),
    ])
    expect(factsOf(group)).toEqual({ cells: 2, cards: 3 })
  })

  it('只剩一侧的半个组仍按一格算，不从画面上消失', () => {
    expect(factsOf(boardWith([card('back', { id: 'g', side: 'back' })]))).toEqual({ cells: 1, cards: 1 })
  })
})
