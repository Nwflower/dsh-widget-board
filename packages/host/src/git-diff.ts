/**
 * 仓库改动的数据源：卡片看得见时读一次真实的 Git 改动，之后每 5 秒读一次。
 *
 * 读的是本地仓库的未提交改动（暂存与未暂存都算，相对于 HEAD）；工作区干净时退回最近一次提交的
 * 改动，卡片上因此总有内容可看。目录不是仓库、仓库还没有第一次提交或 Git 读不出来时给空列表：
 * 卡片显示「暂无改动」，一次读失败不该在卡片上留一条红条。
 *
 * 读哪个目录由三处决定，卡片自己的 props 最优先：props 里的 `cwd` 固定一个仓库；没填时跟随
 * 当前活跃会话的工作目录；再没有就取第一个工作区；都没有就用宿主进程的当前目录。
 *
 * 取样由订阅驱动（D32）：卡片可见时宿主订上，`subscribe` 立刻读一次、之后每 5 秒读一次；上一拍
 * 还没回来时这一拍跳过。卡片离开视口、props 变了或提供方撤下时宿主退订，退订之后不再回调。
 */
import { execFile } from 'node:child_process'
import type { DataSourceRegistration, HostSessions, HostWorkspaceRegistry, InstanceFace } from '@dsh-widget-board/contracts'
import { WIDGET_BOARD_API_VERSION } from '@dsh-widget-board/contracts'

/** 数据源的 id 与提供方：组件 manifest 里写成 `widget-board:git.diff`。 */
export const GIT_DIFF_PROVIDER = 'widget-board'
export const GIT_DIFF_SOURCE = 'git.diff'

/** 组件 manifest 里点名这个数据源时写的全名。 */
export const GIT_DIFF_NAME = `${GIT_DIFF_PROVIDER}:${GIT_DIFF_SOURCE}`

/** 订阅里的采样间隔，毫秒：卡片可见时每这么多个毫秒读一次。 */
export const GIT_DIFF_INTERVAL_MS = 5000

/** 一张卡最多收多少行改动。 */
export const GIT_DIFF_LINE_LIMIT = 400

/** 单行文字的上限，与组件 manifest 里 `text` 的 maxLength 一致。 */
const TEXT_LIMIT = 400

/** Git 命令的超时，毫秒：读不动就当这一拍没有改动。 */
const COMMAND_TIMEOUT_MS = 5000

/** Git 输出的上限，字节：一份大改动读不下时按失败处理。 */
const COMMAND_MAX_BUFFER = 2 * 1024 * 1024

/** 一行改动。 */
export interface GitDiffLine {
  /** 行的类型：新增、删除、上下文或文件路径。 */
  type: 'add' | 'remove' | 'context' | 'meta'
  /** 行里的文字。 */
  text: string
}

/** 一次采样。组件只读这个结构，不接触宿主。 */
export interface GitDiffData {
  /** 改动行；读不到时是空数组。 */
  lines: GitDiffLine[]
}

/** 建这个数据源要读的东西；每项都可能缺席，缺席时按兜底走（D11）。 */
export interface GitDiffDeps {
  /** 宿主的会话服务；读当前活跃会话的工作目录。 */
  sessions?: () => HostSessions | undefined
  /** 宿主的工作区登记表；读第一个工作区的目录。 */
  workspaces?: () => HostWorkspaceRegistry | undefined
  /** 前两处都没有时用的目录。 */
  defaultCwd?: string
}

/**
 * 一份 unified diff 里的三类行头：文件头、块头与说明行。
 *
 * 文件头给出这一段属于哪个文件，块头给出上下文范围，说明行是 `\ No newline at end of file`
 * 之类。改动本身只出现在块头之后。
 */
const FILE_HEADER = /^(?:index |new file mode |deleted file mode |similarity index |rename from |rename to |old mode |new mode |dissimilarity index |copy from |copy to |GIT binary patch|Binary files )/

