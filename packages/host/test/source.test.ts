/**
 * 组件源码的写入、草稿与预览（技术契约 4—5、C08—C17）。
 *
 * 判的是这一轮新增的那几件事：只读源不能就地改、并发按 expectedHash 判定、目录交换不留半份
 * 组件、草稿不装凭据值、预览不写正式的地方。
 */
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HostRequest, HostResponse, WidgetRoot } from '@dsh-widget-board/contracts'
import { PLUGIN_ROUTE } from '@dsh-widget-board/contracts'
import { createHandler } from '../src/routes'
import type { RouteContext } from '../src/routes'
import { createVersionStore } from '../src/blobs'
import { openGrants } from '../src/grants'
import { readWidget } from '../src/library'
import type { WidgetRecord } from '../src/library'
import { createLive } from '../src/live'
import { createRequestLog } from '../src/request-log'
import { createSelfChecks } from '../src/selfcheck'
import { createRegistries } from '../src/sources'
import { openDrafts } from '../src/drafts/store'
import { createPreviews } from '../src/preview/store'
import { writeBoard } from '../src/state'
import { openWorkspace } from '../src/workspace'
import { BOARD_STATE_WRITES_PER_SECOND, STATE_WRITES_PER_SECOND, createRateLimiter } from '../src/limits'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))

/** 这一轮起的临时目录，测试结束一并删掉。 */
const homes: string[] = []

afterEach(async () => {
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true })
})

/**
 * 一个组件目录的内容。
 *
 * @param id - 组件 id。
 * @param extra - 额外的文件。
 * @returns 相对路径到内容的映射。
 */
