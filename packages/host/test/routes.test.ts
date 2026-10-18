/**
 * 路由表（D1、D3、D17、D21）：方法、状态码、请求体上限与每条路由做的事。
 *
 * 请求与响应用最小的替身：宿主的 `HostRequest` 只被读方法、地址、请求头与请求体，`HostResponse`
 * 只被写状态、头与体。工作区用真的那一份，落在 `.debug/` 下的临时目录里：索引与看板文件的读写
 * 因此一起被测到。这一层判定的是本插件的行为，不是宿主的实现。
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import type { Board, BoardEvent, Grant, HostRequest, HostResponse, WidgetLibraryEntry } from '@dsh-widget-board/contracts'
import { PLUGIN_ROUTE, grantKey } from '@dsh-widget-board/contracts'
import type { RouteContext } from '../src/routes'
import { createHandler } from '../src/routes'
import { readManyInto } from '../src/batch-reads'
import type { GrantStore } from '../src/grants'
import type { WidgetRecord } from '../src/library'
import { createRegistries } from '../src/sources'
import { writeBoard } from '../src/state'
import { openWorkspace } from '../src/workspace'
import { BOARD_STATE_WRITES_PER_SECOND, STATE_WRITES_PER_SECOND, createRateLimiter } from '../src/limits'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))

/** 一个版本固定的组件。 */
const HASH = 'a'.repeat(64)
const RECORD: WidgetRecord = {
  manifest: {
    id: 'weather',
    title: { zh: '天气', en: 'Weather' },
    version: '0.1.0',
    sizes: ['s'],
    data: { type: 'object', required: ['n'], properties: { n: { type: 'number' } } },
  },
  source: 'builtin',
  dir: '/widgets/weather',
  hash: HASH,
  files: new Map([['index.html', Buffer.from('<p></p>')], ['style.css', Buffer.from('p{}')]]),
}

/** 组件库在界面上的样子。 */
const ENTRIES: WidgetLibraryEntry[] = [
  { id: 'weather', source: 'builtin', title: { zh: '天气', en: 'Weather' }, sizes: ['s'], hash: HASH },
]

/** 一块两张卡的看板。 */
function board(id = 'board', title = '看板'): Board {
  return {
    version: 2,
    id,
    title,
    revision: 2,
    layoutRevision: 5,
    instances: [
      { id: `${id}-first`, widget: 'weather', hash: HASH, props: {}, data: null, state: null, layout: { x: 0, y: 0, w: 1, h: 22 } },
      { id: `${id}-second`, widget: 'weather', hash: HASH, props: {}, data: null, state: null, layout: { x: 1, y: 0, w: 1, h: 22 } },
    ],
  }
}

/** 捕获下来的响应。 */
class Capture implements HostResponse {
  status = 0
  headers: Record<string, string> = {}
  body = ''

  writeHead(status: number, headers?: Record<string, string>): this {
    this.status = status
    this.headers = headers ?? {}
    return this
  }

  end(body?: string | Uint8Array): this {
    if (body !== undefined) this.body += body.toString()
    return this
  }

  write(chunk: string): this {
    this.body += chunk
    return this
  }

  on(): this {
    return this
  }
}

/**
 * 一条请求。
 *
 * @param method - 方法。
 * @param path - 前缀之后的路径。
 * @param body - 请求体。
 * @param remote - 对端地址。
 * @returns 宿主的请求。
 */
function request(method: string, path: string, body?: string, remote = '127.0.0.1'): HostRequest {
  return {
    method,
    url: `${PLUGIN_ROUTE}${path}`,
    headers: { host: '127.0.0.1:3080' },
    socket: { remoteAddress: remote },
    async *[Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
      if (body !== undefined) yield Buffer.from(body)
    },
  }
}

/** 一次调用留下的记录。 */
interface Harness {
  context: RouteContext
  events: BoardEvent[]
  home: string
  send(method: string, path: string, body?: string, remote?: string): Promise<Capture>
}