/**
 * 在一个目录里跑一条 Git 命令。
 *
 * @param cwd - 目标目录。
 * @param args - 命令的参数。
 * @returns 命令的标准输出；命令失败时抛出。
 */
function runGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, windowsHide: true, timeout: COMMAND_TIMEOUT_MS, maxBuffer: COMMAND_MAX_BUFFER, encoding: 'utf8' }, (error, stdout) => {
      if (error) reject(error)
      else resolve(stdout)
    })
  })
}

/**
 * 读一份改动：先看未提交的，没有未提交的就看最近一次提交。
 *
 * 三条命令按顺序试，取到第一条有输出的：仓库还没有第一次提交时 `diff HEAD` 跑不了，退回只看
 * 工作区的那一条；工作区干净时再退回最近一次提交。目录不是仓库时三条都跑不了，给空改动。
 *
 * @param cwd - 目标仓库目录。
 * @returns unified diff 的原文；读不到时是空串。
 */
async function readDiff(cwd: string): Promise<string> {
  const attempts: string[][] = [
    ['-c', 'core.quotepath=false', 'diff', 'HEAD', '--no-color', '--no-ext-diff', '-U3'],
    ['-c', 'core.quotepath=false', 'diff', '--no-color', '--no-ext-diff', '-U3'],
    ['-c', 'core.quotepath=false', 'show', '--format=', '--patch', '--no-color', '--no-ext-diff', '-U3', 'HEAD'],
  ]
  for (const args of attempts) {
    let raw: string
    try {
      raw = await runGit(cwd, args)
    } catch {
      // 这条命令在这个仓库里跑不了（没有 HEAD、不是仓库）；换下一条。
      continue
    }
    if (raw.trim() !== '') return raw
  }
  return ''
}

/**
 * 文件头里的路径：去掉 `a/` 与 `b/` 前缀，`/dev/null` 原样留着。
 *
 * @param raw - 文件头那一行里的路径。
 * @returns 路径。
 */
function pathOf(raw: string): string {
  const value = raw.trim()
  if (value === '/dev/null') return value
  if (value.startsWith('a/') || value.startsWith('b/')) return value.slice(2)
  return value
}

/**
 * 解析一份 unified diff。
 *
 * 文件头里 `+++` 那一行给出这一段的文件路径；新增文件的那一侧是 `/dev/null`，删除文件的那一侧
 * 是 `/dev/null`，两种都从另一侧取路径。路径自成一行（meta），其余按新增、删除与上下文收下。
 *
 * @param raw - `git diff` 的输出。
 * @param limit - 最多收多少行。
 * @returns 改动行。
 */
export function parseUnifiedDiff(raw: string, limit = GIT_DIFF_LINE_LIMIT): GitDiffLine[] {
  const lines: GitDiffLine[] = []
  const source = raw.split(/\r?\n/)
  // 末尾那个换行切出来的空串不是改动行。
  if (source.length > 0 && source[source.length - 1] === '') source.pop()
  let inHunk = false
  let oldPath = ''
  for (const entry of source) {
    if (lines.length >= limit) break
    const line = entry.endsWith('\r') ? entry.slice(0, -1) : entry
    if (line.startsWith('diff --git ')) {
      inHunk = false
      oldPath = ''
      continue
    }
    if (line.startsWith('@@')) {
      inHunk = true
      continue
    }
    if (!inHunk) {
      if (line.startsWith('--- ')) {
        oldPath = pathOf(line.slice(4))
        continue
      }
      if (line.startsWith('+++ ')) {
        const next = pathOf(line.slice(4))
        lines.push({ type: 'meta', text: next === '/dev/null' ? oldPath : next })
        continue
      }
      // 其余文件头（index、new file mode、二进制补丁之类）不带改动内容。
      if (FILE_HEADER.test(line)) continue
    }
    if (line.startsWith('\\')) continue
    if (line.startsWith('+')) {
      lines.push({ type: 'add', text: line.slice(1, TEXT_LIMIT + 1) })
      continue
    }
    if (line.startsWith('-')) {
      lines.push({ type: 'remove', text: line.slice(1, TEXT_LIMIT + 1) })
      continue
    }
    if (line.startsWith(' ')) {
      lines.push({ type: 'context', text: line.slice(1, TEXT_LIMIT + 1) })
      continue
    }
    if (line === '') lines.push({ type: 'context', text: '' })
  }
  return lines
}

