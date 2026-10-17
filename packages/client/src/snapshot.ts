/**
 * 快照与提交：从宿主读看板、把用户的动作交给宿主（D5）。
 *
 * 宿主是唯一权威；看板页打开时取一次，之后靠变更通知就地合并，只有卡片增删与组件库变化才重取
 * （D18）。
 */
import type { BoardLayoutRequest, BoardSnapshot, CardLayout, GrantKind, GroupAddRequest, GroupRemoveRequest, InstanceAddRequest, InstanceStateRequest } from '@dsh-widget-board/contracts'
import { BOARD_PATH, CLIENT_ROUTE, boardGroupPath, boardGroupRemovePath, boardInstancePath, boardLayoutPath, instanceActionPath, instanceDataPath, instanceGrantPath, instanceReadPath, instanceRemovePath, instanceRevokePath, instanceStatePath, refreshPath } from '@dsh-widget-board/contracts'

/** 读一份失败响应里的原因。 */
async function errorOf(response: Response, subject: string): Promise<string> {
  return (await failureOf(response, subject)).message
}

/**
 * 宿主因为缺授权而拒绝了一次动作或一次读数据（D6）。
 *
 * 卡片据此把「允许」按钮画出来：授权只由人给出，所以界面要能把这件事说清楚并让人点一下。
 */
export class GrantRequiredError extends Error {
  constructor(message: string, readonly kind: GrantKind, readonly id: string, readonly provider: string | undefined) {
    super(message)
    this.name = 'GrantRequiredError'
  }
}

/**
 * 读一份失败响应：缺授权时给 `GrantRequiredError`，其余给普通错误。
 *
 * @param response - 失败的响应。
 * @param subject - 出错的这件事，写在消息开头。
 * @returns 抛出去的错误。
 */
async function failureOf(response: Response, subject: string): Promise<Error> {
  let body: { error?: string, code?: string, kind?: GrantKind, id?: string, provider?: string } = {}
  try {
    body = await response.json() as typeof body
  } catch {
    return new Error(`${subject}：HTTP ${response.status}`)
  }
  const message = body.error === undefined ? `${subject}：HTTP ${response.status}` : `${subject}：${body.error}`
  if (body.code === 'grant-required' && typeof body.id === 'string') {
    return new GrantRequiredError(message, body.kind ?? 'action', body.id, body.provider)
  }
  return new Error(message)
}

/** 读一份快照；形状不对时抛出来。 */
async function snapshotOf(response: Response, subject: string): Promise<BoardSnapshot> {
  if (!response.ok) throw new Error(await errorOf(response, subject))
  const snapshot = await response.json() as BoardSnapshot
  if (!Array.isArray(snapshot?.board?.instances)) throw new Error(`${subject}：响应不是看板快照`)
  return snapshot
}

/**
 * 读一次看板快照。
 *
 * @returns 宿主上的看板、组件元信息与组件库。
 * @throws {Error} 请求失败或响应不是快照。
 */
export async function fetchSnapshot(): Promise<BoardSnapshot> {
  const response = await fetch(`${CLIENT_ROUTE}${BOARD_PATH}`, { headers: { accept: 'application/json' } })
  return await snapshotOf(response, '看板快照读不出来')
}

/**
 * 把一张卡的界面状态交给宿主存下来（D5）：切走再切回来、组件热重载之后都还接得上。
 *
 * @param id - 卡片实例的 id。
 * @param patch - 组件送来的补丁。
 * @throws {Error} 请求失败。
 */
export async function saveInstanceState(id: string, patch: unknown): Promise<void> {
  const body: InstanceStateRequest = { patch }
  const response = await fetch(instanceStatePath(id), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(await errorOf(response, '存不下这张卡的状态'))
}

/**
 * 把数据推给一张卡（D6）。
 *
 * @param id - 卡片实例的 id。
 * @param data - 要推的数据。
 * @throws {Error} 请求失败。
 */
export async function pushInstanceData(id: string, data: unknown): Promise<void> {
  const response = await fetch(instanceDataPath(id), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ data }),
  })
  if (!response.ok) throw new Error(await errorOf(response, '推不下这张卡的数据'))
}

/**
 * 把组件发出的动作交给宿主（D6）。
 *
 * @param id - 卡片实例的 id。
 * @param action - 动作的名字，必须在组件的 manifest 里声明过。
 * @param payload - 动作的载荷。
 * @throws {Error} 请求失败，或宿主给出的原因。
 */
export async function sendInstanceAction(id: string, action: string, payload?: unknown): Promise<void> {
  const response = await fetch(instanceActionPath(id), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: action, payload }),
  })
  if (!response.ok) throw await failureOf(response, '动作没有执行')
}

/**
 * 按卡片绑定的（或点名的）数据源读一次数据（D6）。
 *
 * @param id - 卡片实例的 id。
 * @param source - 数据源的名字；省略时用卡片绑定的那个。
 * @returns 读回来的数据。
 * @throws {Error | GrantRequiredError} 请求失败，或这个数据源还没有授权。
 */