/** 这一轮起的临时目录，测试结束一并删掉。 */
const homes: string[] = []

afterEach(async () => {
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true })
})

/**
 * 一份只在内存里的授权表：路由这一层的测试不碰磁盘（D6）。
 *
 * @returns 授权表。
 */
function memoryGrants(): GrantStore {
  const grants = new Map<string, Grant>()
  return {
    all: () => [...grants.values()],
    has: (kind, hash, id) => grants.has(grantKey(kind, hash, id)),
    async grant(input) {
      const key = grantKey(input.kind, input.hash, input.id)
      const existing = grants.get(key)
      if (existing !== undefined) return existing
      const grant: Grant = { key, ...input, at: input.at ?? '2026-01-01T00:00:00.000Z' }
      grants.set(key, grant)
      return grant
    },
    async revoke(kind, hash, id) {
      return grants.delete(grantKey(kind, hash, id))
    },
    async forget(options) {
      let removed = 0
      for (const [key, grant] of [...grants]) {
        const byHash = options.hashes === undefined || options.hashes.includes(grant.hash)
        const byKind = options.kind === undefined || grant.kind === options.kind
        const byId = options.id === undefined || grant.id === options.id
        const byProvider = options.provider === undefined || grant.provider === options.provider
        if (byHash && byKind && byId && byProvider) {
          grants.delete(key)
          removed += 1
        }
      }
      return removed
    },
  }
}

/**
 * 起一套替身：`.debug/` 下写一份索引与一块看板，再打开工作区。
 *
 * @param record - 组件库里的那一个组件，默认是天气卡。
 * @param extra - 是否再多放一块看板（`second`）。
 * @returns 上下文、推出去的事件与发请求的函数。
 */
async function harness(record: WidgetRecord = RECORD, extra = false): Promise<Harness> {
  const events: BoardEvent[] = []
  await mkdir(join(ROOT, '.debug'), { recursive: true })
  const home = await mkdtemp(join(ROOT, '.debug', 'routes-test-'))
  homes.push(home)
  await mkdir(join(home, 'boards'), { recursive: true })
  const first = board()
  await writeBoard(join(home, 'boards', 'board.json'), first)
  const ids = ['board']
  if (extra) {
    await writeBoard(join(home, 'boards', 'second.json'), board('second', '第二块'))
    ids.push('second')
  }
  await writeFile(join(home, 'boards.json'), `${JSON.stringify({ version: 1, active: 'board', boards: ids })}\n`, 'utf8')
  const sources = createRegistries()
  const workspace = await openWorkspace(home, new Map([[record.manifest.id, record]]), (event) => { events.push(event) })
  const context: RouteContext = {
    records: new Map([[record.manifest.id, record]]),
    entries: ENTRIES,
    versions: {
      remember: async () => undefined,
      get: async (hash: string) => (hash === HASH ? record : undefined),
    },
    workspace,
    get board() { return workspace.active() },
    save: async (change, options) => await workspace.save(workspace.activeId(), change, options),
    live: {
      assets: { tokensCss: '', suiteCss: '', runtimeJs: '', libs: {} },
      revision: 0,
      subscribe: () => undefined,
      publish: () => undefined,
      notify: (event) => { events.push(event) },
      close: () => undefined,
    },
    connection: undefined,
    refresh: async () => undefined,
    sources,
    grants: memoryGrants(),
    limits: {
      stateCard: createRateLimiter(STATE_WRITES_PER_SECOND),
      stateBoard: createRateLimiter(BOARD_STATE_WRITES_PER_SECOND),
    },
  }
  const handler = createHandler(context)
  return {
    context,
    events,
    home,
    async send(method, path, body, remote) {
      const response = new Capture()
      await handler(request(method, path, body, remote), response)
      return response
    },
  }
}

