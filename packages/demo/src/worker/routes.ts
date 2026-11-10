/**
 * 演示宿主的路由表：只实现看板页在没有宿主服务时会用到的那些，状态判定复用真实宿主的纯函数（D25）。
 *
 * 路径、方法、状态码与响应形状与 `packages/host/src/routes.ts` 一致：布局提交过期是 409 并带
 * 当前快照，没有这张卡是 404，请求形状不对是 400，状态超额度是 413。真实宿主上靠提供方、凭据
 * 服务与会话兑现的路由（数据源、动作、能力、授权、凭据、看板的新建与改名、分享）回一条写明
 * 原因的拒绝，页面把它显示出来（D11）。组件文档是静态文件，不经过这里（见 `data.ts` 的 `documentFile`）。
 */
import type {
  Board,
  BoardEvent,
  BoardInstance,
  BoardLayoutRequest,
  CardLayout,
  CardSettings,
  InstanceAddRequest,
  InstancePropsRequest,
  InstanceStateRequest,
  WidgetMinBox,
} from '@dsh-widget-board/contracts'
import { FLIP_GROUP_BACK, FLIP_GROUP_FRONT, PLUGIN_ROUTE, REQUEST_LOG_LIMIT, VISIBILITY_LIMIT, VISIBILITY_PATH, isVisibilityReport } from '@dsh-widget-board/contracts'
import { isCardLayout } from '@dsh-widget-board/model'
import { isRecord } from '../../../host/src/guards'
import { BOARD_STATE_WRITES_PER_SECOND, STATE_WRITES_PER_SECOND, createRateLimiter } from '../../../host/src/limits'
import type { WidgetRecord } from '../../../host/src/library'
import { Refusal } from '../../../host/src/refusal'
import { dataError, propsError, propsIssues } from '../../../host/src/schema'
import {
  StaleRevisionError,
  withBoardLayouts,
  withGroupAdded,
  withGroupRemoved,
  withGroupSlotReplaced,
  withInstanceAdded,
  withInstanceData,
  withInstancePatched,
  withInstanceRemoved,
  withInstanceStateChecked,
} from '../../../host/src/state'
import type { HostData } from '../data'
import type { Boards } from './boards'
import type { Live } from './live'

/** 请求体上限，与真实宿主的同名常量取同样的值。 */
const LIMITS = { state: 16 * 1024, layout: 64 * 1024, add: 32 * 1024, data: 256 * 1024, small: 1024, props: 32 * 1024 }

/** 路由处理器用到的一切。 */
export interface DemoContext {
  data: HostData
  boards: Boards
  live: Live
  /** Service Worker 的作用域地址：静态文件相对它取。 */
  scope: string
}

interface Route {
  method: 'GET' | 'POST'
  pattern: RegExp
  handle(context: DemoContext, request: Request, match: RegExpExecArray): Promise<Response>
}

const stateLimiters = {
  card: createRateLimiter(STATE_WRITES_PER_SECOND),
  board: createRateLimiter(BOARD_STATE_WRITES_PER_SECOND),
}

/** 回一条 JSON。 */
function json(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } })
}

/**
 * 读一个 JSON 请求体，超过上限就拒绝。
 *
 * @param request - 请求。
 * @param limit - 允许的最大字节数。
 * @returns 解出来的 JSON；请求体是空的时是 `undefined`。
 */
async function jsonBody(request: Request, limit: number): Promise<unknown> {
  const text = await request.text()
  if (new TextEncoder().encode(text).length > limit) throw new Refusal(413, `请求体超过 ${String(limit)} 字节`)
  if (text === '') return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Refusal(400, '请求体不是合法 JSON')
  }
}

/** 这个演示宿主上没有的东西：回一条中英并列的原因，页面原样显示。 */
function unavailable(zh: string, en: string): Refusal {
  return new Refusal(501, `演示页的宿主是只读的，没有${zh}；在安装了 DSH 的环境里才有。This demo host is read-only and has no ${en}; it exists in a real DSH install.`)
}

