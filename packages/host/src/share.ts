/**
 * 分享与导入的四条路由（D8）。
 *
 * - `GET /library/widget/<id>/export`：把一个组件打成 `.dshw` 下载。
 * - `POST /library/import`：读一个 `.dshw`，校验、写进用户目录、重读组件库。
 * - `GET /board/export[?data=true]`：把看板打成 `.dshboard` 下载，用到的组件按哈希内嵌。
 * - `POST /board/import`：读一个 `.dshboard`，把组件装进来、把卡片放上看板。
 *
 * 同 id 不同内容的导入不静默覆盖：先回 409 并带上两边的哈希，调用方带 `replace=true` 再来一次才会
 * 覆盖。内置与插件提供的组件不允许被覆盖——它们不落在用户目录里（D17）。
 */
import { join } from 'node:path'
import type { BoardInstance, WidgetLibraryEntry } from '@dsh-widget-board/contracts'
import { readBody } from './body'
import { contentHash, writeWidgetDirectory } from './library'
import type { WidgetRecord } from './library'
import type { BoardPackageCard, BoardPackageWidget } from './package'
import { PACKAGE_MAX_COMPRESSED_BYTES, packBoard, packWidget, unpackBoard, unpackWidget } from './package'
import { Refusal } from './refusal'
import type { Route, RouteContext } from './routes'
import { instanceOf } from './state'

/** 导入时最多读多少字节。 */
const IMPORT_LIMIT = PACKAGE_MAX_COMPRESSED_BYTES

/**
 * 一个组件版本在包里的样子。
 *
 * @param record - 组件记录。
 * @returns 内嵌的那一份。
 */
function embeddedOf(record: WidgetRecord): BoardPackageWidget {
  return {
    hash: record.hash,
    manifest: record.manifest,
    files: Object.fromEntries([...record.files].map(([path, content]) => [path, content.toString('base64')])),
  }
}

/**
 * 写一个组件的目录；同 id 的旧版本先由 `writeWidgetDirectory` 清掉。
 *
 * @param context - 路由上下文。
 * @param id - 组件 id。
 * @param files - 相对路径与内容。
 * @throws {Refusal} 没有可写的用户目录，或来源不允许覆盖。
 */
async function install(context: RouteContext, id: string, files: readonly { path: string, content: Uint8Array }[]): Promise<void> {
  const existing = context.records.get(id)
  if (existing !== undefined && existing.source !== 'user') {
    throw new Refusal(400, `${id} 是${existing.source === 'builtin' ? '内置' : '插件提供'}的组件，不能覆盖；换一个 id 再导入`)
  }
  const root = context.roots.find((candidate) => candidate.source === 'user')
  if (root === undefined) throw new Refusal(500, '没有可写的用户组件目录')
  await writeWidgetDirectory(join(root.dir, id), files)
}

/** 一个组件在界面上的样子；刚装上、重读还没跟上时给出最小的那一份。 */
function entryOf(context: RouteContext, id: string, hash: string): WidgetLibraryEntry {
  return context.entries.find((candidate) => candidate.id === id && candidate.hash === hash)
    ?? { id, source: 'user', title: { zh: id, en: id }, sizes: [], hash }
}

/**
 * 把一组内嵌的组件版本装上：同一个哈希已经有就跳过；同 id 有别的版本时按 `replace` 决定方向。
 *
 * @param context - 路由上下文。
 * @param widgets - 包里的组件版本。
 * @param replace - 允许覆盖同 id 的另一个版本。
 * @returns 装了几个新的。
 * @throws {Refusal} 同 id 冲突（409）或来源不允许覆盖（400）。
 */
async function importWidgets(context: RouteContext, widgets: readonly BoardPackageWidget[], replace: boolean): Promise<number> {
  let installed = 0
  for (const widget of widgets) {
    const existing = context.records.get(widget.manifest.id)
    if (existing !== undefined && existing.hash === widget.hash) continue
    if (existing !== undefined && !replace) {
      throw new Refusal(409, `${widget.manifest.id} 已经在组件库里，内容不一样；带上 replace=true 才会覆盖`, {
        code: 'widget-conflict',
        id: widget.manifest.id,
        current: existing.hash,
        incoming: widget.hash,
      })
    }
    const files = Object.entries(widget.files).map(([path, content]) => ({ path, content: new Uint8Array(Buffer.from(content, 'base64')) }))
    await install(context, widget.manifest.id, files)
    installed += 1
  }
  if (installed > 0) await context.refresh()
  return installed
}

/**
 * 把包里的卡片放上看板：布局沿用包里那一份，数据与状态只有包里带了才写。
 *
 * @param context - 路由上下文。
 * @param cards - 包里的卡片。
 * @returns 新卡片的 id。
 * @throws {Refusal} 有卡片引用了没装进来的组件（400）。
 */
