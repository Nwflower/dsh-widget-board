/**
 * GitHub 账号的 issue 能力（D24）：读一张卡上配好的 `GITHUB_TOKEN` 所属账号名下、还开着口的 issue。
 *
 * 账号由令牌决定，卡片上没有用户名可填：`GET /user` 回的那个 `login` 就是这张卡认的账号。列表走
 * `user:@me is:issue is:open`：`user:` 取账号名下的仓库、`is:issue` 把 PR 挡在外面、`is:open` 只留
 * 还开着口的。`total_count` 顺便给出待处理的总数。
 *
 * 凭据只在这一次读里出现：值从宿主的凭据服务现取，不写进返回值，也不跨调用保存。缓存按令牌的摘要
 * 分键，只留读到的结果与时刻——搜索接口每分钟只给 30 次，没换令牌时就先给上一次的结果。卡片上按
 * 刷新时传 `refresh` 跳过缓存，剩下的请求次数用在真的想知道的时候。
 */
import { createHash } from 'node:crypto'
import type { CapabilityRegistration, HostCredentials, InstanceFace } from '@dsh-widget-board/contracts'
import { WIDGET_BOARD_API_VERSION } from '@dsh-widget-board/contracts'
import type { FetchLike } from './http'
import { HTTP_TIMEOUT_MS, readJsonBody } from './http'
import type { Registries } from './sources'

/** 能力的名字；组件 manifest 用它声明（D24）。 */
export const GITHUB_ISSUES_CAPABILITY = 'github.issues'

/** 能力的提供方名；设置弹窗与授权记录用它标注归属。 */
export const GITHUB_PROVIDER = 'github'

/** 组件要配的凭据：一个人的 GitHub 令牌，权限只需读公开仓库。 */
export const GITHUB_TOKEN_REF = 'GITHUB_TOKEN'

/** 一次读最多带回多少条 issue；再多卡片里也放不下，只是多耗一次搜索配额。 */
export const GITHUB_ISSUE_LIMIT = 30

/** 一条 issue 最多带几个标签。 */
const LABEL_LIMIT = 3

/** 同一个令牌的搜索结果留多久。搜索接口按分钟计配额，缓存期间重复读同一个结果不占配额。 */
export const GITHUB_CACHE_MS = 5 * 60_000

/** 记多少个账号的登录名；令牌换了就是一个新键，旧的最多留这么几份。 */
const ACCOUNT_CACHE_ENTRIES = 8

/** 能力的接口地址。 */
const API = 'https://api.github.com'

/** 一个标签：名字与 GitHub 给的颜色（六位十六进制，没有 `#`）。 */
export interface GithubLabel {
  name: string
  /** 空串表示这条标签没带颜色。 */
  color: string
}

/** 一条 issue 的样子；字段是卡片画一行需要的全部。 */
export interface GithubIssue {
  number: number
  title: string
  repository: string
  /** 开这条 issue 的账号；读不出来时是空串。 */
  author: string
  createdAt: string
  /** 最后一次改动的时刻；卡片右边那一列写「更新」。 */
  updatedAt: string
  comments: number
  labels: GithubLabel[]
  /** issue 自己的地址，点一行时交给宿主打开。 */
  url: string
}

/** 一次读的结果：读到了、没有配令牌、令牌被拒、还是这次没读成。 */
export type GithubIssues =
  | { status: 'ready', account: string, total: number, items: GithubIssue[] }
  | { status: 'unconfigured' }
  | { status: 'rejected' }
  | { status: 'failed', reason: string }

/** 令牌被 GitHub 拒了：与网络故障分开，卡片据此让人去换令牌。 */
class TokenRejected extends Error {}

/** 一条 issue 的 schema；与 `GithubIssue` 一一对应，宿主在回给组件之前按它校验。 */
const ISSUE = {
  type: 'object',
  additionalProperties: false,
  required: ['number', 'title', 'repository', 'author', 'createdAt', 'updatedAt', 'comments', 'labels', 'url'],
  properties: {
    number: { type: 'integer', minimum: 1 },
    title: { type: 'string' },
    repository: { type: 'string' },
    author: { type: 'string' },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
    comments: { type: 'integer', minimum: 0 },
    labels: {
      type: 'array',
      maxItems: LABEL_LIMIT,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'color'],
        properties: { name: { type: 'string' }, color: { type: 'string', pattern: '^([0-9a-fA-F]{6})?$' } },
      },
    },
    url: { type: 'string' },
  },
} as const

/** 能力返回值的 schema：四种结果各一支。 */
const OUTPUT = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['status', 'account', 'total', 'items'],
      properties: {
        status: { const: 'ready' },
        account: { type: 'string' },
        total: { type: 'integer', minimum: 0 },
        items: { type: 'array', items: ISSUE },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['status'],
      properties: { status: { enum: ['unconfigured', 'rejected'] } },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['status', 'reason'],
      properties: { status: { const: 'failed' }, reason: { type: 'string' } },
    },
  ],
} as const