describe('工作区快照', () => {
  it('GET /boards 回全部看板、当前选中、组件元信息与整个组件库', async () => {
    const test = await harness()
    const response = await test.send('GET', '/boards')
    expect(response.status).toBe(200)
    const body = JSON.parse(response.body) as { active: string, boards: Board[], widgets: Record<string, { source: string }>, library: WidgetLibraryEntry[] }
    expect(body.active).toBe('board')
    expect(body.boards).toHaveLength(1)
    expect(body.boards[0]?.instances).toHaveLength(2)
    expect(body.widgets.weather?.source).toBe('builtin')
    expect(body.library).toHaveLength(1)
  })

  it('方法不对时回 405 并给出允许的方法', async () => {
    const test = await harness()
    const response = await test.send('PUT', '/boards')
    expect(response.status).toBe(405)
    expect(response.headers.allow).toBe('GET, POST')
  })

  it('没有这条路径时回 404', async () => {
    const response = await (await harness()).send('GET', '/nope')
    expect(response.status).toBe(404)
  })

  it('不是本机来的请求被拒绝', async () => {
    const response = await (await harness()).send('GET', '/boards', undefined, '10.0.0.5')
    expect(response.status).toBe(403)
  })
})

describe('看板的增删改与选中', () => {
  it('新建一块看板：回 201、新 id 与两块看板的快照', async () => {
    const test = await harness()
    const response = await test.send('POST', '/boards', JSON.stringify({}))
    expect(response.status).toBe(201)
    const body = JSON.parse(response.body) as { id: string, snapshot: { active: string, boards: Board[] } }
    expect(body.snapshot.boards).toHaveLength(2)
    expect(body.snapshot.active).toBe(body.id)
    expect(body.snapshot.boards[1]?.title).toBe('未命名看板')
    expect(body.snapshot.boards[1]?.instances).toHaveLength(0)
    expect(test.events.at(-1)).toEqual({ type: 'board' })
  })

  it('改标题写进那一块看板', async () => {
    const test = await harness()
    const response = await test.send('POST', '/boards/board/rename', JSON.stringify({ title: '工作' }))
    expect(response.status).toBe(200)
    expect(test.context.workspace.board('board').title).toBe('工作')
  })

  it('空标题被拒绝', async () => {
    const response = await (await harness()).send('POST', '/boards/board/rename', JSON.stringify({ title: '   ' }))
    expect(response.status).toBe(400)
  })

  it('移除一块看板：文件与索引都不再提它', async () => {
    const test = await harness(RECORD, true)
    const response = await test.send('POST', '/boards/second/remove')
    expect(response.status).toBe(200)
    expect(test.context.workspace.list().map((entry) => entry.id)).toEqual(['board'])
    expect((JSON.parse(response.body) as { boards: Board[] }).boards).toHaveLength(1)
  })

  it('只剩一块时不移除', async () => {
    const response = await (await harness()).send('POST', '/boards/board/remove')
    expect(response.status).toBe(404)
  })

  it('选中另一块看板推出 active 事件，不重取快照', async () => {
    const test = await harness(RECORD, true)
    const response = await test.send('POST', '/boards/second/activate')
    expect(response.status).toBe(200)
    expect(test.context.workspace.activeId()).toBe('second')
    expect(test.events.at(-1)).toEqual({ type: 'active', board: 'second' })
  })

  it('没有这块看板时回 404', async () => {
    const response = await (await harness()).send('POST', '/boards/nope/activate')
    expect(response.status).toBe(404)
  })
})