async function importCards(context: RouteContext, cards: readonly BoardPackageCard[]): Promise<string[]> {
  const missing = [...new Set(cards.map((card) => card.widget).filter((widget) => !context.records.has(widget)))]
  if (missing.length > 0) throw new Refusal(400, `看板包里的这些组件没有装进来：${missing.join('、')}`)
  const added: string[] = []
  await context.save((current) => {
    let board = current
    for (const card of cards) {
      const record = context.records.get(card.widget) as WidgetRecord
      const base = instanceOf(record, board.instances, { props: card.props, layout: card.layout })
      const instance: BoardInstance = {
        ...base,
        ...(card.data === undefined ? {} : { data: card.data }),
        ...(card.state === undefined ? {} : { state: card.state }),
      }
      board = { ...board, instances: [...board.instances, instance] }
      added.push(instance.id)
    }
    return board
  }, { layoutChanged: true, event: () => ({ type: 'board' }) })
  return added
}

/**
 * 分享与导入的路由。
 *
 * @param context - 路由上下文。
 * @returns 四条路由。
 */
export function shareRoutes(context: RouteContext): Route[] {
  return [
    {
      method: 'GET',
      pattern: /^\/library\/widget\/([^/]+)\/export$/,
      limit: 0,
      async handle(routes, _request, response, match) {
        const id = decodeURIComponent(match[1] as string)
        const record = routes.records.get(id)
        if (record === undefined) throw new Refusal(404, `组件库里没有可用的组件 ${id}`)
        const bytes = packWidget([...record.files].map(([path, content]) => ({ path, content: new Uint8Array(content) })))
        response.writeHead(200, {
          'content-type': 'application/zip',
          'content-disposition': `attachment; filename="${id}.dshw"`,
          'cache-control': 'no-store',
        })
        response.end(Buffer.from(bytes))
      },
    },
    {
      method: 'POST',
      pattern: /^\/library\/import$/,
      limit: 0,
      async handle(routes, request, response) {
        const replace = new URL(request.url ?? '/', 'http://board.invalid').searchParams.get('replace') === 'true'
        let unpacked
        try {
          unpacked = unpackWidget(new Uint8Array(await readBody(request, IMPORT_LIMIT)))
        } catch (error) {
          throw new Refusal(400, (error as Error).message)
        }
        const hash = contentHash(new Map(unpacked.files.map((file) => [file.path, Buffer.from(file.content)])))
        const existing = routes.records.get(unpacked.manifest.id)
        if (existing !== undefined && existing.hash !== hash && !replace) {
          throw new Refusal(409, `${unpacked.manifest.id} 已经在组件库里，内容不一样；带上 replace=true 才会覆盖`, {
            code: 'widget-conflict',
            id: unpacked.manifest.id,
            current: existing.hash,
            incoming: hash,
          })
        }
        await install(routes, unpacked.manifest.id, unpacked.files)
        await routes.refresh()
        response.writeHead(201, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        response.end(JSON.stringify({ ok: true, entry: entryOf(routes, unpacked.manifest.id, hash) }))
      },
    },
    {
      method: 'GET',
      pattern: /^\/board\/export$/,
      limit: 0,
      async handle(routes, request, response) {
        const withData = new URL(request.url ?? '/', 'http://board.invalid').searchParams.get('data') === 'true'
        const used = new Map<string, WidgetRecord>()
        const cards: BoardPackageCard[] = []
        for (const instance of routes.board.instances) {
          const record = routes.records.get(instance.widget)
          if (record !== undefined) used.set(record.hash, record)
          cards.push({
            widget: instance.widget,
            props: instance.props,
            layout: instance.layout,
            ...(withData ? { data: instance.data, state: instance.state } : {}),
          })
        }
        const bytes = packBoard(routes.board.title, cards, [...used.values()].map(embeddedOf))
        response.writeHead(200, {
          'content-type': 'application/json',
          'content-disposition': 'attachment; filename="board.dshboard"',
          'cache-control': 'no-store',
        })
        response.end(Buffer.from(bytes))
      },
    },
    {
      method: 'POST',
      pattern: /^\/board\/import$/,
      limit: 0,
      async handle(routes, request, response) {
        const replace = new URL(request.url ?? '/', 'http://board.invalid').searchParams.get('replace') === 'true'
        let unpacked
        try {
          unpacked = unpackBoard(new Uint8Array(await readBody(request, IMPORT_LIMIT)))
        } catch (error) {
          throw new Refusal(400, (error as Error).message)
        }
        const installed = await importWidgets(routes, unpacked.widgets, replace)
        const cards = await importCards(routes, unpacked.cards)
        response.writeHead(201, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        response.end(JSON.stringify({ ok: true, installed, cards, title: unpacked.title }))
      },
    },
  ]
}
