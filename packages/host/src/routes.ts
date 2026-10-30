/**
 * 插件的私有路由（D1、D3）：工作区与看板、卡片增删、状态与数据、布局、组件文档与变更通知。
 *
 * 每条请求先过宿主的请求栅栏；宿主没有这项服务时只放行本机回环来的请求，判定以对端地址为准。
 * 路由写成一张表：方法、路径、请求体上限与处理器各写一次，404、405 与 413 由表本身给出，处理器
 * 只管自己那一件事。状态码按原因分开：没有这张卡或这块看板是 404，请求形状不对是 400，布局修订号
 * 过期是 409，组件库与数据源的拒绝是 400 并写明原因，提供方超时是 504、执行槽占满 429（D31）。
 *
 * 动作的对象是一块看板时，看板 id 写在路径里；对象是一张卡片或一组卡片时按它们自己的 id 找，卡片
 * 与组的 id 全工作区唯一（D21）。
 */
import { randomUUID } from 'node:crypto'
import type {
  Board,
  BoardCreateRequest,
  BoardEvent,
  BoardLayoutRequest,
  BoardRenameRequest,
  CardLayout,
  GrantKind,
  GrantRequest,
  GroupAddRequest,
  GroupRemoveRequest,
  HostConnection,
  HostCredentials,
  HostRequest,
  HostResponse,
  InstanceAddRequest,
  InstanceActionRequest,
  InstanceDataRequest,
  InstanceStateRequest,
  WidgetLibraryEntry,
  WidgetRoot,
} from '@dsh-widget-board/contracts'
import { FLIP_GROUP_BACK, FLIP_GROUP_FRONT, PLUGIN_ROUTE, withRequestSignal } from '@dsh-widget-board/contracts'
import { BOARD_TITLE_LIMIT, boardTitleProblem } from '@dsh-widget-board/contracts'
import type { BoardTitleProblem } from '@dsh-widget-board/contracts'
import type { VersionStore } from './blobs'
import { buildDocument, contentSecurityPolicy, freshNonce } from './document'
import { groupRoutes } from './groups'
import { capabilityRoutes } from './capabilities'
import type { GrantStore } from './grants'
import { isRecord } from './guards'
import { readInto, runAction, saveData } from './instance-operations'
import { locate } from './lookup'
import type { RequestLog } from './request-log'
import type { Live } from './live'
import type { LibraryLoad, WidgetRecord } from './library'
import { json } from './response'
import { propsError } from './schema'
import { settingsRoutes } from './settings'
import { workspaceSnapshot } from './snapshot'
import type { Registries } from './sources'
import { isCardLayout } from '@dsh-widget-board/model'
import { readJson } from './body'
import { Refusal } from './refusal'
import { shareRoutes } from './share'
import type { SelfChecks } from './selfcheck'
import { selfCheckRoutes } from './selfcheck'
import { StaleRevisionError, withBoardLayouts, withGroupAdded, withGroupRemoved, withInstanceAdded, withInstanceRemoved, withInstanceStateChecked } from './state'
import type { RateLimiter } from './limits'
import type { MarketRegistry } from './market'
import { visibilityRoutes } from './visibility'
import type { SaveOptions, Workspace } from './workspace'

/** 卡片状态的请求体上限：界面状态只是几张表单的值，几 KB 足够。 */
const STATE_LIMIT = 16 * 1024

/** 一次布局提交的上限：一整块看板的卡片盒子，比单张卡的状态大一些。 */
const LAYOUT_LIMIT = 64 * 1024

/** 加一张卡的请求体上限。 */
const ADD_LIMIT = 32 * 1024

/** 推送数据的请求体上限：数据源读出来的快照可能不小，但仍要有个头。 */
const DATA_LIMIT = 256 * 1024


/** 加卡片、移除卡片与看板管理这类请求体可以没有。 */
const EMPTY_LIMIT = 1024

