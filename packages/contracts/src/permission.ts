/**
 * 授权：谁能跑一个动作、读一个数据源（D6）。
 *
 * 组件代码是不可信的（D3）：内置、用户目录与 agent 写出来的组件都可能声明一个自己不该有的动作。
 * 因此一个动作要真的跑起来，需要两件事同时成立——组件在自己的 manifest 里声明过它，且有人为这张
 * 卡的**这个组件版本**给出过授权。授权绑在内容哈希上：组件改了内容，之前给的授权就失效，要重新问
 * 一次。
 *
 * 插件注册的动作由插件自己提供，提供方在组件目录里声明这个动作时一并声明了它的权限
 * （`ActionRegistration.permission`）；这里记录的只有人给出的那部分。
 */
import type { ActionPermission } from './service'

/** 授权指向的一类东西。 */
export const GRANT_KINDS = ['action', 'source'] as const

/** 一类授权。 */
export type GrantKind = (typeof GRANT_KINDS)[number]

/**
 * 一条由人给出的授权。
 *
 * `id` 是数据源或动作的名字（需要时写成 `提供方:名字`）。`key` 由实现从组件版本与 `id` 算出来，
 * 界面不解释它的内容。
 */
export interface Grant {
  key: string
  kind: GrantKind
  id: string
  /** 组件内容的哈希：授权绑在这个版本上（D7）。 */
  hash: string
  /** 给出授权的人看到的组件 id，只用来在界面上分组。 */
  widget: string
  /** 提供方的包名；看板自己的动作没有它。 */
  provider?: string
  /** 这个动作要的权限；数据源授权没有它。 */
  permission?: ActionPermission
  /** 给出的时刻，ISO 字符串。 */
  at: string
}

/** 一个版本、一类东西、一个名字算出来的授权 key。 */
export function grantKey(kind: GrantKind, hash: string, id: string): string {
  return `${kind}\u0000${hash}\u0000${id}`
}
