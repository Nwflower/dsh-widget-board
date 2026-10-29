/**
 * 分享、导入与市场的路由（D8）。
 *
 * - `GET /library/widget/<id>/export`：把一个组件打成 `.dshw` 下载。
 * - `POST /library/import`：读一个 `.dshw`，校验、写进用户目录、重读组件库。
 * - `GET /library/market/refresh`：重读全部市场提供方的条目。
 * - `POST /library/market/install`：按市场条目装一个版本，核对哈希与大小、解包校验、写进市场来源目录。
 * - `GET /board/export[?data=true]`：把看板打成 `.dshboard` 下载，用到的组件按哈希内嵌。
 * - `POST /board/import`：读一个 `.dshboard`，把组件装进来、把卡片放上看板。
 *
 * 同 id 不同内容的导入不静默覆盖：先回 409 并带上两边的哈希，调用方带 `replace=true` 再来一次才会
 * 覆盖。内置与插件提供的组件不允许被覆盖——它们不落在用户目录里（D17）。
 */
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { readFile, rename, writeFile } from 'node:fs/promises'
import type { BoardInstance, MarketInstallRecord, WidgetLibraryEntry, WidgetManifest, WidgetPermissions } from '@dsh-widget-board/contracts'
import { readBody } from './body'
import { contentHash, manifestProblem, requiresMismatch, writeWidgetDirectory } from './library'
import type { WidgetRecord } from './library'
import type { BoardPackageCard, BoardPackageWidget } from './package'
import { PACKAGE_MAX_COMPRESSED_BYTES, packBoard, packWidget, unpackBoard, unpackWidget } from './package'
import { Refusal } from './refusal'
import type { Route, RouteContext } from './routes'
import { dataError, propsError } from './schema'
import { instanceOf, withInstanceStateChecked } from './state'

/** 导入时最多读多少字节。 */
const IMPORT_LIMIT = PACKAGE_MAX_COMPRESSED_BYTES

/** 市场安装与刷新的请求体上限：只是一个 { provider, id, version }。 */
const MARKET_BODY_LIMIT = 4096

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
    // 内嵌的组件按组件库同一条规则校验，写盘之前整包拒绝：widget.json 是落盘后真正生效的那一份，
    // 包里另带的 manifest 字段只当声明，两边对不上 id 或哈希对不上内容都不装（D3、D7）。
    const files = Object.entries(widget.files).map(([path, content]) => ({ path, content: Buffer.from(content, 'base64') }))
    const manifestFile = files.find((file) => file.path === 'widget.json')
    if (manifestFile === undefined) throw new Refusal(400, `${widget.manifest.id} 的内嵌文件里没有 widget.json（D7）`)
    let actual: unknown
    try {
      actual = JSON.parse(manifestFile.content.toString('utf8'))
    } catch (error) {
      throw new Refusal(400, `${widget.manifest.id} 的 widget.json 不是合法 JSON：${(error as Error).message}`)
    }
    const problem = manifestProblem(actual)
    if (problem !== undefined) throw new Refusal(400, `${widget.manifest.id}：${problem}`)
    const id = (actual as WidgetManifest).id
    if (id !== widget.manifest.id) {
      throw new Refusal(400, `包里声明的组件 id 是 ${widget.manifest.id}，widget.json 里写的是 ${id}`)
    }
    if (contentHash(new Map(files.map((file) => [file.path, file.content]))) !== widget.hash) {
      throw new Refusal(400, `${id} 的内容与它声称的哈希不一致`)
    }
    const existing = context.records.get(id)
    if (existing !== undefined && existing.hash === widget.hash) continue
    if (existing !== undefined && !replace) {
      throw new Refusal(409, `${id} 已经在组件库里，内容不一样；带上 replace=true 才会覆盖`, {
        code: 'widget-conflict',
        id,
        current: existing.hash,
        incoming: widget.hash,
      })
    }
    await install(context, id, files)
    installed += 1
  }
  if (installed > 0) await context.refresh()
  return installed
}

/**
 * 把包里的卡片放进一块看板：布局沿用包里那一份，数据与状态只有包里带了才写。
 *
 * @param context - 路由上下文。
 * @param boardId - 目标看板的 id。
 * @param cards - 包里的卡片。
 * @returns 新卡片的 id。
 * @throws {Refusal} 有卡片引用了没装进来的组件（400）。
 */
