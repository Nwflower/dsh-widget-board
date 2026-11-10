/**
 * 来源规则（技术契约 4、C4）。
 *
 * 内置与插件提供的组件是只读源：改它们时另存为一个新的用户组件 id，manifest 的 id 与目录名跟着
 * 一起改（C4）。已有用户组件也默认另存。
 *
 * 这几条判定是纯的：面板画按钮、宿主写目录都按它，两处不会给出不同的答案。
 */
import type { WidgetSource } from '@dsh-widget-board/contracts'

/** 组件 id 的形状：与 manifest 的 schema 与写入服务一致。 */
const ID_PATTERN = /^[a-z][a-z0-9-]{1,39}$/

/** 组件 id 的长度上限。 */
const ID_LIMIT = 39

/**
 * 一个组件来源对应的目标 id。
 *
 * @param id - 原组件的 id。
 * @param source - 原组件的来源。
 * @returns 就地改时是原 id；只读源另存时是一个新的用户组件 id。
 */
export function suggestedIdOf(id: string, source: WidgetSource): string {
  void source
  // 目录名要与 manifest 的 id 一致（C4）；`user-` 前缀说明它是从别处复制来的。
  const slug = id
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
    .slice(0, 24)
  const candidate = `user-${slug === '' ? 'widget' : slug}-${crypto.randomUUID().slice(0, 8)}`
  return candidate.slice(0, ID_LIMIT)
}

/**
 * 一个 id 能不能当组件 id 用。
 *
 * @param id - 候选 id。
 * @returns 合规时为真。
 */
export function isWidgetId(id: string): boolean {
  return ID_PATTERN.test(id)
}