export async function readInstanceData(id: string, source?: string): Promise<unknown> {
  const response = await fetch(instanceReadPath(id), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(source === undefined ? {} : { source }),
  })
  if (!response.ok) throw await failureOf(response, '读不了这张卡的数据')
  return (await response.json() as { data?: unknown }).data ?? null
}

/**
 * 由人给出一份授权（D6）：绑在这张卡当前的组件版本上。
 *
 * @param id - 卡片实例的 id。
 * @param kind - 动作还是数据源。
 * @param name - 动作或数据源的名字。
 * @throws {Error} 请求失败。
 */
export async function grantInstance(id: string, kind: GrantKind, name: string): Promise<void> {
  const response = await fetch(instanceGrantPath(id), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind, id: name }),
  })
  if (!response.ok) throw await failureOf(response, '授权没有记下')
}

/**
 * 撤掉一份授权（D6）。
 *
 * @param id - 卡片实例的 id。
 * @param kind - 动作还是数据源。
 * @param name - 动作或数据源的名字。
 * @throws {Error} 请求失败。
 */
export async function revokeInstance(id: string, kind: GrantKind, name: string): Promise<void> {
  const response = await fetch(instanceRevokePath(id), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind, id: name }),
  })
  if (!response.ok) throw await failureOf(response, '撤不掉这份授权')
}

/**
 * 把整块看板的卡片盒子交给宿主（D16）。
 *
 * 拖动与缩放只在本地预览，松手时提交一次；修订号过期时宿主返回当前快照，这里把它交回去让页面
 * 按宿主的那一份重画（D5）。
 *
 * @param layoutRevision - 页面读到的那一份的布局修订号。
 * @param layouts - 整理过的卡片布局。
 * @returns 宿主上的快照。
 * @throws {Error} 请求失败，或响应不是快照。
 */
export async function saveBoardLayouts(layoutRevision: number, layouts: Record<string, CardLayout>): Promise<BoardSnapshot> {
  const body: BoardLayoutRequest = { layoutRevision, layouts }
  const response = await fetch(boardLayoutPath(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok && response.status !== 409) throw new Error(await errorOf(response, '存不下卡片布局'))
  return await snapshotOf(response, '存不下卡片布局')
}

/**
 * 往看板上加一张卡（D17）。
 *
 * @param widget - 组件的 id。
 * @param layout - 拖到看板上的落点；省略时宿主放进最矮的一列。
 * @returns 加完之后宿主上的快照。
 * @throws {Error} 请求失败；宿主给出的原因会带在消息里。
 */
export async function addInstance(widget: string, layout?: CardLayout): Promise<BoardSnapshot> {
  const body: InstanceAddRequest = { widget, ...(layout === undefined ? {} : { layout }) }
  const response = await fetch(boardInstancePath(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(await errorOf(response, '加不了这张卡片'))
  const payload = await response.json() as { snapshot?: BoardSnapshot }
  if (payload.snapshot === undefined || !Array.isArray(payload.snapshot.board?.instances)) throw new Error('加不了这张卡片：响应不是看板快照')
  return payload.snapshot
}

/**
 * 往看板上加一张固定的翻面组（D19）：宿主建出正面与背面两张普通卡片。
 *
 * @param layout - 拖到看板上的落点；省略时宿主放进最矮的一列。
 * @returns 加完之后宿主上的快照。
 * @throws {Error} 请求失败；宿主给出的原因会带在消息里。
 */
export async function addGroup(layout?: CardLayout): Promise<BoardSnapshot> {
  const body: GroupAddRequest = layout === undefined ? {} : { layout }
  const response = await fetch(boardGroupPath(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(await errorOf(response, '加不了翻面组'))
  const payload = await response.json() as { snapshot?: BoardSnapshot }
  if (payload.snapshot === undefined || !Array.isArray(payload.snapshot.board?.instances)) throw new Error('加不了翻面组：响应不是看板快照')
  return payload.snapshot
}

/**
 * 把一整组翻面卡从看板上移除（D19）。
 *
 * @param group - 组 id。
 * @returns 移除之后宿主上的快照。
 * @throws {Error} 请求失败。
 */
export async function removeGroup(group: string): Promise<BoardSnapshot> {
  const body: GroupRemoveRequest = { group }
  const response = await fetch(boardGroupRemovePath(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return await snapshotOf(response, '移除不了翻面组')
}

/**
 * 让宿主主动重读组件库与运行时（D17）：菜单上的刷新按钮用它。
 *
 * @returns 重读之后宿主上的快照。
 * @throws {Error} 请求失败。
 */
export async function refreshBoard(): Promise<BoardSnapshot> {
  const response = await fetch(refreshPath(), { method: 'POST' })
  return await snapshotOf(response, '刷新失败')
}

/**
 * 从看板上移除一张卡。
 *
 * @param id - 卡片实例的 id。
 * @returns 移除之后宿主上的快照。
 * @throws {Error} 请求失败。
 */
export async function removeInstance(id: string): Promise<BoardSnapshot> {
  const response = await fetch(instanceRemovePath(id), { method: 'POST' })
  return await snapshotOf(response, '移除不了这张卡片')
}
