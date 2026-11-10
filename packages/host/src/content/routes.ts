/**
 * 人工内容写入的两条路由（技术契约 3）：创建一张完整的卡片、编辑一张卡的内容。
 *
 * 两条都只从人的界面调用，身份由路由栅栏确认；与组件自己的 `/state` 不同，它们不占组件的写入
 * 频率额度，一整次人工保存算一次请求。创建要么整张卡都写进去，要么什么都不留；编辑只改被点名的
 * 那几项，其余保持原样。
 */
import { randomUUID } from 'node:crypto'
import type {
  Board,
  BoardInstance,
  CardContentModel,
  InstanceComposeRequest,
  InstanceContentRequest,
  WidgetManifest,
} from '@dsh-widget-board/contracts'
import { readJson } from '../body'
import { isRecord } from '../guards'
import type { WidgetRecord } from '../library'
import { recordOf } from '../library'
import { locate } from '../lookup'
import { Refusal } from '../refusal'
import { json } from '../response'
import { workspaceSnapshot } from '../snapshot'
import type { Route, RouteContext } from '../routes'
import { isCardLayout } from '@dsh-widget-board/model'
import { campusProps, campusState, isCampusSchema } from '@dsh-widget-board/model/campus/model'
import { STATE_BYTES_LIMIT } from '../limits'
import { instanceOf, stateBytes, withArrangementUnits, withInstancePatched } from '../state'
import { checkContentBudget, contentIssues, handshakeBytes } from './validate'
import { mediaOf } from '../media/routes'
import type { MediaBinding, InstanceMedia } from '@dsh-widget-board/contracts'

/** 没有媒体修改时兼容现有宿主与调用；有修改时必须使用受限存储事务。 */
async function bindMedia<T>(context: RouteContext, target: string, binding: MediaBinding, save: (media: InstanceMedia | undefined) => Promise<T>, beforeBind?: () => void): Promise<T> {
  if (binding.media === undefined) { beforeBind?.(); return await save(context.workspace.findInstance(target)?.instance.media) }
  return await mediaOf(context).bind(target, binding, save, true, beforeBind)
}

/** 创建与编辑的请求体上限（技术契约 3）：一整张卡的内容，比单次状态写入大。 */
export const CONTENT_LIMIT = 128 * 1024

/**
 * 表单读模型里的组件那一份：props 与 data 的 schema、文案与盒子。
 *
 * @param record - 组件库里的记录。
 * @returns 创建器与编辑器都读的那一份。
 */
function formOf(record: WidgetRecord): CardContentModel['widget'] {
  const { manifest } = record
  return {
    id: manifest.id,
    hash: record.hash,
    title: manifest.title,
    version: manifest.version,
    source: record.source,
    ...(record.provider === undefined ? {} : { provider: record.provider }),
    ...(manifest.props === undefined ? {} : { propsSchema: manifest.props }),
    ...(manifest.data === undefined ? {} : { dataSchema: manifest.data }),
    ...(manifest.state === undefined ? {} : { stateSchema: manifest.state }),
    ...(manifest.text === undefined ? {} : { text: manifest.text }),
    sizes: manifest.sizes,
    ...(manifest.defaultBox === undefined ? {} : { defaultBox: manifest.defaultBox }),
    ...(manifest.minBox === undefined ? {} : { minBox: manifest.minBox }),
  }
}

/**
 * 这块看板上除这张卡之外，其余卡片已经占用的状态字节。
 *
 * @param board - 卡片所在的看板。
 * @param id - 这次写入的那张卡；创建时传 `null`。
 * @returns 其余卡片的合计。
 */
function otherStateBytes(board: Board, id: string | null): number {
  return board.instances.reduce((sum, instance) => instance.id === id ? sum : sum + stateBytes(instance.state), 0)
}

/**
 * 一张卡与它当前的组件记录：内容写入的几条路由都要先过这一步。
 *
 * @param context - 路由上下文。
 * @param id - 卡片实例的 id。
 * @returns 那张卡、它所在的看板与组件记录。
 * @throws {Refusal} 没有这张卡，或它的组件不在组件库里。
 */
function cardOf(context: RouteContext, id: string): { board: Board, instance: BoardInstance, record: WidgetRecord } {
  const found = locate(context, id)
  const record = context.records.get(found.instance.widget)
  if (record === undefined) throw new Refusal(404, `组件 ${found.instance.widget} 不在组件库里`)
  return { ...found, record }
}

