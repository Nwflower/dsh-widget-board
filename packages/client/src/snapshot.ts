/**
 * 快照与提交：从宿主读工作区、把用户的动作交给宿主（D5、D21）。
 *
 * 宿主是唯一权威；看板页打开时取一次工作区，之后靠变更通知就地合并，只有卡片与看板增删、组件库
 * 变化才重取（D18）。看板级的动作把看板 id 写在路径里；卡片级的动作按卡片自己的 id 找——卡片与组
 * 的 id 是全工作区唯一的，路由因此不必再带看板（D21）。
 */
import type {
  BoardCreateRequest,
  BoardLayoutRequest,
  BoardLayoutSaved,
  BoardRenameRequest,
  CardLayout,
  CardSettings,
  CredentialStatus,
  GrantKind,
  GroupAddRequest,
  GroupRemoveRequest,
  GroupSide,
  InstanceAddRequest,
  InstanceCredentialRequest,
  InstancePropsRequest,
  InstanceStateRequest,
  RequestLogEntry,
  WorkspaceSnapshot,
} from '@dsh-widget-board/contracts'
import {
  boardActivatePath,
  boardGroupPath,
  boardInstancePath,
  boardLayoutPath,
  boardRemovePath,
  boardRenamePath,
  boardsPath,
  groupRemovePath,
  groupSlotPath,
  instanceActionPath,
  instanceCallPath,
  instanceCredentialPath,
  instanceDataPath,
  instanceGrantPath,
  instanceLogPath,
  instancePropsPath,
  instanceReadPath,
  instanceRemovePath,
  instanceRevokePath,
  instanceSettingsPath,
  instanceStatePath,
  refreshPath,
} from '@dsh-widget-board/contracts'

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

/** 一条 props 字段错误（D27）。 */
export interface PropsIssue {
  path: string
  message: string
}

