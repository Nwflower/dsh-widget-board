/**
 * 插件的私有路由（D1、D3）：看板快照、卡片增删、状态与数据、布局、组件文档与变更通知。
 *
 * 每条请求先过宿主的请求栅栏；宿主没有这项服务时只放行本机回环来的请求，判定以对端地址为准。
 * 路由写成一张表：方法、路径、请求体上限与处理器各写一次，404、405 与 413 由表本身给出，处理器
 * 只管自己那一件事。状态码按原因分开：没有这张卡是 404，请求形状不对是 400，布局修订号过期是
 * 409，组件库与数据源的拒绝是 400 并写明原因。
 */
import { randomUUID } from 'node:crypto'
import type {
  Board,
  BoardEvent,
  BoardLayoutRequest,
  BoardSnapshot,
  CardLayout,
  GrantKind,
  GrantRequest,
  GroupAddRequest,
  GroupRemoveRequest,
  HostConnection,
  HostRequest,
  HostResponse,
  InstanceAddRequest,
  InstanceActionRequest,
  InstanceDataRequest,
  InstanceFace,
  InstanceStateRequest,
  WidgetLibraryEntry,
  WidgetRoot,
} from '@dsh-widget-board/contracts'
import { FLIP_GROUP_BACK, FLIP_GROUP_FRONT, PLUGIN_ROUTE } from '@dsh-widget-board/contracts'
import type { VersionStore } from './blobs'
import { buildDocument, contentSecurityPolicy, freshNonce } from './document'
import type { GrantStore } from './grants'
import { requireGrant, type GrantFacts } from './permissions'
import type { Live } from './live'
import type { LibraryLoad, WidgetRecord } from './library'
import { dataError } from './schema'
import type { Registries } from './sources'
import { isCardLayout } from '@dsh-widget-board/model'
import { readJson } from './body'
import { Refusal } from './refusal'
import { shareRoutes } from './share'
import { StaleRevisionError, withBoardLayouts, withGroupAdded, withGroupRemoved, withInstanceAdded, withInstanceData, withInstanceRemoved, withInstanceState } from './state'

/** 卡片状态的请求体上限：界面状态只是几张表单的值，几 KB 足够。 */
const STATE_LIMIT = 16 * 1024

/** 一次布局提交的上限：一整块看板的卡片盒子，比单张卡的状态大一些。 */
const LAYOUT_LIMIT = 64 * 1024

/** 加一张卡的请求体上限。 */
const ADD_LIMIT = 32 * 1024

/** 推送数据的请求体上限：数据源读出来的快照可能不小，但仍要有个头。 */
const DATA_LIMIT = 256 * 1024

/** 加卡片与移除卡片时请求体可以没有。 */
const EMPTY_LIMIT = 1024

/** 路由处理器读到的一切；组件库与资产随热重载替换，所以这里持有一个可变的对象。 */
export interface RouteContext {
  /** 当前可用的组件，按 id 索引。 */
  records: Map<string, WidgetRecord>
  /** 给界面的全部组件类型，含读不出来的那些（D17）。 */
  entries: WidgetLibraryEntry[]
  /** 组件库这一轮读出来的全部结果：错误与来源也在里面（D17、D9）。 */
  library: LibraryLoad
  /** 组件来源表：写新组件时按它找用户目录（D9、D17）。 */
  roots: readonly WidgetRoot[]
  /** 出现过的版本，按内容哈希取（D7）。 */
  versions: VersionStore
  board: Board
  /**
   * 改一次看板：写到磁盘、换掉内存里的那份、推一条通知；写入串行，后一次看得到前一次的结果。
   * 带上期望的布局修订号时，轮到这次写入会再核对一次，过期就抛出 `StaleRevisionError`。
   */
  save(change: (current: Board) => Board, options: SaveOptions): Promise<Board>
  live: Live
  connection: HostConnection | undefined
  /** 主动重读组件库与运行时（D17）：菜单上的刷新按钮用它。 */
  refresh: () => Promise<void>
  /** 数据源与动作的注册表（D6）。 */
  sources: Registries
  /** 人给出过的授权，绑在组件版本上（D6）。 */
  grants: GrantStore
}

/** 一次写入要带的选项：修订号、要不要动布局修订号、推给页面的是哪条事件。 */
export interface SaveOptions {
  expectedLayoutRevision?: number
  layoutChanged?: boolean
  event: (next: Board) => BoardEvent
}

