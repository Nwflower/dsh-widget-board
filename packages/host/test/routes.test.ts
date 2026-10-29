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
import { MY_BOARD_TITLE } from '../src/default-boards'
import { readManyInto } from '../src/batch-reads'
import { registerDataRead } from '../src/data-read'
import type { GrantStore } from '../src/grants'
import type { WidgetRecord } from '../src/library'
import { loadLibrary } from '../src/library'
import type { Live } from '../src/live'
import { createLive } from '../src/live'
import { createProviderHealth } from '../src/provider-health'
import { createRegistries } from '../src/sources'
import { createMarketRegistry } from '../src/market'
import { createRequestLog } from '../src/request-log'
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

/**
 * 一段文案里出现几次某句话：一句前缀只该说一遍，界面才看不到重复的两遍。
 *
 * @param text - 文案。
 * @param phrase - 要找的那一句。
 * @returns 出现次数。
 */
function timesIn(text: string, phrase: string): number {
  return text.split(phrase).length - 1
}

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

/** 这一轮建的通知器：心跳与长连接在测试结束一并收掉。 */
const lives: Live[] = []

afterEach(async () => {
  for (const live of lives.splice(0)) live.close()
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
 * @param records - 打开工作区用的组件库；省略时只有 `record` 一个。
 * @param timeoutMs - 提供方调用的默认超时；省略时用生产上的 15 秒。
 * @returns 上下文、推出去的事件与发请求的函数。
 */
async function harness(
  record: WidgetRecord = RECORD,
  extra = false,
  records?: Map<string, WidgetRecord>,
  timeoutMs?: number,
): Promise<Harness> {
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
  const sources = createRegistries(timeoutMs === undefined ? undefined : createProviderHealth({ timeoutMs }))
  const workspace = await openWorkspace(home, records ?? new Map([[record.manifest.id, record]]), (event) => { events.push(event) })
  // 真的通知器：/events 与可见性上报都落在它身上，测试因此判定的是真行为。
  const live = createLive({ tokensCss: '', suiteCss: '', runtimeJs: '', libs: {} })
  lives.push(live)
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
    live,
    connection: undefined,
    refresh: async () => undefined,
    sources,
    grants: memoryGrants(),
    requests: createRequestLog(),
    market: createMarketRegistry(),
    marketDir: join(home, 'market-widgets'),
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

  it('快照带上这张卡可用的能力：提供方不在的能力不在其中', async () => {
    const declared = {
      ...RECORD,
      manifest: { ...RECORD.manifest, capabilities: ['demo:present', 'demo:absent'] },
    }
    const test = await harness(declared)
    // 这个替身的注册表里没有注册任何能力：两项都不可用。
    const response = await test.send('GET', '/boards')
    const body = JSON.parse(response.body) as { widgets: Record<string, { capabilities?: string[], availableCapabilities?: string[] }> }
    expect(body.widgets.weather?.capabilities).toEqual(['demo:present', 'demo:absent'])
    expect(body.widgets.weather?.availableCapabilities).toEqual([])
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

  it('移除最后一块看板时补上默认看板', async () => {
    const library = (await loadLibrary([{ dir: join(ROOT, 'packages', 'widgets'), source: 'builtin' }])).records
    const test = await harness(RECORD, false, library)
    const response = await test.send('POST', '/boards/board/remove')
    expect(response.status).toBe(200)
    const body = JSON.parse(response.body) as { active: string, boards: Board[] }
    expect(body.boards).toHaveLength(1)
    const replacement = body.boards[0] as Board
    expect(replacement.id).not.toBe('board')
    expect(replacement.title).toBe(MY_BOARD_TITLE)
    expect(replacement.instances.length).toBeGreaterThan(0)
    expect(body.active).toBe(replacement.id)
    expect(test.events.at(-1)).toEqual({ type: 'board' })
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

  it('定时刷新里一个提供方超时只影响它自己那张卡', async () => {
    const test = await harness(RECORD, false, undefined, 20)
    test.context.sources.registerDataSource({ apiVersion: 3, provider: 'slow-provider', id: 'slow.now', read: () => new Promise<unknown>(() => {}) })
    test.context.sources.registerDataSource({ apiVersion: 3, provider: 'fast-provider', id: 'fast.now', read: () => ({ n: 5 }) })
    await test.context.workspace.save('board', (current) => ({
      ...current,
      instances: current.instances.map((instance, index) => ({ ...instance, source: index === 0 ? 'slow.now' : 'fast.now' })),
    }), { event: () => ({ type: 'board' }) })
    const outcomes = await readManyInto(test.context, ['board-first', 'board-second'])
    expect(outcomes.find((outcome) => outcome.id === 'board-first')?.error).toBeDefined()
    expect(outcomes.find((outcome) => outcome.id === 'board-second')?.error).toBeUndefined()
    const [first, second] = test.context.workspace.board('board').instances
    expect(first?.data).toBeNull()
    expect(second?.data).toEqual({ n: 5 })
    const health = test.context.sources.health.snapshot()
    expect(health.find((record) => record.provider === 'slow-provider')).toMatchObject({ timeouts: 1, failures: 0 })
    expect(health.find((record) => record.provider === 'fast-provider')).toMatchObject({ timeouts: 0, failures: 0 })
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

  it('第一次读失败时卡片照样加得进来，数据留空', async () => {
    const test = await harness()
    test.context.records.set('weather', { ...RECORD, manifest: { ...RECORD.manifest, source: 'weather.now' } })
    test.context.sources.registerDataSource({
      apiVersion: 2,
      provider: 'test-provider',
      id: 'weather.now',
      read: () => { throw new Error('网络断了') },
    })
    const response = await test.send('POST', '/boards/board/instance', JSON.stringify({ widget: 'weather' }))
    expect(response.status).toBe(201)
    const created = test.context.workspace.board('board').instances.at(-1)
    expect(created?.source).toBe('weather.now')
    expect(created?.data).toBeNull()
  })

  it('数据源要授权时加卡照样成功，数据留空等人授权', async () => {
    const test = await harness()
    test.context.records.set('weather', { ...RECORD, manifest: { ...RECORD.manifest, source: 'weather.gated' } })
    test.context.sources.registerDataSource({
      apiVersion: 2,
      provider: 'test-provider',
      id: 'weather.gated',
      permission: { hosts: ['api.open-meteo.com'] },
      read: () => ({ n: 1 }),
    })
    const response = await test.send('POST', '/boards/board/instance', JSON.stringify({ widget: 'weather' }))
    // 卡片照加、数据留空：授权只由人给出（D6），用户在卡片上点「允许」之后再读就有数据了。
    expect(response.status).toBe(201)
    const created = test.context.workspace.board('board').instances.at(-1)
    expect(created?.source).toBe('weather.gated')
    expect(created?.data).toBeNull()
    // 手动读那一下会给出缺授权的说明与「允许」的依据。
    const read = await test.send('POST', `/instance/${encodeURIComponent(created?.id ?? '')}/read`, '{}')
    expect(read.status).toBe(403)
    expect(JSON.parse(read.body).code).toBe('grant-required')
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
  /** 一套装好 calendar 与 fortune 的替身：加组卡时宿主按固定 id 找它们。 */
  async function groupHarness(): Promise<Harness> {
    const test = await harness()
    for (const id of ['calendar', 'fortune']) {
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

  it('日历与运势不在组件库里时回 400', async () => {
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
    // 提供方换了实现：先撤下旧的，再按新的权限注册（D31）。
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

describe('提供方调用的超时、并发与健康', () => {
  it('读取超时回 504，槽占满时下一个调用回 429', async () => {
    const test = await harness(RECORD, false, undefined, 20)
    // 两张卡都绑同一个读不完的数据源：8 个槽被那 8 次超时的调用占着，因为提供方忽略中止信号。
    await test.context.workspace.save('board', (current) => ({
      ...current,
      instances: current.instances.map((instance) => ({ ...instance, source: 'weather.now' })),
    }), { event: () => ({ type: 'board' }) })
    test.context.sources.registerDataSource({
      apiVersion: 3,
      provider: 'test-provider',
      id: 'weather.now',
      read: () => new Promise<unknown>(() => {}),
    })
    const first = await test.send('POST', '/instance/board-first/read')
    expect(first.status).toBe(504)
    expect(JSON.parse(first.body)).toMatchObject({ code: 'provider-timeout', provider: 'test-provider' })
    for (let index = 1; index < 8; index += 1) await test.send('POST', '/instance/board-first/read')
    const busy = await test.send('POST', '/instance/board-second/read')
    expect(busy.status).toBe(429)
    expect(JSON.parse(busy.body)).toMatchObject({ code: 'provider-busy', provider: 'test-provider' })
    const snapshot = JSON.parse((await test.send('GET', '/boards')).body) as { providers?: { provider: string, registrations: number, failures: number, timeouts: number, available: boolean }[] }
    expect(snapshot.providers).toHaveLength(1)
    expect(snapshot.providers?.[0]).toMatchObject({ provider: 'test-provider', registrations: 1, failures: 0, timeouts: 8, available: true })
  })

  it('动作超时回 504 并带原因码', async () => {
    const test = await harness(RECORD, false, undefined, 20)
    test.context.records.set('weather', { ...RECORD, manifest: { ...RECORD.manifest, actions: [{ id: 'hang' }] } })
    test.context.sources.registerAction({ apiVersion: 3, provider: 'test-provider', id: 'hang', run: () => new Promise<unknown>(() => {}) })
    const response = await test.send('POST', '/instance/board-first/action', JSON.stringify({ id: 'hang' }))
    expect(response.status).toBe(504)
    expect(JSON.parse(response.body).code).toBe('provider-timeout')
  })

  it('提供方抛错时计一次失败，原因原样回给卡片', async () => {
    const test = await harness()
    test.context.records.set('weather', { ...RECORD, manifest: { ...RECORD.manifest, actions: [{ id: 'boom' }] } })
    test.context.sources.registerAction({ apiVersion: 3, provider: 'test-provider', id: 'boom', run: () => { throw new Error('命令退出码 1') } })
    const response = await test.send('POST', '/instance/board-first/action', JSON.stringify({ id: 'boom' }))
    expect(response.status).toBe(500)
    expect((JSON.parse(response.body) as { error: string }).error).toBe('命令退出码 1')
    expect(test.context.sources.health.snapshot()[0]).toMatchObject({ failures: 1, timeouts: 0 })
  })

  it('能力输入不合格不计失败，输出不合格记一次', async () => {
    const test = await harness(RECORD, false, undefined, 20)
    test.context.records.set('weather', { ...RECORD, manifest: { ...RECORD.manifest, capabilities: ['test.echo'] } })
    test.context.sources.registerCapability({
      apiVersion: 3,
      provider: 'test-provider',
      id: 'test.echo',
      input: { type: 'object', required: ['n'], properties: { n: { type: 'number' } } },
      output: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } },
      call: () => ({ ok: 'nope' }),
    })
    const badInput = await test.send('POST', '/instance/board-first/call', JSON.stringify({ capability: 'test.echo', args: {} }))
    expect(badInput.status).toBe(400)
    // 提供方根本没有被调用：失败计数还是 0。
    expect(test.context.sources.health.snapshot()[0]).toEqual({ provider: 'test-provider', features: [], registrations: 1, failures: 0, timeouts: 0, available: true })
    const badOutput = await test.send('POST', '/instance/board-first/call', JSON.stringify({ capability: 'test.echo', args: { n: 1 } }))
    expect(badOutput.status).toBe(502)
    expect(test.context.sources.health.snapshot()[0]).toMatchObject({
      failures: 1,
      lastError: 'provider-output：能力 test.echo 的结果与 output schema 不符',
    })
  })

  it('能力参数可以整个省略：按空对象校验与执行', async () => {
    const test = await harness()
    test.context.records.set('weather', { ...RECORD, manifest: { ...RECORD.manifest, capabilities: ['test.none'] } })
    const seen: unknown[] = []
    test.context.sources.registerCapability({
      apiVersion: 3,
      provider: 'test-provider',
      id: 'test.none',
      input: { type: 'object', additionalProperties: false, properties: {} },
      call: (_instance, args) => { seen.push(args); return { ok: true } },
    })
    // 组件调一个不声明参数的能力时可以不传 args；传了不合 schema 的值仍按同一处校验拒绝。
    const omitted = await test.send('POST', '/instance/board-first/call', JSON.stringify({ capability: 'test.none' }))
    expect(omitted.status).toBe(200)
    expect(seen).toEqual([{}])
    const wrong = await test.send('POST', '/instance/board-first/call', JSON.stringify({ capability: 'test.none', args: { extra: 1 } }))
    expect(wrong.status).toBe(400)
    // 没有声明 input schema 的能力保持收到 undefined：既有提供方按「没有参数」写的那种行为不变。
    const raw: unknown[] = []
    test.context.sources.registerCapability({
      apiVersion: 3,
      provider: 'test-provider',
      id: 'test.raw',
      call: (_instance, args) => { raw.push(args); return { ok: true } },
    })
    test.context.records.set('weather', { ...RECORD, manifest: { ...RECORD.manifest, capabilities: ['test.none', 'test.raw'] } })
    const undeclared = await test.send('POST', '/instance/board-first/call', JSON.stringify({ capability: 'test.raw' }))
    expect(undeclared.status).toBe(200)
    expect(raw).toEqual([undefined])
  })

  it('快照带每个提供方一份健康记录，撤下之后不可用', async () => {
    const test = await harness()
    const release = test.context.sources.registerDataSource({ apiVersion: 3, provider: 'test-provider', id: 'weather.now', read: () => ({ n: 1 }) })
    const now = JSON.parse((await test.send('GET', '/boards')).body) as { providers?: unknown }
    expect(now.providers).toEqual([{ provider: 'test-provider', features: [], registrations: 1, failures: 0, timeouts: 0, available: true }])
    release()
    const after = JSON.parse((await test.send('GET', '/boards')).body) as { providers?: unknown }
    // 计数留着，可用性随最后一项注册撤下变成假（D31）。
    expect(after.providers).toEqual([{ provider: 'test-provider', features: [], registrations: 1, failures: 0, timeouts: 0, available: false }])
  })

  it('数据源读出来的数据不合组件 schema：手动读回 400，按提供方记一次失败', async () => {
    const test = await harness()
    test.context.sources.registerDataSource({ apiVersion: 3, provider: 'test-provider', id: 'weather.now', read: () => ({ n: 'x' }) })
    await test.context.workspace.save('board', (current) => ({
      ...current,
      instances: current.instances.map((instance) => ({ ...instance, source: 'weather.now' })),
    }), { event: () => ({ type: 'board' }) })
    const response = await test.send('POST', '/instance/board-first/read')
    expect(response.status).toBe(400)
    const error = (JSON.parse(response.body) as { error: string }).error
    expect(error).toMatch(/data schema/)
    // dataError 自带的那一句就是全部：前缀在文案里只出现一次。
    expect(timesIn(error, 'data schema 不符')).toBe(1)
    // 校验只在 loadData 一处：读取失败两次也不会多记一次（D31）。
    const health = test.context.sources.health.snapshot()
    expect(health).toHaveLength(1)
    expect(health[0]).toMatchObject({ provider: 'test-provider', failures: 1, timeouts: 0 })
    expect(health[0]?.lastError).toMatch(/^provider-output：数据源 weather.now 交出来的数据不合格：/)
    expect(timesIn(health[0]?.lastError ?? '', 'data schema 不符')).toBe(1)
    expect(test.context.workspace.board('board').instances[0]?.data).toBeNull()
  })

  it('定时刷新批量读到不合 schema 的数据时也只记一次失败', async () => {
    const test = await harness()
    test.context.sources.registerDataSource({ apiVersion: 3, provider: 'test-provider', id: 'weather.now', read: () => ({ n: 'x' }) })
    await test.context.workspace.save('board', (current) => ({
      ...current,
      instances: current.instances.map((instance) => ({ ...instance, source: 'weather.now' })),
    }), { event: () => ({ type: 'board' }) })
    const outcomes = await readManyInto(test.context, ['board-first'])
    expect(outcomes[0]?.error).toBeDefined()
    expect((outcomes[0]?.error as Error).message).toMatch(/data schema/)
    expect(test.context.sources.health.snapshot()[0]).toMatchObject({ provider: 'test-provider', failures: 1, timeouts: 0 })
    expect(test.context.workspace.board('board').instances[0]?.data).toBeNull()
  })

  it('push 推来的数据不合 schema 时不记到提供方名下', async () => {
    const test = await harness()
    test.context.sources.registerDataSource({ apiVersion: 3, provider: 'test-provider', id: 'weather.now', read: () => ({ n: 1 }) })
    const bad = await test.send('POST', '/instance/board-first/data', JSON.stringify({ data: { n: 'x' } }))
    expect(bad.status).toBe(400)
    const health = test.context.sources.health.snapshot()
    expect(health).toHaveLength(1)
    expect(health[0]).toMatchObject({ provider: 'test-provider', registrations: 1, failures: 0, timeouts: 0 })
    expect(health[0]?.lastError).toBeUndefined()
  })

  it('卡片上存着的静态数据不合 schema 也不算提供方的失败', async () => {
    const test = await harness()
    test.context.sources.registerDataSource({ apiVersion: 3, provider: 'test-provider', id: 'weather.now', read: () => ({ n: 1 }) })
    // 直接写进看板的旧数据（例如组件换了 schema 之后留下的）：没有读取发生，不该出现在任何提供方名下。
    await test.context.workspace.save('board', (current) => ({
      ...current,
      instances: current.instances.map((instance) => ({ ...instance, data: { n: 'stale' } })),
    }), { event: () => ({ type: 'board' }) })
    const snapshot = JSON.parse((await test.send('GET', '/boards')).body) as { providers?: { registrations: number, failures: number, timeouts: number }[] }
    expect(snapshot.providers?.[0]).toMatchObject({ registrations: 1, failures: 0, timeouts: 0 })
  })
})

describe('按需读的错误语义', () => {
  /** 一张声明了按需读的卡：默认源与额外源都写在 manifest 里。 */
  const READER: WidgetRecord = {
    ...RECORD,
    manifest: {
      ...RECORD.manifest,
      source: 'test-provider:weather.now',
      sources: ['test-provider:weather.now', 'test-provider:extra'],
      capabilities: ['widget-board:data.read'],
    },
  }

  /**
   * 起一套注册了按需读能力的替身。
   *
   * @param timeoutMs - 提供方调用的默认超时；省略时用生产上的 15 秒。
   * @returns 上下文与发请求的函数。
   */
  async function readerHarness(timeoutMs?: number): Promise<Harness> {
    const test = await harness(READER, false, undefined, timeoutMs)
    registerDataRead(test.context.sources, test.context)
    return test
  }

  /**
   * 一个提供方的健康记录。
   *
   * @param test - 这一轮的替身。
   * @param provider - 提供方的包名。
   * @returns 那一条记录。
   */
  function healthOf(test: Harness, provider: string) {
    return test.context.sources.health.snapshot().find((entry) => entry.provider === provider)
  }

  it('白名单之外的源回 400 与 source-unavailable，不记到 data.read 名下', async () => {
    const test = await readerHarness()
    test.context.sources.registerDataSource({ apiVersion: 3, provider: 'test-provider', id: 'weather.now', read: () => ({ n: 1 }) })
    const response = await test.send('POST', '/instance/board-first/call', JSON.stringify({ capability: 'widget-board:data.read', args: { source: 'other:nowhere' } }))
    expect(response.status).toBe(400)
    expect(JSON.parse(response.body)).toMatchObject({ code: 'source-unavailable', source: 'other:nowhere' })
    expect(healthOf(test, 'widget-board')).toMatchObject({ provider: 'widget-board', registrations: 1, failures: 0, timeouts: 0 })
    expect(healthOf(test, 'widget-board')?.lastError).toBeUndefined()
  })

  it('数据源要授权时回 403 与 grant-required，提供方没有被调用', async () => {
    const test = await readerHarness()
    test.context.sources.registerDataSource({
      apiVersion: 3,
      provider: 'test-provider',
      id: 'weather.now',
      permission: { hosts: ['example.com'] },
      read: () => ({ n: 1 }),
    })
    const response = await test.send('POST', '/instance/board-first/call', JSON.stringify({ capability: 'widget-board:data.read' }))
    expect(response.status).toBe(403)
    expect(JSON.parse(response.body)).toMatchObject({ code: 'grant-required', kind: 'source', id: 'test-provider:weather.now' })
    expect(healthOf(test, 'test-provider')).toMatchObject({ registrations: 1, failures: 0, timeouts: 0 })
    expect(healthOf(test, 'widget-board')).toMatchObject({ failures: 0, timeouts: 0 })
  })

  it('数据不合 data schema 时按 loadData 的语义回 400，只记数据源提供方一次', async () => {
    const test = await readerHarness()
    test.context.sources.registerDataSource({ apiVersion: 3, provider: 'test-provider', id: 'weather.now', read: () => ({ n: 'x' }) })
    const response = await test.send('POST', '/instance/board-first/call', JSON.stringify({ capability: 'widget-board:data.read' }))
    expect(response.status).toBe(400)
    const error = (JSON.parse(response.body) as { error: string }).error
    expect(error).toMatch(/data schema/)
    // 同一句话只说一遍：HTTP 文案与提供方的 lastError 各自只出现一次。
    expect(timesIn(error, 'data schema 不符')).toBe(1)
    expect(timesIn(healthOf(test, 'test-provider')?.lastError ?? '', 'data schema 不符')).toBe(1)
    expect(healthOf(test, 'test-provider')).toMatchObject({ failures: 1, timeouts: 0 })
    expect(healthOf(test, 'widget-board')).toMatchObject({ failures: 0, timeouts: 0 })
    // 按需读不改写卡片：这次拒绝只回给组件。
    expect(test.context.workspace.board('board').instances[0]?.data).toBeNull()
  })

  it('数据源超时仍回 504 与 provider-timeout，不记到 data.read 名下', async () => {
    const test = await readerHarness(20)
    test.context.sources.registerDataSource({ apiVersion: 3, provider: 'test-provider', id: 'weather.now', read: () => new Promise<unknown>(() => {}) })
    const response = await test.send('POST', '/instance/board-first/call', JSON.stringify({ capability: 'widget-board:data.read' }))
    expect(response.status).toBe(504)
    expect(JSON.parse(response.body)).toMatchObject({ code: 'provider-timeout', provider: 'test-provider' })
    expect(healthOf(test, 'test-provider')).toMatchObject({ timeouts: 1, failures: 0 })
    expect(healthOf(test, 'widget-board')).toMatchObject({ timeouts: 0, failures: 0 })
  }, 5_000)

  it('提供方真的抛出异常时回 502，失败只记在它自己名下', async () => {
    const test = await readerHarness()
    test.context.sources.registerDataSource({ apiVersion: 3, provider: 'test-provider', id: 'weather.now', read: () => { throw new Error('网络断了') } })
    const response = await test.send('POST', '/instance/board-first/call', JSON.stringify({ capability: 'widget-board:data.read' }))
    expect(response.status).toBe(502)
    expect((JSON.parse(response.body) as { error: string }).error).toContain('网络断了')
    expect(healthOf(test, 'test-provider')).toMatchObject({ failures: 1, timeouts: 0 })
    expect(healthOf(test, 'test-provider')?.lastError).toBe('provider-failure：数据源 weather.now 失败：网络断了')
    // 读异常在 data.read 的读取边界已经翻成宿主拒绝：看板这一层不再记一次失败。
    expect(healthOf(test, 'widget-board')).toMatchObject({ registrations: 1, failures: 0, timeouts: 0 })
    expect(healthOf(test, 'widget-board')?.lastError).toBeUndefined()
  })
})

describe('变更通知与单卡可见性', () => {
  it('GET /events 接上长连接，先补一条重取快照的通知', async () => {
    const test = await harness()
    const response = await test.send('GET', '/events?viewer=v1')
    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toBe('text/event-stream; charset=utf-8')
    expect(response.body).toContain('"type":"board"')
  })

  it('GET /events 不带观众身份也接得上', async () => {
    const test = await harness()
    const response = await test.send('GET', '/events')
    expect(response.status).toBe(200)
    expect(test.context.live.viewers).toBe(1)
    expect(test.context.live.visible).toBe('all')
  })

  it('GET /events 的观众 id 超过 128 字符时回 400，连接不接', async () => {
    const test = await harness()
    const response = await test.send('GET', `/events?viewer=${'v'.repeat(129)}`)
    expect(response.status).toBe(400)
    expect(test.context.live.viewers).toBe(0)
  })

  it('GET /events 的观众 id 刚好 128 字符时接得上，之后的上报按这位观众记', async () => {
    const test = await harness()
    const viewer = 'v'.repeat(128)
    const events = await test.send('GET', `/events?viewer=${viewer}`)
    expect(events.status).toBe(200)
    expect(test.context.live.viewers).toBe(1)
    const posted = await test.send('POST', '/visibility', JSON.stringify({ viewer, visible: ['board-first'] }))
    expect(JSON.parse(posted.body)).toEqual({ ok: true, accepted: true })
    expect([...(test.context.live.visible as ReadonlySet<string>)]).toEqual(['board-first'])
  })

  it('GET /events 的 viewer 参数为空时按老页面算：仍然全部可见', async () => {
    const test = await harness()
    const response = await test.send('GET', '/events?viewer=')
    expect(response.status).toBe(200)
    expect(test.context.live.viewers).toBe(1)
    expect(test.context.live.visible).toBe('all')
  })

  it('POST /visibility 记下这一页看得见的卡片', async () => {
    const test = await harness()
    await test.send('GET', '/events?viewer=v1')
    const response = await test.send('POST', '/visibility', JSON.stringify({ viewer: 'v1', visible: ['board-first'] }))
    expect(response.status).toBe(200)
    expect(JSON.parse(response.body)).toEqual({ ok: true, accepted: true })
    expect([...(test.context.live.visible as ReadonlySet<string>)]).toEqual(['board-first'])
  })

  it('已经断开的观众再上报时不记', async () => {
    const test = await harness()
    const response = await test.send('POST', '/visibility', JSON.stringify({ viewer: 'ghost', visible: ['board-first'] }))
    expect(response.status).toBe(200)
    expect(JSON.parse(response.body)).toEqual({ ok: true, accepted: false })
    expect([...(test.context.live.visible as ReadonlySet<string>)]).toEqual([])
  })

  it('形状不对的上报回 400', async () => {
    const test = await harness()
    expect((await test.send('POST', '/visibility', JSON.stringify({ viewer: 'v1' }))).status).toBe(400)
    expect((await test.send('POST', '/visibility', JSON.stringify({ viewer: '', visible: [] }))).status).toBe(400)
    expect((await test.send('POST', '/visibility', JSON.stringify({ viewer: 'v1', visible: [1] }))).status).toBe(400)
    expect((await test.send('POST', '/visibility', 'not json')).status).toBe(400)
  })

  it('一次上报超过 512 个卡片 id 时回 400', async () => {
    const test = await harness()
    const visible = Array.from({ length: 513 }, (_unused, index) => `c${String(index)}`)
    const response = await test.send('POST', '/visibility', JSON.stringify({ viewer: 'v1', visible }))
    expect(response.status).toBe(400)
  })

  it('一个卡片 id 超过 128 字符时回 400', async () => {
    const test = await harness()
    const response = await test.send('POST', '/visibility', JSON.stringify({ viewer: 'v1', visible: ['c'.repeat(129)] }))
    expect(response.status).toBe(400)
  })

  it('请求体超过 16KB 时回 413', async () => {
    const test = await harness()
    // 200 个 120 字符的 id 已经超过 16KB：上限按每次请求算，不累计。
    const big = await test.send('POST', '/visibility', JSON.stringify({ viewer: 'v1', visible: Array.from({ length: 200 }, () => 'c'.repeat(120)) }))
    expect(big.status).toBe(413)
  })
})

describe('市场安装', () => {
  /** 一个装了给定 id 的市场提供方；包装成真包（manifest 的 id 与条目一致），哈希按内容算。 */
  async function marketHarness(widgetId = 'acme.weather') {
    const { packWidget, bytesOf } = await import('../src/package')
    const { createHash } = await import('node:crypto')
    const manifest = JSON.stringify({
      id: widgetId,
      title: { zh: '市场天气', en: 'Market weather' },
      version: '1.0.0',
      sizes: ['s'],
    })
    const bytes = packWidget([
      { path: 'widget.json', content: bytesOf(manifest) },
      { path: 'index.html', content: bytesOf('<p>market</p>') },
      { path: 'style.css', content: bytesOf('p{}') },
    ])
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const test = await harness()
    const { mkdir } = await import('node:fs/promises')
    await mkdir(test.context.marketDir, { recursive: true })
    test.context.market.register({
      apiVersion: 3,
      provider: 'acme-market',
      id: 'acme',
      title: { zh: 'acme 市场', en: 'Acme market' },
      list: async () => [{
        id: widgetId,
        title: { zh: '市场天气', en: 'Market weather' },
        author: { name: 'acme' },
        versions: [{ version: '1.0.0', sizes: ['s'], package: { url: 'https://example.invalid/x.dshw', sha256, bytes: bytes.byteLength } }],
      }],
      fetch: async () => bytes,
    })
    await test.context.market.refresh('acme-market')
    return test
  }

  it('装一个条目：写进市场目录并记录来源', async () => {
    const test = await marketHarness()
    const response = await test.send('POST', '/library/market/install', JSON.stringify({ provider: 'acme-market', id: 'acme.weather', version: '1.0.0' }))
    expect(response.status).toBe(201)
    const { readFile } = await import('node:fs/promises')
    const records = JSON.parse(await readFile(join(test.context.marketDir, 'sources.json'), 'utf8')) as Record<string, { provider: string, version: string }>
    expect(records['acme.weather']).toMatchObject({ provider: 'acme-market', version: '1.0.0' })
    const written = await readFile(join(test.context.marketDir, 'acme.weather', 'widget.json'), 'utf8')
    expect(JSON.parse(written).id).toBe('acme.weather')
  })

  it('哈希不符拒绝安装', async () => {
    const test = await marketHarness()
    const section = test.context.market.sections()[0]
    // 把索引里的哈希换掉：包没变，对不上就拒绝。
    section?.listings.forEach((entry) => { entry.versions[0]!.package.sha256 = 'f'.repeat(64) })
    const response = await test.send('POST', '/library/market/install', JSON.stringify({ provider: 'acme-market', id: 'acme.weather', version: '1.0.0' }))
    expect(response.status).toBe(400)
    expect(response.body).toMatch(/sha256/)
  })

  it('扁平 id 在市场 schema 里就被拒，到不了安装', async () => {
    // 市场条目必须带作者域（D8 之后的市场契约）：`weather` 这种扁平 id 在 refresh 时进 errors。
    const test = await marketHarness('weather')
    const section = test.context.market.sections()[0]
    expect(section?.listings).toEqual([])
    expect(section?.errors[0]).toMatch(/weather/)
    const response = await test.send('POST', '/library/market/install', JSON.stringify({ provider: 'acme-market', id: 'weather', version: '1.0.0' }))
    expect(response.status).toBe(404)
  })

  it('索引声明的能力不在包内 manifest 里时拒绝安装', async () => {
    const test = await marketHarness()
    const section = test.context.market.sections()[0]
    section?.listings.forEach((entry) => { entry.versions[0]!.declares = { capabilities: ['acme:not-in-package'] } })
    const response = await test.send('POST', '/library/market/install', JSON.stringify({ provider: 'acme-market', id: 'acme.weather', version: '1.0.0' }))
    expect(response.status).toBe(400)
    expect(response.body).toMatch(/对不上/)
  })

  it('请求体不是合法 JSON 时回 400', async () => {
    const test = await marketHarness()
    const response = await test.send('POST', '/library/market/install', '{不是 JSON')
    expect(response.status).toBe(400)
    expect(response.body).toMatch(/合法的 JSON/)
  })

  it('提供方的 fetch 没有返回字节时回 400', async () => {
    const test = await marketHarness()
    test.context.market.register({
      apiVersion: 3,
      provider: 'acme-broken',
      id: 'broken',
      title: { zh: '坏市场', en: 'Broken market' },
      list: async () => [{
        id: 'acme.broken',
        title: { zh: '坏包', en: 'Broken package' },
        author: { name: 'acme' },
        versions: [{ version: '1.0.0', sizes: ['s'], package: { url: 'https://example.invalid/z.dshw', sha256: 'e'.repeat(64), bytes: 4 } }],
      }],
      fetch: async () => 'nope' as unknown as Uint8Array,
    })
    await test.context.market.refresh('acme-broken')
    const response = await test.send('POST', '/library/market/install', JSON.stringify({ provider: 'acme-broken', id: 'acme.broken', version: '1.0.0' }))
    expect(response.status).toBe(400)
    expect(response.body).toMatch(/没有返回字节/)
  })

  it('市场来源里同 id 不同内容要明确的 replace', async () => {
    // 提供方手里有两个版本，fetch 按版本回包；装过 1.0.0 之后再装 1.0.1，不带 replace 是 409。
    const { packWidget, bytesOf } = await import('../src/package')
    const { createHash } = await import('node:crypto')
    const pack = (version: string, marker: string): { bytes: Uint8Array, sha256: string } => {
      const bytes = packWidget([
        { path: 'widget.json', content: bytesOf(JSON.stringify({ id: 'acme.weather', title: { zh: '市场天气', en: 'Market weather' }, version, sizes: ['s'] })) },
        { path: 'index.html', content: bytesOf(`<p>${marker}</p>`) },
        { path: 'style.css', content: bytesOf('p{}') },
      ])
      return { bytes, sha256: createHash('sha256').update(bytes).digest('hex') }
    }
    const one = pack('1.0.0', 'market')
    const two = pack('1.0.1', 'changed')
    const test = await harness()
    const { mkdir } = await import('node:fs/promises')
    await mkdir(test.context.marketDir, { recursive: true })
    test.context.market.register({
      apiVersion: 3,
      provider: 'acme-market',
      id: 'acme',
      title: { zh: 'acme 市场', en: 'Acme market' },
      list: async () => [{
        id: 'acme.weather',
        title: { zh: '市场天气', en: 'Market weather' },
        author: { name: 'acme' },
        versions: [
          { version: '1.0.0', sizes: ['s'], package: { url: 'https://example.invalid/x.dshw', sha256: one.sha256, bytes: one.bytes.byteLength } },
          { version: '1.0.1', sizes: ['s'], package: { url: 'https://example.invalid/y.dshw', sha256: two.sha256, bytes: two.bytes.byteLength } },
        ],
      }],
      fetch: async (_listing, version) => version === '1.0.1' ? two.bytes : one.bytes,
    })
    await test.context.market.refresh('acme-market')
    const first = await test.send('POST', '/library/market/install', JSON.stringify({ provider: 'acme-market', id: 'acme.weather', version: '1.0.0' }))
    expect(first.status).toBe(201)
    // 把市场来源读进 records：路由的 records 表是安装之后才认识这个组件的。
    const { readWidget } = await import('../src/library')
    test.context.records.set('acme.weather', await readWidget(join(test.context.marketDir, 'acme.weather'), { source: 'market', authorDomain: true }))
    const conflict = await test.send('POST', '/library/market/install', JSON.stringify({ provider: 'acme-market', id: 'acme.weather', version: '1.0.1' }))
    expect(conflict.status).toBe(409)
    expect(conflict.body).toMatch(/widget-conflict/)
    // 带上 replace=true 就换掉。
    const replaced = await test.send('POST', '/library/market/install', JSON.stringify({ provider: 'acme-market', id: 'acme.weather', version: '1.0.1', replace: true }))
    expect(replaced.status).toBe(201)
  })

  it('提供方不在时回 404', async () => {
    const test = await harness()
    const response = await test.send('POST', '/library/market/install', JSON.stringify({ provider: 'ghost', id: 'acme.weather', version: '1.0.0' }))
    expect(response.status).toBe(404)
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