async function importCards(context: RouteContext, boardId: string, cards: readonly BoardPackageCard[]): Promise<string[]> {
  const missing = [...new Set(cards.map((card) => card.widget).filter((widget) => !context.records.has(widget)))]
  if (missing.length > 0) throw new Refusal(400, `看板包里的这些组件没有装进来：${missing.join('、')}`)
  const added: string[] = []
  if (cards.length === 0) return added
  await context.workspace.save(boardId, (current) => {
    let board = current
    for (const card of cards) {
      const record = context.records.get(card.widget) as WidgetRecord
      // 导入的卡与路由加的卡同一条规则：props 与 data 按组件 schema 核对，状态受同一组额度约束（D6、D23）。
      const propsProblem = propsError(record.manifest.props, card.props)
      if (propsProblem !== undefined) throw new Refusal(400, `${card.widget}：${propsProblem}`)
      if (card.data !== undefined && card.data !== null) {
        const dataProblem = dataError(record.manifest.data, card.data)
        if (dataProblem !== undefined) throw new Refusal(400, `${card.widget}：${dataProblem}`)
      }
      const base = instanceOf(record, board.instances, { props: card.props, layout: card.layout })
      const staged: BoardInstance = {
        ...base,
        ...(card.data === undefined ? {} : { data: card.data }),
      }
      board = { ...board, instances: [...board.instances, staged] }
      if (card.state !== undefined) board = withInstanceStateChecked(board, staged.id, card.state)
      added.push(staged.id)
    }
    return board
  }, { layoutChanged: true, event: () => ({ type: 'board' }) })
  return added
}

/**
 * 市场安装（D8 之后的市场契约）：按提供方解析条目与版本，取包、核对哈希与大小、解包校验，
 * 核对包内 manifest 与索引的 declares、requires，检查 id 冲突后写进市场来源目录，并记录来源。
 *
 * @param context - 路由上下文。
 * @param body - 请求体：提供方、条目 id 与版本。
 * @returns 装好的组件 id 与哈希。
 * @throws {Refusal} 提供方、条目或版本不存在；哈希、大小或 manifest 不合格；id 冲突。
 */
async function marketInstall(context: RouteContext, body: unknown): Promise<{ id: string, hash: string }> {
  const wanted = body as { provider?: unknown, id?: unknown, version?: unknown }
  if (typeof wanted?.provider !== 'string' || typeof wanted.id !== 'string' || typeof wanted.version !== 'string') {
    throw new Refusal(400, '安装请求要写明 provider、id 与 version')
  }
  const resolved = context.market.listing(wanted.provider, wanted.id)
  if (resolved === undefined) throw new Refusal(404, `市场里没有 ${wanted.id}；提供方 ${wanted.provider} 可能没有加载`)
  const summary = resolved.listing.versions.find((candidate) => candidate.version === wanted.version)
  if (summary === undefined) {
    throw new Refusal(404, `${wanted.id} 没有版本 ${wanted.version}；现有版本：${resolved.listing.versions.map((candidate) => candidate.version).join('、')}`)
  }

  // 取包并核对：哈希与大小不一致的包不解包（D3 的市场条目是不可信输入）。
  const fetched: unknown = await resolved.registration.fetch(resolved.listing, wanted.version)
  if (!(fetched instanceof Uint8Array)) {
    throw new Refusal(400, `提供方 ${wanted.provider} 的 fetch 没有返回字节`)
  }
  const bytes = new Uint8Array(fetched)
  if (bytes.byteLength !== summary.package.bytes) {
    throw new Refusal(400, `包的大小是 ${bytes.byteLength} 字节，索引声明的是 ${summary.package.bytes} 字节`)
  }
  const digest = createHash('sha256').update(bytes).digest('hex')
  if (digest !== summary.package.sha256) throw new Refusal(400, '包的 sha256 与索引声明的不一致')
  let unpacked
  try {
    unpacked = unpackWidget(bytes)
  } catch (error) {
    throw new Refusal(400, (error as Error).message)
  }
  if (unpacked.manifest.id !== wanted.id) {
    throw new Refusal(400, `包里的组件 id 是 ${unpacked.manifest.id}，条目声明的是 ${wanted.id}`)
  }

  // 包内的 manifest 按组件库同一条规则校验（D3、D7）：市场条目是不可信输入，版本要求在写盘之前判，
  // 不合格的包一个字节都不落进组件库。
  const manifestIssue = manifestProblem(unpacked.manifest)
  if (manifestIssue !== undefined) throw new Refusal(400, `包里的 widget.json：${manifestIssue}`)

  // 安装前摘要与包内声明要一致（D6、D24、D30）：索引里写的权限、凭据与版本要求是给人看的，包里的
  // 才是真的。
  const declaresProblem = declaresMismatch(summary.declares, unpacked.manifest)
  if (declaresProblem !== undefined) throw new Refusal(400, declaresProblem)
  const requiresProblem = requiresMismatch(summary.requires, unpacked.manifest.requires)
  if (requiresProblem !== undefined) throw new Refusal(400, `${requiresProblem}，拒绝安装`)

  // id 冲突：内置、我的、插件与示例来源一律拒绝；市场来源里同 id 不同包要明确的 replace。
  const replace = (wanted as { replace?: unknown }).replace === true
  const hash = contentHash(new Map(unpacked.files.map((file) => [file.path, Buffer.from(file.content)])))
  const existing = context.records.get(unpacked.manifest.id)
  if (existing !== undefined && existing.source !== 'market') {
    throw new Refusal(409, `${unpacked.manifest.id} 已经由${existing.source === 'builtin' ? '内置' : existing.source === 'user' ? '用户目录' : existing.source === 'example' ? '示例' : `插件 ${existing.provider ?? ''}`}提供，市场不能覆盖；换一个 id`, {
      code: 'widget-conflict',
      id: unpacked.manifest.id,
      current: existing.hash,
      incoming: hash,
    })
  }
  if (existing !== undefined && existing.hash !== hash && !replace) {
    throw new Refusal(409, `${unpacked.manifest.id} 已经装过别的内容；带上 replace=true 才会换掉`, {
      code: 'widget-conflict',
      id: unpacked.manifest.id,
      current: existing.hash,
      incoming: hash,
    })
  }

  await writeWidgetDirectory(join(context.marketDir, unpacked.manifest.id), unpacked.files)
  await rememberInstall(context.marketDir, {
    provider: wanted.provider,
    listingId: wanted.id,
    version: wanted.version,
    sha256: summary.package.sha256,
    installedAt: new Date().toISOString(),
  })
  await context.refresh()
  return { id: unpacked.manifest.id, hash }
}

