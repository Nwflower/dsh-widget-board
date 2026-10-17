/**
 * 快照与提交：从宿主读看板、把用户的动作交给宿主（D5）。
 *
 * 宿主是唯一权威；看板页打开时取一次，之后靠变更通知就地合并，只有卡片增删与组件库变化才重取
 * （D18）。
 */
import type { BoardLayoutRequest, BoardSnapshot, CardLayout, GroupAddRequest, GroupRemoveRequest, InstanceAddRequest, InstanceStateRequest } from '@dsh-widget-board/contracts'
import { BOARD_PATH, CLIENT_ROUTE, boardGroupPath, boardGroupRemovePath, boardInstancePath, boardLayoutPath, instanceActionPath, instanceDataPath, instanceRemovePath, instanceStatePath, refreshPath } from '@dsh-widget-board/contracts'

/** 读一份响应体里的原因。 */
async function errorOf(response: Response, subject: string): Promise<string> {
  try {
    const body = await response.json() as { error?: string }
    return body.error === undefined ? `${subject}：HTTP ${response.status}` : `${subject}：${body.error}`
  } catch {
    return `${subject}：HTTP ${response.status}`
  }
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
  if (!response.ok) throw new Error(await errorOf(response, '动作没有执行'))
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