/** 演示宿主上一个组件的记录：只有哈希与 manifest，文件在构建时已经拼进静态文档。 */
function recordOf(data: HostData, id: string): WidgetRecord {
  const widget = data.widgets[id]
  if (widget === undefined) throw new Refusal(400, `组件库里没有可用的组件 ${id}`)
  return { manifest: widget.manifest, source: 'builtin', dir: '', hash: widget.hash, files: new Map() }
}

/** 按组件 id 取最小盒子。 */
const minBoxOf = (data: HostData) => (widget: string): WidgetMinBox | undefined => data.widgets[widget]?.manifest.minBox

/** 看板上的这块看板，没有就是 404。 */
async function requireBoard(context: DemoContext, id: string): Promise<void> {
  if (!(await context.boards.has(id))) throw new Refusal(404, `没有这块看板：${id}`)
}

/** 全工作区里的这张卡，没有就是 404。 */
async function requireInstance(context: DemoContext, id: string): Promise<{ board: Board, instance: BoardInstance }> {
  const found = await context.boards.findInstance(id)
  if (found === undefined) throw new Refusal(404, `看板上没有这张卡：${id}`)
  return found
}

/** 一块看板上的卡片布局提交：真实宿主的 `POST /boards/<id>/layout`。 */
async function submitLayout(context: DemoContext, id: string, request: Request): Promise<Response> {
  const body = await jsonBody(request, LIMITS.layout)
  const valid = isRecord(body) && Number.isSafeInteger(body.layoutRevision) && (body.layoutRevision as number) >= 0 && isRecord(body.layouts)
  if (!valid) throw new Refusal(400, '布局提交的形状不对：需要 layoutRevision 与 layouts')
  const wanted = body as unknown as BoardLayoutRequest
  try {
    let saved: Record<string, CardLayout> = {}
    const next = await context.boards.save(id, (current) => withBoardLayouts(current, wanted.layouts, minBoxOf(context.data)), {
      expectedLayoutRevision: wanted.layoutRevision,
      layoutChanged: true,
      event: (board, boardId) => {
        const byId = new Map(board.instances.map((instance) => [instance.id, instance]))
        saved = Object.fromEntries(Object.keys(wanted.layouts).flatMap((cardId) => {
          const layout = byId.get(cardId)?.layout
          return layout === undefined ? [] : [[cardId, layout]]
        }))
        return { type: 'layout', board: boardId, layoutRevision: board.layoutRevision, layouts: saved }
      },
    })
    return json(200, { layoutRevision: next.layoutRevision, layouts: saved })
  } catch (error) {
    if (error instanceof StaleRevisionError) return json(409, await context.boards.snapshot())
    throw error
  }
}

/** 加一张卡：数据源在演示宿主上不存在，所以不读第一次数据。 */
async function addInstance(context: DemoContext, boardId: string, request: Request): Promise<Response> {
  await requireBoard(context, boardId)
  const body = await jsonBody(request, LIMITS.add)
  if (!isRecord(body) || typeof body.widget !== 'string' || body.widget === '') throw new Refusal(400, '加卡片要写明 widget')
  const wanted = body as unknown as InstanceAddRequest
  const record = recordOf(context.data, wanted.widget)
  if (wanted.source !== undefined) throw unavailable('数据源', 'data sources')
  if (wanted.props !== undefined && !isRecord(wanted.props)) throw new Refusal(400, 'props 要是普通的 JSON 对象')
  const problem = wanted.props === undefined ? undefined : propsError(record.manifest.props, wanted.props)
  if (problem !== undefined) throw new Refusal(400, problem)
  if (wanted.layout !== undefined && !isCardLayout(wanted.layout)) throw new Refusal(400, 'layout 的列号、跨列与高度不合法')
  const id = crypto.randomUUID()
  const options = {
    ...(wanted.props === undefined ? {} : { props: wanted.props }),
    ...(wanted.layout === undefined ? {} : { layout: wanted.layout }),
  }
  await context.boards.save(boardId, (current) => withInstanceAdded(current, record, options, id).board, {
    layoutChanged: true,
    event: () => ({ type: 'board' }),
  })
  return json(201, { id, snapshot: await context.boards.snapshot() })
}

