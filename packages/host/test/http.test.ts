/**
 * 宿主代发的 HTTP 数据源（D6）：地址模板、主机许可、内网限制与响应处理。
 *
 * 请求本身换成替身，测试只盯着「请求发出前核对了什么」与「响应怎么变成卡片的数据」。
 */
import { describe, expect, it } from 'vitest'
import type { WidgetManifest } from '@dsh-widget-board/contracts'
import { HTTP_BODY_LIMIT, createHttpSource, readHttpSource, requestUrlOf } from '../src/http'
import type { FetchLike, HttpCache } from '../src/http'

/** 一份带地址模板的天气组件 manifest。 */
function manifest(overrides: Partial<WidgetManifest> = {}): WidgetManifest {
  return {
    id: 'weather',
    title: { zh: '天气', en: 'Weather' },
    version: '0.1.0',
    sizes: ['s'],
    source: 'http',
    request: { url: 'https://api.open-meteo.com/v1/forecast?latitude={latitude}&longitude={longitude}' },
    props: {
      type: 'object',
      properties: {
        latitude: { type: 'number', default: 39.9042 },
        longitude: { type: 'number', default: 116.4074 },
      },
    },
    permissions: { hosts: ['api.open-meteo.com'] },
    ...overrides,
  }
}

/** 一个只返回给定正文的请求替身。 */
function answering(body: string, status = 200): FetchLike {
  return async () => new Response(body, { status })
}

describe('地址模板', () => {
  it('props 没有给值时用 props schema 的默认值', () => {
    expect(requestUrlOf(manifest(), {})).toBe('https://api.open-meteo.com/v1/forecast?latitude=39.9042&longitude=116.4074')
  })

  it('props 里的值覆盖默认值，字符串按 URL 编码', () => {
    const custom = manifest({
      request: { url: 'https://api.open-meteo.com/v1/search?q={q}' },
      props: { type: 'object', properties: { q: { type: 'string', default: 'Beijing' } } },
    })
    expect(requestUrlOf(custom, { q: 'a b&c' })).toBe('https://api.open-meteo.com/v1/search?q=a%20b%26c')
  })

  it('占位符在 props 与默认值里都没有时报错', () => {
    const missing = manifest({ request: { url: 'https://api.open-meteo.com/v1/forecast?latitude={latitude}&q={q}' } })
    expect(() => requestUrlOf(missing, {})).toThrow(/\{q\}/)
  })

  it('不是 https 的地址被拒绝', () => {
    const plain = manifest({ request: { url: 'http://api.open-meteo.com/v1/forecast' } })
    expect(() => requestUrlOf(plain, {})).toThrow(/只能是 https/)
  })

  it('主机没有写在 permissions.hosts 里时被拒绝', () => {
    const other = manifest({ request: { url: 'https://example.com/weather' } })
    expect(() => requestUrlOf(other, {})).toThrow(/没有写在 permissions\.hosts/)
  })

  it('即使写进了 hosts，回环与 IP 字面量也被拒绝', () => {
    const loopback = manifest({
      request: { url: 'https://127.0.0.1/weather' },
      permissions: { hosts: ['127.0.0.1'] },
    })
    expect(() => requestUrlOf(loopback, {})).toThrow(/只在本机或内网/)
    const local = manifest({
      request: { url: 'https://localhost/weather' },
      permissions: { hosts: ['localhost'] },
    })
    expect(() => requestUrlOf(local, {})).toThrow(/只在本机或内网/)
  })

  it('没有声明 request.url 时说明是哪一步缺了', () => {
    expect(() => requestUrlOf(manifest({ request: undefined }), {})).toThrow(/没有声明 request\.url/)
  })
})

