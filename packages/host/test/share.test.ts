/**
 * 分享与导入的四条路由（D8）。
 *
 * 判的是「别人的文件进来会发生什么」在路由这一层的表现：导出得到的东西能再导入、同 id 不同内容
 * 回 409 并带上两边的哈希、内置组件不许被覆盖、看板包里引用了没装进来的组件时整包拒绝。
 */
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { strToU8 } from 'fflate'
import type { Board, BoardEvent, HostRequest, HostResponse, WidgetLibraryEntry } from '@dsh-widget-board/contracts'
import { PLUGIN_ROUTE } from '@dsh-widget-board/contracts'
import type { RouteContext } from '../src/routes'
import { createHandler } from '../src/routes'
import type { WidgetRecord } from '../src/library'
import { createRegistries } from '../src/sources'
import { contentHash, readWidget, writeWidgetDirectory } from '../src/library'
import { writeBoard } from '../src/state'
import { openWorkspace } from '../src/workspace'
import { unpackBoard, unpackWidget } from '../src/package'
import { packBoard } from '../src/package'
import { createMediaStore } from '../src/media/store'
import sharp from 'sharp'
import { createMarketRegistry } from '../src/market'
import { createHash } from 'node:crypto'
import { packWidget } from '../src/package'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(async (dir) => { await rm(dir, { recursive: true, force: true }) }))
})

/** 一个组件记录。 */
function record(id: string, files: Record<string, string> = {}): WidgetRecord {
  const map = new Map<string, Buffer>([
    ['widget.json', Buffer.from(JSON.stringify({ id, title: { zh: id, en: id }, version: '0.1.0', sizes: ['s'] }))],
    ['index.html', Buffer.from('<p></p>')],
    ['style.css', Buffer.from('p{}')],
    ...Object.entries(files).map(([path, content]) => [path, Buffer.from(content)] as [string, Buffer]),
  ])
  return { manifest: JSON.parse(map.get('widget.json')?.toString('utf8') ?? '{}'), source: 'user', dir: `/w/${id}`, hash: contentHash(map), files: map }
}

/** 一张空看板。 */
function emptyBoard(): Board {
  return { version: 2, id: 'board', title: '看板', revision: 0, layoutRevision: 0, instances: [] }
}

/** 一次调用留下的记录。 */
interface Capture {
  status: number
  headers: Record<string, string>
  body: Buffer
}

/** 请求与响应的最小替身，与 routes.test.ts 同一套写法。 */
function send(context: RouteContext, method: string, path: string, body?: Uint8Array | string): Promise<Capture> {
  const handler = createHandler(context)
  const payload = body === undefined ? undefined : typeof body === 'string' ? Buffer.from(body) : Buffer.from(body)
  const request = {
    method,
    url: `${PLUGIN_ROUTE}${path}`,
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
    async* [Symbol.asyncIterator]() {
      if (payload !== undefined) yield payload
    },
  } as unknown as HostRequest
  const headers: Record<string, string> = {}
  const chunks: Buffer[] = []
  const response = {
    writeHead(status: number, extra: Record<string, string> = {}) {
      (response as unknown as { status: number }).status = status
      Object.assign(headers, extra)
      return response
    },
    end(chunk?: Buffer | string) { if (chunk !== undefined) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)) },
    write(chunk: string) { chunks.push(Buffer.from(chunk)) },
  } as unknown as HostResponse
  return handler(request, response).then(() => ({
    status: (response as unknown as { status: number }).status,
    headers,
    body: Buffer.concat(chunks),
  }))
}