/** 看板标题不合规矩时回给客户端的那一句（D21）。 */
const BOARD_TITLE_REFUSAL: Record<BoardTitleProblem, string> = {
  'not-text': '看板标题要是文字',
  empty: '看板标题不能是空的',
  'too-long': `看板标题最多 ${String(BOARD_TITLE_LIMIT)} 个字符`,
}

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
  /** 全部看板与唯一的写入者（D21）。 */
  workspace: Workspace
  /**
   * 当前选中的看板。
   *
   * D21 之后看板由 `workspace` 持有；这一项与 `save` 是给「只关心当前那块看板」的处理器与工具用的
   * 适配，`index.ts` 里用 getter 接上（D5）。
   */
  readonly board: Board
  /**
   * 改当前选中的看板：与界面走同一条写入队列，带期望的布局修订号时轮到写入会再核对一次。
   *
   * @param change - 从当前看板算出新看板。
   * @param options - 修订号、要不要动布局修订号、推哪条事件。
   */
  save: (change: (current: Board) => Board, options: SaveOptions) => Promise<Board>
  live: Live
  connection: HostConnection | undefined
  /** 主动重读组件库与运行时（D17）：菜单上的刷新按钮用它。 */
  refresh: () => Promise<void>
  /** 数据源与动作的注册表（D6）。 */
  sources: Registries
  /** 人给出过的授权，绑在组件版本上（D6）。 */
  grants: GrantStore
  /**
   * 重算一次按观众启停的东西（D6、D32）：定时刷新与数据订阅共用这一个入口。
   *
   * 授权给出或收回之后要调一次——订阅能不能开着取决于授权在不在。工具那一侧的替身没有它。
   */
  sync?: () => void
  /** 状态写入的预算：按卡与按看板各一份（D23）。 */
  limits: { stateCard: RateLimiter, stateBoard: RateLimiter }
  /** 宿主的凭据服务（D27）；没装时是 `undefined`，设置弹窗给出可见的说法。 */
  credentials?: () => HostCredentials | undefined
  /** `widget_define` 的自检：任务与报告经它在工具与会话页面之间交接（D9）。 */
  selfChecks: SelfChecks
  /** 组件对外请求的日志（D28）：按卡片记最近几十条。 */
  requests: RequestLog
  /** 市场提供方注册表（D8 之后的市场契约）。 */
  market: MarketRegistry
  /** 市场组件的来源目录（D17）。 */
  marketDir: string
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
 * 一块看板。
 *
 * @param context - 路由上下文。
 * @param id - 看板 id。
 * @returns 那块看板。
 * @throws {Refusal} 没有这块看板。
 */
