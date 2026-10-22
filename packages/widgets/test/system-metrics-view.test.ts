/**
 * 运行成本卡的纯视图逻辑（issue #5）：字节格式化、历史裁剪与空态判定。
 *
 * `view.js` 同时以经典脚本内联进组件文档；这里按副作用模块载入同一份文件，读到的是卡片真正
 * 在用的实现，不是另写一份样例。
 */
import { describe, expect, it } from 'vitest'
import '../system-metrics/view.js'

interface Formatted {
  value: string
  unit: string
  text: string
}

interface ViewApi {
  LIMIT: number
  formatBytes(bytes: unknown, lang: string): Formatted
  sampleOf(value: unknown): { at: string, rss: number } | null
  trimSamples(list: unknown, limit: number): { at: string, rss: number }[]
  appendSample(list: unknown, sample: unknown, limit: number): { at: string, rss: number }[]
  trendOf(samples: unknown): { count: number, line: string, area: string, low: string, high: string } | null
  stampOf(iso: unknown, lang: string): string
  viewOf(data: unknown, samples: unknown, lang: string): Record<string, unknown>
}

const view = (globalThis as unknown as { SystemMetricsView: ViewApi }).SystemMetricsView
const MB = 1024 * 1024
const GB = 1024 * 1024 * 1024
const KB = 1024

/** 一份完整的采样数据。 */
const DATA = {
  sampledAt: '2026-10-22T10:00:00.000Z',
  readMs: 0.4,
  host: { rss: 184 * MB, heapUsed: 42 * MB, heapTotal: 58 * MB, external: 11 * MB, arrayBuffers: 4 * MB },
  system: {
    platform: 'Windows 11 Pro',
    cpus: 16,
    loadAverage: null,
    totalMemory: 50 * GB,
    freeMemory: 28 * GB,
    disk: { available: 715 * GB, total: 999 * GB },
  },
  board: { cards: 24, boards: 3, stateBytes: 18 * KB, documentsBytes: Math.round(7.2 * MB) },
  library: { widgets: 27, versions: 61 },
}

describe('字节格式化', () => {
  it('按 1024 进制换成 KB、MB 与 GiB', () => {
    expect(view.formatBytes(0, 'en-US')).toEqual({ value: '0', unit: 'B', text: '0 B' })
    expect(view.formatBytes(1023, 'en-US').text).toBe('1,023 B')
    expect(view.formatBytes(1024, 'en-US')).toEqual({ value: '1', unit: 'KB', text: '1 KB' })
    expect(view.formatBytes(1536, 'en-US').text).toBe('1.5 KB')
    expect(view.formatBytes(18 * KB, 'zh-CN').text).toBe('18 KB')
    expect(view.formatBytes(7.2 * MB, 'en-US').text).toBe('7.2 MB')
    expect(view.formatBytes(1024 * MB, 'en-US').text).toBe('1 GiB')
    expect(view.formatBytes(1536 * MB, 'en-US').text).toBe('1.5 GiB')
  })

  it('十位以上不留小数，十位以下留一位', () => {
    expect(view.formatBytes(9.8 * MB, 'en-US').text).toBe('9.8 MB')
    expect(view.formatBytes(10.4 * MB, 'en-US').text).toBe('10 MB')
  })

  it('不是数字时给占位，不编造读数', () => {
    for (const value of [undefined, null, -1, Number.NaN, '12']) {
      expect(view.formatBytes(value, 'zh-CN')).toEqual({ value: '—', unit: '', text: '—' })
    }
  })
})

describe('历史裁剪', () => {
  const many = Array.from({ length: 75 }, (_, index) => ({ at: String(index), rss: (100 + index) * MB }))

  it('只留最近 60 个采样', () => {
    const kept = view.trimSamples(many, 60)
    expect(kept).toHaveLength(60)
    expect(kept[0]?.at).toBe('15')
    expect(kept[59]?.at).toBe('74')
  })

  it('追加到上限后丢掉最旧的一个', () => {
    const kept = view.trimSamples(many, 60)
    const next = view.appendSample(kept, { at: '75', rss: 200 * MB }, 60)
    expect(next).toHaveLength(60)
    expect(next[0]?.at).toBe('16')
    expect(next[59]?.at).toBe('75')
  })

  it('60 次采样写进状态远低于单卡 64 KB 的额度', () => {
    const samples = Array.from({ length: 60 }, (_, index) => ({
      at: new Date(Date.UTC(2026, 9, 22, 10, index, 0)).toISOString(),
      rss: 190 * MB + index * 1024,
    }))
    expect(Buffer.byteLength(JSON.stringify({ samples }), 'utf8')).toBeLessThan(64 * 1024)
  })

  it('形状不对的采样被丢掉，不会画进走势', () => {
    const next = view.trimSamples([{ at: 'a', rss: 1 }, null, { at: 'b' }, { at: 'c', rss: 'x' }, { at: 'd', rss: 2 }], 60)
    expect(next).toEqual([{ at: 'a', rss: 1 }, { at: 'd', rss: 2 }])
  })
})