function filesOf(id: string, extra: Record<string, string> = {}): Map<string, Buffer> {
  return new Map<string, Buffer>([
    ['widget.json', Buffer.from(JSON.stringify({
      id,
      title: { zh: id, en: id },
      version: '0.1.0',
      sizes: ['s'],
    }))],
    ['index.html', Buffer.from('<p>hi</p>')],
    ['style.css', Buffer.from('p{}')],
    ...Object.entries(extra).map(([path, content]) => [path, Buffer.from(content)] as [string, Buffer]),
  ])
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
function request(method: string, path: string, body?: unknown): HostRequest {
  const payload = body === undefined ? undefined : JSON.stringify(body)
  return {
    method,
    url: `${PLUGIN_ROUTE}${path}`,
    headers: { host: '127.0.0.1:3080' },
    socket: { remoteAddress: '127.0.0.1' },
    async *[Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
      if (payload !== undefined) yield Buffer.from(payload)
    },
  }
}

/** 一次调用留下的记录。 */
interface Harness {
  context: RouteContext
  home: string
  /** 用户组件目录。 */
  userDir: string
  send(method: string, path: string, body?: unknown): Promise<Capture>
  /** 组件库里现在有的组件。 */
  records(): Map<string, WidgetRecord>
}

/**
 * 起一套替身：用户组件目录里先放几个组件，组件库照着它读出来。
 *
 * @param installed - 用户目录里先放好的组件 id。
 * @param readonlySources - 只读来源（内置与插件提供）的组件 id。
 * @returns 上下文、临时目录与发请求的函数。
 */
async function harness(installed: string[] = [], readonlySources: string[] = []): Promise<Harness> {
  await mkdir(join(ROOT, '.debug'), { recursive: true })
  const home = await mkdtemp(join(ROOT, '.debug', 'source-test-'))
  homes.push(home)
  const userDir = join(home, 'widgets')
  await mkdir(userDir, { recursive: true })
  const records = new Map<string, WidgetRecord>()
  for (const id of installed) {
    const dir = join(userDir, id)
    await mkdir(dir, { recursive: true })
    for (const [path, content] of filesOf(id)) await writeFile(join(dir, path), content)
  }
  for (const id of readonlySources) {
    records.set(id, {
      manifest: { id, title: { zh: id, en: id }, version: '0.1.0', sizes: ['s'] },
      source: 'builtin',
      dir: join(home, 'builtin', id),
      hash: 'b'.repeat(64),
      files: filesOf(id),
    })
  }
  const roots: WidgetRoot[] = [
    { dir: join(home, 'builtin'), source: 'builtin' },
    { dir: userDir, source: 'user' },
  ]
  // 用户目录里的组件进库；只读来源保持在库里，不给写权限。
  for (const id of installed) {
    const loaded = await readWidget(join(userDir, id), { source: 'user' })
    records.set(loaded.manifest.id, loaded)
  }
  await mkdir(join(home, 'boards'), { recursive: true })
  await writeBoard(join(home, 'boards', 'board.json'), {
    version: 2,
    id: 'board',
    title: '看板',
    revision: 0,
    layoutRevision: 0,
    instances: [],
  })
  await writeFile(join(home, 'boards.json'), `${JSON.stringify({ version: 1, active: 'board', boards: ['board'] })}\n`, 'utf8')
  const workspace = await openWorkspace(home, records, () => undefined)
  const context: RouteContext = {
    records,
    entries: [...records.values()].map((entry) => ({
      id: entry.manifest.id,
      source: entry.source,
      title: entry.manifest.title,
      sizes: entry.manifest.sizes,
      hash: entry.hash,
    })),
    library: { records, entries: [], errors: [] },
    roots,
    versions: createVersionStore(join(home, 'blobs')),
    workspace,
    get board() { return workspace.active() },
    save: async (change, options) => await workspace.save(workspace.activeId(), change, options),
    live: createLive({ tokensCss: '', suiteCss: '', runtimeJs: '', libs: {} }),
    connection: undefined,
    refresh: async () => {
      for (const entry of await readdir(userDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const loaded = await readWidget(join(userDir, entry.name), { source: 'user' })
        records.set(loaded.manifest.id, loaded)
      }
    },
    sources: createRegistries(),
    grants: await openGrants(join(home, 'grants.json')),
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
    home,
    userDir,
    records: () => records,
    async send(method, path, body) {
      const response = new Capture()
      await handler(request(method, path, body), response)
      return response
    },
  }
}

describe('读一个组件的源码', () => {
  it('给出 manifest、文件、来源与当前哈希', async () => {
    const test = await harness(['mine'])
    const response = await test.send('GET', '/library/mine/source')
    expect(response.status).toBe(200)
    const model = JSON.parse(response.body) as {
      id: string
      source: string
      hash: string
      manifest: string
      files: Record<string, string>
      writable: boolean
    }
    expect(model.id).toBe('mine')
    expect(model.source).toBe('user')
    expect(model.writable).toBe(true)
    expect(JSON.parse(model.manifest).id).toBe('mine')
    expect(model.files['index.html']).toBe('<p>hi</p>')
    expect(model.files['style.css']).toBe('p{}')
    expect(model.hash).toHaveLength(64)
  })

  it('只读源标成不可就地改，并给出另存用的 id', async () => {
    const test = await harness([], ['clock'])
    const response = await test.send('GET', '/library/clock/source')
    expect(response.status).toBe(200)
    const model = JSON.parse(response.body) as { writable: boolean, suggestedId?: string, source: string }
    expect(model.source).toBe('builtin')
    expect(model.writable).toBe(false)
    expect(model.suggestedId).toMatch(/^user-/)
  })

  it('组件库里没有它就说清楚是哪一个', async () => {
    const test = await harness()
    const response = await test.send('GET', '/library/nope/source')
    expect(response.status).toBe(404)
    expect(response.body).toMatch(/nope/)
  })

  it('凭据值不进源码响应：只有名字与用途', async () => {
    // manifest 声明凭据的名字与用途，值由宿主的凭据服务保存（D27）。这里确认响应里
    // 只有声明，没有值：把一个看起来像密钥的字符串放进组件目录，响应里不该有它。
    const test = await harness()
    const dir = join(test.userDir, 'withsecret')
    await mkdir(dir, { recursive: true })
    const manifest = {
      id: 'withsecret',
      title: { zh: '带凭据', en: 'With secret' },
      version: '0.1.0',
      sizes: ['s'],
      credentials: [{ ref: 'MY_API_KEY', label: { zh: '密钥', en: 'Key' } }],
    }
    await writeFile(join(dir, 'widget.json'), JSON.stringify(manifest))
    await writeFile(join(dir, 'index.html'), '<p>hi</p>')
    await writeFile(join(dir, 'style.css'), 'p{}')
    await test.context.refresh()
    const response = await test.send('GET', '/library/withsecret/source')
    expect(response.status).toBe(200)
    const model = JSON.parse(response.body) as { manifest: string }
    // 声明的名字在，值的形状不在。
    expect(model.manifest).toContain('MY_API_KEY')
    expect(model.manifest).not.toMatch(/-----BEGIN/)
  })
})

describe('写一个用户组件类型', () => {
  it('新建时目录里就是那几份文件', async () => {
    const test = await harness()
    const response = await test.send('POST', '/library/define', {
      id: 'mine',
      manifest: { id: 'mine', title: { zh: '我的', en: 'Mine' }, version: '0.1.0', sizes: ['s'] },
      files: { 'index.html': '<p>hi</p>', 'style.css': 'p{}' },
    })
    expect(response.status).toBe(201)
    const written = JSON.parse(response.body) as { id: string, hash: string, created: boolean }
    expect(written.id).toBe('mine')
    expect(written.created).toBe(true)
    expect(written.hash).toHaveLength(64)
    expect(await readFile(join(test.userDir, 'mine', 'index.html'), 'utf8')).toBe('<p>hi</p>')
    const manifest = JSON.parse(await readFile(join(test.userDir, 'mine', 'widget.json'), 'utf8')) as { id: string }
    expect(manifest.id).toBe('mine')
  })

  it('只读源不能就地改，回 403 并说清是哪一个', async () => {
    const test = await harness([], ['clock'])
    const response = await test.send('POST', '/library/define', {
      id: 'clock',
      manifest: { id: 'clock', title: { zh: '钟', en: 'Clock' }, version: '0.1.0', sizes: ['s'] },
      files: { 'index.html': '<p></p>', 'style.css': 'p{}' },
    })
    expect(response.status).toBe(403)
    expect(response.body).toMatch(/不能就地改/)
  })

  it('更新时不带 expectedHash 回 409', async () => {
    const test = await harness(['mine'])
    const response = await test.send('POST', '/library/define', {
      id: 'mine',
      manifest: { id: 'mine', title: { zh: '我的', en: 'Mine' }, version: '0.1.0', sizes: ['s'] },
      files: { 'index.html': '<p>新</p>', 'style.css': 'p{}' },
    })
    expect(response.status).toBe(409)
    expect(response.body).toMatch(/expectedHash/)
  })

  it('expectedHash 对不上时回 409 并带上当前版本，旧目录原样保留', async () => {
    const test = await harness(['mine'])
    const before = await readFile(join(test.userDir, 'mine', 'index.html'), 'utf8')
    const response = await test.send('POST', '/library/define', {
      id: 'mine',
      manifest: { id: 'mine', title: { zh: '我的', en: 'Mine' }, version: '0.1.0', sizes: ['s'] },
      files: { 'index.html': '<p>新</p>', 'style.css': 'p{}' },
      expectedHash: 'c'.repeat(64),
    })
    expect(response.status).toBe(409)
    expect(response.body).toMatch(/stale-hash/)
    expect(await readFile(join(test.userDir, 'mine', 'index.html'), 'utf8')).toBe(before)
  })

  it('expectedHash 对得上时换掉目录，暂存目录不留下来', async () => {
    const test = await harness(['mine'])
    const current = test.records().get('mine')?.hash ?? ''
    const response = await test.send('POST', '/library/define', {
      id: 'mine',
      manifest: { id: 'mine', title: { zh: '我的', en: 'Mine' }, version: '0.1.0', sizes: ['s'] },
      files: { 'index.html': '<p>新</p>', 'style.css': 'p{}' },
      expectedHash: current,
    })
    expect(response.status).toBe(200)
    expect(await readFile(join(test.userDir, 'mine', 'index.html'), 'utf8')).toBe('<p>新</p>')
    const names = await readdir(test.userDir)
    expect(names.filter((name) => name.includes('staging') || name.includes('retired'))).toEqual([])
  })

  it('manifest 不合格时回 400，目录里不落半份', async () => {
    const test = await harness()
    const response = await test.send('POST', '/library/define', {
      id: 'mine',
      manifest: { id: 'mine', title: { zh: '我的' }, version: 'nope', sizes: [] },
      files: { 'index.html': '<p></p>', 'style.css': 'p{}' },
    })
    expect(response.status).toBe(400)
    expect(response.body).toMatch(/manifest 不合格/)
    expect(await readdir(test.userDir)).toEqual([])
  })

  it('缺必需的文件时回 400', async () => {
    const test = await harness()
    const response = await test.send('POST', '/library/define', {
      id: 'mine',
      manifest: { id: 'mine', title: { zh: '我的', en: 'Mine' }, version: '0.1.0', sizes: ['s'] },
      files: { 'index.html': '<p></p>' },
    })
    expect(response.status).toBe(400)
    expect(response.body).toMatch(/style\.css/)
  })

  it('文件路径越出组件目录时回 400', async () => {
    const test = await harness()
    const response = await test.send('POST', '/library/define', {
      id: 'mine',
      manifest: { id: 'mine', title: { zh: '我的', en: 'Mine' }, version: '0.1.0', sizes: ['s'] },
      files: { 'index.html': '<p></p>', 'style.css': 'p{}', '../escape.js': 'x' },
    })
    expect(response.status).toBe(400)
    expect(response.body).toMatch(/留在组件目录之内/)
  })

  it('manifest 的 id 与请求的 id 不一致时回 400', async () => {
    const test = await harness()
    const response = await test.send('POST', '/library/define', {
      id: 'mine',
      manifest: { id: 'other', title: { zh: '我的', en: 'Mine' }, version: '0.1.0', sizes: ['s'] },
      files: { 'index.html': '<p></p>', 'style.css': 'p{}' },
    })
    expect(response.status).toBe(400)
    expect(response.body).toMatch(/不一致/)
  })

  it('只读源的包导进来时也回 403：内容一样也不行', async () => {
    // 这一条曾经被「同哈希就跳过」那条短路放过去：内置组件的包能装进用户目录，
    // 装出来的目录名与内置那份重名（D17）。
    const test = await harness([], ['clock'])
    const response = await test.send('POST', '/library/define', {
      id: 'clock',
      manifest: { id: 'clock', title: { zh: 'clock', en: 'clock' }, version: '0.1.0', sizes: ['s'] },
      files: { 'index.html': '<p>hi</p>', 'style.css': 'p{}' },
      expectedHash: 'b'.repeat(64),
    })
    expect(response.status).toBe(403)
    expect(response.body).toMatch(/不能就地改/)
  })
})

describe('草稿', () => {
  it('存下来再读出来是同一份', async () => {
    const test = await harness()
    const saved = await test.send('POST', '/drafts', {
      target: { kind: 'widget', widgetId: 'mine' },
      base: { hash: 'a'.repeat(64) },
      files: { 'index.html': '<p>草稿</p>' },
    })
    expect(saved.status).toBe(201)
    const draft = JSON.parse(saved.body) as { draftId: string, updatedAt: string }
    expect(typeof draft.draftId).toBe('string')
    const read = await test.send('GET', `/drafts/${draft.draftId}`)
    expect(read.status).toBe(200)
    const loaded = JSON.parse(read.body) as { files: Record<string, string> }
    expect(loaded.files['index.html']).toBe('<p>草稿</p>')
  })

  it('列表给出摘要', async () => {
    const test = await harness()
    await test.send('POST', '/drafts', { target: { kind: 'widget', widgetId: 'mine' }, files: { 'index.html': 'x' } })
    const listed = await test.send('GET', '/drafts')
    expect(listed.status).toBe(200)
    const body = JSON.parse(listed.body) as { drafts: { draftId: string, kind: string }[] }
    expect(body.drafts).toHaveLength(1)
    expect(body.drafts[0]?.kind).toBe('source')
  })

  it('删掉之后读不到', async () => {
    const test = await harness()
    const saved = await test.send('POST', '/drafts', { target: { kind: 'widget', widgetId: 'mine' }, files: { 'index.html': 'x' } })
    const draft = JSON.parse(saved.body) as { draftId: string }
    const removed = await test.send('DELETE', `/drafts/${draft.draftId}`)
    expect(removed.status).toBe(200)
    expect((await test.send('GET', `/drafts/${draft.draftId}`)).status).toBe(404)
  })

  it('带凭据值时拒绝存', async () => {
    const test = await harness()
    // 私钥头的形状在这里拼出来：它足够像，不含任何真实密钥，也不出现在提交里（D12）。
    const header = ['-----BEGIN', 'RSA', 'PRIVATE KEY-----'].join(' ')
    const response = await test.send('POST', '/drafts', {
      target: { kind: 'widget', widgetId: 'mine' },
      files: { 'main.js': `const key = "${header}\\nMIIEow==\\n"` },
    })
    expect(response.status).toBe(400)
    expect(response.body).toMatch(/凭据/)
  })

  it('最多二十份，满了明确提示', async () => {
    const test = await harness()
    for (let index = 0; index < 20; index += 1) {
      const response = await test.send('POST', '/drafts', { target: { kind: 'widget', widgetId: 'mine' }, files: { 'index.html': `x${String(index)}` } })
      expect(response.status).toBe(201)
    }
    const overflow = await test.send('POST', '/drafts', { target: { kind: 'widget', widgetId: 'mine' }, files: { 'index.html': 'x' } })
    expect(overflow.status).toBe(409)
    expect(overflow.body).toMatch(/最多 20 份/)
    // 满了也不静默删掉旧的：前二十份还在。
    const listed = await test.send('GET', '/drafts')
    const body = JSON.parse(listed.body) as { drafts: unknown[] }
    expect(body.drafts).toHaveLength(20)
  })

  it('不接客户端给的文件路径', async () => {
    const test = await harness()
    const response = await test.send('POST', '/drafts', {
      target: { kind: 'widget', widgetId: 'mine' },
      path: 'C:/Windows/System32/drivers/etc/hosts',
      files: { 'index.html': 'x' },
    })
    // 路径不在草稿的形状里：那一项被忽略，草稿只认 target、base、files 与 form。
    expect(response.status).toBe(201)
    const draft = JSON.parse(response.body) as { path?: unknown }
    expect(draft.path).toBeUndefined()
  })
})

describe('源码应用与资源', () => {
  it('正式保存前构建文档，拒绝缺失的脚本并保留旧目录', async () => {
    const test = await harness(['mine'])
    const record = test.records().get('mine')!
    const before = await readFile(join(test.userDir, 'mine/index.html'), 'utf8')
    const response = await test.send('POST', '/library/define', { id: 'mine', expectedHash: record.hash, manifest: { ...record.manifest, scripts: ['missing.js'] }, files: { 'index.html': '<p>new</p>', 'style.css': '' } })
    expect(response.status).toBe(400)
    expect(await readFile(join(test.userDir, 'mine/index.html'), 'utf8')).toBe(before)
  })
  it('应用只改变当前实例的组件与 hash，保留内容和布局', async () => {
    const test = await harness(['mine', 'next'])
    const composed = await test.send('POST', '/boards/board/compose', { widget: 'mine', props: { name: '保留' }, state: { count: 2 }, data: [1] })
    const id = (JSON.parse(composed.body) as { id: string }).id
    const before = test.context.workspace.findInstance(id)!
    const original = structuredClone(before.instance)
    const record = test.records().get('next')!
    const applied = await test.send('POST', `/instance/${id}/source`, { widget: 'next', expectedHash: record.hash, expectedRevision: before.board.revision })
    expect(applied.status).toBe(200)
    expect(test.context.workspace.findInstance(id)!.instance).toEqual({ ...original, widget: 'next', hash: record.hash })
    expect((await test.send('POST', `/instance/${id}/source`, { widget: 'mine', expectedHash: test.records().get('mine')!.hash, expectedRevision: before.board.revision })).status).toBe(409)
  })

  it('新 schema 不兼容时保留原实例', async () => {
    const test = await harness(['mine', 'next'])
    test.records().get('next')!.manifest.props = { type: 'object', required: ['required'], properties: { required: { type: 'number' } } }
    const composed = await test.send('POST', '/boards/board/compose', { widget: 'mine', props: { title: '原内容' } })
    const id = JSON.parse(composed.body).id as string
    const before = structuredClone(test.context.workspace.findInstance(id)!.instance)
    const applied = await test.send('POST', `/instance/${id}/source`, { widget: 'next', expectedHash: test.records().get('next')!.hash, expectedRevision: test.context.workspace.active().revision })
    expect(applied.status).toBe(400)
    expect(test.context.workspace.findInstance(id)!.instance).toEqual(before)
  })

  it('二进制资源经过定义和源码响应保持原始字节', async () => {
    const test = await harness()
    const bytes = Buffer.from([0, 255, 128, 35, 10])
    const files = filesOf('binary')
    const defined = await test.send('POST', '/library/define', { id: 'binary', manifest: JSON.parse(files.get('widget.json')!.toString()), files: { 'index.html': '<p/>', 'style.css': '' }, binaryFiles: { 'assets/picture.png': bytes.toString('base64') } })
    expect(defined.status).toBe(201)
    expect(await readFile(join(test.userDir, 'binary/assets/picture.png'))).toEqual(bytes)
    const source = JSON.parse((await test.send('GET', '/library/binary/source')).body)
    expect(Buffer.from(source.binaryFiles['assets/picture.png'], 'base64')).toEqual(bytes)
  })

  it('两个窗口用同一 expectedHash 写入，只允许一个成功', async () => {
    const test = await harness(['mine'])
    const hash = test.records().get('mine')!.hash
    const manifest = test.records().get('mine')!.manifest
    const results = await Promise.all(['first', 'second'].map(async (text) => await test.send('POST', '/library/define', { id: 'mine', manifest, expectedHash: hash, files: { 'index.html': `<p>${text}</p>`, 'style.css': '' } })))
    expect(results.map((result) => result.status).sort()).toEqual([200, 409])
  })
})

describe('预览会话', () => {
  it('预览与正式定义同样拒绝非法 manifest 和路径', async () => {
    const test = await harness()
    const files = Object.fromEntries([...filesOf('demo')].map(([path, content]) => [path, content.toString('utf8')]))
    for (const path of ['../escape.js', 'C:/escape.js', 'assets/./a.js', 'assets/x:stream', 'assets/CON']) {
      expect((await test.send('POST', '/preview', { files: { ...files, [path]: 'x' } })).status).toBe(400)
    }
    expect((await test.send('POST', '/preview', { files: { ...files, 'widget.json': '{"id":"demo"}' } })).status).toBe(400)
    expect((await test.send('POST', '/preview', { files: { ...files, 'main.js': 'x'.repeat(4 * 1024 * 1024 + 1) } })).status).toBe(413)
  })

  it('过期会话释放内存并拒绝读取', async () => {
    const test = await harness()
    vi.useFakeTimers()
    try {
      const files = Object.fromEntries([...filesOf('demo')].map(([path, content]) => [path, content.toString('utf8')]))
      const created = await test.context.previews!.create({ files, props: {}, data: null, state: null }, test.context.live.assets)
      vi.advanceTimersByTime(10 * 60 * 1000 + 1)
      expect(test.context.previews!.size()).toBe(0)
      expect(test.context.previews!.get(created.previewId)).toBeUndefined()
    } finally { vi.useRealTimers() }
  })

  it('校验 schema 并计算 manifest 文案在内的握手额度', async () => {
    const test = await harness()
    const files = Object.fromEntries([...filesOf('demo')].map(([path, content]) => [path, content.toString('utf8')]))
    const manifest = JSON.parse(files['widget.json'] as string)
    manifest.props = { type: 'object', required: ['name'], properties: { name: { type: 'string' } } }
    expect((await test.send('POST', '/preview', { files: { ...files, 'widget.json': JSON.stringify(manifest) }, props: {} })).status).toBe(400)
    delete manifest.props
    manifest.text = { big: { zh: 'x'.repeat(65000), en: 'x' } }
    expect((await test.send('POST', '/preview', { files: { ...files, 'widget.json': JSON.stringify(manifest) } })).status).toBe(201)
    manifest.text = { big: { zh: 'x'.repeat(320 * 1024), en: 'x' } }
    expect((await test.send('POST', '/preview', { files: { ...files, 'widget.json': JSON.stringify(manifest) } })).status).toBe(413)
  })
  it('新建后拿到一个不可猜测的 id，文档能画出来', async () => {
    const test = await harness()
    const created = await test.send('POST', '/preview', {
      files: {
        'widget.json': JSON.stringify({ id: 'demo', title: { zh: '演示', en: 'Demo' }, version: '0.1.0', sizes: ['s'] }),
        'index.html': '<p>预览</p>',
        'style.css': 'p{}',
      },
      props: { title: '预览' },
    })
    expect(created.status).toBe(201)
    const session = JSON.parse(created.body) as { previewId: string }
    expect(session.previewId).toMatch(/^[0-9a-f]{32}$/)
    const document = await test.send('GET', `/preview/${session.previewId}/document?lang=zh-CN`)
    expect(document.status).toBe(200)
    expect(document.body).toMatch(/预览/)
    // 预览用同一份 CSP：不给 same-origin，不放开网络（D3）。
    expect(document.headers['content-security-policy']).toMatch(/default-src 'none'/)
    expect(document.headers['content-security-policy']).not.toContain('same-origin')
  })

  it('不写进正式的地方：组件库与看板都不动', async () => {
    const test = await harness()
    const before = test.records().size
    await test.send('POST', '/preview', {
      files: {
        'widget.json': JSON.stringify({ id: 'demo', title: { zh: '演示', en: 'Demo' }, version: '0.1.0', sizes: ['s'] }),
        'index.html': '<p>预览</p>',
        'style.css': 'p{}',
      },
    })
    expect(test.records().size).toBe(before)
    const names = await readdir(test.userDir)
    expect(names).toEqual([])
  })

  it('关掉之后文档读不到', async () => {
    const test = await harness()
    const created = await test.send('POST', '/preview', {
      files: {
        'widget.json': JSON.stringify({ id: 'demo', title: { zh: '演示', en: 'Demo' }, version: '0.1.0', sizes: ['s'] }),
        'index.html': '<p>预览</p>',
        'style.css': 'p{}',
      },
    })
    const session = JSON.parse(created.body) as { previewId: string }
    const released = await test.send('DELETE', `/preview/${session.previewId}`)
    expect(released.status).toBe(200)
    expect((await test.send('GET', `/preview/${session.previewId}/document`)).status).toBe(404)
  })

  it('同时最多四个会话', async () => {
    const test = await harness()
    const body = {
      files: {
        'widget.json': JSON.stringify({ id: 'demo', title: { zh: '演示', en: 'Demo' }, version: '0.1.0', sizes: ['s'] }),
        'index.html': '<p>预览</p>',
        'style.css': 'p{}',
      },
    }
    for (let index = 0; index < 4; index += 1) {
      expect((await test.send('POST', '/preview', body)).status).toBe(201)
    }
    const overflow = await test.send('POST', '/preview', body)
    expect(overflow.status).toBe(429)
    expect(overflow.body).toMatch(/同时最多 4 个预览/)
  })

  it('缺必需的文件时回 400', async () => {
    const test = await harness()
    const response = await test.send('POST', '/preview', {
      files: { 'widget.json': JSON.stringify({ id: 'demo', title: { zh: '演示', en: 'Demo' }, version: '0.1.0', sizes: ['s'] }) },
    })
    expect(response.status).toBe(400)
    expect(response.body).toMatch(/index\.html/)
  })

  it('没有这一份预览时回 404', async () => {
    const test = await harness()
    expect((await test.send('GET', '/preview/deadbeef/document')).status).toBe(404)
  })
})
