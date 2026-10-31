/**
 * 宿主自己状态的数据源：读的是宿主此刻的真实状态，读出来的形状与组件 manifest 的 data schema 相符，
 * 订阅的生命周期由单元测试盯着。
 *
 * 临时仓库写在 `.debug/` 下，跑完按文件逐个删掉；不碰系统临时目录（根 AGENTS）。
 */
import { execFile } from 'node:child_process'
import { mkdir, readFile, readdir, rmdir, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import type { Board, BoardInstance, DataSourceRegistration, InstanceFace, WidgetManifest } from '@dsh-widget-board/contracts'
import type { BoardSourceDeps } from '../src/board-sources'
import {
  BOARD_JSON_NAME,
  BOARD_JSON_SOURCE,
  BOARD_SOURCE_PROVIDER,
  CAPACITY_ITEMS_NAME,
  CAPACITY_ITEMS_SOURCE,
  PROVIDERS_TABLE_NAME,
  PROVIDERS_TABLE_SOURCE,
  RUNTIME_KV_NAME,
  RUNTIME_KV_SOURCE,
  SESSIONS_LIST_NAME,
  SESSIONS_LIST_SOURCE,
  USAGE_CHART_NAME,
  USAGE_CHART_SOURCE,
  USAGE_STAT_NAME,
  USAGE_STAT_SOURCE,
  createBoardJsonSource,
  createCapacityItemsSource,
  createProvidersTableSource,
  createRuntimeKvSource,
  createSessionsListSource,
  createUsageChartSource,
  createUsageStatSource,
} from '../src/board-sources'
import { GIT_LOG_NAME, GIT_LOG_SOURCE, MARKDOWN_DOC_NAME, MARKDOWN_DOC_SOURCE, REPO_LINKS_NAME, REPO_LINKS_SOURCE, createGitLogSource, createMarkdownDocSource, createRepoLinksSource } from '../src/git-log'
import type { GitLogDeps } from '../src/git-log'
import { localDate } from '../src/local-date'
import { createProviderHealth } from '../src/provider-health'
import { dataError } from '../src/schema'
import type { UsageAnswer } from '../src/usage'

/** 组件目录：读它的 manifest，核对数据源的名字与 data schema。 */
const WIDGET_DIR = join(process.cwd(), 'packages', 'widgets')

/** 临时仓库写在 `.debug/` 下：这一条要经过真的文件读写与真的 Git，不碰系统临时目录。 */
const ROOT = join(process.cwd(), '.debug', 'tests', `board-sources-${String(process.pid)}-${String(Date.now())}`)

const FACE: InstanceFace = { id: 'card', widget: 'card', props: {} }

/**
 * 删掉一棵目录树：按文件逐个删，再从最深处往上删空目录。
 *
 * 不做递归删除（根 AGENTS）：链接只删链接本身，目录要空了才删得掉。
 *
 * @param dir - 要删的目录。
 */
async function removeTree(dir: string): Promise<void> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      await removeTree(full)
      continue
    }
    await unlink(full)
  }
  await rmdir(dir)
}

/**
 * 在一个目录里跑一条 Git 命令。
 *
 * @param cwd - 目标目录。
 * @param args - 命令的参数。
 * @returns 命令的标准输出。
 */
async function git(cwd: string, ...args: string[]): Promise<string> {
  return await new Promise((resolve, reject) => {
    execFile('git', args, { cwd, windowsHide: true, encoding: 'utf8' }, (error, stdout) => {
      if (error) reject(error)
      else resolve(stdout)
    })
  })
}

/**
 * 建一个真的 Git 仓库：一次提交，文件里是给定的内容。
 *
 * @param name - 仓库目录名。
 * @param content - 提交进仓库的文件内容。
 * @returns 仓库目录。
 */
async function makeRepo(name: string, content: string): Promise<string> {
  const dir = join(ROOT, name)
  await mkdir(dir, { recursive: true })
  await git(dir, 'init')
  await git(dir, 'config', 'user.email', 'board@example.com')
  await git(dir, 'config', 'user.name', 'Widget Board')
  await git(dir, 'config', 'commit.gpgsign', 'false')
  await writeFile(join(dir, 'a.ts'), content, 'utf8')
  await git(dir, 'add', 'a.ts')
  await git(dir, 'commit', '-m', 'first')
  return dir
}