/**
 * 把这次要写的几项与组件的 schema 核对；只校验这一次点名的那几项。
 *
 * 没点名的项用实例上的原值原样保留、不过 schema：旧卡片上的值要么是 null（`/instance` 建出来就是这个），
 * 要么是当初按当时的 schema 写进去的；组件升级过 schema 之后再用新规则卡它，会让「旧卡改个标题」这种
 * 一次普通的编辑失败（技术契约第 3 节的「可选 props/data/state」指的是要改的那几项）。
 *
 * `null` 表示「还没有内容」，与 `/instance` 建卡时的初值同义：它只说明这一份没填过，不算与 schema 不符。
 *
 * @param manifest - 组件 manifest。
 * @param written - 这次点名要写的那几项。
 * @returns 点名的几项原样；调用方把它们并进实例，未点名的项留在实例上不动。
 * @throws {Refusal} props 不是对象，或点名的那一项与 schema 不符。
 */
function settle(
  manifest: WidgetManifest,
  written: { props?: Record<string, unknown>, data?: unknown, state?: unknown },
): { props?: Record<string, unknown>, data?: unknown, state?: unknown } {
  if (written.props !== undefined && !isRecord(written.props)) throw new Refusal(400, 'props 要是普通的 JSON 对象')
  if (written.props !== undefined) contentIssues('props', manifest.props, written.props)
  if ('data' in written && written.data !== null) contentIssues('data', manifest.data, written.data)
  if ('state' in written && written.state !== null) contentIssues('state', manifest.state, written.state)
  // 校园结构的用户副本与内置组件使用同一语义校验；只校验本次点名的字段，保留旧内容编辑契约。
  if (isCampusSchema(manifest.state)) {
    for (const subject of ['props', 'state'] as const) {
      if (!(subject in written)) continue
      try {
        if (subject === 'props') campusProps(written.props)
        else campusState(written.state)
      } catch (error) {
        const message = (error as Error).message
        if (subject === 'state' && stateBytes(written.state) > STATE_BYTES_LIMIT) throw new Refusal(413, message, { code: 'state-too-large' })
        throw new Refusal(400, message, { subject, issues: [{ path: '/', message }] })
      }
    }
  }
  return written
}

/**
 * 两条内容路由。
 *
 * @param context - 路由上下文。
 * @returns 创建与编辑。
 */