/** 能力的入参：这一次要几条，以及要不要跳过后台缓存。 */
const INPUT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    limit: { type: 'integer', minimum: 1, maximum: GITHUB_ISSUE_LIMIT },
    /** 由人按下的刷新传真：跳过缓存重新问 GitHub。 */
    refresh: { type: 'boolean' },
  },
} as const

/**
 * 令牌的摘要：缓存按它分键，内存里不长期留着令牌本身。
 *
 * @param token - 令牌。
 * @returns 十六进制摘要。
 */
function digestOf(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 32)
}

/**
 * 请求 GitHub 的接口。
 *
 * @param path - 以 `/` 开头的路径与查询串。
 * @param token - 令牌。
 * @param signal - 中止信号：调用被取消或超时时停在这里。
 * @param fetchImpl - 请求函数；测试里换成替身。
 * @returns 解析出来的 JSON。
 * @throws {TokenRejected} 令牌无效、过期或没有这项权限。
 * @throws {Error} 网络失败、非 2xx、正文读不出来。
 */
async function githubJson(path: string, token: string, signal: AbortSignal, fetchImpl: FetchLike): Promise<unknown> {
  // 调用在建请求之前就被取消时，信号已经错过：不必再发出去。
  if (signal.aborted) throw new Error('读 issue 的调用已被取消')
  const url = `${API}${path}`
  const timeout = AbortSignal.timeout(HTTP_TIMEOUT_MS)
  let response: Response
  try {
    response = await fetchImpl(url, {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'user-agent': 'dsh-widget-board',
        'x-github-api-version': '2022-11-28',
      },
      redirect: 'error',
      signal: AbortSignal.any([signal, timeout]),
    })
  } catch (error) {
    throw new Error(`请求 api.github.com 失败：${error instanceof Error ? error.message : String(error)}`)
  }
  if (response.status === 401 || response.status === 403) {
    const limited = response.headers.get('x-ratelimit-remaining') === '0'
    throw new TokenRejected(limited ? 'GitHub 的请求配额用完了，等一会儿再刷新' : '令牌无效、过期，或没有读这些仓库的权限')
  }
  if (!response.ok) throw new Error(`请求 api.github.com 返回 ${String(response.status)}`)
  return await readJsonBody(response, 'api.github.com')
}

/** 从 `GET /user` 的响应里取登录名。 */
function loginOf(body: unknown): string | undefined {
  if (body === null || typeof body !== 'object') return undefined
  const login = (body as { login?: unknown }).login
  return typeof login === 'string' && login.trim() !== '' ? login : undefined
}

/** 从搜索结果的 `repository_url` 里取 `owner/name`。 */
function repositoryOf(value: unknown): string {
  if (typeof value !== 'string') return ''
  const marker = '/repos/'
  const at = value.indexOf(marker)
  return at === -1 ? '' : value.slice(at + marker.length)
}

/**
 * 把搜索接口回来的条目收成一条 issue；不是 issue 或读不出编号的跳过。
 *
 * @param raw - 搜索接口里的一项。
 * @returns 卡片要的那一条；读不出来时是 `undefined`。
 */
