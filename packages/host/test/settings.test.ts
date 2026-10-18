/**
 * 卡片设置弹窗的宿主半边（D22）：设置读模型、props 校验、凭据写入与组卡换槽。
 *
 * 请求与响应沿用路由测试的最小替身；工作区落在 `.debug/` 下的临时目录，授权表与凭据服务是内存里的
 * 替身，不碰真实凭据文件。
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import type {
  Board,
  BoardEvent,
  BoardInstance,
  HostCredentials,
  HostRequest,
  HostResponse,
  WidgetManifest,
} from '@dsh-widget-board/contracts'
import { PLUGIN_ROUTE, grantKey } from '@dsh-widget-board/contracts'
import type { GrantStore } from '../src/grants'
import type { WidgetRecord } from '../src/library'
import type { RouteContext } from '../src/routes'
import { createHandler } from '../src/routes'
import { createRegistries } from '../src/sources'
import type { Registries } from '../src/sources'
import { writeBoard } from '../src/state'
import { openWorkspace } from '../src/workspace'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))

/** 一条固定哈希的组件记录。 */
function record(id: string, extra: Partial<WidgetManifest> = {}, hash = id.padEnd(64, 'a').slice(0, 64)): WidgetRecord {
  return {
    manifest: {
      id,
      title: { zh: id, en: id },
      version: '0.1.0',
      sizes: ['s'],
      ...extra,
    },
    source: 'builtin',
    dir: `/widgets/${id}`,
    hash,
    files: new Map([['index.html', Buffer.from('<p></p>')], ['style.css', Buffer.from('p{}')]]),
  }
}

/** 一张卡。 */
function card(id: string, widget: WidgetRecord, extra: Partial<BoardInstance> = {}): BoardInstance {
  return {
    id,
    widget: widget.manifest.id,
    hash: widget.hash,
    props: {},
    data: null,
    state: null,
    layout: { x: 0, y: 0, w: 1, h: 22 },
    ...extra,
  }
}

/** 一块只有给定卡片的看板。 */
function boardOf(instances: BoardInstance[]): Board {
  return { version: 2, id: 'board', title: '看板', revision: 2, layoutRevision: 5, instances }
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

/** 一条请求。 */
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

/** 内存授权表。 */
function memoryGrants(): GrantStore {
  const grants = new Map<string, ReturnType<GrantStore['all']>[number]>()
  return {
    all: () => [...grants.values()],
    has: (kind, hash, id) => grants.has(grantKey(kind, hash, id)),
    async grant(input) {
      const key = grantKey(input.kind, input.hash, input.id)
      const existing = grants.get(key)
      if (existing !== undefined) return existing
      const grant = { key, ...input, at: input.at ?? '2026-01-01T00:00:00.000Z' }
      grants.set(key, grant)
      return grant
    },
    async revoke(kind, hash, id) {
      return grants.delete(grantKey(kind, hash, id))
    },
    async forget() {
      return 0
    },
  }
}

/** 内存凭据服务：记下写入的值，供断言检查。 */
function memoryCredentials(options: { configured?: boolean, source?: string, writable?: boolean } = {}): HostCredentials & {
  writes: { kind: 'set' | 'unset', ref: string, value?: string }[]
} {
  let configured = options.configured ?? false
  let source = options.source
  const writes: { kind: 'set' | 'unset', ref: string, value?: string }[] = []
  return {
    writes,
    async describe() {
      return { configured, ...(configured && source !== undefined ? { source } : {}), writable: options.writable ?? true }
    },
    async set(ref, value) {
      writes.push({ kind: 'set', ref, value })
      configured = true
      source = 'file'
    },
    async unset(ref) {
      writes.push({ kind: 'unset', ref })
      configured = false
      source = undefined
    },
  }
}

/** 一套替身。 */
interface Harness {
  context: RouteContext
  events: BoardEvent[]
  home: string
  send(method: string, path: string, body?: string): Promise<Capture>
}

const homes: string[] = []

afterEach(async () => {
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true })
})

