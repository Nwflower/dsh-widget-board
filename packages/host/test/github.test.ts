/**
 * GitHub 的 issue 能力（D24）：令牌决定账号，读的是这个账号最近创建的 issue。
 *
 * GitHub 换成替身，凭据服务也用内存里的一份；判据只看包装层的几件事——令牌怎么取、账号从哪来、
 * PR 与坏条目怎么处理、被拒与网络故障各自回什么、缓存按什么分键。
 */
import { describe, expect, it } from 'vitest'
import type { HostCredentials, InstanceFace } from '@dsh-widget-board/contracts'
import type { FetchLike } from '../src/http'
import { GITHUB_CACHE_MS, GITHUB_ISSUES_CAPABILITY, GITHUB_PROVIDER, GITHUB_TOKEN_REF, githubIssuesCapability } from '../src/github'

const FACE: InstanceFace = { id: 'card', widget: 'github-issues', props: {} }

/** 一份只回令牌的内存凭据服务。 */
function credentialsWith(value: string | undefined): HostCredentials {
  return {
    async describe() {
      return { configured: value !== undefined, writable: true }
    },
    async resolve() {
      return value === undefined ? undefined : { value, source: 'file' }
    },
    async set() {},
    async unset() {},
  }
}

/** 一条搜索结果的原文。 */
function searchItem(number: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    number,
    title: `issue ${String(number)}`,
    state: 'open',
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-03T00:00:00Z',
    comments: 2,
    html_url: `https://github.com/owner/repo-${String(number)}/issues/${String(number)}`,
    user: { login: 'octocat' },
    repository_url: `https://api.github.com/repos/owner/repo-${String(number)}`,
    labels: [{ name: 'perf', color: 'd73a4a' }, { name: 'ui', color: 'a2eeef' }],
    ...extra,
  }
}

/** 按路径分派的请求替身，并记下每一次请求。 */
function fakeGithub(options: {
  login?: string
  items?: unknown[]
  total?: number
  status?: number
  fail?: Error
} = {}): FetchLike & { calls: { url: string, headers: Record<string, string> }[] } {
  const calls: { url: string, headers: Record<string, string> }[] = []
  const impl = async (url: string, init: RequestInit): Promise<Response> => {
    calls.push({ url, headers: (init.headers ?? {}) as Record<string, string> })
    if (options.fail !== undefined) throw options.fail
    const status = options.status ?? 200
    if (status !== 200) return new Response('{}', { status })
    if (url.endsWith('/user')) return new Response(JSON.stringify({ login: options.login ?? 'octocat' }), { status: 200 })
    return new Response(JSON.stringify({
      total_count: options.total ?? (options.items ?? []).length,
      items: options.items ?? [searchItem(1)],
    }), { status: 200 })
  }
  return Object.assign(impl, { calls })
}

/** 一次调用的信号。 */
const SIGNAL = new AbortController().signal

