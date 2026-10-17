/**
 * 授权闸门（D6）：一个动作或数据源能不能跑。
 *
 * 组件代码是不可信的，所以「组件在 manifest 里声明过它」只是第一道；插件提供的动作还要有人在授权
 * 表里为这张卡的**这个组件版本**给过授权。看板自己的数据源与动作由本插件提供，不是第三方代码，
 * 不经过这里（D3）。
 */
import type { ActionPermission, Board, GrantKind } from '@dsh-widget-board/contracts'
import { PACKAGE_NAME } from '@dsh-widget-board/contracts'
import { permissionMatches, type GrantStore } from './grants'
import { Refusal } from './refusal'

/** 判一次授权需要的事实。 */
export interface GrantFacts {
  board: Board
  /** 组件 id 到它当前版本的内容哈希；组件不在库里时没有这一项。 */
  hashes: ReadonlyMap<string, string>
  grants: GrantStore
}

/**
 * 这张卡上有没有跑这个动作、读这个数据源的授权。
 *
 * @param facts - 看板、组件版本与授权表。
 * @param instanceId - 卡片实例的 id。
 * @param kind - 授权指向的是动作还是数据源。
 * @param name - 动作或数据源的名字。
 * @param permission - 动作声明的权限；不需要权限时是 `undefined`。
 * @param provider - 提供方的包名。
 * @throws {Refusal} 没有这份授权（403），错误里带着缺的那一条与要问的权限。
 */
export function requireGrant(
  facts: GrantFacts,
  instanceId: string,
  kind: GrantKind,
  name: string,
  permission: ActionPermission | undefined,
  provider: string,
): void {
  if (kind === 'source' && provider === PACKAGE_NAME) return
  if (kind === 'action' && permission === undefined) return
  const instance = facts.board.instances.find((candidate) => candidate.id === instanceId)
  const hash = instance === undefined ? undefined : facts.hashes.get(instance.widget)
  if (hash === undefined) throw new Refusal(400, '这张卡的组件不在组件库里，先把它装回来', { code: 'widget-missing' })
  const grant = facts.grants.all().find((candidate) => candidate.kind === kind && candidate.hash === hash && candidate.id === name)
  const ask = {
    code: 'grant-required',
    kind,
    id: name,
    provider,
    widget: instance?.widget,
    ...(permission === undefined ? {} : { permission }),
  }
  if (grant === undefined) throw new Refusal(403, `要用 ${name}，先由人给出授权`, ask)
  if (kind === 'action' && !permissionMatches(permission, grant.permission)) {
    throw new Refusal(403, `${name} 现在要的权限与授权时不一样了，要重新给出授权`, ask)
  }
}
