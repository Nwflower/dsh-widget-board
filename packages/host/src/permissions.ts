/**
 * 授权闸门（D6）：一个动作或数据源能不能跑。
 *
 * 组件代码是不可信的，所以「组件在 manifest 里声明过它」只是第一道；插件提供的动作还要有人在授权
 * 表里为这张卡的**这个组件版本**给过授权。看板自己的数据源与动作由本插件提供，不是第三方代码，
 * 不经过这里（D3）。
 */
import type { ActionPermission, Board, GrantKind } from '@dsh-widget-board/contracts'
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
 * 没有声明权限的动作与数据源不必问人：它们只读看板自己的东西（D6）。声明了权限的，要有一份绑在
 * 这个组件版本与这个名字上的授权，且授权里记下的权限要与现在要的一致。
 *
 * @param facts - 看板、组件版本与授权表。
 * @param instanceId - 卡片实例的 id。
 * @param kind - 授权指向的是动作还是数据源。
 * @param name - 动作或数据源的名字。
 * @param permission - 它声明的权限；不需要权限时是 `undefined`。
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
  const problem = grantProblemOf(facts, instanceId, kind, name, permission, provider)
  if (problem !== undefined) throw problem
}

/**
 * 与 {@link requireGrant} 同一个判定，但把拒绝交回来而不是抛出。
 *
 * 宿主自己要启停一条持续的路（D32 的数据订阅）时用：授权不在就不开、已经开着的退掉，这不是一次请求
 * 的失败，不必抛。
 *
 * @param facts - 看板、组件版本与授权表。
 * @param instanceId - 卡片实例的 id。
 * @param kind - 授权指向的是动作、数据源还是能力。
 * @param name - 名字。
 * @param permission - 它声明的权限；不需要权限时是 `undefined`。
 * @param provider - 提供方的包名。
 * @returns 缺授权或组件不在库里时为那条拒绝，否则是 `undefined`。
 */
export function grantProblemOf(
  facts: GrantFacts,
  instanceId: string,
  kind: GrantKind,
  name: string,
  permission: ActionPermission | undefined,
  provider: string,
): Refusal | undefined {
  if (permission === undefined) return undefined
  const instance = facts.board.instances.find((candidate) => candidate.id === instanceId)
  const hash = instance === undefined ? undefined : facts.hashes.get(instance.widget)
  if (instance === undefined || hash === undefined) {
    return new Refusal(400, '这张卡的组件不在组件库里，先把它装回来', { code: 'widget-missing' })
  }
  return grantProblemIn(facts.grants, instance.widget, hash, kind, name, permission, provider)
}

/**
 * 一次授权核对本身（D6）：有这个版本与这个名字的授权，且授权时记下的权限与现在要的一致。
 *
 * 看板上的卡片经 {@link grantProblemOf} 按卡片找到组件版本；不在看板上的一次性快照直接拿着组件的
 * 哈希进来。判定只有这一份。
 *
 * @param grants - 授权表。
 * @param widget - 组件 id。
 * @param hash - 这张卡实际渲染的组件版本。
 * @param kind - 授权指向的是动作、数据源还是能力。
 * @param name - 名字。
 * @param permission - 它声明的权限。
 * @param provider - 提供方的包名。
 * @returns 缺授权或权限对不上时为那条拒绝，否则是 `undefined`。
 */
function grantProblemIn(
  grants: GrantStore,
  widget: string,
  hash: string,
  kind: GrantKind,
  name: string,
  permission: ActionPermission,
  provider: string,
): Refusal | undefined {
  const grant = grants.all().find((candidate) => candidate.kind === kind && candidate.hash === hash && candidate.id === name)
  const ask = {
    code: 'grant-required',
    kind,
    id: name,
    provider,
    widget,
    permission,
  }
  if (grant === undefined) return new Refusal(403, `要用 ${name}，先由人给出授权`, ask)
  if (!permissionMatches(permission, grant.permission)) {
    return new Refusal(403, `${name} 现在要的权限与授权时不一样了，要重新给出授权`, ask)
  }
  return undefined
}

/**
 * 按组件版本与名字核对一份授权，缺了就抛出（D6）。
 *
 * @param grants - 授权表。
 * @param widget - 组件 id。
 * @param hash - 这张卡实际渲染的组件版本。
 * @param kind - 授权指向的是动作、数据源还是能力。
 * @param name - 名字。
 * @param permission - 它声明的权限。
 * @param provider - 提供方的包名。
 * @throws {Refusal} 没有这份授权（403），错误里带着缺的那一条与要问的权限。
 */
export function requireGrantOf(
  grants: GrantStore,
  widget: string,
  hash: string,
  kind: GrantKind,
  name: string,
  permission: ActionPermission,
  provider: string,
): void {
  const problem = grantProblemIn(grants, widget, hash, kind, name, permission, provider)
  if (problem !== undefined) throw problem
}