/** 回环地址：127/8 与 ::1，含 IPv4 映射。 */
function isLoopback(address: string | undefined): boolean {
  if (address === undefined) return false
  const normalized = address.toLowerCase()
  if (normalized === '::1') return true
  const v4 = normalized.startsWith('::ffff:') ? normalized.slice('::ffff:'.length) : normalized
  const parts = v4.split('.')
  return parts.length === 4 && parts[0] === '127' && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

/**
 * 一条请求能不能进来。
 *
 * @param request - 宿主的请求。
 * @param connection - 宿主的栅栏；没有时按回环地址与同站标记判定。
 * @returns 拒绝时的状态码，放行时是 `undefined`。
 */
function rejectionOf(request: HostRequest, connection: HostConnection | undefined): 401 | 403 | undefined {
  if (connection !== undefined) return connection.requestRejection({ headers: request.headers })
  if (!isLoopback(request.socket?.remoteAddress)) return 403
  return request.headers['sec-fetch-site'] === 'cross-site' ? 403 : undefined
}

/** 回一条 JSON。 */
function json(response: HostResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  response.end(JSON.stringify(body))
}

/** 看板快照：看板本身，外加它用到的组件元信息、整个组件库与看板上用得到的授权。 */
export function snapshot(context: RouteContext): BoardSnapshot {
  const widgets: BoardSnapshot['widgets'] = {}
  for (const [id, record] of context.records) {
    widgets[id] = {
      hash: record.hash,
      title: record.manifest.title,
      sizes: record.manifest.sizes,
      ...(record.manifest.text === undefined ? {} : { text: record.manifest.text }),
      source: record.source,
      ...(record.provider === undefined ? {} : { provider: record.provider }),
      ...(record.manifest.minBox === undefined ? {} : { minBox: record.manifest.minBox }),
    }
  }
  // 只带看板上出现的那些版本：授权表会一直长，页面只关心眼前这几张卡（D6）。
  const hashes = new Set(context.board.instances.map((instance) => instance.hash))
  const grants = context.grants.all().filter((grant) => hashes.has(grant.hash))
  return { board: context.board, widgets, library: context.entries, grants }
}


/** 普通的 JSON 对象。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 从写好的看板里取回这次提交的卡片盒子：宿主抬过下限之后，推给其他页面的是真正存下的那一份。
 *
 * @param board - 写入后的看板。
 * @param ids - 这次提交涉及的卡片 id。
 * @returns 按 id 索引的盒子。
 */
function storedLayouts(board: Board, ids: readonly string[]): Record<string, CardLayout> {
  const byId = new Map(board.instances.map((instance) => [instance.id, instance]))
  const layouts: Record<string, CardLayout> = {}
  for (const id of ids) {
    const instance = byId.get(id)
    if (instance !== undefined) layouts[id] = instance.layout
  }
  return layouts
}

/**
 * 一份布局提交的外形：布局修订号是非负整数，布局表是普通的 JSON 对象；每份布局由状态层逐张校验。
 *
 * @param value - 解出来的请求体。
 * @returns 可以当 `BoardLayoutRequest` 用时为真。
 */
function isBoardLayoutRequest(value: unknown): value is BoardLayoutRequest {
  if (!isRecord(value)) return false
  const { layoutRevision, layouts } = value
  return Number.isSafeInteger(layoutRevision) && (layoutRevision as number) >= 0 && isRecord(layouts)
}

/**
 * 一张卡在数据源与动作眼里的样子。
 *
 * @param board - 当前看板。
 * @param id - 卡片实例的 id。
 * @returns 数据源与动作的参数。
 * @throws {Refusal} 看板上没有这张卡。
 */
function faceOf(board: Board, id: string): InstanceFace {
  const instance = board.instances.find((candidate) => candidate.id === id)
  if (instance === undefined) throw new Refusal(404, `看板上没有这张卡：${id}`)
  return { id: instance.id, widget: instance.widget, props: instance.props }
}

/**
 * 把一份数据写进卡片：先按组件的 data schema 核对，再交给唯一的写入者（D6、D17）。
 *
 * @param context - 路由上下文。
 * @param id - 卡片实例的 id。
 * @param data - 数据源读出来或推给卡片的数据。
 * @throws {Refusal} 看板上没有这张卡，或数据与 schema 不符。
 */
async function saveData(context: RouteContext, id: string, data: unknown): Promise<void> {
  const face = faceOf(context.board, id)
  const problem = dataError(context.records.get(face.widget)?.manifest.data, data)
  if (problem !== undefined) throw new Refusal(400, problem)
  await context.save((current) => withInstanceData(current, id, data), {
    event: () => ({ type: 'instance', id, data }),
  })
}

/** 一条路由：方法、路径、请求体上限与处理器。 */
export interface Route {
  method: 'GET' | 'POST'
  pattern: RegExp
  limit: number
  handle(context: RouteContext, request: HostRequest, response: HostResponse, match: RegExpExecArray): Promise<void>
}

/** 路由表；顺序不影响匹配，路径与方法一起决定走哪一条。 */
const ROUTES: Route[] = [
  {
    method: 'GET',
    pattern: /^\/board$/,
    limit: 0,
    async handle(context, _request, response) {
      json(response, 200, snapshot(context))
    },
  },
  {
    method: 'POST',
    pattern: /^\/board\/layout$/,
    limit: LAYOUT_LIMIT,
    async handle(context, request, response) {
      const body = await readJson(request, LAYOUT_LIMIT)
      if (!isBoardLayoutRequest(body)) throw new Refusal(400, '布局提交的形状不对：需要 layoutRevision 与 layouts')
      const layouts = body.layouts
      try {
        await context.save(
          (current) => withBoardLayouts(current, layouts, (widget) => context.records.get(widget)?.manifest.minBox),
          {
            expectedLayoutRevision: body.layoutRevision,
            layoutChanged: true,
            event: (next) => ({ type: 'layout', layoutRevision: next.layoutRevision, layouts: storedLayouts(next, Object.keys(layouts)) }),
          },
        )
      } catch (error) {
        if (error instanceof StaleRevisionError) {
          json(response, 409, snapshot(context))
          return
        }
        throw error
      }
      json(response, 200, snapshot(context))
    },
  },
  {
    method: 'POST',
    pattern: /^\/board\/instance$/,
    limit: ADD_LIMIT,
    async handle(context, request, response) {
      const body = await readJson(request, ADD_LIMIT)
      if (!isRecord(body) || typeof body.widget !== 'string' || body.widget === '') throw new Refusal(400, '加卡片要写明 widget')
      const wanted = body as unknown as InstanceAddRequest
      const record = context.records.get(wanted.widget)
      if (record === undefined) throw new Refusal(400, `组件库里没有可用的组件 ${wanted.widget}`)
      // 请求没指定数据源时用组件自己声明的那个；调用方点名了一个不存在的源才算错误。
      const source = wanted.source ?? record.manifest.source
      if (wanted.source !== undefined && !context.sources.hasDataSource(wanted.source)) {
        throw new Refusal(400, `没有数据源 ${wanted.source}，提供它的插件可能没有安装`)
      }
      if (wanted.props !== undefined && !isRecord(wanted.props)) throw new Refusal(400, 'props 要是普通的 JSON 对象')
      if (wanted.layout !== undefined && !isCardLayout(wanted.layout)) throw new Refusal(400, 'layout 的列号、跨列与高度不合法')
      // 先定下卡片的 id：写入排进队列之后，响应与数据源都要按它找这张卡。
      const id = randomUUID()
      const options = {
        ...(source === undefined ? {} : { source }),
        ...(wanted.props === undefined ? {} : { props: wanted.props }),
        ...(wanted.layout === undefined ? {} : { layout: wanted.layout }),
      }
      await context.save((current) => withInstanceAdded(current, record, options, id).board, {
        layoutChanged: true,
        event: () => ({ type: 'board' }),
      })
      // 组件默认的数据源不在时卡片照样留着，数据留空：提供方可能只是还没装好（D17）。
      if (source !== undefined && context.sources.hasDataSource(source)) {
        const instance = faceOf(context.board, id)
        const data = await context.sources.readSource(source, instance)
        await saveData(context, id, data)
      }
      json(response, 201, { id, snapshot: snapshot(context) })
    },
  },
  {
    method: 'POST',
    pattern: /^\/board\/group$/,
    limit: ADD_LIMIT,
    async handle(context, request, response) {
      const body = await readJson(request, ADD_LIMIT)
      if (body !== undefined && !isRecord(body)) throw new Refusal(400, '加组卡要写明落点')
      const wanted = (body ?? {}) as GroupAddRequest
      if (wanted.layout !== undefined && !isCardLayout(wanted.layout)) throw new Refusal(400, 'layout 的列号、跨列与高度不合法')
      const front = context.records.get(FLIP_GROUP_FRONT)
      const back = context.records.get(FLIP_GROUP_BACK)
      if (front === undefined || back === undefined) throw new Refusal(400, `翻面组需要组件 ${FLIP_GROUP_FRONT} 与 ${FLIP_GROUP_BACK}`)
      let id = ''
      await context.save((current) => {
        const added = withGroupAdded(current, front, back, wanted.layout === undefined ? {} : { layout: wanted.layout })
        id = added.id
        return added.board
      }, { layoutChanged: true, event: () => ({ type: 'board' }) })
      json(response, 201, { id, snapshot: snapshot(context) })
    },
  },
  {
    method: 'POST',
    pattern: /^\/board\/group\/remove$/,
    limit: EMPTY_LIMIT,
    async handle(context, request, response) {
      const body = await readJson(request, EMPTY_LIMIT)
      if (!isRecord(body) || typeof body.group !== 'string' || body.group === '') throw new Refusal(400, '移除组卡要写明 group')
      const wanted = body as unknown as GroupRemoveRequest
      if (!context.board.instances.some((instance) => instance.group?.id === wanted.group)) throw new Refusal(404, `看板上没有这一组：${wanted.group}`)
      await context.save((current) => withGroupRemoved(current, wanted.group), { layoutChanged: true, event: () => ({ type: 'board' }) })
      json(response, 200, snapshot(context))
    },
  },
  {
    method: 'POST',
    pattern: /^\/refresh$/,
    limit: EMPTY_LIMIT,
    async handle(context, request, response) {
      await readJson(request, EMPTY_LIMIT)
      await context.refresh()
      json(response, 200, snapshot(context))
    },
  },
  {
    method: 'POST',
    pattern: /^\/instance\/([^/]+)\/state$/,
    limit: STATE_LIMIT,
    async handle(context, request, response, match) {
      const id = decodeURIComponent(match[1] as string)
      faceOf(context.board, id)
      const body = await readJson(request, STATE_LIMIT)
      if (!isRecord(body) || !('patch' in body)) throw new Refusal(400, '状态要放在 patch 里')
      const patch = (body as unknown as InstanceStateRequest).patch
      await context.save((current) => withInstanceState(current, id, patch), {
        event: (next) => ({ type: 'instance', id, state: next.instances.find((instance) => instance.id === id)?.state }),
      })
      json(response, 200, { ok: true })
    },
  },
  {
    method: 'POST',
    pattern: /^\/instance\/([^/]+)\/data$/,
    limit: DATA_LIMIT,
    async handle(context, request, response, match) {
      const id = decodeURIComponent(match[1] as string)
      faceOf(context.board, id)
      const body = await readJson(request, DATA_LIMIT)
      if (!isRecord(body) || !('data' in body)) throw new Refusal(400, '数据要放在 data 里')
      await saveData(context, id, (body as unknown as InstanceDataRequest).data)
      json(response, 200, { ok: true })
    },
  },
  {
    method: 'POST',
    pattern: /^\/instance\/([^/]+)\/action$/,
    limit: DATA_LIMIT,
    async handle(context, request, response, match) {
      const id = decodeURIComponent(match[1] as string)
      const face = faceOf(context.board, id)
      const body = await readJson(request, DATA_LIMIT)
      if (!isRecord(body) || typeof body.id !== 'string' || body.id === '') throw new Refusal(400, '动作要写明 id')
      const wanted = body as unknown as InstanceActionRequest
      const declared = context.records.get(face.widget)?.manifest.actions?.some((action) => action.id === wanted.id) === true
      if (!declared) throw new Refusal(400, `组件没有声明动作 ${wanted.id}`)
      const resolved = context.sources.resolveAction(wanted.id)
      if (resolved === undefined) throw new Refusal(400, `没有动作 ${wanted.id}，提供它的插件可能没有安装`)
      requireGrant(grantFacts(context), id, 'action', wanted.id, resolved.registration.permission, resolved.provider)
      // 动作的失败原因原样回给卡片：组件把它显示出来，用户不必去翻日志（D11）。
      const result = await context.sources.runAction(wanted.id, face, wanted.payload)
      json(response, 200, { ok: true, result: result ?? null })
    },
  },
  {
    method: 'POST',
    pattern: /^\/instance\/([^/]+)\/read$/,
    limit: EMPTY_LIMIT,
    async handle(context, request, response, match) {
      const id = decodeURIComponent(match[1] as string)
      const body = await readJson(request, EMPTY_LIMIT)
      const asked = isRecord(body) && typeof body.source === 'string' ? body.source : undefined
      const data = await readInto(context, id, asked)
      json(response, 200, { ok: true, data: data ?? null })
    },
  },
  {
    method: 'POST',
    pattern: /^\/instance\/([^/]+)\/grant$/,
    limit: EMPTY_LIMIT,
    async handle(context, request, response, match) {
      const id = decodeURIComponent(match[1] as string)
      const wanted = await grantRequestOf(context, request, id)
      const record = recordOfCard(context, id)
      const action = wanted.kind === 'action' ? context.sources.resolveAction(wanted.id) : undefined
      const source = wanted.kind === 'source' ? context.sources.resolveDataSource(wanted.id) : undefined
      if (wanted.kind === 'action' && action === undefined) throw new Refusal(400, `没有动作 ${wanted.id}，提供它的插件可能没有安装`)
      if (wanted.kind === 'source' && source === undefined) throw new Refusal(400, `没有数据源 ${wanted.id}，提供它的插件可能没有安装`)
      const provider = action?.provider ?? source?.provider
      const permission = action?.registration.permission ?? source?.registration.permission
      const grant = await context.grants.grant({
        kind: wanted.kind,
        id: wanted.id,
        hash: record.hash,
        widget: record.manifest.id,
        ...(provider === undefined ? {} : { provider }),
        ...(permission === undefined ? {} : { permission }),
      })
      json(response, 200, { ok: true, grant })
    },
  },
  {
    method: 'POST',
    pattern: /^\/instance\/([^/]+)\/revoke$/,
    limit: EMPTY_LIMIT,
    async handle(context, request, response, match) {
      const id = decodeURIComponent(match[1] as string)
      const wanted = await grantRequestOf(context, request, id)
      const removed = await context.grants.revoke(wanted.kind, recordOfCard(context, id).hash, wanted.id)
      json(response, 200, { ok: true, removed })
    },
  },
  {
    method: 'POST',
    pattern: /^\/instance\/([^/]+)\/remove$/,
    limit: EMPTY_LIMIT,
    async handle(context, request, response, match) {
      const id = decodeURIComponent(match[1] as string)
      faceOf(context.board, id)
      await readJson(request, EMPTY_LIMIT)
      await context.save((current) => withInstanceRemoved(current, id), { layoutChanged: true, event: () => ({ type: 'board' }) })
      json(response, 200, snapshot(context))
    },
  },
  {
    method: 'GET',
    pattern: /^\/events$/,
    limit: 0,
    async handle(context, _request, response) {
      context.live.subscribe(response)
    },
  },
  {
    method: 'GET',
    pattern: /^\/widget\/([0-9a-f]{64})\/document$/,
    limit: 0,
    async handle(context, request, response, match) {
      const hash = match[1] as string
      // 按出现过的版本取，不只看当前版本：热重载之后仍在请求旧哈希的 iframe 也拿得到文档。
      const record = await context.versions.get(hash)
      if (record === undefined) throw new Refusal(404, `没有这个版本：${hash}`)
      const lang = new URL(request.url ?? '/', 'http://board.invalid').searchParams.get('lang') ?? 'zh-CN'
      const nonce = freshNonce()
      const html = buildDocument(record, context.live.assets, nonce, { lang })
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': contentSecurityPolicy(nonce),
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
      })
      response.end(html)
    },
  },
]