/** 保存 props 被 schema 拒绝：带着逐字段的原因。 */
export class PropsRejectedError extends Error {
  constructor(message: string, readonly issues: PropsIssue[]) {
    super(message)
    this.name = 'PropsRejectedError'
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

/** 一份响应体是不是工作区快照。 */
function isWorkspace(value: unknown): value is WorkspaceSnapshot {
  return Array.isArray((value as WorkspaceSnapshot | undefined)?.boards)
}

/** 一份响应体是不是卡片设置读模型（D27）。 */
function isCardSettings(value: unknown): value is CardSettings {
  const settings = value as CardSettings | undefined
  return typeof settings?.instance === 'object' && settings.instance !== null
    && typeof settings.widget === 'object' && settings.widget !== null
    && Array.isArray(settings.credentials)
    && Array.isArray(settings.capabilities)
    && Array.isArray(settings.grants)
}

/** 读一份工作区快照；形状不对时抛出来。 */
async function snapshotOf(response: Response, subject: string): Promise<WorkspaceSnapshot> {
  if (!response.ok) throw new Error(await errorOf(response, subject))
  return await snapshotBodyOf(response, subject)
}

/** 读一份工作区快照的响应体，不先看状态码；409 也要把它交给页面。 */
async function snapshotBodyOf(response: Response, subject: string): Promise<WorkspaceSnapshot> {
  const snapshot: unknown = await response.json()
  if (!isWorkspace(snapshot)) throw new Error(`${subject}：响应不是工作区快照`)
  return snapshot
}

/**
 * 读一份「快照装在信封里」的响应体：新建看板、加卡片、加组卡都是这个形状。
 *
 * @param response - 宿主的答复。
 * @param subject - 出错时用来说明的名字。
 * @returns 信封里的 id（有的话）与快照。
 * @throws {Error} 请求失败或响应不是工作区快照。
 */
async function wrappedOf(response: Response, subject: string): Promise<{ id?: string, snapshot: WorkspaceSnapshot }> {
  if (!response.ok) throw new Error(await errorOf(response, subject))
  const payload = await response.json() as { id?: unknown, snapshot?: unknown }
  if (!isWorkspace(payload.snapshot)) throw new Error(`${subject}：响应不是工作区快照`)
  return { ...(typeof payload.id === 'string' ? { id: payload.id } : {}), snapshot: payload.snapshot }
}

/**
 * 读一次工作区快照（D21）。
 *
 * @returns 宿主上的全部看板、当前选中、组件元信息与组件库。
 * @throws {Error} 请求失败或响应不是快照。
 */
export async function fetchWorkspace(): Promise<WorkspaceSnapshot> {
  const response = await fetch(boardsPath(), { headers: { accept: 'application/json' } })
  return await snapshotOf(response, '工作区读不出来')
}

/**
 * 新建一块看板（D21）。
 *
 * @param title - 标题；省略时宿主起一个「未命名看板」加序号。
 * @returns 新看板的 id 与建完之后的工作区。
 * @throws {Error} 请求失败；宿主给出的原因会带在消息里。
 */
export async function createBoard(title?: string): Promise<{ id: string, snapshot: WorkspaceSnapshot }> {
  const body: BoardCreateRequest = title === undefined ? {} : { title }
  const response = await fetch(boardsPath(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const { id, snapshot } = await wrappedOf(response, '新建不了看板')
  if (id === undefined) throw new Error('新建不了看板：响应里没有看板 id')
  return { id, snapshot }
}

/**
 * 改一块看板的标题（D21）。
 *
 * @param id - 看板 id。
 * @param title - 新标题。
 * @returns 改完之后的工作区。
 * @throws {Error} 请求失败；宿主给出的原因会带在消息里。
 */
export async function renameBoard(id: string, title: string): Promise<WorkspaceSnapshot> {
  const body: BoardRenameRequest = { title }
  const response = await fetch(boardRenamePath(id), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return await snapshotOf(response, '改不了看板的名字')
}

/**
 * 移除一块看板（D21）。
 *
 * @param id - 看板 id。
 * @returns 移除之后的工作区；移除的是最后一块时，里面是补上的那块空看板。
 * @throws {Error} 请求失败。
 */
export async function removeBoard(id: string): Promise<WorkspaceSnapshot> {
  const response = await fetch(boardRemovePath(id), { method: 'POST' })
  return await snapshotOf(response, '移除不了这块看板')
}

/**
 * 选中一块看板（D21）。
 *
 * @param id - 看板 id。
 * @returns 换过选中之后的工作区。
 * @throws {Error} 请求失败。
 */
export async function activateBoard(id: string): Promise<WorkspaceSnapshot> {
  const response = await fetch(boardActivatePath(id), { method: 'POST' })
  return await snapshotOf(response, '换不了选中的看板')
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
 * 调用一张卡声明过的一个宿主能力（D24）。
 *
 * @param id - 卡片实例的 id。
 * @param capability - 能力名，必须在组件 manifest 里声明过。
 * @param args - 参数；宿主按能力的 input schema 校验。
 * @param signal - 取消这次调用。
 * @returns 能力的返回值。
 * @throws {Error | GrantRequiredError} 请求失败、能力失败，或这个能力还没有授权。
 */
export async function callInstanceCapability(
  id: string,
  capability: string,
  args: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  const response = await fetch(instanceCallPath(id), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ capability, args }),
    ...(signal === undefined ? {} : { signal }),
  })
  if (!response.ok) throw await failureOf(response, `调用 ${capability} 失败`)
  return (await response.json() as { result?: unknown }).result ?? null
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
 * 一次布局提交的结果：宿主存下这次盒子，或修订号过期时给出当前工作区（D5、D16）。
 */
export type BoardLayoutResult =
  | { kind: 'saved', layout: BoardLayoutSaved }
  | { kind: 'stale', snapshot: WorkspaceSnapshot }

/**
 * 把一块看板的卡片盒子交给宿主（D16、D21）。
 *
 * 拖动与缩放只在本地预览，松手时提交一次；修订号过期时宿主返回当前工作区，这里把它交回去让页面
 * 按宿主的那一份重画（D5）。成功时只回这次落定的盒子，不再把全部看板的数据与状态带回来。
 *
 * @param boardId - 看板 id。
 * @param layoutRevision - 页面读到的那一块的布局修订号。
 * @param layouts - 整理过的卡片布局。
 * @returns 存下的盒子，或修订号过期时的当前工作区。
 * @throws {Error} 请求失败，或响应形状不对。
 */
export async function saveBoardLayouts(boardId: string, layoutRevision: number, layouts: Record<string, CardLayout>): Promise<BoardLayoutResult> {
  const body: BoardLayoutRequest = { layoutRevision, layouts }
  const response = await fetch(boardLayoutPath(boardId), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (response.status === 409) return { kind: 'stale', snapshot: await snapshotBodyOf(response, '存不下卡片布局') }
  if (!response.ok) throw new Error(await errorOf(response, '存不下卡片布局'))
  const saved = await response.json() as Partial<BoardLayoutSaved>
  if (!Number.isSafeInteger(saved.layoutRevision) || typeof saved.layouts !== 'object' || saved.layouts === null) {
    throw new Error('存不下卡片布局：响应不是布局结果')
  }
  return { kind: 'saved', layout: saved as BoardLayoutSaved }
}

/**
 * 往一块看板上加一张卡（D17、D21）。
 *
 * @param boardId - 看板 id。
 * @param widget - 组件的 id。
 * @param layout - 拖到看板上的落点；省略时宿主放进最矮的一列。
 * @returns 加完之后宿主上的工作区。
 * @throws {Error} 请求失败；宿主给出的原因会带在消息里。
 */
export async function addInstance(boardId: string, widget: string, layout?: CardLayout): Promise<WorkspaceSnapshot> {
  const body: InstanceAddRequest = { widget, ...(layout === undefined ? {} : { layout }) }
  const response = await fetch(boardInstancePath(boardId), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return (await wrappedOf(response, '加不了这张卡片')).snapshot
}

/**
 * 往一块看板上加一张翻面组（D19、D21）：宿主建出正面与背面两张普通卡片。
 *
 * @param boardId - 看板 id。
 * @param layout - 拖到看板上的落点；省略时宿主放进最矮的一列。
 * @returns 组 id 与加完之后宿主上的工作区。
 * @throws {Error} 请求失败；宿主给出的原因会带在消息里。
 */
export async function addGroup(boardId: string, layout?: CardLayout): Promise<{ id: string, snapshot: WorkspaceSnapshot }> {
  const body: GroupAddRequest = layout === undefined ? {} : { layout }
  const response = await fetch(boardGroupPath(boardId), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const { id, snapshot } = await wrappedOf(response, '加不了翻面组')
  if (id === undefined) throw new Error('加不了翻面组：响应里没有组 id')
  return { id, snapshot }
}

/**
 * 读一张卡的设置读模型（D27）。
 *
 * @param id - 卡片实例的 id。
 * @returns 只含状态与 schema 的设置。
 * @throws {Error} 请求失败或响应不是设置读模型。
 */
export async function fetchInstanceSettings(id: string): Promise<CardSettings> {
  const response = await fetch(instanceSettingsPath(id), { headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(await errorOf(response, '读不了这张卡的设置'))
  const value: unknown = await response.json()
  if (!isCardSettings(value)) throw new Error('读不了这张卡的设置：响应不是设置读模型')
  return value
}

/**
 * 读一张卡对外请求的日志（D28）。
 *
 * @param id - 卡片实例的 id。
 * @returns 最近的请求，按发生的先后。
 * @throws {Error} 请求失败或响应不是日志。
 */
export async function fetchInstanceLog(id: string): Promise<RequestLogEntry[]> {
  const response = await fetch(instanceLogPath(id), { headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(await errorOf(response, '读不了这张卡的日志'))
  const value = await response.json() as { entries?: unknown }
  if (!Array.isArray(value.entries)) throw new Error('读不了这张卡的日志：响应里没有请求列表')
  return value.entries as RequestLogEntry[]
}

/**
 * 保存一张卡的 props（D27）：宿主按组件的 props schema 校验，失败时带逐字段原因。
 *
 * @param id - 卡片实例的 id。
 * @param props - 整份 props。
 * @returns 宿主存下来的 props。
 * @throws {PropsRejectedError | Error} schema 不符或请求失败。
 */
export async function saveInstanceProps(id: string, props: Record<string, unknown>): Promise<Record<string, unknown>> {
  const body: InstancePropsRequest = { props }
  const response = await fetch(instancePropsPath(id), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    let failure: { error?: string, issues?: PropsIssue[] } = {}
    try {
      failure = await response.json() as typeof failure
    } catch {
      throw new Error(`保存 props 失败：HTTP ${response.status}`)
    }
    const message = failure.error ?? `保存 props 失败：HTTP ${response.status}`
    const issues = Array.isArray(failure.issues) ? failure.issues : undefined
    if (issues === undefined) throw new Error(message)
    throw new PropsRejectedError(message, issues)
  }
  return (await response.json() as { props: Record<string, unknown> }).props
}

/**
 * 写一张卡的一项凭据（D27）：值只往宿主走，返回值没有密钥。
 *
 * @param id - 卡片实例的 id。
 * @param ref - 凭据名，必须在组件的 manifest 里声明过。
 * @param action - `set` 或 `unset`。
 * @param value - `set` 时的非空密钥。
 * @returns 写完之后的凭据状态。
 * @throws {Error} 请求失败，宿主的拒绝会带在消息里。
 */
export async function setInstanceCredential(
  id: string,
  ref: string,
  action: 'set' | 'unset',
  value?: string,
): Promise<CredentialStatus> {
  const body: InstanceCredentialRequest = { ref, action, ...(action === 'set' ? { value } : {}) }
  const response = await fetch(instanceCredentialPath(id), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(await errorOf(response, '改不了这项凭据'))
  return (await response.json() as { info: CredentialStatus }).info
}

/**
 * 把组卡的一个槽换成另一个组件（D27）。
 *
 * @param groupId - 组 id。
 * @param side - 换哪一侧。
 * @param widget - 新组件的 id。
 * @returns 换完之后宿主上的工作区。
 * @throws {Error} 请求失败。
 */
export async function changeGroupSlot(groupId: string, side: GroupSide, widget: string): Promise<WorkspaceSnapshot> {
  const body = { side, widget } satisfies { side: GroupSide, widget: string }
  const response = await fetch(groupSlotPath(groupId), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return (await wrappedOf(response, '换不了这个槽')).snapshot
}

/**
 * 把一整组翻面卡从看板上移除（D19）。
 *
 * @param group - 组 id。
 * @returns 移除之后宿主上的工作区。
 * @throws {Error} 请求失败。
 */
export async function removeGroup(group: string): Promise<WorkspaceSnapshot> {
  const body: GroupRemoveRequest = { group }
  const response = await fetch(groupRemovePath(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return await snapshotOf(response, '移除不了翻面组')
}

/**
 * 让宿主主动重读组件库与运行时（D17）：菜单上的刷新按钮用它。
 *
 * @returns 重读之后宿主上的工作区。
 * @throws {Error} 请求失败。
 */
export async function refreshBoard(): Promise<WorkspaceSnapshot> {
  const response = await fetch(refreshPath(), { method: 'POST' })
  return await snapshotOf(response, '刷新失败')
}

/**
 * 从看板上移除一张卡（D21）：卡片 id 全工作区唯一，这条路由不带看板。
 *
 * @param id - 卡片实例的 id。
 * @returns 移除之后宿主上的工作区。
 * @throws {Error} 请求失败。
 */
export async function removeInstance(id: string): Promise<WorkspaceSnapshot> {
  const response = await fetch(instanceRemovePath(id), { method: 'POST' })
  return await snapshotOf(response, '移除不了这张卡片')
}