/** 加一组翻面卡：正面与背面的组件固定（D19）。 */
async function addGroup(context: DemoContext, boardId: string, request: Request): Promise<Response> {
  await requireBoard(context, boardId)
  const body = await jsonBody(request, LIMITS.add)
  if (body !== undefined && !isRecord(body)) throw new Refusal(400, '加组卡要写明落点')
  const layout = (body as { layout?: unknown } | undefined)?.layout
  if (layout !== undefined && !isCardLayout(layout)) throw new Refusal(400, 'layout 的列号、跨列与高度不合法')
  const front = recordOf(context.data, FLIP_GROUP_FRONT)
  const back = recordOf(context.data, FLIP_GROUP_BACK)
  let id = ''
  await context.boards.save(boardId, (current) => {
    const added = withGroupAdded(current, front, back, layout === undefined ? {} : { layout })
    id = added.id
    return added.board
  }, { layoutChanged: true, event: () => ({ type: 'board' }) })
  return json(201, { id, snapshot: await context.boards.snapshot() })
}

/** 一张卡的状态补丁：先过写入预算，再并进状态（D23）。 */
async function patchState(context: DemoContext, id: string, request: Request): Promise<Response> {
  const { board } = await requireInstance(context, id)
  const body = await jsonBody(request, LIMITS.state)
  if (!isRecord(body) || !('patch' in body)) throw new Refusal(400, '状态要放在 patch 里')
  const patch = (body as unknown as InstanceStateRequest).patch
  if (!stateLimiters.card.allow(id) || !stateLimiters.board.allow(board.id)) {
    throw new Refusal(429, '状态写入太频繁，稍后再试', { code: 'state-rate-limited' })
  }
  let merged = false
  await context.boards.save(board.id, (current) => {
    const state = current.instances.find((candidate) => candidate.id === id)?.state
    merged = isRecord(state) && isRecord(patch)
    return withInstanceStateChecked(current, id, patch)
  }, {
    event: (next): BoardEvent => {
      const state = next.instances.find((instance) => instance.id === id)?.state
      return merged ? { type: 'instance', id, patch } : { type: 'instance', id, state }
    },
  })
  return json(200, { ok: true })
}

/** 设置弹窗的读模型：演示宿主没有数据源、能力与凭据服务，对应的几节是空的。 */
async function readSettings(context: DemoContext, id: string): Promise<Response> {
  const { instance } = await requireInstance(context, id)
  const widget = context.data.widgets[instance.widget]
  if (widget === undefined) throw new Refusal(404, `组件 ${instance.widget} 不在组件库里`)
  const { manifest } = widget
  const settings: CardSettings = {
    instance,
    widget: {
      title: manifest.title,
      ...(manifest.description === undefined ? {} : { description: manifest.description }),
      version: manifest.version,
      hash: widget.hash,
      source: 'builtin',
      ...(manifest.props === undefined ? {} : { propsSchema: manifest.props }),
      ...(manifest.text === undefined ? {} : { text: manifest.text }),
      ...(manifest.refresh === undefined ? {} : { refresh: manifest.refresh }),
    },
    capabilities: [],
    grants: [],
    credentials: [],
    credentialsAvailable: false,
  }
  return json(200, settings)
}

/** 保存整份 props。 */
async function saveProps(context: DemoContext, id: string, request: Request): Promise<Response> {
  const { board, instance } = await requireInstance(context, id)
  const body = await jsonBody(request, LIMITS.props)
  if (!isRecord(body) || !isRecord(body.props)) throw new Refusal(400, 'props 要放在 props 里，且是普通对象')
  const wanted = body as unknown as InstancePropsRequest
  const record = recordOf(context.data, instance.widget)
  const issues = propsIssues(record.manifest.props, wanted.props)
  if (issues !== undefined) throw new Refusal(400, `props 与 ${record.manifest.id} 的 props schema 不符`, { issues })
  await context.boards.save(board.id, (current) => withInstancePatched(current, id, { props: wanted.props }), {
    event: () => ({ type: 'instance', id, props: wanted.props }),
  })
  return json(200, { props: wanted.props })
}