describe('布局提交', () => {
  it('修订号过期时回 409 与当前快照', async () => {
    const test = await harness()
    const response = await test.send('POST', '/boards/board/layout', JSON.stringify({ layoutRevision: 4, layouts: { 'board-first': { x: 0, y: 30, w: 1, h: 10 } } }))
    expect(response.status).toBe(409)
    const body = JSON.parse(response.body) as { boards: Board[] }
    expect(body.boards[0]?.layoutRevision).toBe(5)
  })

  it('提交成功时布局修订号加一，并推出带看板 id 的布局事件', async () => {
    const test = await harness()
    const layouts = { 'board-first': { x: 0, y: 30, w: 2, h: 10 } }
    const response = await test.send('POST', '/boards/board/layout', JSON.stringify({ layoutRevision: 5, layouts }))
    expect(response.status).toBe(200)
    expect(test.context.workspace.board('board').layoutRevision).toBe(6)
    expect(test.context.workspace.board('board').instances[0]?.layout).toEqual(layouts['board-first'])
    expect(test.events.at(-1)).toEqual({ type: 'layout', board: 'board', layoutRevision: 6, layouts })
    // 成功只回这次落定的盒子，不再把全部看板的数据与状态带回来。
    const body = JSON.parse(response.body) as { layoutRevision: number, layouts: typeof layouts }
    expect(body).toEqual({ layoutRevision: 6, layouts })
  })

  it('提交低于组件最小盒子的布局时抬到下限', async () => {
    const sized: WidgetRecord = { ...RECORD, manifest: { ...RECORD.manifest, minBox: { w: 2, h: 14 } } }
    const test = await harness(sized)
    const response = await test.send('POST', '/boards/board/layout', JSON.stringify({ layoutRevision: 5, layouts: { 'board-first': { x: 0, y: 0, w: 1, h: 6 } } }))
    expect(response.status).toBe(200)
    expect(test.context.workspace.board('board').instances[0]?.layout).toEqual({ x: 0, y: 0, w: 2, h: 14 })
    expect(test.events.at(-1)).toEqual({ type: 'layout', board: 'board', layoutRevision: 6, layouts: { 'board-first': { x: 0, y: 0, w: 2, h: 14 } } })
  })

  it('形状不对时回 400', async () => {
    const response = await (await harness()).send('POST', '/boards/board/layout', JSON.stringify({ layouts: {} }))
    expect(response.status).toBe(400)
  })
})