/**
 * 一张卡片。
 *
 * @param id - 卡片 id。
 * @param widget - 组件 id。
 * @param state - 卡片的状态。
 * @returns 卡片。
 */
function instance(id: string, widget: string, state: unknown = null): BoardInstance {
  return { id, widget, hash: 'hash', props: {}, data: null, state, layout: { x: 0, y: 0, w: 1, h: 10 } }
}

/**
 * 一块看板。
 *
 * @param instances - 看板上的卡片。
 * @returns 看板。
 */
function boardOf(instances: BoardInstance[]): Board {
  return { version: 2, id: 'board-1', title: '我的看板', revision: 7, layoutRevision: 3, instances }
}

/**
 * 读一个组件的 manifest。
 *
 * @param widget - 组件 id。
 * @returns manifest。
 */
async function manifestOf(widget: string): Promise<WidgetManifest> {
  return JSON.parse(await readFile(join(WIDGET_DIR, widget, 'widget.json'), 'utf8')) as WidgetManifest
}

/**
 * 从今天往前推若干天的本地日期。
 *
 * @param offset - 往前推几天；0 是今天。
 * @returns 日期的键。
 */
function dayKey(offset: number): string {
  const date = new Date()
  date.setDate(date.getDate() - offset)
  return localDate(date.getTime()) ?? ''
}

/**
 * 一份用量汇总。
 *
 * @param days - 每天的分桶。
 * @returns 用量汇总。
 */
function usageOf(days: { date: string, calls: number, input?: number, output?: number }[]): UsageAnswer {
  const buckets = days.map((day) => ({
    date: day.date,
    input: day.input ?? 0,
    output: day.output ?? 0,
    cacheRead: 0,
    cacheWrite: 0,
    calls: day.calls,
  }))
  return {
    ready: true,
    computedAt: Date.now(),
    days: buckets,
    hours: new Array(24).fill(0),
    totals: {
      input: buckets.reduce((sum, day) => sum + day.input, 0),
      output: buckets.reduce((sum, day) => sum + day.output, 0),
      cacheRead: 0,
      cacheWrite: 0,
      calls: buckets.reduce((sum, day) => sum + day.calls, 0),
    },
  }
}

/**
 * 建出这些数据源要读的东西。
 *
 * @param overrides - 覆盖其中几项。
 * @returns 依赖。
 */
function depsOf(overrides: Partial<BoardSourceDeps> = {}): BoardSourceDeps {
  return {
    sessions: () => undefined,
    workspaces: () => undefined,
    readUsage: async () => usageOf([]),
    health: createProviderHealth(),
    workspace: { list: () => [boardOf([instance('a', 'gauge')])], active: () => boardOf([instance('a', 'gauge')]) },
    records: () => new Map(),
    diskPath: ROOT,
    version: '0.1.6',
    ...overrides,
  }
}

/**
 * 建出仓库那三个数据源要读的东西。
 *
 * @param overrides - 覆盖其中几项。
 * @returns 依赖。
 */
function gitDepsOf(overrides: Partial<GitLogDeps> = {}): GitLogDeps {
  return { defaultCwd: ROOT, ...overrides }
}

/**
 * 读一次数据源，并按组件的 data schema 核对读出来的数据。
 *
 * @param source - 数据源。
 * @param widget - 组件 id；它的 manifest 里有 data schema。
 * @param face - 读哪张卡。
 * @returns 读到的数据。
 */
async function readChecked(source: DataSourceRegistration, widget: string, face: InstanceFace = FACE): Promise<unknown> {
  const data = await source.read(face)
  const manifest = await manifestOf(widget)
  expect(dataError(manifest.data, data)).toBeUndefined()
  return data
}

/**
 * 等一个条件成立。
 *
 * @param ready - 条件。
 * @param what - 等不到时说什么。
 */
async function until(ready: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (ready()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`等不到${what}`)
}

afterAll(async () => {
  await removeTree(ROOT)
})

