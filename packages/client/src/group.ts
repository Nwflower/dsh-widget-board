import type { BoardInstance, CardLayout, WidgetLibraryEntry } from '@dsh-widget-board/contracts'
import { FLIP_GROUP_ID } from '@dsh-widget-board/contracts'

/** 看板上的一格：普通卡片，或一组翻面卡。 */
export type BoardCard =
  | { kind: 'single', instance: BoardInstance }
  | { kind: 'group', id: string, front: BoardInstance, back: BoardInstance }

/** 组件库里翻面组的那一行；它不是组件目录，添加时由宿主建出两张卡（D19）。 */
export const FLIP_GROUP_ENTRY: WidgetLibraryEntry = {
  id: FLIP_GROUP_ID,
  source: 'builtin',
  title: { zh: '翻面组', en: 'Flip group' },
  description: {
    zh: '正反各一张卡，鼠标移上去翻面；暂固定为数字与图表。',
    en: 'Two cards, one per side, flipped by hover; fixed to stat and chart for now.',
  },
  sizes: ['s', 'l'],
}

/**
 * 把看板上的实例分成普通卡片与组卡（D19）。
 *
 * 同一组的两张卡只算一格，盒子取正面那张；只有一侧的半个组按普通卡片画出来，不让它从看板上消失。
 *
 * @param instances - 看板上的全部实例。
 * @returns 按实例顺序排列的格子。
 */
export function groupCards(instances: readonly BoardInstance[]): BoardCard[] {
  const slots = new Map<string, { front?: BoardInstance, back?: BoardInstance }>()
  for (const instance of instances) {
    if (instance.group === undefined) continue
    const slot = slots.get(instance.group.id) ?? {}
    slot[instance.group.side] = instance
    slots.set(instance.group.id, slot)
  }
  const cards: BoardCard[] = []
  const seen = new Set<string>()
  for (const instance of instances) {
    if (instance.group === undefined) {
      cards.push({ kind: 'single', instance })
      continue
    }
    if (seen.has(instance.group.id)) continue
    seen.add(instance.group.id)
    const slot = slots.get(instance.group.id)
    if (slot?.front !== undefined && slot.back !== undefined) {
      cards.push({ kind: 'group', id: instance.group.id, front: slot.front, back: slot.back })
    } else if (slot?.front !== undefined) {
      cards.push({ kind: 'single', instance: slot.front })
    } else if (slot?.back !== undefined) {
      cards.push({ kind: 'single', instance: slot.back })
    }
  }
  return cards
}

/**
 * 一格的 id：组卡用正面的实例 id，布局提交与暂停登记都按它寻址。
 *
 * @param card - 看板上的一格。
 * @returns 实例 id。
 */
export function cardId(card: BoardCard): string {
  return card.kind === 'group' ? card.front.id : card.instance.id
}

/**
 * 一格的盒子：组卡取正面的那一份。
 *
 * @param card - 看板上的一格。
 * @returns 卡片盒子。
 */
export function cardLayout(card: BoardCard): CardLayout {
  return card.kind === 'group' ? card.front.layout : card.instance.layout
}

/**
 * 排布用的条目：一组只交一条。
 *
 * @param cards - 看板上的格子。
 * @returns 布局引擎要的 id 与盒子。
 */
export function layoutItemsOf(cards: readonly BoardCard[]): Array<{ id: string, layout: CardLayout }> {
  return cards.map((card) => ({ id: cardId(card), layout: cardLayout(card) }))
}