/**
 * 读一次授权或撤权请求：看板上有这张卡，请求里写明了动作或数据源的名字。
 *
 * @param context - 路由上下文。
 * @param request - 宿主的请求。
 * @param id - 卡片实例的 id。
 * @returns 解析出来的那一类与名字。
 * @throws {Refusal} 看板上没有这张卡（404），或请求里没有名字（400）。
 */
async function grantRequestOf(context: RouteContext, request: HostRequest, id: string): Promise<{ kind: GrantKind, id: string }> {
  faceOf(context.board, id)
  const body = await readJson(request, EMPTY_LIMIT)
  if (!isRecord(body) || typeof body.id !== 'string' || body.id === '') throw new Refusal(400, '授权或撤权要写明 id')
  return { kind: body.kind === 'source' ? 'source' : 'action', id: body.id }
}

/**
 * 一张卡对应的组件记录。
 *
 * @param context - 路由上下文。
 * @param id - 卡片实例的 id。
 * @returns 组件记录。
 * @throws {Refusal} 看板上没有这张卡，或它的组件不在组件库里。
 */
function recordOfCard(context: RouteContext, id: string): WidgetRecord {
  const widget = context.board.instances.find((instance) => instance.id === id)?.widget ?? ''
  const record = context.records.get(widget)
  if (record === undefined) throw new Refusal(400, '这张卡的组件不在组件库里，先把它装回来')
  return record
}