describe('十个数据源的注册', () => {
  it('都以 widget-board 提供方注册，名字与组件 manifest 里点名的一致，且不声明权限', () => {
    const sources: { source: DataSourceRegistration, id: string, name: string }[] = [
      { source: createGitLogSource(gitDepsOf()), id: GIT_LOG_SOURCE, name: GIT_LOG_NAME },
      { source: createRepoLinksSource(gitDepsOf()), id: REPO_LINKS_SOURCE, name: REPO_LINKS_NAME },
      { source: createMarkdownDocSource(gitDepsOf()), id: MARKDOWN_DOC_SOURCE, name: MARKDOWN_DOC_NAME },
      { source: createSessionsListSource(depsOf()), id: SESSIONS_LIST_SOURCE, name: SESSIONS_LIST_NAME },
      { source: createUsageChartSource(depsOf()), id: USAGE_CHART_SOURCE, name: USAGE_CHART_NAME },
      { source: createUsageStatSource(depsOf()), id: USAGE_STAT_SOURCE, name: USAGE_STAT_NAME },
      { source: createCapacityItemsSource(depsOf()), id: CAPACITY_ITEMS_SOURCE, name: CAPACITY_ITEMS_NAME },
      { source: createProvidersTableSource(depsOf()), id: PROVIDERS_TABLE_SOURCE, name: PROVIDERS_TABLE_NAME },
      { source: createRuntimeKvSource(depsOf()), id: RUNTIME_KV_SOURCE, name: RUNTIME_KV_NAME },
      { source: createBoardJsonSource(depsOf()), id: BOARD_JSON_SOURCE, name: BOARD_JSON_NAME },
    ]
    for (const entry of sources) {
      expect(entry.source.provider).toBe(BOARD_SOURCE_PROVIDER)
      expect(entry.source.id).toBe(entry.id)
      expect(entry.name).toBe(`widget-board:${entry.id}`)
      expect(entry.source.permission).toBeUndefined()
    }
  })
})

describe('提交时间线', () => {
  it('在真的仓库里读到提交，读出来的数据符合时间线组件的 schema', async () => {
    const dir = await makeRepo('log', 'const one = 1\n')
    const source = createGitLogSource(gitDepsOf({ defaultCwd: dir }))
    const data = await readChecked(source, 'timeline') as { items: { time: string, title: string, detail: string }[] }
    expect(data.items.length).toBeGreaterThan(0)
    expect(data.items[0]?.title).toBe('first')
    expect(data.items[0]?.time).toMatch(/^\d{2}-\d{2} \d{2}:\d{2}$/)
    expect(data.items[0]?.detail).toContain('·')
  })

  it('目录不是仓库时给空列表，不抛出去', async () => {
    const source = createGitLogSource(gitDepsOf({ defaultCwd: join(ROOT, 'missing') }))
    expect(await source.read(FACE)).toEqual({ items: [] })
  })
})

describe('仓库链接', () => {
  it('远端地址被写成浏览器能打开的样子，文档入口也都在', async () => {
    const dir = await makeRepo('links', 'const one = 1\n')
    await git(dir, 'remote', 'add', 'origin', 'git@github.com:owner/repo.git')
    const source = createRepoLinksSource(gitDepsOf({ defaultCwd: dir, origin: () => 'http://127.0.0.1:3080' }))
    const data = await readChecked(source, 'links') as { items: { title: string, url: string }[] }
    expect(data.items.map((item) => item.url)).toContain('https://github.com/owner/repo')
    expect(data.items.map((item) => item.url)).toContain('http://127.0.0.1:3080')
    expect(data.items.map((item) => item.url)).toContain('https://github.com/Nwflower/dsh-widget-board')
    expect(data.items.map((item) => item.url)).toContain('https://transitions.dev')
  })

  it('目录不是仓库时只有文档入口', async () => {
    const source = createRepoLinksSource(gitDepsOf({ defaultCwd: join(ROOT, 'missing') }))
    const data = await readChecked(source, 'links') as { items: { url: string }[] }
    expect(data.items.length).toBe(2)
  })
})