describe('GitHub 的 issue 能力', () => {
  it('声明提供方、名字、凭据与结果 schema', () => {
    const capability = githubIssuesCapability({ credentials: () => credentialsWith('t') })
    expect(capability.provider).toBe(GITHUB_PROVIDER)
    expect(capability.id).toBe(GITHUB_ISSUES_CAPABILITY)
    expect(capability.credentials?.[0]?.ref).toBe(GITHUB_TOKEN_REF)
    // 令牌是人填进卡片设置的，读的是它所属账号的公开数据：不再另要一份授权。
    expect(capability.permission).toBeUndefined()
    expect(capability.output).toBeDefined()
    expect(capability.input).toBeDefined()
  })

  it('账号来自令牌：先读登录名，再读这个账号名下还开着的 issue', async () => {
    const fetchImpl = fakeGithub({ login: 'Nwflower', items: [searchItem(7), searchItem(9, { labels: [] })], total: 42 })
    const capability = githubIssuesCapability({ credentials: () => credentialsWith('secret-token'), fetch: fetchImpl })
    const result = await capability.call(FACE, { limit: 5 }, SIGNAL)
    expect(result).toEqual({
      status: 'ready',
      account: 'Nwflower',
      total: 42,
      items: [
        { number: 7, title: 'issue 7', repository: 'owner/repo-7', author: 'octocat', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-03T00:00:00Z', comments: 2, labels: [{ name: 'perf', color: 'd73a4a' }, { name: 'ui', color: 'a2eeef' }], url: 'https://github.com/owner/repo-7/issues/7' },
        { number: 9, title: 'issue 9', repository: 'owner/repo-9', author: 'octocat', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-03T00:00:00Z', comments: 2, labels: [], url: 'https://github.com/owner/repo-9/issues/9' },
      ],
    })
    expect(fetchImpl.calls.map((call) => call.url)).toEqual([
      'https://api.github.com/user',
      'https://api.github.com/search/issues?q=user%3A%40me+is%3Aissue+is%3Aopen&sort=created&order=desc&per_page=5',
    ])
    expect(fetchImpl.calls[0]?.headers.authorization).toBe('Bearer secret-token')
  })

  it('没有配令牌时回 unconfigured，不发请求', async () => {
    const fetchImpl = fakeGithub()
    const missing = githubIssuesCapability({ credentials: () => credentialsWith(undefined), fetch: fetchImpl })
    await expect(missing.call(FACE, {}, SIGNAL)).resolves.toEqual({ status: 'unconfigured' })
    const noService = githubIssuesCapability({ credentials: () => undefined, fetch: fetchImpl })
    await expect(noService.call(FACE, {}, SIGNAL)).resolves.toEqual({ status: 'unconfigured' })
    expect(fetchImpl.calls).toHaveLength(0)
  })

  it('令牌被拒与被限流都回 rejected，网络故障回 failed 并带原因', async () => {
    const rejected = githubIssuesCapability({ credentials: () => credentialsWith('bad'), fetch: fakeGithub({ status: 401 }) })
    await expect(rejected.call(FACE, {}, SIGNAL)).resolves.toEqual({ status: 'rejected' })
    const limited = githubIssuesCapability({
      credentials: () => credentialsWith('slow'),
      fetch: async () => new Response('{}', { status: 403, headers: { 'x-ratelimit-remaining': '0' } }),
    })
    await expect(limited.call(FACE, {}, SIGNAL)).resolves.toEqual({ status: 'rejected' })
    const broken = githubIssuesCapability({ credentials: () => credentialsWith('t'), fetch: fakeGithub({ fail: new Error('网络断了') }) })
    const failed = await broken.call(FACE, {}, SIGNAL)
    expect(failed.status).toBe('failed')
    expect(failed.status === 'failed' ? failed.reason : '').toContain('网络断了')
  })

  it('读不出编号或仓库的条目跳过，标签最多留三个', async () => {
    const fetchImpl = fakeGithub({
      items: [
        searchItem(1, { labels: [{ name: 'a', color: 'ff0000' }, { name: 'b' }, { name: 'c' }, { name: 'd' }] }),
        { title: '没有编号', repository_url: 'https://api.github.com/repos/o/r' },
        searchItem(3, { repository_url: 'https://api.github.com/elsewhere' }),
        searchItem(4, { title: '   ' }),
      ],
      total: 4,
    })
    const capability = githubIssuesCapability({ credentials: () => credentialsWith('t'), fetch: fetchImpl })
    const result = await capability.call(FACE, { limit: 10 }, SIGNAL)
    expect(result.status).toBe('ready')
    if (result.status !== 'ready') return
    expect(result.items.map((item) => item.number)).toEqual([1, 4])
    // 颜色照 GitHub 给的原样带着，没带颜色的留空串。
    expect(result.items[0]?.labels).toEqual([{ name: 'a', color: 'ff0000' }, { name: 'b', color: '' }, { name: 'c', color: '' }])
    // 标题是空白时用编号顶上，卡片上不会出现一行空白的标题。
    expect(result.items[1]?.title).toBe('#4')
    // 最后改动时刻缺失时退到创建时刻，右列不会空着。
    expect(result.items[0]?.updatedAt).toBe('2026-10-03T00:00:00Z')
    const createdOnly = searchItem(5, { updated_at: undefined })
    const second = fakeGithub({ items: [createdOnly] })
    const again = await githubIssuesCapability({ credentials: () => credentialsWith('t'), fetch: second }).call(FACE, {}, SIGNAL)
    expect(again.status === 'ready' ? again.items[0]?.updatedAt : '').toBe('2026-10-01T00:00:00Z')
  })

  it('每一条都带自己的地址，按编号拼出来而不是用接口给的', async () => {
    // 搜索结果的 html_url 可能缺失或被代理改写；卡片要开的就是这个仓库下这个编号。
    const fetchImpl = fakeGithub({ items: [searchItem(12, { html_url: 'https://example.com/elsewhere' })] })
    const capability = githubIssuesCapability({ credentials: () => credentialsWith('t'), fetch: fetchImpl })
    const result = await capability.call(FACE, {}, SIGNAL)
    expect(result.status === 'ready' ? result.items[0]?.url : '').toBe('https://github.com/owner/repo-12/issues/12')
  })

  it('同一个令牌与条数在缓存窗口里只请求一次，refresh 跳过缓存', async () => {
    let clock = 1_000
    const fetchImpl = fakeGithub({ items: [searchItem(1)] })
    const capability = githubIssuesCapability({
      credentials: () => credentialsWith('t'),
      fetch: fetchImpl,
      now: () => clock,
    })
    await capability.call(FACE, { limit: 5 }, SIGNAL)
    await capability.call(FACE, { limit: 5 }, SIGNAL)
    // 登录名按令牌记住，搜索按「令牌 + 条数」缓存：第二次只有一次搜索请求，没有第二次 /user。
    expect(fetchImpl.calls).toHaveLength(2)
    clock += GITHUB_CACHE_MS
    await capability.call(FACE, { limit: 5 }, SIGNAL)
    expect(fetchImpl.calls).toHaveLength(3)
    await capability.call(FACE, { limit: 9 }, SIGNAL)
    expect(fetchImpl.calls).toHaveLength(4)
    expect(fetchImpl.calls.at(-1)?.url).toContain('per_page=9')
    // 人按的刷新不吃缓存：同一个键与条数也再问一次。
    await capability.call(FACE, { limit: 9, refresh: true }, SIGNAL)
    expect(fetchImpl.calls).toHaveLength(5)
  })

  it('条数的默认值与上限落在 8 与 30 上', async () => {
    const fetchImpl = fakeGithub()
    const capability = githubIssuesCapability({ credentials: () => credentialsWith('t'), fetch: fetchImpl })
    await capability.call(FACE, {}, SIGNAL)
    expect(fetchImpl.calls[1]?.url).toContain('per_page=8')
    await capability.call(FACE, { limit: 999 }, SIGNAL)
    expect(fetchImpl.calls.at(-1)?.url).toContain('per_page=30')
  })

  it('调用被取消时不再等下去', async () => {
    const controller = new AbortController()
    const hanging: FetchLike = (_url, init) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => { reject(new Error('aborted')) })
    })
    const capability = githubIssuesCapability({ credentials: () => credentialsWith('t'), fetch: hanging })
    const running = capability.call(FACE, {}, controller.signal)
    controller.abort()
    const result = await running
    expect(result.status).toBe('failed')
  })
})