export function contentRoutes(context: RouteContext): Route[] {
  return [
    {
      method: 'POST',
      pattern: /^\/boards\/([^/]+)\/compose$/,
      limit: CONTENT_LIMIT,
      async handle(_context, request, response, match) {
        const boardId = decodeURIComponent(match[1] as string)
        if (!context.workspace.has(boardId)) throw new Refusal(404, `没有这块看板：${boardId}`)
        const raw = await readJson(request, CONTENT_LIMIT)
        if (!isRecord(raw) || typeof raw.widget !== 'string' || raw.widget === '') throw new Refusal(400, '创建卡片要写明 widget')
        const wanted = raw as unknown as InstanceComposeRequest
        const record = context.records.get(wanted.widget)
        if (record === undefined) throw new Refusal(400, `组件库里没有可用的组件 ${wanted.widget}`)
        // 编辑器里预览过的那一版与库里的不一致：不静默换成新版，让界面重读之后由人决定。
        if (wanted.expectedHash !== undefined && wanted.expectedHash !== '' && wanted.expectedHash !== record.hash) {
          throw new Refusal(409, '组件在你编辑期间变过，重读之后再来', { code: 'stale-hash', hash: record.hash })
        }
        if (wanted.layout !== undefined && !isCardLayout(wanted.layout)) throw new Refusal(400, 'layout 的列号、跨列与高度不合法')
        // 创建请求的三项要么都在（模板全都给全），要么显式的 null；两种都过 schema，undefined 不算点名。
        const content = settle(record.manifest, wanted)
        // 整张卡一次写进去：内容与状态都已经校验，写入失败时磁盘上还是原来那一份（D5）。
        const id = randomUUID()
        await bindMedia(context, `board:${boardId}`, wanted, async media => await context.workspace.save(boardId, (current) => {
          // 队列里的 current 才包含其它窗口刚刚创建的卡片，额度与写入共同提交。
          checkContentBudget(content.state ?? null, {
            requestBytes: Buffer.byteLength(JSON.stringify(raw), 'utf8'),
            requestLimit: CONTENT_LIMIT,
            otherStateBytes: otherStateBytes(current, null),
            handshakeBytes: handshakeBytes(record.manifest, { props: content.props ?? {}, data: content.data ?? null, state: content.state ?? null }),
          })
          const added = instanceOf(record, current.instances, {
            props: content.props ?? {},
            ...(wanted.layout === undefined ? {} : { layout: wanted.layout }),
          })
          const composed: BoardInstance = { ...added, id, data: content.data ?? null, state: content.state ?? null, ...(media === undefined ? {} : { media }) }
          return withArrangementUnits({ ...current, instances: [...current.instances, composed] }, [], [{ id, box: { w: composed.layout.w, h: composed.layout.h } }])
        }, { layoutChanged: true, event: () => ({ type: 'board' }) }))
        json(response, 201, { id, snapshot: workspaceSnapshot(context) })
      },
    },
    {
      method: 'POST',
      pattern: /^\/instance\/([^/]+)\/content$/,
      limit: CONTENT_LIMIT,
      async handle(_context, request, response, match) {
        const id = decodeURIComponent(match[1] as string)
        const found = cardOf(context, id)
        const record = found.record
        const raw = await readJson(request, CONTENT_LIMIT)
        if (!isRecord(raw)) throw new Refusal(400, '内容写入要是一个 JSON 对象')
        const wanted = raw as unknown as InstanceContentRequest
        if (!Number.isSafeInteger(wanted.expectedRevision) || wanted.expectedRevision < 0) {
          throw new Refusal(400, '内容写入要带上读到的 expectedRevision')
        }
        if (wanted.props === undefined && !('data' in wanted) && !('state' in wanted) && wanted.media === undefined) {
          throw new Refusal(400, '这次内容写入没有要改的项')
        }
        const content = settle(record.manifest, wanted)
        // 额度与握手按「改完之后的样子」算：没点名的那几项并上实例上的原值。
        const final = {
          props: wanted.props === undefined ? found.instance.props : content.props,
          data: 'data' in wanted ? content.data : found.instance.data,
          state: 'state' in wanted ? content.state : found.instance.state,
        }
        checkContentBudget(final.state, {
          requestBytes: Buffer.byteLength(JSON.stringify(raw), 'utf8'),
          requestLimit: CONTENT_LIMIT,
          otherStateBytes: otherStateBytes(found.board, id),
          handshakeBytes: handshakeBytes(record.manifest, final),
        })
        // 修订号在看板写入队列里再核对一次：这里读到之后，别的窗口仍可能先写进去。
        try {
          await bindMedia(context, id, wanted, async media => await context.workspace.save(found.board.id, (current) => {
            if (current.revision !== wanted.expectedRevision) {
              throw new ContentStaleError(wanted.expectedRevision, current.revision)
            }
            const patch = {
              ...(wanted.props === undefined ? {} : { props: content.props }),
              ...('data' in wanted ? { data: content.data } : {}),
            }
            const changed = withInstancePatched(current, id, patch)
            // state 不在 withInstancePatched 的写入面上：它要么按请求换成这份，要么留在实例上不动。
            const instances = 'state' in wanted
              ? changed.instances.map((instance) => instance.id === id ? { ...instance, state: content.state } : instance)
              : changed.instances
            return { ...changed, instances: instances.map(instance => instance.id === id && media !== undefined ? { ...instance, media } : instance) }
          }, {
            event: () => ({
              type: wanted.media === undefined ? 'instance' : 'board',
              id,
              ...(wanted.props === undefined ? {} : { props: content.props }),
              ...('data' in wanted ? { data: content.data } : {}),
              ...('state' in wanted ? { state: content.state } : {}),
            }),
          }), () => {
            const actual = context.workspace.board(found.board.id).revision
            if (actual !== wanted.expectedRevision) throw new ContentStaleError(wanted.expectedRevision, actual)
          })
        } catch (error) {
          if (error instanceof ContentStaleError) {
            json(response, 409, { error: error.message, code: 'stale-revision', revision: error.actual, snapshot: workspaceSnapshot(context) })
            return
          }
          throw error
        }
        const saved = context.workspace.findInstance(id)
        json(response, 200, {
          revision: context.workspace.board(found.board.id).revision,
          props: saved?.instance.props ?? content.props,
          data: saved?.instance.data ?? null,
          state: saved?.instance.state ?? null,
          ...(saved?.instance.media === undefined ? {} : { media: saved.instance.media }),
        })
      },
    },
    {
      method: 'GET',
      pattern: /^\/instance\/([^/]+)\/content$/,
      limit: 0,
      async handle(_context, _request, response, match) {
        const id = decodeURIComponent(match[1] as string)
        const found = cardOf(context, id)
        const model: CardContentModel = {
          instance: found.instance,
          revision: found.board.revision,
          widget: formOf(found.record),
        }
        json(response, 200, model)
      },
    },
    {
      method: 'GET',
      pattern: /^\/library\/([^/]+)\/form$/,
      limit: 0,
      async handle(_context, _request, response, match) {
        const id = decodeURIComponent(match[1] as string)
        json(response, 200, { widget: formOf(recordOf(context.records, id)) })
      },
    },
  ]
}

/** 编辑器读到的那份修订号已经过期（技术契约 3）。 */
class ContentStaleError extends Error {
  constructor(readonly expected: number, readonly actual: number) {
    super(`这张卡在别处改过了：编辑器读到的是第 ${String(expected)} 版，现在是第 ${String(actual)} 版`)
    this.name = 'ContentStaleError'
  }
}