function issueOf(raw: unknown): GithubIssue | undefined {
  if (raw === null || typeof raw !== 'object') return undefined
  const entry = raw as Record<string, unknown>
  const repository = repositoryOf(entry.repository_url)
  if (typeof entry.number !== 'number' || typeof entry.title !== 'string' || repository === '') return undefined
  const labels: GithubLabel[] = Array.isArray(entry.labels)
    ? entry.labels.flatMap((label): GithubLabel[] => {
      if (label === null || typeof label !== 'object') return []
      const name = (label as { name?: unknown }).name
      if (typeof name !== 'string' || name.trim() === '') return []
      const color = (label as { color?: unknown }).color
      const hex = typeof color === 'string' ? color.replace(/^#/, '') : ''
      return [{ name, color: /^[0-9a-fA-F]{6}$/.test(hex) ? hex : '' }]
    }).slice(0, LABEL_LIMIT)
    : []
  // 地址自己拼：搜索结果的 html_url 是有的，但卡片一定要 `https:` 开头，不依赖它给什么。
  const url = `https://github.com/${repository}/issues/${String(entry.number)}`
  const createdAt = typeof entry.created_at === 'string' ? entry.created_at : ''
  const author = entry.user !== null && typeof entry.user === 'object' && typeof (entry.user as { login?: unknown }).login === 'string'
    ? (entry.user as { login: string }).login
    : ''
  return {
    number: entry.number,
    title: entry.title.trim() === '' ? `#${String(entry.number)}` : entry.title,
    repository,
    author,
    createdAt,
    updatedAt: typeof entry.updated_at === 'string' ? entry.updated_at : createdAt,
    comments: typeof entry.comments === 'number' && entry.comments >= 0 ? entry.comments : 0,
    labels,
    url,
  }
}

/** 搜索接口的响应。 */
interface SearchBody {
  total_count?: unknown
  items?: unknown
}

/**
 * 一次读的全过程：取令牌、认账号、拉列表。
 *
 * @param credentials - 宿主的凭据服务；部署里没有时是 `undefined`。
 * @param args - 已经按 input schema 校验过的参数。
 * @param signal - 中止信号。
 * @param deps - 请求替身与两处缓存。
 * @returns 四种结果之一。
 */
async function readIssues(
  credentials: HostCredentials | undefined,
  args: unknown,
  signal: AbortSignal,
  deps: {
    fetch: FetchLike
    cache: Map<string, { at: number, value: GithubIssues }>
    accounts: Map<string, string>
    now: () => number
  },
): Promise<GithubIssues> {
  if (credentials === undefined) return { status: 'unconfigured' }
  const resolved = await credentials.resolve(GITHUB_TOKEN_REF)
  if (resolved === undefined) return { status: 'unconfigured' }
  const token = resolved.value
  const digest = digestOf(token)
  const asked = args as { limit?: unknown, refresh?: unknown } | null
  const limit = Math.min(Number(asked?.limit) || 8, GITHUB_ISSUE_LIMIT)
  const refresh = asked?.refresh === true
  const key = `${digest}:${String(limit)}`
  const hit = deps.cache.get(key)
  if (!refresh && hit !== undefined && deps.now() - hit.at < GITHUB_CACHE_MS) return hit.value

  try {
    let account = deps.accounts.get(digest)
    if (account === undefined) {
      const who = loginOf(await githubJson('/user', token, signal, deps.fetch))
      if (who === undefined) throw new Error('GitHub 没有回账号名')
      account = who
      deps.accounts.set(digest, account)
      if (deps.accounts.size > ACCOUNT_CACHE_ENTRIES) {
        const oldest = deps.accounts.keys().next().value
        if (oldest !== undefined) deps.accounts.delete(oldest)
      }
    }
    const search = new URLSearchParams({
      q: 'user:@me is:issue is:open',
      sort: 'created',
      order: 'desc',
      per_page: String(limit),
    })
    const body = await githubJson(`/search/issues?${search.toString()}`, token, signal, deps.fetch) as SearchBody
    const items = Array.isArray(body.items)
      ? body.items.map(issueOf).filter((item): item is GithubIssue => item !== undefined)
      : []
    const total = typeof body.total_count === 'number' ? body.total_count : items.length
    const value: GithubIssues = { status: 'ready', account, total, items }
    deps.cache.set(key, { at: deps.now(), value })
    return value
  } catch (error) {
    if (error instanceof TokenRejected) {
      // 换了令牌就是另一个键；被拒的这一份不留，下一次调用照旧去问。
      deps.accounts.delete(digest)
      return { status: 'rejected' }
    }
    return { status: 'failed', reason: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * 建出 issue 能力。
 *
 * @param options - 取凭据服务的函数与请求、时钟的替身。
 * @returns 能力注册项。
 */
export function githubIssuesCapability(options: {
  credentials: () => HostCredentials | undefined
  fetch?: FetchLike
  now?: () => number
}): CapabilityRegistration {
  const cache = new Map<string, { at: number, value: GithubIssues }>()
  const accounts = new Map<string, string>()
  const deps = {
    fetch: options.fetch ?? fetch,
    cache,
    accounts,
    now: options.now ?? Date.now,
  }
  return {
    apiVersion: WIDGET_BOARD_API_VERSION,
    provider: GITHUB_PROVIDER,
    id: GITHUB_ISSUES_CAPABILITY,
    title: { zh: 'GitHub 上还开着的 issue', en: 'Open GitHub issues' },
    description: {
      zh: '按卡片设置里的 GitHub 令牌认账号，读这个账号名下还没关的 issue；令牌由宿主的凭据服务保存。',
      en: 'Uses the GitHub token from the card settings to find the account and read the open issues on its repositories.',
    },
    input: INPUT,
    output: OUTPUT,
    // 不声明权限：令牌是人自己填进卡片设置的，读的也只是它所属账号名下的 issue（D27、D24）。
    credentials: [
      {
        ref: GITHUB_TOKEN_REF,
        label: { zh: 'GitHub 令牌', en: 'GitHub token' },
        description: {
          zh: '只读公开仓库的令牌就够了；账号由令牌决定，不用另填用户名。',
          en: 'A read-only token is enough; the account comes from the token, so there is no username to fill in.',
        },
        required: true,
      },
    ],
    async call(_instance: InstanceFace, args: unknown, signal: AbortSignal): Promise<GithubIssues> {
      return await readIssues(options.credentials(), args, signal, deps)
    },
  }
}

/**
 * 把 issue 能力注册进看板的注册表。
 *
 * @param sources - 看板的注册表。
 * @param credentials - 取宿主凭据服务的函数；服务缺席时是 `undefined`。
 * @param fetchImpl - 请求函数；测试里换成替身。
 * @returns 撤下这次注册的函数。
 */
export function registerGithub(
  sources: Registries,
  credentials: () => HostCredentials | undefined,
  fetchImpl?: FetchLike,
): () => void {
  return sources.registerCapability(githubIssuesCapability({ credentials, ...(fetchImpl === undefined ? {} : { fetch: fetchImpl }) }))
}
