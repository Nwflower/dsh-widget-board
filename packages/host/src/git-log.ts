/**
 * 仓库与文档的数据源（D6）：提交时间线、仓库链接与一份 Markdown 文档。
 *
 * 三个数据源都只读本机：提交从当前仓库读，链接从仓库的远端与宿主的服务地址读，文档从卡片自己给的
 * 内容或仓库里的一个文件读。它们不联网、不动宿主，因此不声明权限。
 *
 * 读哪个仓库目录由三处决定：卡片自己的 `cwd` 最优先，没填时跟随当前活跃会话的工作目录，再没有
 * 就取第一个工作区，都没有就用宿主进程的当前目录（`.\/git-utils`）。
 */
import { readFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import type { DataSourceRegistration, InstanceFace } from '@dsh-widget-board/contracts'
import type { RepoCwdDeps } from './git-utils'
import { dataSourceOf, resolveRepoCwd, runGit } from './git-utils'

/** 这些数据源的提供方：组件 manifest 里写成 `widget-board:git.log`。 */
export const GIT_LOG_PROVIDER = 'widget-board'

/** 提交时间线的数据源名。 */
export const GIT_LOG_SOURCE = 'git.log'

/** 提交时间线在组件 manifest 里点名的全名。 */
export const GIT_LOG_NAME = `${GIT_LOG_PROVIDER}:${GIT_LOG_SOURCE}`

/** 仓库链接的数据源名。 */
export const REPO_LINKS_SOURCE = 'repo.links'

/** 仓库链接在组件 manifest 里点名的全名。 */
export const REPO_LINKS_NAME = `${GIT_LOG_PROVIDER}:${REPO_LINKS_SOURCE}`

/** Markdown 文档的数据源名。 */
export const MARKDOWN_DOC_SOURCE = 'markdown.doc'

/** Markdown 文档在组件 manifest 里点名的全名。 */
export const MARKDOWN_DOC_NAME = `${GIT_LOG_PROVIDER}:${MARKDOWN_DOC_SOURCE}`

/** 采样间隔，毫秒：卡片可见期间每这么多个毫秒读一次。 */
export const GIT_LOG_INTERVAL_MS = 10000

/** 一次读多少条提交。 */
export const GIT_LOG_LIMIT = 30

/** 文档的最长字符数，与组件 manifest 里 `markdown` 的 maxLength 一致。 */
export const MARKDOWN_LIMIT = 60000

/** 建这几个数据源要读的东西；每项都可能缺席，缺席时按兜底走（D11）。 */
export interface GitLogDeps extends RepoCwdDeps {
  /** 宿主本机客户端的根地址；没有这一项时给不出对应的链接。 */
  origin?: () => string | undefined
}

/** 提交时间线上的一条。 */
export interface GitLogItem {
  /** 提交的时间，例如 `10-31 09:57`。 */
  time: string
  /** 提交标题。 */
  title: string
  /** 短哈希与作者。 */
  detail: string
  /** 状态：读到了就是 ok。 */
  status: 'ok'
}

/** 一次提交时间线的读取结果。 */
export interface GitLogData {
  items: GitLogItem[]
}

/** 一条链接。 */
export interface RepoLinkItem {
  /** 链接的名字。 */
  title: string
  /** 链接的地址。 */
  url: string
  /** 一行说明。 */
  note: string
}

/** 一次仓库链接的读取结果。 */
export interface RepoLinksData {
  items: RepoLinkItem[]
}

/** 一份 Markdown 文档；卡片没给内容也没给文件时是空对象，组件因此用自己的样例渲染。 */
export interface MarkdownDocData {
  /** 文档正文。 */
  markdown?: string
}

/** 提交日志的字段顺序：短哈希、日期、作者与标题，字段之间用制表符隔开。 */
const LOG_FORMAT = '--format=%h%x09%cd%x09%an%x09%s'

/** 提交日志的日期格式：月-日 时:分。 */
const LOG_DATE = '--date=format:%m-%d %H:%M'

/** 文档入口：这个仓库自己的地址。 */
const REPO_HOME = 'https://github.com/Nwflower/dsh-widget-board'

/** 动效原语的参考页面。 */
const TRANSITIONS_HOME = 'https://transitions.dev'

/**
 * 把 `git log` 的输出读成时间线上的几条。
 *
 * 每一行是短哈希、日期、作者与标题，字段之间用制表符隔开；标题里也可能有制表符，因此剩下的
 * 字段重新拼回去。
 *
 * @param raw - `git log` 的输出。
 * @returns 时间线上的几条。
 */
export function parseGitLog(raw: string): GitLogItem[] {
  const items: GitLogItem[] = []
  for (const line of raw.split(/\r?\n/)) {
    if (line.trim() === '') continue
    const [hash = '', date = '', author = '', ...rest] = line.split('\t')
    items.push({
      time: date.slice(0, 24),
      title: rest.join('\t').slice(0, 120),
      detail: `${hash} · ${author}`.slice(0, 160),
      status: 'ok',
    })
  }
  return items
}

/**
 * 把一个远端地址写成浏览器能打开的地址。
 *
 * `git@github.com:owner/repo.git` 与 `https://github.com/owner/repo.git` 都变成
 * `https://github.com/owner/repo`；别的主机按同样的样子换前缀。
 *
 * @param raw - 远端地址的原文。
 * @returns 浏览器能打开的地址；地址为空时是空串。
 */
export function normalizeRemote(raw: string): string {
  const value = raw.trim()
  if (value === '') return ''
  const ssh = /^git@([^:]+):(.+)$/.exec(value)
  if (ssh !== null) return `https://${ssh[1]}/${ssh[2].replace(/\.git$/, '')}`
  return value.replace(/\.git$/, '')
}

/**
 * 建出提交时间线的数据源。
 *
 * @param deps - 仓库目录的读法与宿主的服务地址。
 * @returns 数据源注册项；它只读本地的仓库，不声明权限。
 */
export function createGitLogSource(deps: GitLogDeps): DataSourceRegistration {
  const collect = async (instance: InstanceFace): Promise<GitLogData> => {
    const cwd = resolveRepoCwd(instance, deps)
    try {
      const raw = await runGit(cwd, ['-c', 'core.quotepath=false', 'log', '-n', String(GIT_LOG_LIMIT), LOG_DATE, LOG_FORMAT])
      return { items: parseGitLog(raw) }
    } catch {
      // 目录不是仓库或仓库还没有第一次提交时给空列表：卡片显示「暂无事件」，一次读失败不该留一条红条。
      return { items: [] }
    }
  }
  return dataSourceOf({
    provider: GIT_LOG_PROVIDER,
    id: GIT_LOG_SOURCE,
    intervalMs: GIT_LOG_INTERVAL_MS,
    label: '提交',
    read: async (instance: InstanceFace): Promise<GitLogData> => await collect(instance),
  })
}

/**
 * 建出仓库链接的数据源。
 *
 * 链接有三处来源：仓库的 `origin` 远端、宿主本机客户端的地址，以及两个固定的文档入口。远端读不到
 * 时只是少一条链接，其余照旧。
 *
 * @param deps - 仓库目录的读法与宿主的服务地址。
 * @returns 数据源注册项；它只读本机的仓库与宿主的地址，不声明权限。
 */
export function createRepoLinksSource(deps: GitLogDeps): DataSourceRegistration {
  const collect = async (instance: InstanceFace): Promise<RepoLinksData> => {
    const items: RepoLinkItem[] = []
    const cwd = resolveRepoCwd(instance, deps)
    try {
      const remote = normalizeRemote(await runGit(cwd, ['remote', 'get-url', 'origin']))
      if (remote !== '') items.push({ title: '仓库远端', url: remote, note: 'origin' })
    } catch {
      // 目录不是仓库或没有远端时没有这一条链接，其余链接照旧（D11）。
    }
    const origin = deps.origin?.()
    if (typeof origin === 'string' && origin.trim() !== '') {
      items.push({ title: '本机看板', url: origin.trim(), note: '宿主服务地址' })
    }
    items.push({ title: '项目仓库', url: REPO_HOME, note: '组件看板源码' })
    items.push({ title: '动效参考', url: TRANSITIONS_HOME, note: '动效原语参考' })
    return { items }
  }
  return dataSourceOf({
    provider: GIT_LOG_PROVIDER,
    id: REPO_LINKS_SOURCE,
    intervalMs: GIT_LOG_INTERVAL_MS,
    label: '仓库链接',
    read: async (instance: InstanceFace): Promise<RepoLinksData> => await collect(instance),
  })
}

/**
 * 建出 Markdown 文档的数据源。
 *
 * 卡片自己给了内容就用它；给了文件名就在当前仓库里读那个文件（相对路径按仓库目录算，绝对路径按它
 * 自己算）；两样都没有时给空对象，组件因此用自己的样例渲染，而不是一张空白的卡。
 *
 * @param deps - 仓库目录的读法。
 * @returns 数据源注册项；它只读本机的文件，不声明权限。
 */
export function createMarkdownDocSource(deps: GitLogDeps): DataSourceRegistration {
  const collect = async (instance: InstanceFace): Promise<MarkdownDocData> => {
    const content = instance.props?.content
    if (typeof content === 'string' && content.trim() !== '') return { markdown: content.slice(0, MARKDOWN_LIMIT) }
    const file = instance.props?.file
    if (typeof file !== 'string' || file.trim() === '') return {}
    const target = isAbsolute(file) ? file : join(resolveRepoCwd(instance, deps), file)
    try {
      return { markdown: (await readFile(target, 'utf8')).slice(0, MARKDOWN_LIMIT) }
    } catch {
      // 文件读不到时给空文档：卡片显示「还没有内容」，一次读失败不该留一条红条。
      return { markdown: '' }
    }
  }
  return dataSourceOf({
    provider: GIT_LOG_PROVIDER,
    id: MARKDOWN_DOC_SOURCE,
    intervalMs: GIT_LOG_INTERVAL_MS,
    label: '文档',
    read: async (instance: InstanceFace): Promise<MarkdownDocData> => await collect(instance),
  })
}
