/**
 * 人工内容写入的两条路由（技术契约 3、C05—C07）：一次创建整张卡片、按读到的修订号编辑内容。
 *
 * 请求与响应用最小的替身，工作区用真的那一份落在 `.debug/` 下：schema 校验、字节额度与落盘一起被
 * 测到。这一层判定的是本插件的行为，不是宿主的实现。
 */
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import type { Board, BoardEvent, BoardInstance, HostRequest, HostResponse, WidgetLibraryEntry } from '@dsh-widget-board/contracts'
import { PLUGIN_ROUTE } from '@dsh-widget-board/contracts'
import type { RouteContext } from '../src/routes'
import { createHandler } from '../src/routes'
import { createVersionStore } from '../src/blobs'
import { openGrants } from '../src/grants'
import type { WidgetRecord } from '../src/library'
import { createLive } from '../src/live'
import { createRequestLog } from '../src/request-log'
import { createSelfChecks } from '../src/selfcheck'
import { createRegistries } from '../src/sources'
import { writeBoard } from '../src/state'
import { openWorkspace } from '../src/workspace'
import { BOARD_STATE_WRITES_PER_SECOND, STATE_WRITES_PER_SECOND, createRateLimiter } from '../src/limits'
import { openDrafts } from '../src/drafts/store'
import { createPreviews } from '../src/preview/store'
import { contentHash } from '../src/library'
import { boardFromPackage, validateBoardPackage } from '../src/media/board-package'
import { packBoard, unpackBoard } from '../src/package'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))