/** 一套替身。 */
async function harness(records: WidgetRecord[] = [record('demo')]) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-widget-board-share-'))
  roots.push(dir)
  const map = new Map(records.map((entry) => [entry.manifest.id, entry]))
  const events: BoardEvent[] = []
  // 工作区替身：真正的 openWorkspace，写一份索引与一块看板（D21）。
  const home = await mkdtemp(join(tmpdir(), 'dsh-widget-board-share-home-'))
  roots.push(home)
  const marketDir = join(home, 'market-widgets')
  await mkdir(marketDir)
  await mkdir(join(home, 'boards'), { recursive: true })
  await writeBoard(join(home, 'boards', 'board.json'), emptyBoard())
  await writeFile(join(home, 'boards.json'), `${JSON.stringify({ version: 1, active: 'board', boards: ['board'] })}\n`, 'utf8')
  const workspace = await openWorkspace(home, map, (event) => { events.push(event) })
  const context = {
    marketDir,
    market: createMarketRegistry(),
    records: map,
    entries: [...map.values()].map((entry): WidgetLibraryEntry => ({ id: entry.manifest.id, source: 'user', title: entry.manifest.title, sizes: entry.manifest.sizes, hash: entry.hash })),
    library: { records: map, entries: [], errors: [] },
    roots: [{ dir, source: 'user' as const }],
    versions: { remember: async () => undefined, get: async (hash: string) => [...map.values()].find((entry) => entry.hash === hash) },
    workspace,
    get board() { return workspace.active() },
    save: async (change, options) => await workspace.save(workspace.activeId(), change, options),
    live: {
      assets: { tokensCss: '', suiteCss: '', runtimeJs: '', libs: {} },
      revision: 0,
      viewers: 0,
      onViewers: () => () => undefined,
      subscribe: () => undefined,
      publish: () => undefined,
      notify: (event: BoardEvent) => { events.push(event) },
      close: () => undefined,
    },
    connection: undefined,
    // 重读替身：扫描用户目录，把读得出来的组件放进 records——与真实宿主的 refresh 同一个效果。
    refresh: async () => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        try {
          const loaded = await readWidget(join(dir, entry.name), { source: 'user' })
          map.set(loaded.manifest.id, loaded)
        } catch {
          // 读不出来的目录跳过：与真实宿主一致，一个坏目录不影响别的。
        }
      }
      for (const entry of await readdir(marketDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const loaded = await readWidget(join(marketDir, entry.name), { source: 'market' })
        map.set(loaded.manifest.id, loaded)
      }
      context.entries = [...map.values()].map(entry => ({ id: entry.manifest.id, source: entry.source, title: entry.manifest.title, sizes: entry.manifest.sizes, hash: entry.hash }))
    },
    sources: createRegistries(),
    grants: { all: () => [], has: () => false, grant: async (input: { kind: 'action' | 'source', hash: string, id: string, widget: string }) => ({ key: 'k', ...input, at: 'now' }), revoke: async () => false, forget: async () => 0 },
  } as unknown as RouteContext
  return { context, dir, events, send: (method: string, path: string, body?: Uint8Array | string) => send(context, method, path, body) }
}

describe('组件包的导出与导入', () => {
  it('导出的字节能再导入，文件名与类型对得上', async () => {
    const test = await harness()
    const exported = await test.send('GET', '/library/widget/demo/export')
    expect(exported.status).toBe(200)
    expect(exported.headers['content-type']).toBe('application/zip')
    expect(exported.headers['content-disposition']).toContain('demo.dshw')
    const unpacked = unpackWidget(new Uint8Array(exported.body))
    expect(unpacked.manifest.id).toBe('demo')
    // 换个目录导入回来：同一个哈希，不冲突。
    const other = await harness([])
    const imported = await other.send('POST', '/library/import', new Uint8Array(exported.body))
    expect(imported.status, imported.body.toString('utf8')).toBe(201)
    expect(JSON.parse(imported.body.toString('utf8')).entry.id).toBe('demo')
  })

  it('同 id 不同内容时回 409 并带上两边的哈希', async () => {
    const test = await harness([record('demo')])
    const incoming = await harness([record('demo', { 'main.js': 'void 0' })])
    const exported = await incoming.send('GET', '/library/widget/demo/export')
    const response = await test.send('POST', '/library/import', new Uint8Array(exported.body))
    expect(response.status).toBe(409)
    const body = JSON.parse(response.body.toString('utf8')) as { code: string, current: string, incoming: string }
    expect(body.code).toBe('widget-conflict')
    expect(body.current).not.toBe(body.incoming)
  })

  it('内置组件不许被覆盖', async () => {
    const builtin = { ...record('demo'), source: 'builtin' as const }
    const test = await harness([builtin])
    const incoming = await harness([record('demo', { 'main.js': 'x' })])
    await writeWidgetDirectory(join(test.dir, 'unused'), [])
    const exported = await incoming.send('GET', '/library/widget/demo/export')
    const response = await test.send('POST', '/library/import?replace=true', new Uint8Array(exported.body))
    // 技术契约 4：user 之外的来源更新回 403，不与 409 的并发冲突混在一起。
    expect(response.status).toBe(403)
    expect(response.body.toString('utf8')).toMatch(/不能覆盖/)
  })

  it('不是组件的字节回 400 并说明', async () => {
    const test = await harness()
    const response = await test.send('POST', '/library/import', strToU8('不是一个包'))
    expect(response.status).toBe(400)
    expect(response.body.toString('utf8')).toMatch(/不是有效的组件包/)
  })

  it('单组件导入不能借作者域绕过市场安装入口', async () => {
    const widget = record('acme.weather')
    const test = await harness([])
    const bytes = packWidget([...widget.files].map(([path, content]) => ({ path, content })))
    expect((await test.send('POST', '/library/import', bytes)).status).toBe(400)
    expect(await readdir(test.context.marketDir)).toEqual([])
    expect(await readdir(test.dir)).toEqual([])
  })

  it('内置组件的包内容一样也不许装进用户目录', async () => {
    // 这一条曾经被「同哈希就跳过」那条短路放过去：内置那份的包能装出一个同名的用户目录。
    const builtin = { ...record('demo'), source: 'builtin' as const }
    const test = await harness([builtin])
    const incoming = await harness([record('demo')])
    const exported = await incoming.send('GET', '/library/widget/demo/export')
    const response = await test.send('POST', '/library/import', new Uint8Array(exported.body))
    expect(response.status).toBe(403)
    expect(response.body.toString('utf8')).toMatch(/不能覆盖/)
  })
})

