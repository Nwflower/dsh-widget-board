/**
 * 运行成本的数据源（issue #5）：宿主内存、看板与组件库的计数都从真实形状读出来，读到的数据要
 * 能通过与组件 manifest 里 data schema 的校验；可见期间由订阅每 5 秒推一份（D32）。
 *
 * 宿主进程的内存读数不在这里断言具体数字：它与机器和当时的负载有关；这里只核对范围与类型。
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Board, InstanceFace, WidgetManifest } from '@dsh-widget-board/contracts'
import { buildDocument } from '../src/document'
import type { DocumentAssets } from '../src/document'
import type { WidgetRecord } from '../src/library'
import type { Workspace } from '../src/workspace'
import { dataError } from '../src/schema'
import type { SystemMetrics } from '../src/system-metrics'
import { SYSTEM_METRICS_INTERVAL_MS, SYSTEM_METRICS_NAME, SYSTEM_METRICS_PROVIDER, SYSTEM_METRICS_SOURCE, createSystemMetricsSource } from '../src/system-metrics'

const WIDGET_DIR = fileURLToPath(new URL('../../widgets/system-metrics/', import.meta.url))
const FACE: InstanceFace = { id: 'card', widget: 'system-metrics', props: {} }

/** 一份最小的共用资产：文档拼装要的是这几样文本。 */
const ASSETS: DocumentAssets = {
  tokensCss: ':root { --w-color-fg: #0b1016; }',
  suiteCss: '.t-data { display: flex; }',
  runtimeJs: 'void 0',
  libs: {},
}

/** 一个读得懂的组件记录：文件够拼出一份文档，manifest 用真正发布的那一份。 */
async function record(): Promise<WidgetRecord> {
  const manifest = JSON.parse(await readFile(join(WIDGET_DIR, 'widget.json'), 'utf8')) as WidgetManifest
  return {
    manifest,
    source: 'builtin',
    dir: WIDGET_DIR,
    hash: 'a'.repeat(64),
    files: new Map([
      ['index.html', Buffer.from('<article class="metrics"></article>')],
      ['style.css', Buffer.from('.metrics { display: block; }')],
      ['view.js', Buffer.from('globalThis.SystemMetricsView = { viewOf: () => ({ state: "empty" }) }')],
    ]),
  }
}

/** 一块带若干张卡的看板。 */
function board(id: string, instances: Board['instances']): Board {
  return { version: 2, id, title: id, revision: 1, layoutRevision: 1, instances }
}

/** 一张卡；只有 widget 与 state 参与成本统计。 */
function card(id: string, widget: string, state: unknown = null): Board['instances'][number] {
  return { id, widget, hash: 'a'.repeat(64), props: {}, data: null, state, layout: { x: 0, y: 0, w: 2, h: 18 } }
}