/** 一个版本固定的组件：两个 props 字段与一个 data 字段，创建器与编辑器都按它核对。 */
const HASH = 'a'.repeat(64)
const RECORD: WidgetRecord = {
  manifest: {
    id: 'weather',
    title: { zh: '天气', en: 'Weather' },
    version: '0.1.0',
    sizes: ['s'],
    props: {
      type: 'object',
      required: ['city', 'unit'],
      properties: { city: { type: 'string' }, unit: { type: 'string', enum: ['c', 'f'] } },
    },
    data: { type: 'object', required: ['text'], properties: { text: { type: 'string' } } },
    // 状态也声明了形状：待办这类把内容存进状态的组件，人的界面与组件自己写时走同一条判定。
    state: { type: 'object', required: ['tab'], properties: { tab: { type: 'number' } } },
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
 * 一块两张卡的看板。
 *
 * @returns 两张卡都带着内容，编辑其中一张时另一张能逐字节比对。
 */
function board(): Board {
  return {
    version: 2,
    id: 'board',
    title: '看板',
    revision: 2,
    layoutRevision: 5,
    instances: [
      { id: 'board-first', widget: 'weather', hash: HASH, props: { city: '上海', unit: 'c' }, data: { text: '晴' }, state: { tab: 1 }, layout: { x: 0, y: 0, w: 1, h: 22 } },
      { id: 'board-second', widget: 'weather', hash: HASH, props: { city: '北京', unit: 'f' }, data: { text: '雨' }, state: { tab: 2 }, layout: { x: 1, y: 0, w: 1, h: 22 } },
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
 * @returns 宿主的请求。
 */
function request(method: string, path: string, body?: string): HostRequest {
  return {
    method,
    url: `${PLUGIN_ROUTE}${path}`,
    headers: { host: '127.0.0.1:3080' },
    socket: { remoteAddress: '127.0.0.1' },
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
  send(method: string, path: string, body?: string): Promise<Capture>
}

/** 这一轮起的临时目录，测试结束一并删掉。 */
const homes: string[] = []

afterEach(async () => {
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true })
})

/**
 * 从磁盘读回这块看板。
 *
 * @param home - 这一次的临时工作区。
 * @returns `boards/board.json` 里的那一份。
 */
async function storedBoard(home: string): Promise<Board> {
  return JSON.parse(await readFile(join(home, 'boards', 'board.json'), 'utf8')) as Board
}

/**
 * 起一套替身：`.debug/` 下写一份索引与一块看板，再打开工作区。
 *
 * @param overrides - 想换掉那块看板时给一份自己的；缺省是两张内容齐全的卡。
 * @returns 上下文、推出去的事件、临时目录与发请求的函数。
 */
async function harness(overrides: { board?: Board } = {}): Promise<Harness> {
  const events: BoardEvent[] = []
  await mkdir(join(ROOT, '.debug'), { recursive: true })
  const home = await mkdtemp(join(ROOT, '.debug', 'content-test-'))
  homes.push(home)
  await mkdir(join(home, 'boards'), { recursive: true })
  await writeBoard(join(home, 'boards', 'board.json'), overrides.board ?? board())
  await writeFile(join(home, 'boards.json'), `${JSON.stringify({ version: 1, active: 'board', boards: ['board'] })}\n`, 'utf8')
  const records = new Map([[RECORD.manifest.id, RECORD]])
  const workspace = await openWorkspace(home, records, (event) => { events.push(event) })
  const grants = await openGrants(join(home, 'grants.json'))
  // 内容路由只用到组件库、工作区、授权表与它们的真实现；其余上下文成员照真实宿主装配，免得替身与
  // 生产形状分叉。
  const context: RouteContext = {
    records,
    entries: ENTRIES,
    library: { records, entries: ENTRIES, errors: [] },
    roots: [],
    versions: createVersionStore(join(home, 'blobs')),
    workspace,
    get board() { return workspace.active() },
    save: async (change, options) => await workspace.save(workspace.activeId(), change, options),
    live: createLive({ tokensCss: '', suiteCss: '', runtimeJs: '', libs: {} }),
    connection: undefined,
    refresh: async () => undefined,
    sources: createRegistries(),
    grants,
    limits: {
      stateCard: createRateLimiter(STATE_WRITES_PER_SECOND),
      stateBoard: createRateLimiter(BOARD_STATE_WRITES_PER_SECOND),
    },
    selfChecks: createSelfChecks(),
    requests: createRequestLog(),
    drafts: openDrafts(join(home, 'drafts')),
    previews: createPreviews(),
  }
  const handler = createHandler(context)
  return {
    context,
    events,
    home,
    async send(method, path, body) {
      const response = new Capture()
      await handler(request(method, path, body), response)
      return response
    },
  }
}

describe('创建完整卡片', () => {
  it('并发创建按保存队列内的全板状态总量拒绝超额写入', async () => {
    const initial = board()
    initial.instances = Array.from({ length: 15 }, (_, index) => ({ ...initial.instances[0]!, id: `existing-${index}`, state: { tab: 1, padding: 'x'.repeat(65400) } }))
    const test = await harness({ board: initial })
    const body = JSON.stringify({ widget: 'weather', props: { city: '上海', unit: 'c' }, data: null, state: { tab: 1, padding: 'x'.repeat(39900) } })
    const replies = await Promise.all([test.send('POST', '/boards/board/compose', body), test.send('POST', '/boards/board/compose', body)])
    expect(replies.map(reply => reply.status).sort()).toEqual([201, 413])
    const stored = await storedBoard(test.home)
    expect(stored.instances).toHaveLength(16)
    expect(stored.instances.reduce((total, instance) => total + Buffer.byteLength(JSON.stringify(instance.state)), 0)).toBeLessThanOrEqual(1024 * 1024)
  })

  it('创建器立即维护整齐偏好，无需重启补全', async () => {
    const current = board()
    current.version = 3
    current.arrangement = { mode: 'aligned', aligned: { order: ['board-first', 'board-second'], boxes: { 'board-first': { w: 1, h: 22 }, 'board-second': { w: 1, h: 22 } } } }
    const test = await harness({ board: current })
    const response = await test.send('POST', '/boards/board/compose', JSON.stringify({ widget: 'weather', props: { city: '上海', unit: 'c' }, data: null, state: null }))
    expect(response.status).toBe(201)
    const id = JSON.parse(response.body).id as string
    const stored = await storedBoard(test.home)
    expect(stored.arrangement?.aligned?.order).toEqual(['board-first', 'board-second', id])
    expect(stored.arrangement?.aligned?.boxes[id]).toEqual({ w: 1, h: 22 })
  })

  it('翻面组的整齐排列包校验及新id重映射往返', async () => {
    const test = await harness()
    const files = new Map(RECORD.files)
    files.set('widget.json', Buffer.from(JSON.stringify(RECORD.manifest)))
    const widget = { manifest: RECORD.manifest, hash: contentHash(files), files: Object.fromEntries([...files].map(([path, bytes]) => [path, bytes.toString('base64')])) }
    const cards = ['front', 'back'].map(side => ({ id: side, widget: 'weather', props: { city: '上海', unit: 'c' }, layout: { x: 0, y: 0, w: 1, h: 22 }, group: { id: 'group', side: side as 'front' | 'back', template: 'flip' as const } }))
    const pkg = unpackBoard(packBoard('组卡备份', cards, [widget], { arrangement: { mode: 'aligned', aligned: { order: ['front'], boxes: { front: { w: 1, h: 22 } } } } }))
    const validated = await validateBoardPackage(test.context, pkg)
    const restored = boardFromPackage({ ...board(), instances: [] }, pkg, validated.records)
    expect(restored.instances).toHaveLength(2)
    expect(restored.instances[0]?.group?.id).toBe(restored.instances[1]?.group?.id)
    expect(restored.instances[0]?.group?.id).not.toBe('group')
    expect(restored.arrangement?.aligned?.order).toEqual([restored.instances[0]?.id])
    const invalid = { ...pkg, arrangement: { mode: 'aligned' as const, aligned: { order: ['group'], boxes: { group: { w: 1, h: 22 } } } } }
    await expect(validateBoardPackage(test.context, invalid)).rejects.toThrow('排列引用不完整')
  })

  it('一次写进 props、data、state 与盒子：回 201、新 id 与快照，磁盘上读得到这张卡', async () => {
    const test = await harness()
    const response = await test.send('POST', '/boards/board/compose', JSON.stringify({
      widget: 'weather',
      props: { city: '上海', unit: 'c' },
      data: { text: '晴' },
      state: { tab: 1 },
      layout: { x: 1, y: 4, w: 2, h: 14 },
    }))
    expect(response.status).toBe(201)
    const body = JSON.parse(response.body) as { id: string, snapshot: { boards: Board[] } }
    expect(typeof body.id).toBe('string')
    expect(body.snapshot.boards[0]?.instances).toHaveLength(3)
    expect(body.snapshot.boards[0]?.instances.at(-1)?.id).toBe(body.id)
    const stored = await storedBoard(test.home)
    expect(stored.instances.map((instance) => instance.id)).toContain(body.id)
    expect(stored.instances.find((instance) => instance.id === body.id)).toMatchObject({
      widget: 'weather',
      hash: HASH,
      props: { city: '上海', unit: 'c' },
      data: { text: '晴' },
      state: { tab: 1 },
      layout: { x: 1, y: 4, w: 2, h: 14 },
    })
    expect(test.events.at(-1)).toEqual({ type: 'board' })
  })

  it('props 与 schema 不符时回 400 与逐字段原因，看板上不多出卡片', async () => {
    const test = await harness()
    const response = await test.send('POST', '/boards/board/compose', JSON.stringify({
      widget: 'weather',
      props: { city: 7, unit: 'c' },
      data: { text: '晴' },
    }))
    expect(response.status).toBe(400)
    const body = JSON.parse(response.body) as { issues: { path: string, message: string }[] }
    expect(body.issues.length).toBeGreaterThan(0)
    expect(body.issues.map((issue) => issue.path)).toContain('/city')
    expect((await storedBoard(test.home)).instances).toHaveLength(2)
    expect(test.context.workspace.board('board').instances).toHaveLength(2)
  })

  it('组件库里没有这个组件时回 400', async () => {
    const response = await (await harness()).send('POST', '/boards/board/compose', JSON.stringify({ widget: 'nope' }))
    expect(response.status).toBe(400)
  })

  it('expectedHash 与库里的版本不一致时回 409', async () => {
    const response = await (await harness()).send('POST', '/boards/board/compose', JSON.stringify({
      widget: 'weather',
      expectedHash: 'b'.repeat(64),
    }))
    expect(response.status).toBe(409)
    expect(JSON.parse(response.body).code).toBe('stale-hash')
  })

  it('state 与组件的 state schema 不符时回 400，看板文件一个字节都不变', async () => {
    const test = await harness()
    const before = await readFile(join(test.home, 'boards', 'board.json'), 'utf8')
    const response = await test.send('POST', '/boards/board/compose', JSON.stringify({
      widget: 'weather',
      props: { city: '上海', unit: 'c' },
      data: { text: '晴' },
      state: { tab: '不是数字' },
    }))
    expect(response.status).toBe(400)
    expect(JSON.parse(response.body).subject).toBe('state')
    expect(await readFile(join(test.home, 'boards', 'board.json'), 'utf8')).toBe(before)
  })

  it('state 超过单卡额度时回 413，看板文件一个字节都不变', async () => {
    const test = await harness()
    const before = await readFile(join(test.home, 'boards', 'board.json'), 'utf8')
    const response = await test.send('POST', '/boards/board/compose', JSON.stringify({
      widget: 'weather',
      props: { city: '上海', unit: 'c' },
      data: { text: '晴' },
      // 形状先合规，再撞单卡额度：两道判定的先后要分开测。
      state: { tab: 1, blob: 'x'.repeat(65 * 1024) },
    }))
    expect(response.status).toBe(413)
    expect(JSON.parse(response.body).code).toBe('state-too-large')
    expect(await readFile(join(test.home, 'boards', 'board.json'), 'utf8')).toBe(before)
  })
})

describe('编辑实例内容', () => {
  it('读到的修订号再提交：回新修订号与落盘的值，同看板其它卡片一个字节都不变', async () => {
    const test = await harness()
    const model = JSON.parse((await test.send('GET', '/instance/board-first/content')).body) as {
      instance: BoardInstance
      revision: number
      widget: { id: string, propsSchema?: Record<string, unknown>, dataSchema?: Record<string, unknown> }
    }
    expect(model.instance).toMatchObject({
      id: 'board-first',
      widget: 'weather',
      props: { city: '上海', unit: 'c' },
      data: { text: '晴' },
      state: { tab: 1 },
    })
    expect(model.revision).toBe(2)
    expect(model.widget.id).toBe('weather')
    expect(model.widget.propsSchema).toEqual(RECORD.manifest.props)
    expect(model.widget.dataSchema).toEqual(RECORD.manifest.data)

    const before = await storedBoard(test.home)
    const othersBefore = JSON.stringify(before.instances.filter((instance) => instance.id !== 'board-first'))
    const response = await test.send('POST', '/instance/board-first/content', JSON.stringify({
      expectedRevision: model.revision,
      props: { city: '广州', unit: 'c' },
      state: { tab: 9 },
    }))
    expect(response.status).toBe(200)
    const saved = JSON.parse(response.body) as { revision: number, props: unknown, data: unknown, state: unknown }
    expect(saved.revision).toBe(model.revision + 1)
    expect(saved.props).toEqual({ city: '广州', unit: 'c' })
    expect(saved.state).toEqual({ tab: 9 })

    const after = await storedBoard(test.home)
    expect(after.instances.filter((instance) => instance.id !== 'board-first')).toEqual(before.instances.filter((instance) => instance.id !== 'board-first'))
    expect(JSON.stringify(after.instances.filter((instance) => instance.id !== 'board-first'))).toBe(othersBefore)
    const edited = after.instances.find((instance) => instance.id === 'board-first')
    expect(edited?.props).toEqual({ city: '广州', unit: 'c' })
    expect(edited?.state).toEqual({ tab: 9 })
    expect(edited?.data).toEqual(before.instances[0]?.data)
    expect(edited?.layout).toEqual(before.instances[0]?.layout)
    expect(after.revision).toBe(3)
  })

  it('老卡片上 state 与 data 还是 null 时，只改 props 不被组件自己的 schema 挡住', async () => {
    // `/instance` 建出来的卡初值就是 null（state.ts 的 instanceOf）；null 只说明「还没填过」，
    // 不该按组件当前的 schema 判为不符——否则旧卡连一次普通的 props 编辑都做不了。
    const nullBoard = board()
    nullBoard.instances = [{ id: 'null-card', widget: 'weather', hash: HASH, props: {}, data: null, state: null, layout: { x: 0, y: 0, w: 1, h: 22 } }]
    const test = await harness({ board: nullBoard })
    const read = await test.send('GET', '/instance/null-card/content')
    const revision = (JSON.parse(read.body) as { revision: number }).revision
    const response = await test.send('POST', '/instance/null-card/content', JSON.stringify({
      expectedRevision: revision,
      props: { city: '广州', unit: 'c' },
    }))
    expect(response.status).toBe(200)
    const saved = JSON.parse(response.body) as { revision: number, props: unknown, state: unknown }
    expect(saved.props).toEqual({ city: '广州', unit: 'c' })
    expect(saved.state).toBeNull()
  })

  it('老卡片上 state 与 data 还是 null 时，只改 props 不被组件自己的 schema 挡住', async () => {
    // `/instance` 建出来的卡初值就是 null（state.ts 的 instanceOf）；null 只说明「还没填过」，
    // 不该按组件当前的 schema 判为不符——否则旧卡连一次普通的 props 编辑都做不了。
    const nullBoard = board()
    nullBoard.instances = [{ id: 'null-card', widget: 'weather', hash: HASH, props: {}, data: null, state: null, layout: { x: 0, y: 0, w: 1, h: 22 } }]
    const test = await harness({ board: nullBoard })
    const read = await test.send('GET', '/instance/null-card/content')
    const revision = (JSON.parse(read.body) as { revision: number }).revision
    const response = await test.send('POST', '/instance/null-card/content', JSON.stringify({
      expectedRevision: revision,
      props: { city: '广州', unit: 'c' },
    }))
    expect(response.status).toBe(200)
    const saved = JSON.parse(response.body) as { revision: number, props: unknown, state: unknown }
    expect(saved.props).toEqual({ city: '广州', unit: 'c' })
    expect(saved.state).toBeNull()
  })

  it('修订号过期时回 409、当前修订号与快照，磁盘上仍是原来的内容', async () => {
    const test = await harness()
    const before = await storedBoard(test.home)
    const response = await test.send('POST', '/instance/board-first/content', JSON.stringify({
      expectedRevision: 0,
      props: { city: '广州', unit: 'c' },
    }))
    expect(response.status).toBe(409)
    const body = JSON.parse(response.body) as { code: string, revision: number, snapshot: { boards: Board[] } }
    expect(body.code).toBe('stale-revision')
    expect(body.revision).toBe(2)
    expect(body.snapshot.boards[0]?.instances).toHaveLength(2)
    expect((await storedBoard(test.home)).instances).toEqual(before.instances)
  })

  it('改 state 时同样按 state schema 校验：不符回 400，磁盘不变', async () => {
    const test = await harness()
    const read = await test.send('GET', '/instance/board-first/content')
    const revision = (JSON.parse(read.body) as { revision: number }).revision
    const before = await readFile(join(test.home, 'boards', 'board.json'), 'utf8')
    const response = await test.send('POST', '/instance/board-first/content', JSON.stringify({ expectedRevision: revision, state: { tab: '还是不是数字' } }))
    expect(response.status).toBe(400)
    expect(JSON.parse(response.body).subject).toBe('state')
    expect(await readFile(join(test.home, 'boards', 'board.json'), 'utf8')).toBe(before)
  })

  it('props 与 schema 不符时回 400 与原因，磁盘内容不变', async () => {
    const test = await harness()
    const before = await readFile(join(test.home, 'boards', 'board.json'), 'utf8')
    const response = await test.send('POST', '/instance/board-first/content', JSON.stringify({
      expectedRevision: 2,
      props: { city: '上海', unit: 'k' },
    }))
    expect(response.status).toBe(400)
    const body = JSON.parse(response.body) as { issues: { path: string }[] }
    expect(body.issues.map((issue) => issue.path)).toContain('/unit')
    expect(await readFile(join(test.home, 'boards', 'board.json'), 'utf8')).toBe(before)
  })

  it('看板上没有这张卡时回 404', async () => {
    const response = await (await harness()).send('POST', '/instance/missing/content', JSON.stringify({
      expectedRevision: 2,
      props: { city: '上海', unit: 'c' },
    }))
    expect(response.status).toBe(404)
  })

  it('没带 expectedRevision 时回 400', async () => {
    const response = await (await harness()).send('POST', '/instance/board-first/content', JSON.stringify({
      props: { city: '上海', unit: 'c' },
    }))
    expect(response.status).toBe(400)
  })
})