/**
 * 把路由上下文里跟授权有关的那几项收成一份事实（D6）。
 *
 * @param context - 路由上下文。
 * @returns 看板、组件当前的版本哈希与授权表。
 */
function grantFacts(context: RouteContext): GrantFacts {
  const hashes = new Map<string, string>()
  for (const [id, record] of context.records) hashes.set(id, record.hash)
  return { board: context.board, hashes, grants: context.grants }
}

/**
 * 让一张卡按绑定的数据源读一次，把数据写进卡片（D6、D17）。
 *
 * 手动读、工具读与定时刷新都走这一条：校验与写入只有一处。
 *
 * @param context - 路由上下文。
 * @param id - 卡片实例的 id。
 * @param source - 数据源的名字；省略时用卡片绑定的那个。
 * @returns 读回来的数据。
 * @throws {Refusal} 看板上没有这张卡、这张卡没有数据源、数据源不在、或没有授权。
 */
export async function readInto(context: RouteContext, id: string, source?: string): Promise<unknown> {
  const face = faceOf(context.board, id)
  const asked = source ?? context.board.instances.find((instance) => instance.id === id)?.source
  if (asked === undefined || asked === '') throw new Refusal(400, `这张卡没有数据源：${id}`)
  const resolved = context.sources.resolveDataSource(asked)
  if (resolved === undefined) throw new Refusal(400, `没有数据源 ${asked}，提供它的插件可能没有安装`)
  requireGrant(grantFacts(context), id, 'source', asked, resolved.registration.permission, resolved.provider)
  const data = await context.sources.readSource(asked, face)
  await saveData(context, id, data)
  return data
}