describe('看板包的导出与导入', () => {
  it('市场组件恢复后创建失败时清理新目录，不残留看板', async () => {
    const widget = { ...record('acme.weather'), source: 'market' as const }
    const source = await harness([widget])
    await source.send('POST', '/boards/board/instance', JSON.stringify({ widget: widget.manifest.id }))
    const pkg = (await source.send('GET', '/boards/board/export')).body
    const target = await harness([])
    // 用真实文件占住 boards 目录，让工作区写盘失败。
    const { rename } = await import('node:fs/promises')
    const home = join(target.context.marketDir, '..')
    await rename(join(home, 'boards'), join(home, 'saved-boards'))
    await writeFile(join(home, 'boards'), 'not a directory')
    const before = target.context.workspace.list().length
    expect((await target.send('POST', '/boards/import', pkg)).status).toBe(500)
    expect(await readdir(target.context.marketDir)).toEqual([])
    expect(target.context.records.has(widget.manifest.id)).toBe(false)
    expect(target.context.workspace.list()).toHaveLength(before)
  })
  it('旧格式无来源字段的市场组件备份在全新目录恢复，保持原始哈希和只读来源', async () => {
    const widget = { ...record('acme.weather'), source: 'market' as const }
    const source = await harness([widget])
    await source.send('POST', '/boards/board/instance', JSON.stringify({ widget: widget.manifest.id }))
    const pkg = (await source.send('GET', '/boards/board/export')).body
    const target = await harness([])
    const restored = await target.send('POST', '/boards/import', pkg)
    expect(restored.status, restored.body.toString()).toBe(201)
    const disk = await readWidget(join(target.context.marketDir, widget.manifest.id), { source: 'market' })
    expect(disk.hash).toBe(widget.hash)
    expect(target.context.records.get(widget.manifest.id)?.source).toBe('market')
    expect(await readdir(target.dir)).toEqual([])
    await expect(readFile(join(target.context.marketDir, 'sources.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await target.send('POST', '/boards/import', pkg)).status).toBe(201)
    const conflict = { ...record('acme.weather', { 'main.js': 'void 0' }), source: 'market' as const }
    const incoming = await harness([conflict])
    await incoming.send('POST', '/boards/board/instance', JSON.stringify({ widget: conflict.manifest.id }))
    const other = (await incoming.send('GET', '/boards/board/export')).body
    expect((await target.send('POST', '/boards/import?replace=true', other)).status).toBe(403)
    expect((await readWidget(join(target.context.marketDir, widget.manifest.id), { source: 'market' })).hash).toBe(widget.hash)
  })
  it('组件写入后发生真实刷新读取失败时清理本次目录', async () => {
    const source = await harness()
    await source.send('POST', '/boards/board/instance', JSON.stringify({ widget: 'demo' }))
    const pkg = (await source.send('GET', '/boards/board/export')).body
    const target = await harness([])
    const refresh = target.context.refresh
    target.context.refresh = async () => {
      await refresh()
      // 故意读取不存在的测试文件，让真实 I/O 在目录交换后的刷新阶段失败。
      await readFile(join(target.dir, 'missing-refresh-input'))
    }
    const count = target.context.workspace.list().length
    const response = await target.send('POST', '/boards/import', pkg)
    expect(response.status).toBe(500)
    expect(await readdir(target.dir)).toEqual([])
    expect(target.context.workspace.list()).toHaveLength(count)
  })
  it('真实媒体备份导入完整恢复，并拒绝篡改hash且不残留组件或看板', async () => {
    const source = await harness()
    source.context.media = createMediaStore(join(source.dir, 'media-store'), source.context.workspace)
    const session = source.context.media.session('board:board')
    const png = await sharp({ create: { width: 40, height: 20, channels: 3, background: '#7395ad' } }).png().toBuffer()
    const uploaded = await source.context.media.upload(session, 'background', png, 'image/png')
    const created = await source.send('POST', '/boards/board/compose', JSON.stringify({ widget: 'demo', props: {}, data: null, state: null, media: { background: uploaded.ref }, mediaSession: session, mediaTickets: { background: uploaded.uploadTicket } }))
    expect(created.status).toBe(201)
    const id = JSON.parse(created.body.toString()).id as string
    const stale = await source.send('POST', `/instance/${id}/content`, JSON.stringify({ expectedRevision: 0, media: { background: 'f'.repeat(64) } }))
    expect(stale.status).toBe(409)
    expect(JSON.parse(stale.body.toString()).code).toBe('stale-revision')
    const exported = await source.send('GET', '/boards/board/export?data=true')
    expect(exported.status).toBe(200)
    const target = await harness([])
    target.context.media = createMediaStore(join(target.dir, 'media-store'), target.context.workspace)
    const imported = await target.send('POST', '/boards/import', exported.body)
    expect(imported.status, imported.body.toString()).toBe(201)
    const instance = target.context.board.instances[0]!
    expect(instance.media?.background).toBe(uploaded.ref)
    expect((await target.context.media.read(instance.id, 'background', 0, 24 * 1024)).total).toBe(uploaded.bytes)
    const invalid = unpackBoard(exported.body)
    invalid.media![uploaded.ref] = Buffer.from('bad').toString('base64')
    const refused = await harness([])
    refused.context.media = createMediaStore(join(refused.dir, 'media-store'), refused.context.workspace)
    const before = refused.context.workspace.list().length
    const response = await refused.send('POST', '/boards/import', packBoard(invalid.title, invalid.cards, invalid.widgets, { media: invalid.media }))
    expect(response.status).toBe(400)
    expect(refused.context.workspace.list()).toHaveLength(before)
    expect(await readdir(refused.dir)).toEqual([])
  })

  it('在任何写入之前拒绝媒体路径、数量与缺失资源', async () => {
    const source = await harness()
    await source.send('POST', '/boards/board/instance', JSON.stringify({ widget: 'demo' }))
    const pkg = unpackBoard((await source.send('GET', '/boards/board/export')).body)
    for (const media of [{ '../escape': 'AA==' }, Object.fromEntries(Array.from({ length: 65 }, (_, i) => [i.toString(16).padStart(64, '0'), 'AA==']))]) {
      const target = await harness([])
      const response = await target.send('POST', '/boards/import', packBoard(pkg.title, pkg.cards, pkg.widgets, { media }))
      expect(response.status).toBeGreaterThanOrEqual(400)
      expect(await readdir(target.dir)).toEqual([])
    }
    const target = await harness([])
    const response = await target.send('POST', '/boards/import', packBoard(pkg.title, [{ ...pkg.cards[0]!, media: { background: 'a'.repeat(64) } }], pkg.widgets))
    expect(response.status).toBe(400)
    expect(await readdir(target.dir)).toEqual([])
  })

  it('导出的看板包能在另一处导入，卡片与组件都装回来', async () => {
    const source = await harness()
    await source.send('POST', '/boards/board/instance', JSON.stringify({ widget: 'demo', props: { n: 2 } }))
    expect(source.context.board.instances).toHaveLength(1)
    const exported = await source.send('GET', '/boards/board/export')
    expect(exported.status).toBe(200)
    expect(exported.headers['content-disposition']).toContain('.dshboard')

    const target = await harness([])
    const imported = await target.send('POST', '/boards/import', new Uint8Array(exported.body))
    expect(imported.status).toBe(201)
    const body = JSON.parse(imported.body.toString('utf8')) as { installed: number, cards: string[] }
    expect(body.installed).toBe(1)
    expect(target.context.board.instances).toHaveLength(1)
    expect(target.context.board.instances[0]?.props).toEqual({ n: 2 })
  })

  it('默认不导出数据与状态', async () => {
    const source = await harness()
    await source.send('POST', '/boards/board/instance', JSON.stringify({ widget: 'demo' }))
    const id = source.context.board.instances[0]?.id ?? ''
    await source.send('POST', `/instance/${id}/data`, JSON.stringify({ data: { n: 1 } }))
    const plain = unpackBoard((await source.send('GET', '/boards/board/export')).body)
    expect(plain.cards[0]).not.toHaveProperty('data')
    const withData = unpackBoard((await source.send('GET', '/boards/board/export?data=true')).body)
    expect(withData.cards[0]).toHaveProperty('data')
  })

  it('包里引用了装不进来的组件时整包拒绝', async () => {
    const source = await harness()
    await source.send('POST', '/boards/board/instance', JSON.stringify({ widget: 'demo' }))
    // 手工造一个引用了不存在的组件的包：把组件表清空。
    const exported = unpackBoard((await source.send('GET', '/boards/board/export')).body)
    const broken = JSON.stringify({ ...exported, widgets: [] })
    const target = await harness([])
    const response = await target.send('POST', '/boards/import', strToU8(broken))
    expect(response.status).toBe(400)
    expect(response.body.toString('utf8')).toMatch(/没有包含在包内/)
  })
})

describe('市场写入事务', () => {
  async function marketTarget() {
    const test = await harness([])
    const widgets = [record('acme.weather'), record('acme.clock')]
    const packages = new Map(widgets.map(widget => [widget.manifest.id, packWidget([...widget.files].map(([path, content]) => ({ path, content })))]))
    test.context.market.register({
      apiVersion: 3, provider: 'acme-market', id: 'acme', title: { zh: '市场', en: 'Market' },
      list: async () => widgets.map(widget => {
        const bytes = packages.get(widget.manifest.id)!
        return { id: widget.manifest.id, title: widget.manifest.title, author: { name: 'acme' }, versions: [{ version: '0.1.0', sizes: widget.manifest.sizes, package: { url: 'https://example.invalid/widget.dshw', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') } }] }
      }),
      fetch: async listing => packages.get(listing.id)!,
    })
    await test.context.market.refresh('acme-market')
    return { ...test, install: async (id: string) => await test.send('POST', '/library/market/install', JSON.stringify({ provider: 'acme-market', id, version: '0.1.0' })) }
  }

  it('不同 id 并发安装保留两条来源，同 id 竞争不会覆盖版本', async () => {
    const test = await marketTarget()
    const responses = await Promise.all([test.install('acme.weather'), test.install('acme.clock'), test.install('acme.weather')])
    expect(responses.map(response => response.status).sort()).toEqual([201, 201, 409])
    const sources = JSON.parse(await readFile(join(test.context.marketDir, 'sources.json'), 'utf8'))
    expect(Object.keys(sources).sort()).toEqual(['acme.clock', 'acme.weather'])
    expect((await readWidget(join(test.context.marketDir, 'acme.weather'), { source: 'market' })).manifest.id).toBe('acme.weather')
  })

  it('损坏的来源记录保持原样，失败安装不产生组件', async () => {
    const test = await marketTarget()
    const file = join(test.context.marketDir, 'sources.json')
    await writeFile(file, '{broken')
    expect((await test.install('acme.weather')).status).toBe(500)
    expect(await readFile(file, 'utf8')).toBe('{broken')
    expect(await readdir(test.context.marketDir)).toEqual(['sources.json'])
  })

  it('刷新发生真实 I/O 失败时恢复原始组件及来源字节', async () => {
    const test = await marketTarget()
    expect((await test.install('acme.weather')).status).toBe(201)
    const file = join(test.context.marketDir, 'sources.json')
    const before = await readFile(file)
    const recordBefore = await readWidget(join(test.context.marketDir, 'acme.weather'), { source: 'market' })
    const refresh = test.context.refresh
    test.context.refresh = async () => { await refresh(); await readFile(join(test.dir, 'missing-refresh-input')) }
    expect((await test.install('acme.clock')).status).toBe(500)
    expect(await readFile(file)).toEqual(before)
    expect((await readWidget(join(test.context.marketDir, 'acme.weather'), { source: 'market' })).hash).toBe(recordBefore.hash)
    expect(test.context.records.has('acme.clock')).toBe(false)
    expect(test.context.entries.some(entry => entry.id === 'acme.clock')).toBe(false)
    expect((await test.install('acme.weather')).status).toBe(500)
    expect(await readFile(file)).toEqual(before)
    expect((await readWidget(join(test.context.marketDir, 'acme.weather'), { source: 'market' })).hash).toBe(recordBefore.hash)
  })
})