describe('卡片状态与数据', () => {
  it('状态写入推出这条卡的事件，不改布局修订号', async () => {
    const test = await harness()
    const response = await test.send('POST', '/instance/board-first/state', JSON.stringify({ patch: { n: 1 } }))
    expect(response.status).toBe(200)
    expect(test.context.workspace.board('board').layoutRevision).toBe(5)
    expect(test.context.workspace.board('board').instances[0]?.state).toEqual({ n: 1 })
    expect(test.events.at(-1)).toEqual({ type: 'instance', id: 'board-first', state: { n: 1 } })
  })

  it('状态已经是对象时事件只带这次补丁', async () => {
    const test = await harness()
    await test.send('POST', '/instance/board-first/state', JSON.stringify({ patch: { n: 1 } }))
    await test.send('POST', '/instance/board-first/state', JSON.stringify({ patch: { m: 2 } }))
    expect(test.context.workspace.board('board').instances[0]?.state).toEqual({ n: 1, m: 2 })
    expect(test.events.at(-1)).toEqual({ type: 'instance', id: 'board-first', patch: { m: 2 } })
  })

  it('状态超过单卡额度时回 413，不写进看板', async () => {
    const test = await harness()
    let last = 0
    for (let index = 0; index < 5; index += 1) {
      const patch = { [`k${index}`]: 'x'.repeat(15 * 1024) }
      last = (await test.send('POST', '/instance/board-first/state', JSON.stringify({ patch }))).status
    }
    expect(last).toBe(413)
    expect(JSON.stringify(test.context.workspace.board('board').instances[0]?.state).length).toBeLessThan(64 * 1024)
  })

  it('写入太频繁时回 429', async () => {
    const test = await harness()
    let last = 0
    for (let index = 0; index < STATE_WRITES_PER_SECOND + 1; index += 1) {
      last = (await test.send('POST', '/instance/board-first/state', JSON.stringify({ patch: { n: index } }))).status
    }
    expect(last).toBe(429)
  })

  it('同一块看板的到期卡一次读取只写一次看板', async () => {
    const test = await harness()
    test.context.sources.registerDataSource({
      apiVersion: 2,
      provider: 'test-provider',
      id: 'weather.now',
      read: () => ({ n: 3 }),
    })
    await test.context.workspace.save('board', (current) => ({
      ...current,
      instances: current.instances.map((instance) => ({ ...instance, source: 'weather.now' })),
    }), { event: () => ({ type: 'board' }) })
    const original = test.context.workspace.save
    let saves = 0
    test.context.workspace.save = async (id, change, options) => {
      saves += 1
      return await original.call(test.context.workspace, id, change, options)
    }
    const outcomes = await readManyInto(test.context, ['board-first', 'board-second'])
    expect(outcomes.every((outcome) => outcome.error === undefined)).toBe(true)
    expect(saves).toBe(1)
    expect(test.context.workspace.board('board').instances.map((instance) => instance.data)).toEqual([{ n: 3 }, { n: 3 }])
  })

  it('卡片在哪块看板上就写哪一块：另一块看板上的卡也找得到', async () => {
    const test = await harness(RECORD, true)
    const response = await test.send('POST', '/instance/second-first/state', JSON.stringify({ patch: { n: 2 } }))
    expect(response.status).toBe(200)
    expect(test.context.workspace.board('second').instances[0]?.state).toEqual({ n: 2 })
    expect(test.context.workspace.board('board').instances[0]?.state).toBeNull()
  })

  it('另一块看板上的卡也能按 id 读数据与授权', async () => {
    const test = await harness(RECORD, true)
    await test.context.workspace.save('second', (current) => ({
      ...current,
      instances: current.instances.map((instance) => ({ ...instance, source: 'weather.now' })),
    }), { event: () => ({ type: 'board' }) })
    let reads = 0
    test.context.sources.registerDataSource({
      apiVersion: 2,
      provider: 'test-provider',
      id: 'weather.now',
      read: () => { reads += 1; return { n: 7 } },
    })
    const read = await test.send('POST', '/instance/second-first/read')
    expect(read.status).toBe(200)
    expect(reads).toBe(1)
    expect(test.context.workspace.board('second').instances[0]?.data).toEqual({ n: 7 })
    expect(test.context.workspace.board('board').instances[0]?.data).toBeNull()

    const granted = await test.send('POST', '/instance/second-first/grant', JSON.stringify({ kind: 'source', id: 'weather.now' }))
    expect(granted.status).toBe(200)
    expect(test.context.grants.all()).toHaveLength(1)
  })

  it('看板上没有这张卡时回 404', async () => {
    const response = await (await harness()).send('POST', '/instance/missing/state', JSON.stringify({ patch: {} }))
    expect(response.status).toBe(404)
  })

  it('没有 patch 字段时回 400', async () => {
    const response = await (await harness()).send('POST', '/instance/board-first/state', JSON.stringify({ value: 1 }))
    expect(response.status).toBe(400)
  })

  it('请求体超过上限时回 413', async () => {
    const big = JSON.stringify({ patch: { text: 'x'.repeat(20 * 1024) } })
    const response = await (await harness()).send('POST', '/instance/board-first/state', big)
    expect(response.status).toBe(413)
  })

  it('数据按组件的 data schema 校验', async () => {
    const test = await harness()
    const bad = await test.send('POST', '/instance/board-first/data', JSON.stringify({ data: { n: 'x' } }))
    expect(bad.status).toBe(400)
    const good = await harness()
    const ok = await good.send('POST', '/instance/board-first/data', JSON.stringify({ data: { n: 1 } }))
    expect(ok.status).toBe(200)
    expect(good.events.at(-1)).toEqual({ type: 'instance', id: 'board-first', data: { n: 1 } })
  })
})

