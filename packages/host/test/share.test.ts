/**
 * 分享与导入的四条路由（D8）。
 *
 * 判的是「别人的文件进来会发生什么」在路由这一层的表现：导出得到的东西能再导入、同 id 不同内容
 * 回 409 并带上两边的哈希、内置组件不许被覆盖、看板包里引用了没装进来的组件时整包拒绝。
 */
import { mkdtemp, readdir, rm } from 'node:fs/promises'
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
import { readWidget, writeWidgetDirectory } from '../src/library'
import { unpackWidget } from '../src/package'
import { StaleRevisionError } from '../src/state'

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
  return { manifest: JSON.parse(map.get('widget.json')?.toString('utf8') ?? '{}'), source: 'user', dir: `/w/${id}`, hash: id.padEnd(64, 'a').slice(0, 64), files: map }
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
  const context = {
    records: map,
    entries: [...map.values()].map((entry): WidgetLibraryEntry => ({ id: entry.manifest.id, source: 'user', title: entry.manifest.title, sizes: entry.manifest.sizes, hash: entry.hash })),
    library: { records: map, entries: [], errors: [] },
    roots: [{ dir, source: 'user' as const }],
    versions: { remember: async () => undefined, get: async (hash: string) => [...map.values()].find((entry) => entry.hash === hash) },
    board: emptyBoard(),
    save: async (change, options) => {
      const current = context.board
      if (options.expectedLayoutRevision !== undefined && options.expectedLayoutRevision !== current.layoutRevision) {
        throw new StaleRevisionError(options.expectedLayoutRevision, current.layoutRevision)
      }
      const next = { ...change(current), revision: current.revision + 1, layoutRevision: current.layoutRevision + (options.layoutChanged === true ? 1 : 0) }
      context.board = next
      events.push(options.event(next))
      return next
    },
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
    expect(imported.status).toBe(201)
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
    expect(response.status).toBe(400)
    expect(response.body.toString('utf8')).toMatch(/不能覆盖/)
  })

  it('不是组件的字节回 400 并说明', async () => {
    const test = await harness()
    const response = await test.send('POST', '/library/import', strToU8('不是一个包'))
    expect(response.status).toBe(400)
    expect(response.body.toString('utf8')).toMatch(/不是有效的组件包/)
  })
})

describe('看板包的导出与导入', () => {
  it('导出的看板包能在另一处导入，卡片与组件都装回来', async () => {
    const source = await harness()
    await source.send('POST', '/board/instance', JSON.stringify({ widget: 'demo', props: { n: 2 } }))
    expect(source.context.board.instances).toHaveLength(1)
    const exported = await source.send('GET', '/board/export')
    expect(exported.status).toBe(200)
    expect(exported.headers['content-disposition']).toContain('board.dshboard')

    const target = await harness([])
    const imported = await target.send('POST', '/board/import', new Uint8Array(exported.body))
    expect(imported.status).toBe(201)
    const body = JSON.parse(imported.body.toString('utf8')) as { installed: number, cards: string[] }
    expect(body.installed).toBe(1)
    expect(target.context.board.instances).toHaveLength(1)
    expect(target.context.board.instances[0]?.props).toEqual({ n: 2 })
  })

  it('默认不导出数据与状态', async () => {
    const source = await harness()
    await source.send('POST', '/board/instance', JSON.stringify({ widget: 'demo' }))
    const id = source.context.board.instances[0]?.id ?? ''
    await source.send('POST', `/instance/${id}/data`, JSON.stringify({ data: { n: 1 } }))
    const plain = JSON.parse((await source.send('GET', '/board/export')).body.toString('utf8')) as { cards: Record<string, unknown>[] }
    expect(plain.cards[0]).not.toHaveProperty('data')
    const withData = JSON.parse((await source.send('GET', '/board/export?data=true')).body.toString('utf8')) as { cards: Record<string, unknown>[] }
    expect(withData.cards[0]).toHaveProperty('data')
  })

  it('包里引用了装不进来的组件时整包拒绝', async () => {
    const source = await harness()
    await source.send('POST', '/board/instance', JSON.stringify({ widget: 'demo' }))
    // 手工造一个引用了不存在的组件的包：把组件表清空。
    const exported = JSON.parse((await source.send('GET', '/board/export')).body.toString('utf8')) as { widgets: unknown[] }
    const broken = JSON.stringify({ ...exported, widgets: [] })
    const target = await harness([])
    const response = await target.send('POST', '/board/import', strToU8(broken))
    expect(response.status).toBe(400)
    expect(response.body.toString('utf8')).toMatch(/没有装进来/)
  })
})