/**
 * 索引声明的权限与凭据和包内 manifest 对不对得上。
 *
 * @param declares - 索引里的摘要。
 * @param manifest - 包内的 manifest。
 * @returns 不一致时的原因；一致时为 `undefined`。
 */
function declaresMismatch(declares: { capabilities?: string[], credentials?: string[], hosts?: string[] } | undefined, manifest: WidgetManifest): string | undefined {
  if (declares === undefined) return undefined
  const sets: [string, readonly string[] | undefined, readonly string[]][] = [
    ['能力', declares.capabilities, manifest.capabilities ?? []],
    ['凭据', declares.credentials, (manifest.credentials ?? []).map((credential) => credential.ref)],
    ['主机', declares.hosts, (manifest.permissions as WidgetPermissions | undefined)?.hosts ?? []],
  ]
  for (const [kind, declared, actual] of sets) {
    if (declared === undefined) continue
    const missing = declared.filter((item) => !actual.includes(item))
    if (missing.length > 0) return `索引声明的${kind} ${missing.join('、')} 不在包内的 manifest 里，两边对不上，拒绝安装`
  }
  return undefined
}

/**
 * 记下一个市场组件的来源。
 *
 * 与写组件目录同一条规矩：先写旁边的临时文件、落盘之后再换过来，写一半崩掉不会留下半份记录。
 *
 * @param marketDir - 市场来源目录。
 * @param record - 这次安装的来源。
 */
async function rememberInstall(marketDir: string, record: MarketInstallRecord): Promise<void> {
  const file = join(marketDir, 'sources.json')
  let all: Record<string, MarketInstallRecord> = {}
  try {
    all = JSON.parse(await readFile(file, 'utf8')) as Record<string, MarketInstallRecord>
  } catch {
    // 文件还不存在时按空表算（D11 的合法缺席）。
  }
  all[record.listingId] = record
  const staging = `${file}.incoming`
  await writeFile(staging, `${JSON.stringify(all, null, 2)}\n`, 'utf8')
  await rename(staging, file)
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
      pattern: /^\/library\/market\/refresh$/,
      limit: 0,
      async handle(routes, _request, response) {
        // 重读全部提供方的条目；一个失败只进它那一节的错误，别的不受影响（D11）。
        for (const section of routes.market.sections()) {
          await routes.market.refresh(section.provider)
        }
        routes.live.notify({ type: 'board' })
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        response.end(JSON.stringify({ ok: true, sections: routes.market.sections() }))
      },
    },
    {
      method: 'POST',
      pattern: /^\/library\/market\/install$/,
      limit: MARKET_BODY_LIMIT,
      async handle(routes, request, response) {
        const text = (await readBody(request, MARKET_BODY_LIMIT)).toString('utf8')
        let body: unknown
        try {
          body = JSON.parse(text === '' ? '{}' : text)
        } catch {
          throw new Refusal(400, '安装请求不是合法的 JSON')
        }
        const installed = await marketInstall(routes, body)
        routes.live.notify({ type: 'board' })
        response.writeHead(201, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        response.end(JSON.stringify({ ok: true, entry: entryOf(routes, installed.id, installed.hash) }))
      },
    },
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
            widget: instance.widget,
            props: instance.props,
            layout: instance.layout,
            ...(withData ? { data: instance.data, state: instance.state } : {}),
          })
        }
        const bytes = packBoard(board.title, cards, [...used.values()].map(embeddedOf))
        response.writeHead(200, {
          'content-type': 'application/json',
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
          unpacked = unpackBoard(new Uint8Array(await readBody(request, IMPORT_LIMIT)))
        } catch (error) {
          throw new Refusal(400, (error as Error).message)
        }
        const installed = await importWidgets(routes, unpacked.widgets, replace)
        // 导入的看板是新的那一块，并选中它：不动原来的看板（D21）。
        const board = await routes.workspace.create(unpacked.title)
        const cards = await importCards(routes, board.id, unpacked.cards)
        response.writeHead(201, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        response.end(JSON.stringify({ ok: true, installed, cards, title: unpacked.title, board: board.id }))
      },
    },
  ]
}