describe('加卡片与移除卡片', () => {
  it('加卡片回 201，那一块看板多一张，布局修订号加一', async () => {
    const test = await harness()
    const response = await test.send('POST', '/boards/board/instance', JSON.stringify({ widget: 'weather' }))
    expect(response.status).toBe(201)
    const body = JSON.parse(response.body) as { id: string, snapshot: { boards: Board[] } }
    expect(body.snapshot.boards[0]?.instances).toHaveLength(3)
    expect(body.snapshot.boards[0]?.instances.at(-1)?.id).toBe(body.id)
    expect(test.context.workspace.board('board').layoutRevision).toBe(6)
    expect(test.events[0]).toEqual({ type: 'board' })
  })

  it('加卡片只加在点名的那一块看板上', async () => {
    const test = await harness(RECORD, true)
    await test.send('POST', '/boards/second/instance', JSON.stringify({ widget: 'weather' }))
    expect(test.context.workspace.board('second').instances).toHaveLength(3)
    expect(test.context.workspace.board('board').instances).toHaveLength(2)
  })

  it('请求带着拖放落点时，新卡片按它摆放', async () => {
    const test = await harness()
    const response = await test.send('POST', '/boards/board/instance', JSON.stringify({ widget: 'weather', layout: { x: 1, y: 4.5, w: 1, h: 10 } }))
    expect(response.status).toBe(201)
    expect(test.context.workspace.board('board').instances.at(-1)?.layout).toEqual({ x: 1, y: 4, w: 1, h: 10 })
  })

  it('拖放落点不合法时回 400', async () => {
    const response = await (await harness()).send('POST', '/boards/board/instance', JSON.stringify({ widget: 'weather', layout: { x: 3, y: 0, w: 2, h: 10 } }))
    expect(response.status).toBe(400)
  })

  it('组件库没有这个组件时回 400', async () => {
    const response = await (await harness()).send('POST', '/boards/board/instance', JSON.stringify({ widget: 'nope' }))
    expect(response.status).toBe(400)
  })

  it('数据源不存在时回 400', async () => {
    const response = await (await harness()).send('POST', '/boards/board/instance', JSON.stringify({ widget: 'weather', source: 'ghost' }))
    expect(response.status).toBe(400)
  })

  it('绑定数据源时读一次并把数据写进卡片', async () => {
    const test = await harness()
    test.context.sources.registerDataSource({ apiVersion: 2, provider: 'test-provider', id: 'weather.now', read: () => ({ n: 7 }) })
    const response = await test.send('POST', '/boards/board/instance', JSON.stringify({ widget: 'weather', source: 'weather.now' }))
    expect(response.status).toBe(201)
    const created = test.context.workspace.board('board').instances.at(-1)
    expect(created?.source).toBe('weather.now')
    expect(created?.data).toEqual({ n: 7 })
  })

  it('请求没指定数据源时用组件声明的那个', async () => {
    const test = await harness()
    test.context.records.set('weather', { ...RECORD, manifest: { ...RECORD.manifest, source: 'weather.now' } })
    test.context.sources.registerDataSource({ apiVersion: 2, provider: 'test-provider', id: 'weather.now', read: () => ({ n: 9 }) })
    const response = await test.send('POST', '/boards/board/instance', JSON.stringify({ widget: 'weather' }))
    expect(response.status).toBe(201)
    expect(test.context.workspace.board('board').instances.at(-1)?.data).toEqual({ n: 9 })
  })

  it('组件声明的数据源不在时卡片照样加得进来，数据留空', async () => {
    const test = await harness()
    test.context.records.set('weather', { ...RECORD, manifest: { ...RECORD.manifest, source: 'gone.source' } })
    const response = await test.send('POST', '/boards/board/instance', JSON.stringify({ widget: 'weather' }))
    expect(response.status).toBe(201)
    expect(test.context.workspace.board('board').instances.at(-1)?.source).toBe('gone.source')
    expect(test.context.workspace.board('board').instances.at(-1)?.data).toBeNull()
  })

  it('刷新路由触发一次重读并回快照', async () => {
    const test = await harness()
    let calls = 0
    test.context.refresh = async () => { calls += 1 }
    const response = await test.send('POST', '/refresh')
    expect(response.status).toBe(200)
    expect(calls).toBe(1)
    expect(JSON.parse(response.body).boards[0].instances).toHaveLength(2)
  })

  it('移除卡片回快照，布局修订号加一', async () => {
    const test = await harness()
    const response = await test.send('POST', '/instance/board-first/remove')
    expect(response.status).toBe(200)
    expect(test.context.workspace.board('board').instances.map((instance) => instance.id)).toEqual(['board-second'])
    expect(test.context.workspace.board('board').layoutRevision).toBe(6)
  })
})