describe('空态', () => {
  it('没有数据时给空态', () => {
    expect(view.viewOf(null, [], 'zh-CN')).toEqual({ state: 'empty' })
    expect(view.viewOf(undefined, [], 'zh-CN')).toEqual({ state: 'empty' })
  })

  it('数据缺项时也是空态，不拿缺失的字段当 0', () => {
    expect(view.viewOf({}, [], 'zh-CN')).toEqual({ state: 'empty' })
    expect(view.viewOf({ host: {}, system: {}, board: {}, library: {} }, [], 'zh-CN')).toEqual({ state: 'empty' })
    expect(view.viewOf({ ...DATA, host: { ...DATA.host, rss: undefined } }, [], 'zh-CN')).toEqual({ state: 'empty' })
    expect(view.viewOf({ ...DATA, system: { ...DATA.system, freeMemory: DATA.system.totalMemory + 1 } }, [], 'zh-CN')).toEqual({ state: 'empty' })
  })

  it('数据完整时给出宿主、机器、看板与组件库的读数', () => {
    const model = view.viewOf(DATA, [], 'en-US') as {
      state: string
      rss: Formatted
      heap: { used: Formatted, total: Formatted, ratio: number }
      external: Formatted
      arrayBuffers: Formatted
      system: {
        platform: string
        cpus: number
        load: number | null
        loadRatio: number | null
        memory: { used: Formatted, total: Formatted, ratio: number }
        disk: { available: Formatted, total: Formatted, ratio: number } | null
      }
      board: { cards: number, boards: number, state: Formatted, documents: Formatted }
      library: { widgets: number, versions: number }
      readMs: number | null
      trend: unknown
      stamp: string
    }
    expect(model.state).toBe('ready')
    expect(model.rss.unit).toBe('MB')
    expect(model.heap.used.text).toBe('42 MB')
    expect(model.heap.total.text).toBe('58 MB')
    expect(model.heap.ratio).toBeCloseTo(42 / 58, 4)
    expect(model.external.text).toBe('11 MB')
    expect(model.arrayBuffers.text).toBe('4 MB')
    expect(model.system.platform).toBe('Windows 11 Pro')
    expect(model.system.cpus).toBe(16)
    expect(model.system.load).toBeNull()
    expect(model.system.loadRatio).toBeNull()
    expect(model.system.memory.used.text).toBe('22 GiB')
    expect(model.system.memory.total.text).toBe('50 GiB')
    expect(model.system.memory.ratio).toBeCloseTo(22 / 50, 4)
    expect(model.system.disk?.available.text).toBe('715 GiB')
    expect(model.system.disk?.total.text).toBe('999 GiB')
    expect(model.system.disk?.ratio).toBeCloseTo((999 - 715) / 999, 4)
    expect(model.board.cards).toBe(24)
    expect(model.board.boards).toBe(3)
    expect(model.board.state.text).toBe('18 KB')
    expect(model.board.documents.text).toBe('7.2 MB')
    expect(model.library.widgets).toBe(27)
    expect(model.library.versions).toBe(61)
    expect(model.readMs).toBe(0.4)
    expect(model.trend).toBeNull()
    expect(model.stamp).not.toBe('')
  })

  it('负载是数字时给出比例；磁盘读不到时是 null', () => {
    const model = view.viewOf({
      ...DATA,
      system: { ...DATA.system, loadAverage: 2.5, disk: null },
    }, [], 'en-US') as {
      system: { load: number | null, loadRatio: number | null, disk: unknown }
    }
    expect(model.system.load).toBe(2.5)
    expect(model.system.loadRatio).toBeCloseTo(2.5 / 16, 4)
    expect(model.system.disk).toBeNull()
  })
})

describe('走势', () => {
  it('两个点才画折线，面积闭合到基线', () => {
    const trend = view.trendOf([{ at: 'a', rss: 100 * MB }, { at: 'b', rss: 200 * MB }])
    expect(trend).not.toBeNull()
    expect(trend?.count).toBe(2)
    expect(trend?.line).toMatch(/^M[\d.]+ [\d.]+ L[\d.]+ [\d.]+$/)
    expect(trend?.area.endsWith('L100 24 L0 24 Z')).toBe(true)
    expect(trend?.low).toBe('100 MB')
    expect(trend?.high).toBe('200 MB')
  })

  it('只有一个点或读数完全相同时不画走势', () => {
    expect(view.trendOf([{ at: 'a', rss: 100 * MB }])).toBeNull()
    const flat = view.trendOf([{ at: 'a', rss: 100 * MB }, { at: 'b', rss: 100 * MB }])
    expect(flat?.line).toBe('M0 12 L100 12')
  })

  it('采样超过 60 个时只画最近 60 个', () => {
    const many = Array.from({ length: 90 }, (_, index) => ({ at: String(index), rss: (100 + index) * MB }))
    const trend = view.trendOf(many)
    expect(trend?.count).toBe(60)
  })
})