describe('运行成本的数据源', () => {
  it('用 issue 里点名的名字注册，并且不要权限', async () => {
    const source = createSystemMetricsSource({
      workspace: { list: () => [] },
      records: () => new Map(),
      versions: { count: async () => 0 },
      assets: () => ASSETS,
      diskPath: WIDGET_DIR,
    })
    expect(source.provider).toBe(SYSTEM_METRICS_PROVIDER)
    expect(source.id).toBe(SYSTEM_METRICS_SOURCE)
    expect(SYSTEM_METRICS_NAME).toBe('widget-board:system.metrics')
    expect(source.permission).toBeUndefined()
  })

  it('组件 manifest 不再声明定时刷新与专用动作，转而声明按需读能力', async () => {
    const { manifest } = await record()
    expect(manifest.source).toBe(SYSTEM_METRICS_NAME)
    expect(manifest.refresh).toBeUndefined()
    expect(manifest.actions).toBeUndefined()
    expect(manifest.capabilities).toEqual(['widget-board:data.read'])
  })

  it('读到的数据与组件 manifest 的 data schema 相符', async () => {
    const demo = await record()
    const source = createSystemMetricsSource({
      workspace: { list: () => [board('one', [card('a', 'demo'), card('b', 'demo')])] } as Pick<Workspace, 'list'>,
      records: () => new Map([['demo', demo]]),
      versions: { count: async () => 12 },
      assets: () => ASSETS,
      diskPath: WIDGET_DIR,
    })
    const metrics = await source.read(FACE)
    expect(dataError(demo.manifest.data, metrics)).toBeUndefined()
    expect(demo.manifest.source).toBe(SYSTEM_METRICS_NAME)
  })

  it('卡片、看板、状态字节、文档体积与组件库计数都从当前形状算出来', async () => {
    const demo = await record()
    const state = { text: '中文状态' }
    const source = createSystemMetricsSource({
      workspace: {
        list: () => [
          board('one', [card('a', 'demo', state), card('b', 'demo')]),
          // 组件不在组件库里的卡片保留着，但没有文档要加载（D17）。
          board('two', [card('c', 'missing')]),
        ],
      } as Pick<Workspace, 'list'>,
      records: () => new Map([['demo', demo]]),
      versions: { count: async () => 7 },
      assets: () => ASSETS,
      diskPath: WIDGET_DIR,
    })
    const metrics = await source.read(FACE)
    const document = Buffer.byteLength(buildDocument(demo, ASSETS, '', { lang: 'zh-CN' }), 'utf8')
    expect(metrics.board).toEqual({
      cards: 3,
      boards: 2,
      stateBytes: Buffer.byteLength(JSON.stringify(state), 'utf8'),
      documentsBytes: document * 2,
    })
    expect(metrics.library).toEqual({ widgets: 1, versions: 7 })
    expect(Number.isNaN(Date.parse(metrics.sampledAt))).toBe(false)
    for (const value of [metrics.host.rss, metrics.host.heapUsed, metrics.host.heapTotal, metrics.host.external, metrics.host.arrayBuffers]) {
      expect(value).toBeGreaterThanOrEqual(0)
      expect(Number.isInteger(value)).toBe(true)
    }
    expect(metrics.readMs).toBeGreaterThanOrEqual(0)
  })

  it('机器读数从 node:os 与看板数据所在卷读出来', async () => {
    const demo = await record()
    const source = createSystemMetricsSource({
      workspace: { list: () => [] } as Pick<Workspace, 'list'>,
      records: () => new Map([['demo', demo]]),
      versions: { count: async () => 0 },
      assets: () => ASSETS,
      diskPath: WIDGET_DIR,
    })
    const { system } = await source.read(FACE)
    expect(system.platform).not.toBe('')
    expect(system.cpus).toBeGreaterThanOrEqual(1)
    expect(system.totalMemory).toBeGreaterThan(0)
    expect(system.freeMemory).toBeGreaterThanOrEqual(0)
    expect(system.freeMemory).toBeLessThanOrEqual(system.totalMemory)
    expect(system.loadAverage === null || system.loadAverage >= 0).toBe(true)
    if (system.disk !== null) {
      expect(system.disk.total).toBeGreaterThan(0)
      expect(system.disk.available).toBeGreaterThanOrEqual(0)
      expect(system.disk.available).toBeLessThanOrEqual(system.disk.total)
    }
  })

  it('同一版本被多张卡使用时只拼一次文档', async () => {
    const demo = await record()
    let built = 0
    const counting: DocumentAssets = {
      ...ASSETS,
      get suiteCss(): string {
        built += 1
        return ASSETS.suiteCss
      },
    }
    const source = createSystemMetricsSource({
      workspace: {
        list: () => [board('one', Array.from({ length: 4 }, (_, index) => card(String(index), 'demo')))],
      } as Pick<Workspace, 'list'>,
      records: () => new Map([['demo', demo]]),
      versions: { count: async () => 1 },
      assets: () => counting,
      diskPath: WIDGET_DIR,
    })
    await source.read(FACE)
    const afterFirst = built
    await source.read(FACE)
    expect(afterFirst).toBe(1)
    expect(built).toBe(1)
  })
})
/** 轮询到条件成立；假的是定时器，等推送借真的 setTimeout，等不到就停在断言上。 */
async function until(ready: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (ready()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`等不到${what}`)
}