describe('Markdown 文档', () => {
  it('卡片自己给了内容时读的就是这段内容', async () => {
    const source = createMarkdownDocSource(gitDepsOf())
    const data = await readChecked(source, 'markdown', { id: 'card', widget: 'markdown', props: { content: '# 标题' } }) as { markdown: string }
    expect(data.markdown).toBe('# 标题')
  })

  it('给了文件名时读仓库里的那个文件', async () => {
    const dir = await makeRepo('doc', 'const one = 1\n')
    await writeFile(join(dir, 'README.md'), '# 说明\n', 'utf8')
    const source = createMarkdownDocSource(gitDepsOf({ defaultCwd: dir }))
    const data = await readChecked(source, 'markdown', { id: 'card', widget: 'markdown', props: { file: 'README.md' } }) as { markdown: string }
    expect(data.markdown).toBe('# 说明\n')
  })

  it('文件读不到时给空文档', async () => {
    const source = createMarkdownDocSource(gitDepsOf())
    const data = await readChecked(source, 'markdown', { id: 'card', widget: 'markdown', props: { file: '没有这个文件.md' } }) as { markdown: string }
    expect(data.markdown).toBe('')
  })

  it('两样都没有时给空对象，组件因此用自己的样例渲染', async () => {
    const source = createMarkdownDocSource(gitDepsOf())
    expect(await source.read(FACE)).toEqual({})
  })
})

describe('会话与工作区列表', () => {
  it('活跃的会话与开着的工作区各一行', async () => {
    const deps = depsOf({
      sessions: () => ({ list: () => [{ id: 'session-1234567890', header: { cwd: '/tmp/somewhere' } }] }),
      workspaces: () => ({ list: () => [{ id: 'space', path: '/tmp/workspace' }] }),
    })
    const data = await readChecked(createSessionsListSource(deps), 'list') as { items: { title: string, meta: string, status: string }[] }
    expect(data.items[0]?.title).toBe('会话 session-')
    expect(data.items[0]?.meta).toBe('somewhere')
    expect(data.items[0]?.status).toBe('ok')
    expect(data.items[1]?.title).toBe('工作区 · workspace')
    expect(data.items[1]?.status).toBe('idle')
  })

  it('会话与工作区都没有时给一条看板自己的摘要', async () => {
    const data = await readChecked(createSessionsListSource(depsOf()), 'list') as { items: { title: string, meta: string }[] }
    expect(data.items[0]?.title).toBe('组件看板在线')
    expect(data.items[0]?.meta).toBe('1 张卡片')
  })
})

describe('用量曲线', () => {
  it('最近七天每天一个点，默认是那天的调用次数', async () => {
    const deps = depsOf({ readUsage: async () => usageOf([{ date: dayKey(0), calls: 7 }]) })
    const data = await readChecked(createUsageChartSource(deps), 'chart') as { points: { label: string, value: number }[], caption: string }
    expect(data.points.length).toBe(7)
    expect(data.points[6]?.value).toBe(7)
    expect(data.points[6]?.label).toBe(dayKey(0).slice(5))
    expect(data.caption).toContain('调用次数')
  })

  it('卡片要 token 时值是那天的 token 数', async () => {
    const deps = depsOf({ readUsage: async () => usageOf([{ date: dayKey(0), calls: 7, input: 100, output: 50 }]) })
    const data = await readChecked(createUsageChartSource(deps), 'chart', { id: 'card', widget: 'chart', props: { metric: 'tokens' } }) as { points: { value: number }[]; caption: string }
    expect(data.points[6]?.value).toBe(150)
    expect(data.caption).toContain('Token')
  })

  it('没有任何历史记录时给空对象，组件因此回退到自己的样例', async () => {
    const data = await readChecked(createUsageChartSource(depsOf()), 'chart')
    expect(data).toEqual({})
  })
})

describe('用量数字', () => {
  it('最近七天的合计与前一个窗口的环比', async () => {
    const deps = depsOf({ readUsage: async () => usageOf([{ date: dayKey(0), calls: 10 }, { date: dayKey(10), calls: 5 }]) })
    const data = await readChecked(createUsageStatSource(deps), 'stat') as { value: number, unit: string, delta: number, note: string, caption: string }
    expect(data.value).toBe(10)
    expect(data.unit).toBe('次调用')
    expect(data.delta).toBe(100)
    expect(data.note).toBe('较前 7 天')
    expect(data.caption).toContain('活跃 1 天')
  })

  it('卡片要 token 时合计与单位都是 token', async () => {
    const deps = depsOf({ readUsage: async () => usageOf([{ date: dayKey(0), calls: 3, input: 20, output: 5 }]) })
    const data = await readChecked(createUsageStatSource(deps), 'stat', { id: 'card', widget: 'stat', props: { metric: 'tokens' } }) as { value: number, unit: string }
    expect(data.value).toBe(25)
    expect(data.unit).toBe('Tokens')
  })

  it('没有任何历史记录时给空对象', async () => {
    expect(await readChecked(createUsageStatSource(depsOf()), 'stat')).toEqual({})
  })
})

