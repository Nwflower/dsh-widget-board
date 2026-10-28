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
import type { WidgetLibraryEntry } from '@dsh-widget-board/contracts'
import { readBody } from './body'
import { contentHash } from './library'
import type { WidgetRecord } from './library'
import type { BoardPackageCard, BoardPackageWidget } from './package'
import { PACKAGE_MAX_COMPRESSED_BYTES, packBoard, packWidget, unpackBoard, unpackWidget } from './package'
import { Refusal } from './refusal'
import type { Route, RouteContext } from './routes'
import { writeWidgetType } from './widget-write/write'
import { BOARD_PACKAGE_BYTES } from './package'
import { boardFromPackage, exportedMedia, validateBoardPackage } from './media/board-package'
import { mediaOf } from './media/routes'
import { importTransaction } from './media/import-transaction'

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
 * 写一个组件的目录；同 id 的旧版本先由共享写入服务换掉。
 *
 * 来源保护与并发核对都在共享的写入服务里（技术契约 4）：导入与工具、界面写组件走同一条路，不会
 * 各自写一套检查。
 *
 * @param context - 路由上下文。
 * @param id - 组件 id。
 * @param files - 相对路径与内容。
 * @param expectedHash - 更新时读到的版本哈希；导入没有这一份，省略时按「新建」处理。
 * @throws {Refusal} 没有可写的用户目录，或来源不允许覆盖。
 */
async function install(
  context: RouteContext,
  id: string,
  files: readonly { path: string, content: Uint8Array }[],
  expectedHash?: string,
  onSwapped?: () => void,
): Promise<void> {
  const existing = context.records.get(id)
  if (existing !== undefined && existing.source !== 'user') {
    throw new Refusal(403, `${id} 是${existing.source === 'builtin' ? '内置' : '插件提供'}的组件，不能覆盖；换一个 id 再导入`, { code: 'readonly-source' })
  }
  const manifestFile = files.find((file) => file.path === 'widget.json')
  if (manifestFile === undefined) throw new Refusal(400, '组件包里没有 widget.json（D7）')
  const manifest = JSON.parse(Buffer.from(manifestFile.content).toString('utf8')) as unknown
  const rest = files
    .filter((file) => file.path !== 'widget.json')
    .map((file) => ({ path: file.path, content: Buffer.from(file.content) }))
  await writeWidgetType({
    assets: context.live.assets,
    roots: context.roots,
    records: () => context.records,
    request: {
      id,
      manifest,
      files: rest,
      ...(expectedHash === undefined ? {} : { expectedHash }),
    },
    reload: async () => { onSwapped?.(); await context.refresh() },
  })
}

/** 一个组件在界面上的样子；刚装上、重读还没跟上时给出最小的那一份。 */
function entryOf(context: RouteContext, id: string, hash: string): WidgetLibraryEntry {
  return context.entries.find((candidate) => candidate.id === id && candidate.hash === hash)
    ?? { id, source: 'user', title: { zh: id, en: id }, sizes: [], hash }
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
        const id = unpacked.manifest.id
        const existing = routes.records.get(id)
        // 来源保护先于别的判定：内置与插件提供的组件谁也不能用导入覆盖，哪怕内容一模一样
        // （技术契约 4）。
        if (existing !== undefined && existing.source !== 'user') {
          throw new Refusal(403, `${id} 是${existing.source === 'builtin' ? '内置' : '插件提供'}的组件，不能覆盖；换一个 id 再导入`, { code: 'readonly-source' })
        }
        if (existing !== undefined && existing.hash !== hash && !replace) {
          throw new Refusal(409, `${id} 已经在组件库里，内容不一样；带上 replace=true 才会覆盖`, {
            code: 'widget-conflict',
            id,
            current: existing.hash,
            incoming: hash,
          })
        }
        // 同 id 同内容时按「已经是这一份」处理：不必重写目录，也免掉一次并发核对。
        if (existing !== undefined && existing.hash === hash) {
          response.writeHead(201, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
          response.end(JSON.stringify({ ok: true, entry: entryOf(routes, id, hash) }))
          return
        }
        await install(routes, id, unpacked.files, existing?.hash)
        await routes.refresh()
        response.writeHead(201, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        response.end(JSON.stringify({ ok: true, entry: entryOf(routes, id, hash) }))
      },
    },
    {
      method: 'GET',
      pattern: /^\/boards\/([^/]+)\/export$/,
      limit: 0,
      async handle(routes, request, response, match) {
        const id = decodeURIComponent(match[1] as string)
        if (!routes.workspace.has(id)) throw new Refusal(404, `没有这块看板：${id}`)
        const board = routes.workspace.board(id)
        const withData = new URL(request.url ?? '/', 'http://board.invalid').searchParams.get('data') === 'true'
        const used = new Map<string, WidgetRecord>()
        const cards: BoardPackageCard[] = []
        for (const instance of board.instances) {
          const record = routes.records.get(instance.widget)
          if (record !== undefined) used.set(record.hash, record)
          cards.push({
            id: instance.id,
            ...(instance.group === undefined ? {} : { group: instance.group }),
            ...(instance.media === undefined ? {} : { media: instance.media }),
            widget: instance.widget,
            props: instance.props,
            layout: instance.layout,
            ...(withData ? { data: instance.data, state: instance.state } : {}),
          })
        }
        if (cards.some(card => ![...used.values()].some(record => record.manifest.id === card.widget))) throw new Refusal(400, '看板含不可用组件，不能导出不完整备份')
        const media = await exportedMedia(routes, board)
        const bytes = packBoard(board.title, cards, [...used.values()].map(embeddedOf), { media, ...(board.arrangement ? { arrangement: board.arrangement } : {}) })
        response.writeHead(200, {
          'content-type': 'application/gzip',
          'content-disposition': `attachment; filename="${encodeURIComponent(board.title)}.dshboard"`,
          'cache-control': 'no-store',
        })
        response.end(Buffer.from(bytes))
      },
    },
    {
      method: 'POST',
      pattern: /^\/boards\/import$/,
      limit: 0,
      async handle(routes, request, response) {
        const replace = new URL(request.url ?? '/', 'http://board.invalid').searchParams.get('replace') === 'true'
        let unpacked
        try {
          unpacked = unpackBoard(new Uint8Array(await readBody(request, BOARD_PACKAGE_BYTES)))
        } catch (error) {
          throw new Refusal(400, (error as Error).message)
        }
        const validated = await validateBoardPackage(routes, unpacked)
        // 安装前先检查全部冲突；所有卡片、图片与格式均已校验。
        for (const widget of unpacked.widgets) {
          const existing = routes.records.get(widget.manifest.id)
          if (existing && existing.hash !== widget.hash) {
            if (existing.source !== 'user') throw new Refusal(403, '不能覆盖只读组件')
            if (!replace) throw new Refusal(409, '组件版本冲突', { code: 'widget-conflict', id: widget.manifest.id, current: existing.hash, incoming: widget.hash })
          }
        }
        const installAndCreate = async () => {
          return await importTransaction(routes, unpacked.widgets, install, async installed => {
            const board = await routes.workspace.create(unpacked.title, current => boardFromPackage(current, unpacked, routes.records))
            return { installed, board }
          })
        }
        const { installed, board } = validated.resources.size === 0 ? await installAndCreate() : await mediaOf(routes).import(validated.resources, installAndCreate)
        const cards = board.instances.map(instance => instance.id)
        response.writeHead(201, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        response.end(JSON.stringify({ ok: true, installed, cards, title: unpacked.title, board: board.id }))
      },
    },
  ]
}