/** 一条订阅：把推上来的读数按顺序记下来，计数可换成自己的那一个。 */
function subscribeMetrics(count: () => Promise<number> = async () => 3) {
  const source = createSystemMetricsSource({
    workspace: { list: () => [] } as Pick<Workspace, 'list'>,
    records: () => new Map(),
    versions: { count },
    assets: () => ASSETS,
    diskPath: WIDGET_DIR,
  })
  const subscribe = source.subscribe
  if (subscribe === undefined) throw new Error('运行成本的数据源应当声明 subscribe')
  const pushed: SystemMetrics[] = []
  const stop = subscribe(FACE, (data) => { pushed.push(data as SystemMetrics) })
  return { pushed, stop }
}

describe('运行成本的订阅', () => {
  afterEach(() => { vi.useRealTimers() })

  it('订阅时先给一份当下的读数，之后每个间隔再给一份', async () => {
    // 只假 setInterval：采样要等真的磁盘与版本库，等推送要借真的 setTimeout。
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    let counted = 0
    const board = subscribeMetrics(async () => { counted += 1; return counted })
    await until(() => board.pushed.length >= 1, '订阅时的第一份读数')
    expect(board.pushed[0]?.library.versions).toBe(1)
    expect(Number.isNaN(Date.parse(board.pushed[0]?.sampledAt ?? ''))).toBe(false)
    vi.advanceTimersByTime(SYSTEM_METRICS_INTERVAL_MS)
    await until(() => board.pushed.length >= 2, '第二个间隔的那一份读数')
    expect(board.pushed[1]?.library.versions).toBe(2)
    board.stop()
  })

  it('退订之后不再回调', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const board = subscribeMetrics()
    await until(() => board.pushed.length >= 1, '订阅时的第一份读数')
    board.stop()
    vi.advanceTimersByTime(SYSTEM_METRICS_INTERVAL_MS * 3)
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(board.pushed).toHaveLength(1)
  })

  it('上一拍还没回来时跳过后面的那一拍，两次采样不重叠', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    let entered = (): void => {}
    const started = new Promise<void>((resolve) => { entered = resolve })
    let release = (): void => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    let sampled = 0
    const board = subscribeMetrics(async () => {
      sampled += 1
      entered()
      if (sampled === 1) await gate
      return sampled
    })
    await started
    expect(board.pushed).toHaveLength(0)
    // 第一拍还卡在计数上：这两拍都该跳过。
    vi.advanceTimersByTime(SYSTEM_METRICS_INTERVAL_MS * 2)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(sampled).toBe(1)
    expect(board.pushed).toHaveLength(0)
    release()
    await until(() => board.pushed.length >= 1, '放行之后的那一份读数')
    expect(board.pushed[0]?.library.versions).toBe(1)
    vi.advanceTimersByTime(SYSTEM_METRICS_INTERVAL_MS)
    await until(() => board.pushed.length >= 2, '下一个间隔的那一份读数')
    expect(board.pushed[1]?.library.versions).toBe(2)
    board.stop()
  })

  it('一拍读不出来只报出来，下一拍照常读', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      let sampled = 0
      const board = subscribeMetrics(async () => {
        sampled += 1
        if (sampled === 1) throw new Error('版本库读不出来')
        return sampled
      })
      await until(() => errors.mock.calls.length > 0, '采样失败的那一声')
      expect(board.pushed).toHaveLength(0)
      expect(errors.mock.calls[0]?.[0]).toContain('运行成本采样失败')
      vi.advanceTimersByTime(SYSTEM_METRICS_INTERVAL_MS)
      await until(() => board.pushed.length >= 1, '失败之后的那一份读数')
      expect(board.pushed[0]?.library.versions).toBe(2)
      board.stop()
    } finally {
      errors.mockRestore()
    }
  })
})
