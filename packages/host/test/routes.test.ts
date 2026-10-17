/**
 * 路由表（D1、D3、D17）：方法、状态码、请求体上限与每条路由做的事。
 *
 * 请求与响应用最小的替身：宿主的 `HostRequest` 只被读方法、地址、请求头与请求体，`HostResponse`
 * 只被写状态、头与体。这一层判定的是本插件的行为，不是宿主的实现。
 */
import { describe, expect, it } from 'vitest'
import type { Board, BoardEvent, HostRequest, HostResponse, WidgetLibraryEntry } from '@dsh-widget-board/contracts'
import { PLUGIN_ROUTE } from '@dsh-widget-board/contracts'
import type { RouteContext } from '../src/routes'
import { createHandler } from '../src/routes'
import type { WidgetRecord } from '../src/library'
import { createRegistries } from '../src/sources'
import { StaleRevisionError } from '../src/state'

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
function board(): Board {
  return {
    version: 1,
    id: 'board',
    title: '看板',
    revision: 2,
    layoutRevision: 5,
    instances: [
      { id: 'first', widget: 'weather', hash: HASH, props: {}, data: null, state: null, layout: { x: 0, y: 0, w: 1, h: 22 } },
      { id: 'second', widget: 'weather', hash: HASH, props: {}, data: null, state: null, layout: { x: 1, y: 0, w: 1, h: 22 } },
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
  send(method: string, path: string, body?: string, remote?: string): Promise<Capture>
}

/**
 * 起一套替身。
 *
 * @returns 上下文、推出去的事件与发请求的函数。
 */
function harness(): Harness {
  const events: BoardEvent[] = []
  const sources = createRegistries()
  const context: RouteContext = {
    records: new Map([['weather', RECORD]]),
    entries: ENTRIES,
    versions: {
      remember: async () => undefined,
      get: async (hash: string) => (hash === HASH ? RECORD : undefined),
    },
    board: board(),
    save: async (change, options) => {
      const current = context.board
      if (options.expectedLayoutRevision !== undefined && options.expectedLayoutRevision !== current.layoutRevision) {
        throw new StaleRevisionError(options.expectedLayoutRevision, current.layoutRevision)
      }
      const next = {
        ...change(current),
        revision: current.revision + 1,
        layoutRevision: current.layoutRevision + (options.layoutChanged === true ? 1 : 0),
      }
      context.board = next
      events.push(options.event(next))
      return next
    },
    live: {
      assets: { tokensCss: '', suiteCss: '', runtimeJs: '' },
      revision: 0,
      subscribe: () => undefined,
      publish: () => undefined,
      notify: (event) => { events.push(event) },
      close: () => undefined,
    },
    connection: undefined,
    sources,
  }
  const handler = createHandler(context)
  return {
    context,
    events,
    async send(method, path, body, remote) {
      const response = new Capture()
      await handler(request(method, path, body, remote), response)
      return response
    },
  }
}

describe('看板快照', () => {
  it('GET /board 回看板、组件元信息与整个组件库', async () => {
    const test = harness()
    const response = await test.send('GET', '/board')
    expect(response.status).toBe(200)
    const body = JSON.parse(response.body) as { board: Board, widgets: Record<string, { source: string }>, library: WidgetLibraryEntry[] }
    expect(body.board.instances).toHaveLength(2)
    expect(body.widgets.weather?.source).toBe('builtin')
    expect(body.library).toHaveLength(1)
  })

  it('方法不对时回 405 并给出允许的方法', async () => {
    const test = harness()
    const response = await test.send('POST', '/board')
    expect(response.status).toBe(405)
    expect(response.headers.allow).toBe('GET')
  })

  it('没有这条路径时回 404', async () => {
    const response = await harness().send('GET', '/nope')
    expect(response.status).toBe(404)
  })

  it('不是本机来的请求被拒绝', async () => {
    const response = await harness().send('GET', '/board', undefined, '10.0.0.5')
    expect(response.status).toBe(403)
  })
})

describe('布局提交', () => {
  it('修订号过期时回 409 与当前快照', async () => {
    const test = harness()
    const response = await test.send('POST', '/board/layout', JSON.stringify({ layoutRevision: 4, layouts: { first: { x: 0, y: 30, w: 1, h: 10 } } }))
    expect(response.status).toBe(409)
    const body = JSON.parse(response.body) as { board: Board }
    expect(body.board.layoutRevision).toBe(5)
  })

  it('提交成功时布局修订号加一，并推出布局事件', async () => {
    const test = harness()
    const layouts = { first: { x: 0, y: 30, w: 2, h: 10 } }
    const response = await test.send('POST', '/board/layout', JSON.stringify({ layoutRevision: 5, layouts }))
    expect(response.status).toBe(200)
    expect(test.context.board.layoutRevision).toBe(6)
    expect(test.context.board.instances[0]?.layout).toEqual(layouts.first)
    expect(test.events.at(-1)).toEqual({ type: 'layout', layoutRevision: 6, layouts })
  })

  it('形状不对时回 400', async () => {
    const response = await harness().send('POST', '/board/layout', JSON.stringify({ layouts: {} }))
    expect(response.status).toBe(400)
  })
})

describe('卡片状态与数据', () => {
  it('状态写入推出这条卡的事件，不改布局修订号', async () => {
    const test = harness()
    const response = await test.send('POST', '/instance/first/state', JSON.stringify({ patch: { n: 1 } }))
    expect(response.status).toBe(200)
    expect(test.context.board.layoutRevision).toBe(5)
    expect(test.context.board.instances[0]?.state).toEqual({ n: 1 })
    expect(test.events.at(-1)).toEqual({ type: 'instance', id: 'first', state: { n: 1 } })
  })

  it('看板上没有这张卡时回 404', async () => {
    const response = await harness().send('POST', '/instance/missing/state', JSON.stringify({ patch: {} }))
    expect(response.status).toBe(404)
  })

  it('没有 patch 字段时回 400', async () => {
    const response = await harness().send('POST', '/instance/first/state', JSON.stringify({ value: 1 }))
    expect(response.status).toBe(400)
  })

  it('请求体超过上限时回 413', async () => {
    const big = JSON.stringify({ patch: { text: 'x'.repeat(20 * 1024) } })
    const response = await harness().send('POST', '/instance/first/state', big)
    expect(response.status).toBe(413)
  })

  it('数据按组件的 data schema 校验', async () => {
    const bad = await harness().send('POST', '/instance/first/data', JSON.stringify({ data: { n: 'x' } }))
    expect(bad.status).toBe(400)
    const good = harness()
    const ok = await good.send('POST', '/instance/first/data', JSON.stringify({ data: { n: 1 } }))
    expect(ok.status).toBe(200)
    expect(good.events.at(-1)).toEqual({ type: 'instance', id: 'first', data: { n: 1 } })
  })
})

describe('加卡片与移除卡片', () => {
  it('加卡片回 201，快照里多一张，布局修订号加一', async () => {
    const test = harness()
    const response = await test.send('POST', '/board/instance', JSON.stringify({ widget: 'weather' }))
    expect(response.status).toBe(201)
    const body = JSON.parse(response.body) as { id: string, snapshot: { board: Board } }
    expect(body.snapshot.board.instances).toHaveLength(3)
    expect(body.snapshot.board.instances.at(-1)?.id).toBe(body.id)
    expect(test.context.board.layoutRevision).toBe(6)
    expect(test.events[0]).toEqual({ type: 'board' })
  })

  it('组件库没有这个组件时回 400', async () => {
    const response = await harness().send('POST', '/board/instance', JSON.stringify({ widget: 'nope' }))
    expect(response.status).toBe(400)
  })

  it('数据源不存在时回 400', async () => {
    const response = await harness().send('POST', '/board/instance', JSON.stringify({ widget: 'weather', source: 'ghost' }))
    expect(response.status).toBe(400)
  })

  it('绑定数据源时读一次并把数据写进卡片', async () => {
    const test = harness()
    test.context.sources.registerDataSource({ apiVersion: 1, id: 'weather.now', read: () => ({ n: 7 }) })
    const response = await test.send('POST', '/board/instance', JSON.stringify({ widget: 'weather', source: 'weather.now' }))
    expect(response.status).toBe(201)
    const created = test.context.board.instances.at(-1)
    expect(created?.source).toBe('weather.now')
    expect(created?.data).toEqual({ n: 7 })
  })

  it('请求没指定数据源时用组件声明的那个', async () => {
    const test = harness()
    test.context.records.set('weather', { ...RECORD, manifest: { ...RECORD.manifest, source: 'weather.now' } })
    test.context.sources.registerDataSource({ apiVersion: 1, id: 'weather.now', read: () => ({ n: 9 }) })
    const response = await test.send('POST', '/board/instance', JSON.stringify({ widget: 'weather' }))
    expect(response.status).toBe(201)
    expect(test.context.board.instances.at(-1)?.data).toEqual({ n: 9 })
  })

  it('组件声明的数据源不在时卡片照样加得进来，数据留空', async () => {
    const test = harness()
    test.context.records.set('weather', { ...RECORD, manifest: { ...RECORD.manifest, source: 'gone.source' } })
    const response = await test.send('POST', '/board/instance', JSON.stringify({ widget: 'weather' }))
    expect(response.status).toBe(201)
    expect(test.context.board.instances.at(-1)?.source).toBe('gone.source')
    expect(test.context.board.instances.at(-1)?.data).toBeNull()
  })

  it('移除卡片回快照，布局修订号加一', async () => {
    const test = harness()
    const response = await test.send('POST', '/instance/first/remove')
    expect(response.status).toBe(200)
    expect(test.context.board.instances.map((instance) => instance.id)).toEqual(['second'])
    expect(test.context.board.layoutRevision).toBe(6)
  })
})

describe('动作', () => {
  it('manifest 声明过的动作交给注册的动作执行', async () => {
    const test = harness()
    test.context.records.set('weather', { ...RECORD, manifest: { ...RECORD.manifest, actions: [{ id: 'refresh' }] } })
    let seen: unknown
    test.context.sources.registerAction({ apiVersion: 1, id: 'refresh', run: (_instance, payload) => { seen = payload; return { ok: 1 } } })
    const response = await test.send('POST', '/instance/first/action', JSON.stringify({ id: 'refresh', payload: { now: 1 } }))
    expect(response.status).toBe(200)
    expect(JSON.parse(response.body)).toEqual({ ok: true, result: { ok: 1 } })
    expect(seen).toEqual({ now: 1 })
  })

  it('manifest 没声明的动作被拒绝', async () => {
    const response = await harness().send('POST', '/instance/first/action', JSON.stringify({ id: 'refresh' }))
    expect(response.status).toBe(400)
  })

  it('没有声明 id 的请求被拒绝', async () => {
    const response = await harness().send('POST', '/instance/first/action', JSON.stringify({ payload: null }))
    expect(response.status).toBe(400)
  })
})

describe('组件文档', () => {
  it('按哈希取到文档，响应头带 CSP', async () => {
    const response = await harness().send('GET', `/widget/${HASH}/document?lang=en-US`)
    expect(response.status).toBe(200)
    expect(response.headers['content-security-policy']).toContain("script-src 'nonce-")
    expect(response.body).toContain('<html lang="en-US">')
  })

  it('没有这个版本时回 404', async () => {
    const response = await harness().send('GET', `/widget/${'b'.repeat(64)}/document`)
    expect(response.status).toBe(404)
  })
})