function boardById(context: RouteContext, id: string): Board {
  if (!context.workspace.has(id)) throw new Refusal(404, `没有这块看板：${id}`)
  return context.workspace.board(id)
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
    pattern: /^\/boards$/,
    limit: 0,
    async handle(context, _request, response) {
      json(response, 200, workspaceSnapshot(context))
    },
  },
  {
    method: 'POST',
    pattern: /^\/boards$/,
    limit: EMPTY_LIMIT,
    async handle(context, request, response) {
      const body = await readJson(request, EMPTY_LIMIT)
      if (body !== undefined && !isRecord(body)) throw new Refusal(400, '新建看板要写明标题')
      const wanted = (body ?? {}) as BoardCreateRequest
      if (wanted.title !== undefined) {
        const problem = boardTitleProblem(wanted.title)
        if (problem !== null) throw new Refusal(400, BOARD_TITLE_REFUSAL[problem])
      }
      const board = await context.workspace.create(wanted.title)
      json(response, 201, { id: board.id, snapshot: workspaceSnapshot(context) })
    },
  },
  {
    method: 'POST',
    pattern: /^\/boards\/([^/]+)\/rename$/,
    limit: EMPTY_LIMIT,
    async handle(context, request, response, match) {
      const id = decodeURIComponent(match[1] as string)
      boardById(context, id)
      const body = await readJson(request, EMPTY_LIMIT)
      if (!isRecord(body)) throw new Refusal(400, '改标题要写明 title')
      const problem = boardTitleProblem(body.title)
      if (problem !== null) throw new Refusal(400, BOARD_TITLE_REFUSAL[problem])
      await context.workspace.rename(id, (body as unknown as BoardRenameRequest).title)
      json(response, 200, workspaceSnapshot(context))
    },
  },
  {
    method: 'POST',
    pattern: /^\/boards\/([^/]+)\/remove$/,
    limit: EMPTY_LIMIT,
    async handle(context, request, response, match) {
      const id = decodeURIComponent(match[1] as string)
      boardById(context, id)
      await readJson(request, EMPTY_LIMIT)
      await context.workspace.remove(id)
      json(response, 200, workspaceSnapshot(context))
    },
  },
  {
    method: 'POST',
    pattern: /^\/boards\/([^/]+)\/activate$/,
    limit: EMPTY_LIMIT,
    async handle(context, request, response, match) {
      const id = decodeURIComponent(match[1] as string)
      boardById(context, id)
      await readJson(request, EMPTY_LIMIT)
      await context.workspace.setActive(id)
      json(response, 200, workspaceSnapshot(context))
    },
  },
  {
    method: 'POST',
    pattern: /^\/boards\/([^/]+)\/layout$/,
    limit: LAYOUT_LIMIT,
    async handle(context, request, response, match) {
      const id = decodeURIComponent(match[1] as string)
      boardById(context, id)
      const body = await readJson(request, LAYOUT_LIMIT)
      if (!isBoardLayoutRequest(body)) throw new Refusal(400, '布局提交的形状不对：需要 layoutRevision 与 layouts')
      const layouts = body.layouts
      try {
        let saved: Record<string, CardLayout> = {}
        const next = await context.workspace.save(
          id,
          (current) => withBoardLayouts(current, layouts, (widget) => context.records.get(widget)?.manifest.minBox),
          {
            expectedLayoutRevision: body.layoutRevision,
            layoutChanged: true,
            event: (savedBoard, board) => {
              saved = storedLayouts(savedBoard, Object.keys(layouts))
              return { type: 'layout', board, layoutRevision: savedBoard.layoutRevision, layouts: saved }
            },
          },
        )
        json(response, 200, { layoutRevision: next.layoutRevision, layouts: saved })
      } catch (error) {
        if (error instanceof StaleRevisionError) {
          json(response, 409, workspaceSnapshot(context))
          return
        }
        throw error
      }
    },
  },
  {
    method: 'POST',
    pattern: /^\/boards\/([^/]+)\/instance$/,
    limit: ADD_LIMIT,
    async handle(context, request, response, match) {
      const boardId = decodeURIComponent(match[1] as string)
      const board = boardById(context, boardId)
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
      if (wanted.props !== undefined) {
        const problem = propsError(record.manifest.props, wanted.props)
        if (problem !== undefined) throw new Refusal(400, problem)
      }
      if (wanted.layout !== undefined && !isCardLayout(wanted.layout)) throw new Refusal(400, 'layout 的列号、跨列与高度不合法')
      // 先定下卡片的 id：写入排进队列之后，响应与数据源都要按它找这张卡。
      const id = randomUUID()
      const options = {
        ...(source === undefined ? {} : { source }),
        ...(wanted.props === undefined ? {} : { props: wanted.props }),
        ...(wanted.layout === undefined ? {} : { layout: wanted.layout }),
      }
      await context.workspace.save(boardId, (current) => withInstanceAdded(current, record, options, id).board, {
        layoutChanged: true,
        event: () => ({ type: 'board' }),
      })
      // 组件默认的数据源不在时卡片照样留着，数据留空：提供方可能只是还没装好（D17）。
      if (source !== undefined && context.sources.resolveDataSource(source) !== undefined) {
        try {
          // 写入之后第一次读走和 /read 同一条路径：授权、超时与并发都只有一处（D6）。
          // 缺授权、超时与提供方失败都算读不出来：卡片照加、数据留空，用户在卡片上给出「允许」之后再读就有数据了。
          await readInto(context, id, source)
        } catch (error) {
          console.error(`widget-board: 新卡片 ${id} 第一次读 ${source} 失败：${error instanceof Error ? error.message : String(error)}`)
        }
      }
      json(response, 201, { id, snapshot: workspaceSnapshot(context) })
    },
  },
  {
    method: 'POST',
    pattern: /^\/boards\/([^/]+)\/group$/,
    limit: ADD_LIMIT,
    async handle(context, request, response, match) {
      const boardId = decodeURIComponent(match[1] as string)
      boardById(context, boardId)
      const body = await readJson(request, ADD_LIMIT)
      if (body !== undefined && !isRecord(body)) throw new Refusal(400, '加组卡要写明落点')
      const wanted = (body ?? {}) as GroupAddRequest
      if (wanted.layout !== undefined && !isCardLayout(wanted.layout)) throw new Refusal(400, 'layout 的列号、跨列与高度不合法')
      const front = context.records.get(FLIP_GROUP_FRONT)
      const back = context.records.get(FLIP_GROUP_BACK)
      if (front === undefined || back === undefined) throw new Refusal(400, `翻面组需要组件 ${FLIP_GROUP_FRONT} 与 ${FLIP_GROUP_BACK}`)
      let id = ''
      await context.workspace.save(boardId, (current) => {
        const added = withGroupAdded(current, front, back, wanted.layout === undefined ? {} : { layout: wanted.layout })
        id = added.id
        return added.board
      }, { layoutChanged: true, event: () => ({ type: 'board' }) })
      json(response, 201, { id, snapshot: workspaceSnapshot(context) })
    },
  },
  {
    method: 'POST',
    pattern: /^\/group\/remove$/,
    limit: EMPTY_LIMIT,
    async handle(context, request, response) {
      const body = await readJson(request, EMPTY_LIMIT)
      if (!isRecord(body) || typeof body.group !== 'string' || body.group === '') throw new Refusal(400, '移除组卡要写明 group')
      const wanted = body as unknown as GroupRemoveRequest
      const board = context.workspace.findGroup(wanted.group)
      if (board === undefined) throw new Refusal(404, `看板上没有这一组：${wanted.group}`)
      await context.workspace.save(board.id, (current) => withGroupRemoved(current, wanted.group), { layoutChanged: true, event: () => ({ type: 'board' }) })
      // 组里的卡一起走了，它们的请求日志跟着收掉（D28）。
      for (const instance of board.instances.filter((instance) => instance.group?.id === wanted.group)) {
        context.requests.drop(instance.id)
      }
      json(response, 200, workspaceSnapshot(context))
    },
  },
  {
    method: 'POST',
    pattern: /^\/refresh$/,
    limit: EMPTY_LIMIT,
    async handle(context, request, response) {
      await readJson(request, EMPTY_LIMIT)
      await context.refresh()
      json(response, 200, workspaceSnapshot(context))
    },
  },
  {
    method: 'POST',
    pattern: /^\/instance\/([^/]+)\/state$/,
    limit: STATE_LIMIT,
    async handle(context, request, response, match) {
      const id = decodeURIComponent(match[1] as string)
      const { board } = locate(context, id)
      const body = await readJson(request, STATE_LIMIT)
      if (!isRecord(body) || !('patch' in body)) throw new Refusal(400, '状态要放在 patch 里')
      const patch = (body as unknown as InstanceStateRequest).patch
      if (!context.limits.stateCard.allow(id) || !context.limits.stateBoard.allow(board.id)) {
        throw new Refusal(429, '状态写入太频繁，稍后再试', { code: 'state-rate-limited' })
      }
      // 这次是否对象合并，决定事件带补丁还是整份 state；两边用的是同一条合并规则。
      let merged = false
      await context.workspace.save(board.id, (current) => {
        const instance = current.instances.find((candidate) => candidate.id === id)
        merged = isRecord(instance?.state) && isRecord(patch)
        return withInstanceStateChecked(current, id, patch)
      }, {
        event: (next) => {
          const state = next.instances.find((instance) => instance.id === id)?.state
          return merged ? { type: 'instance', id, patch } : { type: 'instance', id, state }
        },
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
      locate(context, id)
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
      const body = await readJson(request, DATA_LIMIT)
      if (!isRecord(body) || typeof body.id !== 'string' || body.id === '') throw new Refusal(400, '动作要写明 id')
      const wanted = body as unknown as InstanceActionRequest
      const result = await withRequestSignal(request, response, async signal => await runAction(context, id, wanted.id, wanted.payload, signal))
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
      const data = await withRequestSignal(request, response, async signal => await readInto(context, id, asked, signal))
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
      const capability = wanted.kind === 'capability' ? context.sources.resolveCapability(wanted.id) : undefined
      if (wanted.kind === 'action' && action === undefined) throw new Refusal(400, `没有动作 ${wanted.id}，提供它的插件可能没有安装`)
      if (wanted.kind === 'source' && source === undefined) throw new Refusal(400, `没有数据源 ${wanted.id}，提供它的插件可能没有安装`)
      if (wanted.kind === 'capability' && capability === undefined) throw new Refusal(400, `没有能力 ${wanted.id}，提供它的插件可能没有安装`)
      const provider = action?.provider ?? source?.provider ?? capability?.provider
      const permission = action?.registration.permission ?? source?.registration.permission ?? capability?.registration.permission
      const grant = await context.grants.grant({
        kind: wanted.kind,
        id: wanted.id,
        hash: record.hash,
        widget: record.manifest.id,
        ...(provider === undefined ? {} : { provider }),
        ...(permission === undefined ? {} : { permission }),
      })
      // 刚给出一条授权：原来因为没有授权而没开的数据订阅现在可以开了（D32）。
      context.sync?.()
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
      // 收回了授权：靠它开着的数据订阅要跟着退掉（D32）。
      context.sync?.()
      json(response, 200, { ok: true, removed })
    },
  },
  {
    method: 'POST',
    pattern: /^\/instance\/([^/]+)\/remove$/,
    limit: EMPTY_LIMIT,
    async handle(context, request, response, match) {
      const id = decodeURIComponent(match[1] as string)
      const { board } = locate(context, id)
      await readJson(request, EMPTY_LIMIT)
      await context.workspace.save(board.id, (current) => withInstanceRemoved(current, id), { layoutChanged: true, event: () => ({ type: 'board' }) })
      context.requests.drop(id)
      json(response, 200, workspaceSnapshot(context))
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
  locate(context, id)
  const body = await readJson(request, EMPTY_LIMIT)
  if (!isRecord(body) || typeof body.id !== 'string' || body.id === '') throw new Refusal(400, '授权或撤权要写明 id')
  if (body.kind !== undefined && body.kind !== 'source' && body.kind !== 'action' && body.kind !== 'capability') {
    throw new Refusal(400, '授权类型只能是 action、source 或 capability')
  }
  return { kind: body.kind === 'source' ? 'source' : body.kind === 'capability' ? 'capability' : 'action', id: body.id }
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
  const record = context.records.get(locate(context, id).instance.widget)
  if (record === undefined) throw new Refusal(400, '这张卡的组件不在组件库里，先把它装回来')
  return record
}

/**
 * 路由表。
 *
 * @param context - 组件库、工作区、通知器与栅栏；`records` 与 `entries` 会在热重载时被替换。
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
    const matched = [...ROUTES, ...shareRoutes(context), ...settingsRoutes(), ...groupRoutes(), ...capabilityRoutes(), ...selfCheckRoutes(), ...visibilityRoutes()].flatMap((route) => {
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
      // 卡片、组或看板在核对与写入之间被另一个窗口移除了：这是 404，不是服务器的故障。
      if (/^(看板上没有这张卡|看板上没有这一组|没有这块看板)/.test(message)) {
        json(response, 404, { error: message })
        return
      }
      json(response, 500, { error: message })
    }
  }
}