describe('容量表盘', () => {
  it('内存、磁盘与看板状态额度三项都在，额度按整块看板算', async () => {
    const board = boardOf([instance('a', 'gauge', { note: 'x'.repeat(3000) }), instance('b', 'gauge', { note: 'y'.repeat(2000) })])
    const deps = depsOf({ workspace: { list: () => [board], active: () => board } })
    const data = await readChecked(createCapacityItemsSource(deps), 'gauge') as { items: { label: string, value: number, max: number, note: string, tone: string }[] }
    expect(data.items.map((item) => item.label)).toEqual(['系统内存', '磁盘空间', '看板状态额度'])
    expect(data.items[2]?.max).toBe(1024)
    expect(data.items[2]?.value).toBeGreaterThan(0)
    expect(data.items[2]?.note).toContain('KB')
  })
})

describe('提供方表格', () => {
  it('列是四列，行按健康记录来', async () => {
    const health = createProviderHealth()
    const release = health.registered('acme')
    const data = await readChecked(createProvidersTableSource(depsOf({ health })), 'table') as { columns: { key: string }[]; rows: Record<string, unknown>[] }
    expect(data.columns.map((column) => column.key)).toEqual(['name', 'state', 'registrations', 'failures'])
    expect(data.rows[0]?.name).toBe('acme')
    expect(data.rows[0]?.state).toBe('在线')
    expect(data.rows[0]?.registrations).toBe(1)
    release()
  })

  it('健康记录为空时也给看板自己的一行', async () => {
    const data = await readChecked(createProvidersTableSource(depsOf()), 'table') as { rows: Record<string, unknown>[] }
    expect(data.rows.length).toBe(1)
    expect(data.rows[0]?.name).toBe('widget-board')
  })
})

describe('运行环境', () => {
  it('插件、Node.js、看板与组件库四项都在', async () => {
    const data = await readChecked(createRuntimeKvSource(depsOf()), 'kv') as { items: { key: string, value: string | number }[] }
    expect(data.items.map((item) => item.key)).toEqual(['插件', 'Node.js', '看板', '组件库'])
    expect(data.items[0]?.value).toBe('dsh-widget-board')
    expect(data.items[1]?.value).toBe(process.version)
  })
})

describe('当前看板的快照', () => {
  it('快照里有标题、修订号、卡片数与每种组件各几张卡', async () => {
    const board = boardOf([instance('a', 'gauge'), instance('b', 'gauge'), instance('c', 'kv')])
    const deps = depsOf({ workspace: { list: () => [board], active: () => board } })
    const data = await readChecked(createBoardJsonSource(deps), 'json') as { value: { board: string, revision: number, cards: number, widgets: Record<string, number> }; caption: string }
    expect(data.value.board).toBe('我的看板')
    expect(data.value.revision).toBe(7)
    expect(data.value.cards).toBe(3)
    expect(data.value.widgets).toEqual({ gauge: 2, kv: 1 })
    expect(data.caption).toBe('当前看板实时快照')
  })
})

describe('订阅的生命周期', () => {
  afterEach(() => { vi.useRealTimers() })

  it('订阅时先给一份，之后每个间隔再给一份', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const source = createRuntimeKvSource(depsOf())
    const subscribe = source.subscribe
    if (subscribe === undefined) throw new Error('运行环境的数据源应当声明 subscribe')
    const pushed: unknown[] = []
    const stop = subscribe(FACE, (data) => { pushed.push(data) })
    await until(() => pushed.length >= 1, '订阅时的第一份读数')
    vi.advanceTimersByTime(10000)
    await until(() => pushed.length >= 2, '下一个间隔的那一份读数')
    stop()
  })

  it('退订之后不再回调', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const source = createRuntimeKvSource(depsOf())
    const subscribe = source.subscribe
    if (subscribe === undefined) throw new Error('运行环境的数据源应当声明 subscribe')
    const pushed: unknown[] = []
    const stop = subscribe(FACE, (data) => { pushed.push(data) })
    await until(() => pushed.length >= 1, '订阅时的第一份读数')
    stop()
    vi.advanceTimersByTime(30000)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(pushed).toHaveLength(1)
  })
})