describe('请求与响应', () => {
  it('请求带上 JSON 的 accept 与不跟随重定向，正文解析成值', async () => {
    const seen: RequestInit[] = []
    const fetchImpl: FetchLike = async (_url, init) => {
      seen.push(init)
      return new Response(JSON.stringify({ current: { temperature_2m: 15 } }), { status: 200 })
    }
    await expect(readHttpSource(manifest(), {}, { fetch: fetchImpl })).resolves.toEqual({ current: { temperature_2m: 15 } })
    expect(seen[0]?.redirect).toBe('error')
    expect((seen[0]?.headers as Record<string, string>).accept).toBe('application/json')
  })

  it('请求失败、状态不是 2xx、正文不是 JSON 时各自说清楚', async () => {
    const broken: FetchLike = async () => { throw new Error('网络断了') }
    await expect(readHttpSource(manifest(), {}, { fetch: broken })).rejects.toThrow(/请求 api\.open-meteo\.com 失败：网络断了/)
    await expect(readHttpSource(manifest(), {}, { fetch: answering('nope', 503) })).rejects.toThrow(/返回 503/)
    await expect(readHttpSource(manifest(), {}, { fetch: answering('<html>') })).rejects.toThrow(/不是 JSON/)
  })

  it('正文超过上限时拒绝', async () => {
    const huge = `"${'x'.repeat(HTTP_BODY_LIMIT)}"`
    await expect(readHttpSource(manifest(), {}, { fetch: answering(huge) })).rejects.toThrow(/超过/)
  })
})

describe('缓存', () => {
  it('cacheMs 内同一个地址只请求一次，过期后重新请求', async () => {
    let clock = 1_000
    let calls = 0
    const fetchImpl: FetchLike = async () => {
      calls += 1
      return new Response(JSON.stringify({ n: calls }), { status: 200 })
    }
    const cache: HttpCache = new Map()
    const cached = manifest({ request: { url: 'https://api.open-meteo.com/v1/forecast', cacheMs: 5_000 } })
    const options = { fetch: fetchImpl, cache, now: () => clock }
    await expect(readHttpSource(cached, {}, options)).resolves.toEqual({ n: 1 })
    clock += 4_999
    await expect(readHttpSource(cached, {}, options)).resolves.toEqual({ n: 1 })
    expect(calls).toBe(1)
    clock += 1
    await expect(readHttpSource(cached, {}, options)).resolves.toEqual({ n: 2 })
    expect(calls).toBe(2)
  })

  it('地址不同各存一条', async () => {
    let calls = 0
    const fetchImpl: FetchLike = async () => {
      calls += 1
      return new Response(JSON.stringify({ n: calls }), { status: 200 })
    }
    const cache: HttpCache = new Map()
    const cached = manifest({ request: { url: 'https://api.open-meteo.com/v1/forecast?q={q}', cacheMs: 5_000 } })
    await readHttpSource(cached, { q: 'a' }, { fetch: fetchImpl, cache })
    await readHttpSource(cached, { q: 'b' }, { fetch: fetchImpl, cache })
    expect(calls).toBe(2)
  })

  it('没有 cacheMs 时不缓存', async () => {
    let calls = 0
    const fetchImpl: FetchLike = async () => {
      calls += 1
      return new Response(JSON.stringify({ n: calls }), { status: 200 })
    }
    const cache: HttpCache = new Map()
    await readHttpSource(manifest(), {}, { fetch: fetchImpl, cache })
    await readHttpSource(manifest(), {}, { fetch: fetchImpl, cache })
    expect(calls).toBe(2)
  })

  it('失败的请求不写进缓存', async () => {
    let calls = 0
    const fetchImpl: FetchLike = async () => {
      calls += 1
      if (calls === 1) throw new Error('网络断了')
      return new Response(JSON.stringify({ n: 2 }), { status: 200 })
    }
    const cache: HttpCache = new Map()
    const cached = manifest({ request: { url: 'https://api.open-meteo.com/v1/forecast', cacheMs: 5_000 } })
    await expect(readHttpSource(cached, {}, { fetch: fetchImpl, cache })).rejects.toThrow(/请求/)
    await expect(readHttpSource(cached, {}, { fetch: fetchImpl, cache })).resolves.toEqual({ n: 2 })
    expect(calls).toBe(2)
  })
})

describe('注册项', () => {
  it('名字是 http，组件不在库里时读不了', async () => {
    const source = createHttpSource(() => new Map(), 'dsh-widget-board', 2)
    expect(source.id).toBe('http')
    expect(source.provider).toBe('dsh-widget-board')
    await expect(source.read({ id: 'card', widget: 'weather', props: {} })).rejects.toThrow(/不在组件库里/)
  })
})