/**
 * 起一套路由与一块看板。
 *
 * @param options - 组件记录、卡片、凭据服务与数据源设置。
 * @returns 上下文、事件与发请求的函数。
 */
async function harness(options: {
  records: WidgetRecord[]
  instances: BoardInstance[]
  credentials?: HostCredentials
  sources?: (sources: Registries) => void
}): Promise<Harness> {
  const events: BoardEvent[] = []
  await mkdir(join(ROOT, '.debug'), { recursive: true })
  const home = await mkdtemp(join(ROOT, '.debug', 'settings-test-'))
  homes.push(home)
  await mkdir(join(home, 'boards'), { recursive: true })
  await writeBoard(join(home, 'boards', 'board.json'), boardOf(options.instances))
  await writeFile(join(home, 'boards.json'), `${JSON.stringify({ version: 1, active: 'board', boards: ['board'] })}\n`, 'utf8')
  const records = new Map(options.records.map((entry) => [entry.manifest.id, entry]))
  const sources = createRegistries()
  options.sources?.(sources)
  const workspace = await openWorkspace(home, records, (event) => { events.push(event) })
  const context: RouteContext = {
    records,
    entries: options.records.map((entry) => ({
      id: entry.manifest.id,
      source: entry.source,
      title: entry.manifest.title,
      sizes: entry.manifest.sizes,
      hash: entry.hash,
    })),
    library: { records, entries: [], errors: [] },
    roots: [{ dir: join(home, 'widgets'), source: 'user' }],
    versions: { remember: async () => undefined, get: async () => undefined },
    workspace,
    get board() { return workspace.active() },
    save: async (change, saveOptions) => await workspace.save(workspace.activeId(), change, saveOptions),
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
    ...(options.credentials === undefined ? {} : { credentials: () => options.credentials }),
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

const PROPS = {
  type: 'object',
  additionalProperties: false,
  properties: { title: { type: 'string', maxLength: 20 } },
}

describe('设置读模型', () => {
  it('带回 props schema、凭据状态、数据源与授权', async () => {
    const stat = record('stat', { props: PROPS, credentials: [{ ref: 'TEST_KEY', label: { zh: '密钥', en: 'Key' } }] })
    const credentials = memoryCredentials({ configured: true, source: 'file' })
    const test = await harness({
      records: [stat],
      instances: [card('card', stat, { props: { title: 'x' }, source: 'demo' })],
      credentials,
      sources: (sources) => {
        sources.registerDataSource({
          apiVersion: 2,
          provider: 'test-provider',
          id: 'demo',
          permission: { hosts: ['api.example'] },
          read: () => null,
        })
      },
    })
    await test.context.grants.grant({
      kind: 'source',
      hash: stat.hash,
      id: 'demo',
      widget: 'stat',
      provider: 'test-provider',
      permission: { hosts: ['api.example'] },
    })
    const response = await test.send('GET', '/instance/card/settings')
    expect(response.status).toBe(200)
    const settings = JSON.parse(response.body) as {
      widget: { propsSchema: unknown },
      source: { id: string, provider: string, granted: boolean },
      credentials: { ref: string, info: { configured: boolean, source: string } }[],
      credentialsAvailable: boolean,
    }
    expect(settings.widget.propsSchema).toEqual(PROPS)
    expect(settings.source).toMatchObject({ id: 'demo', provider: 'test-provider', granted: true })
    expect(settings.credentials[0]).toMatchObject({ ref: 'TEST_KEY', info: { configured: true, source: 'file' } })
    expect(settings.credentialsAvailable).toBe(true)
  })

  it('宿主没有凭据服务时给出可见的缺席原因', async () => {
    const stat = record('stat', { props: PROPS, credentials: [{ ref: 'TEST_KEY', label: { zh: '密钥', en: 'Key' } }] })
    const test = await harness({ records: [stat], instances: [card('card', stat)] })
    const response = await test.send('GET', '/instance/card/settings')
    const settings = JSON.parse(response.body) as { credentialsAvailable: boolean, credentials: { unavailable: string }[] }
    expect(settings.credentialsAvailable).toBe(false)
    expect(settings.credentials[0]?.unavailable).toBe('宿主没有凭据服务')
  })

  it('快照里的组件元信息标出可设置', async () => {
    const stat = record('stat', { props: PROPS })
    const plain = record('todo')
    const test = await harness({ records: [stat, plain], instances: [card('one', stat), card('two', plain)] })
    const response = await test.send('GET', '/boards')
    const snapshot = JSON.parse(response.body) as { widgets: Record<string, { settings?: boolean }> }
    expect(snapshot.widgets.stat?.settings).toBe(true)
    expect(snapshot.widgets.todo?.settings).toBeUndefined()
  })
})

describe('保存 props', () => {
  it('校验通过后写进卡片并发一条带 props 的实例事件', async () => {
    const stat = record('stat', { props: PROPS })
    const test = await harness({ records: [stat], instances: [card('card', stat, { props: { title: 'x' } })] })
    const response = await test.send('POST', '/instance/card/props', JSON.stringify({ props: { title: 'y' } }))
    expect(response.status).toBe(200)
    expect(JSON.parse(response.body)).toEqual({ props: { title: 'y' } })
    expect(test.context.workspace.active().instances[0]?.props).toEqual({ title: 'y' })
    expect(test.events.at(-1)).toEqual({ type: 'instance', id: 'card', props: { title: 'y' } })
  })

  it('schema 不符时整份拒绝，并给出字段路径', async () => {
    const stat = record('stat', { props: PROPS })
    const test = await harness({ records: [stat], instances: [card('card', stat, { props: { title: 'x' } })] })
    const response = await test.send('POST', '/instance/card/props', JSON.stringify({ props: { title: 3 } }))
    expect(response.status).toBe(400)
    const body = JSON.parse(response.body) as { issues: { path: string, message: string }[] }
    expect(body.issues.some((issue) => issue.path === '/title')).toBe(true)
    expect(test.context.workspace.active().instances[0]?.props).toEqual({ title: 'x' })
  })

  it('请求体不是对象时拒绝', async () => {
    const stat = record('stat', { props: PROPS })
    const test = await harness({ records: [stat], instances: [card('card', stat)] })
    const response = await test.send('POST', '/instance/card/props', JSON.stringify({ props: 'x' }))
    expect(response.status).toBe(400)
  })
})

describe('写凭据', () => {
  it('把值写进凭据服务，响应只回状态', async () => {
    const stat = record('stat', { credentials: [{ ref: 'TEST_KEY', label: { zh: '密钥', en: 'Key' } }] })
    const credentials = memoryCredentials()
    const test = await harness({ records: [stat], instances: [card('card', stat)], credentials })
    const response = await test.send('POST', '/instance/card/credential', JSON.stringify({ ref: 'TEST_KEY', action: 'set', value: 'sk-test' }))
    expect(response.status).toBe(200)
    expect(credentials.writes).toEqual([{ kind: 'set', ref: 'TEST_KEY', value: 'sk-test' }])
    expect(response.body).not.toContain('sk-test')
    expect(JSON.parse(response.body)).toEqual({ info: { configured: true, source: 'file', writable: true } })
  })

  it('unset 清掉一项；没声明的 ref 与空值都拒绝', async () => {
    const stat = record('stat', { credentials: [{ ref: 'TEST_KEY', label: { zh: '密钥', en: 'Key' } }] })
    const credentials = memoryCredentials({ configured: true, source: 'file' })
    const test = await harness({ records: [stat], instances: [card('card', stat)], credentials })
    const unset = await test.send('POST', '/instance/card/credential', JSON.stringify({ ref: 'TEST_KEY', action: 'unset' }))
    expect(unset.status).toBe(200)
    expect(credentials.writes.at(-1)).toEqual({ kind: 'unset', ref: 'TEST_KEY' })
    const unknown = await test.send('POST', '/instance/card/credential', JSON.stringify({ ref: 'OTHER', action: 'set', value: 'x' }))
    expect(unknown.status).toBe(400)
    const empty = await test.send('POST', '/instance/card/credential', JSON.stringify({ ref: 'TEST_KEY', action: 'set', value: ' ' }))
    expect(empty.status).toBe(400)
  })

  it('启动环境提供的凭据是只读的', async () => {
    const stat = record('stat', { credentials: [{ ref: 'TEST_KEY', label: { zh: '密钥', en: 'Key' } }] })
    const credentials = memoryCredentials({ configured: true, source: 'env', writable: false })
    const test = await harness({ records: [stat], instances: [card('card', stat)], credentials })
    const response = await test.send('POST', '/instance/card/credential', JSON.stringify({ ref: 'TEST_KEY', action: 'set', value: 'x' }))
    expect(response.status).toBe(409)
  })

  it('没有凭据服务时回 503', async () => {
    const stat = record('stat', { credentials: [{ ref: 'TEST_KEY', label: { zh: '密钥', en: 'Key' } }] })
    const test = await harness({ records: [stat], instances: [card('card', stat)] })
    const response = await test.send('POST', '/instance/card/credential', JSON.stringify({ ref: 'TEST_KEY', action: 'set', value: 'x' }))
    expect(response.status).toBe(503)
  })
})

describe('组卡换槽', () => {
  it('只换选中的槽，重置它的设置并按新的最小盒子抬整组', async () => {
    const stat = record('stat')
    const chart = record('chart')
    const todo = record('todo', { minBox: { w: 2, h: 26 } })
    const test = await harness({
      records: [stat, chart, todo],
      instances: [
        card('front', stat, { group: { id: 'group', side: 'front', template: 'flip' }, props: { title: 'x' }, data: { old: true } }),
        card('back', chart, {
          group: { id: 'group', side: 'back', template: 'flip' },
          props: { title: 'back' },
          data: { n: 1 },
          state: { open: true },
          source: 'back:source',
        }),
      ],
    })
    const response = await test.send('POST', '/group/group/slot', JSON.stringify({ side: 'front', widget: 'todo' }))
    expect(response.status).toBe(200)
    const instances = test.context.workspace.active().instances
    const front = instances.find((instance) => instance.id === 'front')
    const back = instances.find((instance) => instance.id === 'back')
    expect(front).toMatchObject({ widget: 'todo', props: {}, data: null, state: null, layout: { w: 2, h: 26 } })
    expect(back).toMatchObject({
      widget: 'chart',
      props: { title: 'back' },
      data: { n: 1 },
      state: { open: true },
      source: 'back:source',
      layout: { w: 2, h: 26 },
    })
    expect(front?.source).toBeUndefined()
  })

  it('坏侧别、缺组与缺组件都拒绝', async () => {
    const stat = record('stat')
    const chart = record('chart')
    const test = await harness({
      records: [stat, chart],
      instances: [
        card('front', stat, { group: { id: 'group', side: 'front', template: 'flip' } }),
        card('back', chart, { group: { id: 'group', side: 'back', template: 'flip' } }),
      ],
    })
    expect((await test.send('POST', '/group/group/slot', JSON.stringify({ side: 'side', widget: 'stat' }))).status).toBe(400)
    expect((await test.send('POST', '/group/missing/slot', JSON.stringify({ side: 'front', widget: 'stat' }))).status).toBe(404)
    expect((await test.send('POST', '/group/group/slot', JSON.stringify({ side: 'front', widget: 'missing' }))).status).toBe(400)
  })
})

describe('宿主能力', () => {
  it('设置读模型列出能力、授权状态与能力声明的凭据', async () => {
    const stat = record('stat', { capabilities: ['test.echo'] })
    const test = await harness({
      records: [stat],
      instances: [card('card', stat)],
      credentials: memoryCredentials(),
      sources: (sources) => {
        sources.registerCapability({
          apiVersion: 3,
          provider: 'test-provider',
          id: 'test.echo',
          title: { zh: '回声', en: 'Echo' },
          permission: {},
          credentials: [{ ref: 'TEST_KEY', label: { zh: '密钥', en: 'Key' } }],
          call: () => ({ ok: true }),
        })
      },
    })
    const response = await test.send('GET', '/instance/card/settings')
    expect(response.status).toBe(200)
    const settings = JSON.parse(response.body) as {
      capabilities: { id: string, provider: string, title: { zh: string }, granted: boolean }[],
      credentials: { ref: string }[],
    }
    expect(settings.capabilities[0]).toMatchObject({ id: 'test.echo', provider: 'test-provider', title: { zh: '回声' }, granted: false })
    expect(settings.credentials.some((entry) => entry.ref === 'TEST_KEY')).toBe(true)
    const grant = await test.send('POST', '/instance/card/grant', JSON.stringify({ kind: 'capability', id: 'test.echo' }))
    expect(grant.status).toBe(200)
    const after = await test.send('GET', '/instance/card/settings')
    expect((JSON.parse(after.body) as { capabilities: { granted: boolean }[] }).capabilities[0]?.granted).toBe(true)
  })

  it('调用能力：先要授权，再校验参数与结果', async () => {
    const stat = record('stat', { capabilities: ['test.echo'] })
    const seen: unknown[] = []
    const test = await harness({
      records: [stat],
      instances: [card('card', stat)],
      sources: (sources) => {
        sources.registerCapability({
          apiVersion: 3,
          provider: 'test-provider',
          id: 'test.echo',
          permission: {},
          input: { type: 'object', required: ['n'], properties: { n: { type: 'number' } } },
          output: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } },
          call: (_instance, args) => { seen.push(args); return { ok: true } },
        })
      },
    })
    const blocked = await test.send('POST', '/instance/card/call', JSON.stringify({ capability: 'test.echo', args: { n: 1 } }))
    expect(blocked.status).toBe(403)
    expect(JSON.parse(blocked.body)).toMatchObject({ code: 'grant-required', kind: 'capability', id: 'test.echo' })
    await test.send('POST', '/instance/card/grant', JSON.stringify({ kind: 'capability', id: 'test.echo' }))
    const wrong = await test.send('POST', '/instance/card/call', JSON.stringify({ capability: 'test.echo', args: {} }))
    expect(wrong.status).toBe(400)
    expect((JSON.parse(wrong.body) as { issues: unknown[] }).issues.length).toBeGreaterThan(0)
    const ok = await test.send('POST', '/instance/card/call', JSON.stringify({ capability: 'test.echo', args: { n: 2 } }))
    expect(ok.status).toBe(200)
    expect(JSON.parse(ok.body)).toEqual({ result: { ok: true } })
    expect(seen).toEqual([{ n: 2 }])
  })

  it('没声明、没提供方与结果不符都拒绝', async () => {
    const stat = record('stat', { capabilities: ['test.echo'] })
    const plain = record('plain')
    const test = await harness({
      records: [stat, plain],
      instances: [card('card', stat), card('other', plain)],
      sources: (sources) => {
        sources.registerCapability({
          apiVersion: 3,
          provider: 'test-provider',
          id: 'test.echo',
          output: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } },
          call: () => ({ ok: 'nope' }),
        })
      },
    })
    expect((await test.send('POST', '/instance/other/call', JSON.stringify({ capability: 'test.echo', args: {} }))).status).toBe(400)
    expect((await test.send('POST', '/instance/card/call', JSON.stringify({ capability: 'test.missing', args: {} }))).status).toBe(400)
    const bad = await test.send('POST', '/instance/card/call', JSON.stringify({ capability: 'test.echo', args: {} }))
    expect(bad.status).toBe(502)
    expect((JSON.parse(bad.body) as { issues: unknown[] }).issues.length).toBeGreaterThan(0)
  })
})