/** 路由表；路径与方法一起决定走哪一条。 */
const ROUTES: Route[] = [
  {
    method: 'POST',
    pattern: new RegExp(`^${VISIBILITY_PATH}$`),
    async handle(_context, request) {
      const body = await jsonBody(request, VISIBILITY_LIMIT)
      if (!isVisibilityReport(body)) throw new Refusal(400, '可见性上报需要合法的 viewer 与 visible')
      // 演示宿主没有数据源调度；校验上报但不登记观众集合。
      return json(200, { ok: true, accepted: false })
    },
  },
  { method: 'GET', pattern: /^\/boards$/, handle: async (context) => json(200, await context.boards.snapshot()) },
  { method: 'POST', pattern: /^\/boards$/, handle: async () => { throw unavailable('多块看板（新建看板）', 'multiple boards (new board)') } },
  { method: 'POST', pattern: /^\/boards\/([^/]+)\/rename$/, handle: async () => { throw unavailable('看板改名', 'board renaming') } },
  { method: 'POST', pattern: /^\/boards\/([^/]+)\/remove$/, handle: async () => { throw unavailable('看板移除', 'board removal') } },
  { method: 'POST', pattern: /^\/boards\/import$/, handle: async () => { throw unavailable('看板导入', 'board import') } },
  { method: 'GET', pattern: /^\/boards\/([^/]+)\/export$/, handle: async () => { throw unavailable('看板导出', 'board export') } },
  {
    method: 'POST',
    pattern: /^\/boards\/([^/]+)\/activate$/,
    async handle(context, request, match) {
      const id = decodeURIComponent(match[1] as string)
      await requireBoard(context, id)
      await jsonBody(request, LIMITS.small)
      await context.boards.setActive(id)
      return json(200, await context.boards.snapshot())
    },
  },
  {
    method: 'POST',
    pattern: /^\/boards\/([^/]+)\/layout$/,
    async handle(context, request, match) {
      const id = decodeURIComponent(match[1] as string)
      await requireBoard(context, id)
      return await submitLayout(context, id, request)
    },
  },
  { method: 'POST', pattern: /^\/boards\/([^/]+)\/instance$/, handle: async (context, request, match) => await addInstance(context, decodeURIComponent(match[1] as string), request) },
  { method: 'POST', pattern: /^\/boards\/([^/]+)\/group$/, handle: async (context, request, match) => await addGroup(context, decodeURIComponent(match[1] as string), request) },
  {
    method: 'POST',
    pattern: /^\/group\/remove$/,
    async handle(context, request) {
      const body = await jsonBody(request, LIMITS.small)
      if (!isRecord(body) || typeof body.group !== 'string' || body.group === '') throw new Refusal(400, '移除组卡要写明 group')
      const group = body.group
      const board = await context.boards.findGroup(group)
      if (board === undefined) throw new Refusal(404, `看板上没有这一组：${group}`)
      await context.boards.save(board.id, (current) => withGroupRemoved(current, group), { layoutChanged: true, event: () => ({ type: 'board' }) })
      return json(200, await context.boards.snapshot())
    },
  },
  {
    method: 'POST',
    pattern: /^\/group\/([^/]+)\/slot$/,
    async handle(context, request, match) {
      const id = decodeURIComponent(match[1] as string)
      const body = await jsonBody(request, LIMITS.small * 4)
      if (!isRecord(body) || (body.side !== 'front' && body.side !== 'back') || typeof body.widget !== 'string' || body.widget === '') {
        throw new Refusal(400, '换槽要写明 side（front 或 back）与 widget')
      }
      const { side, widget } = body as { side: 'front' | 'back', widget: string }
      const board = await context.boards.findGroup(id)
      if (board === undefined) throw new Refusal(404, `看板上没有这一组：${id}`)
      const record = recordOf(context.data, widget)
      await context.boards.save(board.id, (current) => withGroupSlotReplaced(current, id, side, record, minBoxOf(context.data)), {
        layoutChanged: true,
        event: () => ({ type: 'board' }),
      })
      return json(200, { snapshot: await context.boards.snapshot() })
    },
  },
  {
    method: 'POST',
    pattern: /^\/refresh$/,
    async handle(context) {
      return json(200, await context.boards.snapshot())
    },
  },
  { method: 'POST', pattern: /^\/instance\/([^/]+)\/state$/, handle: async (context, request, match) => await patchState(context, decodeURIComponent(match[1] as string), request) },
  {
    method: 'POST',
    pattern: /^\/instance\/([^/]+)\/data$/,
    async handle(context, request, match) {
      const id = decodeURIComponent(match[1] as string)
      const { board, instance } = await requireInstance(context, id)
      const body = await jsonBody(request, LIMITS.data)
      if (!isRecord(body) || !('data' in body)) throw new Refusal(400, '数据要放在 data 里')
      const problem = dataError(context.data.widgets[instance.widget]?.manifest.data, body.data)
      if (problem !== undefined) throw new Refusal(400, problem)
      await context.boards.save(board.id, (current) => withInstanceData(current, id, body.data), { event: () => ({ type: 'instance', id, data: body.data }) })
      return json(200, { ok: true })
    },
  },
  {
    method: 'POST',
    pattern: /^\/instance\/([^/]+)\/remove$/,
    async handle(context, request, match) {
      const id = decodeURIComponent(match[1] as string)
      const { board } = await requireInstance(context, id)
      await jsonBody(request, LIMITS.small)
      await context.boards.save(board.id, (current) => withInstanceRemoved(current, id), { layoutChanged: true, event: () => ({ type: 'board' }) })
      return json(200, await context.boards.snapshot())
    },
  },
  { method: 'GET', pattern: /^\/instance\/([^/]+)\/settings$/, handle: async (context, _request, match) => await readSettings(context, decodeURIComponent(match[1] as string)) },
  {
    method: 'GET',
    pattern: /^\/instance\/([^/]+)\/log$/,
    async handle(context, _request, match) {
      await requireInstance(context, decodeURIComponent(match[1] as string))
      return json(200, { entries: [], limit: REQUEST_LOG_LIMIT })
    },
  },
  { method: 'POST', pattern: /^\/instance\/([^/]+)\/props$/, handle: async (context, request, match) => await saveProps(context, decodeURIComponent(match[1] as string), request) },
  { method: 'POST', pattern: /^\/instance\/([^/]+)\/read$/, handle: async () => { throw unavailable('数据源', 'data sources') } },
  { method: 'POST', pattern: /^\/instance\/([^/]+)\/action$/, handle: async () => { throw unavailable('动作', 'actions') } },
  { method: 'POST', pattern: /^\/instance\/([^/]+)\/call$/, handle: async () => { throw unavailable('宿主能力（例如 DSH 余额）', 'host capabilities (such as the DSH balance)') } },
  { method: 'POST', pattern: /^\/instance\/([^/]+)\/grant$/, handle: async () => { throw unavailable('授权', 'grants') } },
  { method: 'POST', pattern: /^\/instance\/([^/]+)\/revoke$/, handle: async () => { throw unavailable('授权', 'grants') } },
  { method: 'POST', pattern: /^\/instance\/([^/]+)\/credential$/, handle: async () => { throw unavailable('凭据服务', 'credential service') } },
  { method: 'GET', pattern: /^\/events$/, handle: async (context) => context.live.subscribe() },
]

/**
 * 处理一条发往插件前缀的请求。
 *
 * @param context - 宿主数据、看板存储与通知。
 * @param request - 请求。
 * @returns 响应。
 */
export async function handleRequest(context: DemoContext, request: Request): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname.slice(url.pathname.indexOf(PLUGIN_ROUTE) + PLUGIN_ROUTE.length)
  const matched = ROUTES.flatMap((route) => {
    const match = route.pattern.exec(path)
    return match === null ? [] : [{ route, match }]
  })
  if (matched.length === 0) return json(404, { error: `没有这条路径：${path}` })
  const chosen = matched.find((candidate) => candidate.route.method === request.method)
  if (chosen === undefined) return new Response(null, { status: 405, headers: { allow: matched.map((candidate) => candidate.route.method).join(', ') } })
  try {
    return await chosen.route.handle(context, request, chosen.match)
  } catch (error) {
    if (error instanceof Refusal) return json(error.status, { error: error.message, ...error.extra })
    const message = error instanceof Error ? error.message : String(error)
    if (/^看板上没有这张卡/.test(message) || /^没有这块看板/.test(message)) return json(404, { error: message })
    return json(500, { error: message })
  }
}