/**
 * 这张卡要读哪个目录。
 *
 * 卡片自己填的 `cwd` 最优先；没填时取最后一个有工作目录的活跃会话；再没有取第一个工作区；
 * 都没有就用宿主进程的当前目录。
 *
 * @param instance - 订阅这张卡片。
 * @param deps - 会话、工作区与兜底目录。
 * @returns 目标目录。
 */
function resolveCwd(instance: InstanceFace, deps: GitDiffDeps): string {
  const pinned = instance.props?.cwd
  if (typeof pinned === 'string' && pinned.trim() !== '') return pinned.trim()
  const sessions = deps.sessions?.()
  const live = sessions?.list()
  if (Array.isArray(live)) {
    for (let index = live.length - 1; index >= 0; index -= 1) {
      const cwd = live[index]?.header?.cwd
      if (typeof cwd === 'string' && cwd.trim() !== '') return cwd.trim()
    }
  }
  const workspaces = deps.workspaces?.()
  const spaces = workspaces?.list()
  if (Array.isArray(spaces)) {
    for (const space of spaces) {
      const path = space?.path
      if (typeof path === 'string' && path.trim() !== '') return path.trim()
    }
  }
  return deps.defaultCwd ?? process.cwd()
}

/**
 * 建出仓库改动的数据源。
 *
 * @param deps - 会话、工作区与兜底目录。
 * @returns 数据源注册项；它只读本地的仓库，不声明权限。
 */
export function createGitDiffSource(deps: GitDiffDeps): DataSourceRegistration {
  /**
   * 读一次改动。
   *
   * @param instance - 读这张卡片。
   * @returns 改动行。
   */
  const collect = async (instance: InstanceFace): Promise<GitDiffData> => {
    const cwd = resolveCwd(instance, deps)
    return { lines: parseUnifiedDiff(await readDiff(cwd)) }
  }

  return {
    apiVersion: WIDGET_BOARD_API_VERSION,
    provider: GIT_DIFF_PROVIDER,
    id: GIT_DIFF_SOURCE,
    read(instance: InstanceFace): Promise<GitDiffData> {
      return collect(instance)
    },
    /**
     * 卡片可见期间持续读改动（D32）：先给一份当下的改动，之后每 5 秒一份。
     *
     * 读是异步的（Git 要起一个进程），两拍之间会重叠：上一拍还没回来时这一拍直接跳过。
     *
     * @param instance - 订阅这张卡片。
     * @param emit - 推一份改动给宿主。
     * @returns 退订函数：同步停表，在途的那一次回来之后也不再回调。
     */
    subscribe(instance: InstanceFace, emit: (data: unknown) => void): () => void {
      let alive = true
      let busy = false
      const take = async (): Promise<void> => {
        if (!alive || busy) return
        busy = true
        try {
          const payload = await collect(instance)
          if (alive) emit(payload)
        } catch (error) {
          // 定时回调没有调用方可以接住它，抛出去会把整张看板带下来；这一拍跳过，下一拍照常读（D11）。
          console.error(`widget-board: 改动采样失败：${error instanceof Error ? error.message : String(error)}`)
        } finally {
          busy = false
        }
      }
      const timer = setInterval(() => { void take() }, GIT_DIFF_INTERVAL_MS)
      // 定时器不拽住进程：宿主的退出时机不该由一张卡决定。
      timer.unref()
      void take()
      return () => {
        alive = false
        clearInterval(timer)
      }
    },
  }
}