describe('翻面组', () => {
  /** 一套装好 stat 与 chart 的替身：加组卡时宿主按固定 id 找它们。 */
  async function groupHarness(): Promise<Harness> {
    const test = await harness()
    for (const id of ['stat', 'chart']) {
      test.context.records.set(id, { ...RECORD, manifest: { ...RECORD.manifest, id, title: { zh: id, en: id } } })
    }
    return test
  }

  it('一次加出正面与背面两张卡，回组 id 与快照', async () => {
    const test = await groupHarness()
    const response = await test.send('POST', '/boards/board/group', JSON.stringify({ layout: { x: 1, y: 0, w: 1, h: 22 } }))
    expect(response.status).toBe(201)
    const body = JSON.parse(response.body) as { id: string, snapshot: { boards: Board[] } }
    expect(body.snapshot.boards[0]?.instances).toHaveLength(4)
    const [front, back] = (body.snapshot.boards[0]?.instances ?? []).slice(2)
    expect(front?.group).toMatchObject({ id: body.id, side: 'front', template: 'flip' })
    expect(back?.group).toMatchObject({ id: body.id, side: 'back', template: 'flip' })
    expect(front?.layout).toEqual({ x: 1, y: 0, w: 1, h: 22 })
    expect(back?.layout).toEqual(front?.layout)
    expect(test.context.workspace.board('board').layoutRevision).toBe(6)
    expect(test.events).toEqual([{ type: 'board' }])
  })

  it('没有 stat 或 chart 时回 400', async () => {
    const response = await (await harness()).send('POST', '/boards/board/group', JSON.stringify({}))
    expect(response.status).toBe(400)
  })

  it('落点不合法时回 400', async () => {
    const response = await (await groupHarness()).send('POST', '/boards/board/group', JSON.stringify({ layout: { x: 3, y: 0, w: 2, h: 10 } }))
    expect(response.status).toBe(400)
  })

  it('按组 id 移除时两张卡一起离开，组在哪块看板上就改哪一块', async () => {
    const test = await groupHarness()
    const added = JSON.parse((await test.send('POST', '/boards/board/group', JSON.stringify({}))).body) as { id: string }
    const response = await test.send('POST', '/group/remove', JSON.stringify({ group: added.id }))
    expect(response.status).toBe(200)
    expect(test.context.workspace.board('board').instances.map((instance) => instance.id)).toEqual(['board-first', 'board-second'])
    expect(test.context.workspace.board('board').layoutRevision).toBe(7)
  })

  it('移除没有的组时回 404', async () => {
    const response = await (await groupHarness()).send('POST', '/group/remove', JSON.stringify({ group: 'missing' }))
    expect(response.status).toBe(404)
  })
})