/**
 * 路由表。
 *
 * @param context - 组件库、看板、通知器与栅栏；`records` 与 `entries` 会在热重载时被替换。
 * @returns 交给宿主 web 服务的处理器。
 */
export function createHandler(context: RouteContext): (req: HostRequest, res: HostResponse) => Promise<void> {
  return async (request, response) => {
    const rejection = rejectionOf(request, context.connection)
    if (rejection !== undefined) {
      response.writeHead(rejection)
      response.end()
      return
    }
    const url = new URL(request.url ?? '/', 'http://board.invalid')
    const path = url.pathname.startsWith(PLUGIN_ROUTE) ? url.pathname.slice(PLUGIN_ROUTE.length) : ''
    const matched = [...ROUTES, ...shareRoutes(context)].flatMap((route) => {
      const match = route.pattern.exec(path)
      return match === null ? [] : [{ route, match }]
    })
    if (matched.length === 0) {
      json(response, 404, { error: `没有这条路径：${path}` })
      return
    }
    const chosen = matched.find((candidate) => candidate.route.method === request.method)
    if (chosen === undefined) {
      response.writeHead(405, { allow: matched.map((candidate) => candidate.route.method).join(', ') })
      response.end()
      return
    }
    try {
      await chosen.route.handle(context, request, response, chosen.match)
    } catch (error) {
      if (error instanceof Refusal) {
        json(response, error.status, { error: error.message, ...error.extra })
        return
      }
      const message = error instanceof Error ? error.message : String(error)
      // 卡片在核对与写入之间被另一个窗口移除了：这是 404，不是服务器的故障。
      if (/^看板上没有这张卡/.test(message)) {
        json(response, 404, { error: message })
        return
      }
      json(response, 500, { error: message })
    }
  }
}