describe('动作', () => {
  it('manifest 声明过的动作交给注册的动作执行', async () => {
    const test = await harness()
    test.context.records.set('weather', { ...RECORD, manifest: { ...RECORD.manifest, actions: [{ id: 'refresh' }] } })
    let seen: unknown
    test.context.sources.registerAction({ apiVersion: 2, provider: 'test-provider', id: 'refresh', run: (_instance, payload) => { seen = payload; return { ok: 1 } } })
    const response = await test.send('POST', '/instance/board-first/action', JSON.stringify({ id: 'refresh', payload: { now: 1 } }))
    expect(response.status).toBe(200)
    expect(JSON.parse(response.body)).toEqual({ ok: true, result: { ok: 1 } })
    expect(seen).toEqual({ now: 1 })
  })

  it('要权限的动作在没有授权时回 403，并写明缺的是哪一条', async () => {
    const test = await harness()
    test.context.records.set('weather', { ...RECORD, manifest: { ...RECORD.manifest, actions: [{ id: 'test-provider:run' }] } })
    test.context.sources.registerAction({
      apiVersion: 2,
      provider: 'test-provider',
      id: 'run',
      permission: { hosts: ['example.invalid'] },
      run: () => ({ ok: 1 }),
    })
    const response = await test.send('POST', '/instance/board-first/action', JSON.stringify({ id: 'test-provider:run' }))
    expect(response.status).toBe(403)
    expect(JSON.parse(response.body)).toMatchObject({ code: 'grant-required', kind: 'action', id: 'test-provider:run', provider: 'test-provider' })
  })

  it('人给出授权之后同一个动作放行', async () => {
    const test = await harness()
    test.context.records.set('weather', { ...RECORD, manifest: { ...RECORD.manifest, actions: [{ id: 'test-provider:run' }] } })
    test.context.sources.registerAction({
      apiVersion: 2,
      provider: 'test-provider',
      id: 'run',
      permission: { hosts: ['example.invalid'] },
      run: () => ({ ok: 1 }),
    })
    const granted = await test.send('POST', '/instance/board-first/grant', JSON.stringify({ kind: 'action', id: 'test-provider:run' }))
    expect(granted.status).toBe(200)
    const response = await test.send('POST', '/instance/board-first/action', JSON.stringify({ id: 'test-provider:run' }))
    expect(response.status).toBe(200)
    expect(JSON.parse(response.body)).toEqual({ ok: true, result: { ok: 1 } })
  })

  it('提供方把权限改大之后要重新授权', async () => {
    const test = await harness()
    test.context.records.set('weather', { ...RECORD, manifest: { ...RECORD.manifest, actions: [{ id: 'test-provider:run' }] } })
    const first = test.context.sources.registerAction({ apiVersion: 2, provider: 'test-provider', id: 'run', permission: { hosts: ['a'] }, run: () => null })
    await test.send('POST', '/instance/board-first/grant', JSON.stringify({ kind: 'action', id: 'test-provider:run' }))
    // 提供方换了实现：先撤下旧的，再按新的权限注册（D12）。
    first()
    test.context.sources.registerAction({ apiVersion: 2, provider: 'test-provider', id: 'run', permission: { hosts: ['a', 'b'] }, run: () => null })
    const response = await test.send('POST', '/instance/board-first/action', JSON.stringify({ id: 'test-provider:run' }))
    expect(response.status).toBe(403)
    expect(JSON.parse(response.body).error).toMatch(/重新给出授权/)
  })

  it('manifest 没声明的动作被拒绝', async () => {
    const response = await (await harness()).send('POST', '/instance/board-first/action', JSON.stringify({ id: 'refresh' }))
    expect(response.status).toBe(400)
  })

  it('没有声明 id 的请求被拒绝', async () => {
    const response = await (await harness()).send('POST', '/instance/board-first/action', JSON.stringify({ payload: null }))
    expect(response.status).toBe(400)
  })
})

describe('组件文档', () => {
  it('按哈希取到文档，响应头带 CSP', async () => {
    const response = await (await harness()).send('GET', `/widget/${HASH}/document?lang=en-US`)
    expect(response.status).toBe(200)
    expect(response.headers['content-security-policy']).toContain("script-src 'nonce-")
    expect(response.body).toContain('<html lang="en-US">')
  })

  it('没有这个版本时回 404', async () => {
    const response = await (await harness()).send('GET', `/widget/${'b'.repeat(64)}/document`)
    expect(response.status).toBe(404)
  })
})
