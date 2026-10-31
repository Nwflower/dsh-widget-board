/**
 * 内置数据源共用的几件东西（D6、D32）：Git 命令、读哪个仓库目录、按间隔采样，以及注册项的公共形状。
 *
 * 十个内置数据源里有三个读仓库、七个读宿主自己的状态：读目录的顺序、跑 Git 的方式与采样的节奏
 * 都只在这里实现一次，复制它们就是抄来的代码（jscpd）。
 */
import { execFile } from 'node:child_process'
import type { DataSourceRegistration, HostSessions, HostWorkspaceRegistry, InstanceFace } from '@dsh-widget-board/contracts'
import { WIDGET_BOARD_API_VERSION } from '@dsh-widget-board/contracts'

/** Git 命令的超时，毫秒：读不动就当这一拍没有结果。 */
export const GIT_COMMAND_TIMEOUT_MS = 5000

/** Git 输出的上限，字节：一份大输出读不下时按失败处理。 */
export const GIT_COMMAND_MAX_BUFFER = 2 * 1024 * 1024

/** 读哪个仓库目录要读的东西；每项都可能缺席，缺席时按兜底走（D11）。 */
export interface RepoCwdDeps {
  /** 宿主的会话服务；读当前活跃会话的工作目录。 */
  sessions?: () => HostSessions | undefined
  /** 宿主的工作区登记表；读第一个工作区的目录。 */
  workspaces?: () => HostWorkspaceRegistry | undefined
  /** 前两处都没有时用的目录。 */
  defaultCwd?: string
}

/**
 * 这张卡要读哪个仓库目录。
 *
 * 卡片自己填的 `cwd` 最优先；没填时取最后一个有工作目录的活跃会话；再没有取第一个工作区；
 * 都没有就用宿主进程的当前目录。
 *
 * @param instance - 读这张卡片。
 * @param deps - 会话、工作区与兜底目录。
 * @returns 目标目录。
 */
export function resolveRepoCwd(instance: InstanceFace, deps: RepoCwdDeps): string {
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
 * 在一个目录里跑一条 Git 命令。
 *
 * @param cwd - 目标目录。
 * @param args - 命令的参数。
 * @param timeoutMs - 命令的超时，毫秒；省略时按 {@link GIT_COMMAND_TIMEOUT_MS}。
 * @returns 命令的标准输出；命令失败时抛出。
 */
export function runGit(cwd: string, args: string[], timeoutMs: number = GIT_COMMAND_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, windowsHide: true, timeout: timeoutMs, maxBuffer: GIT_COMMAND_MAX_BUFFER, encoding: 'utf8' }, (error, stdout) => {
      if (error) reject(error)
      else resolve(stdout)
    })
  })
}

/**
 * 按固定间隔采样（D32）：立刻采一次，之后每 `intervalMs` 采一次。
 *
 * 采样是异步的，两拍之间会重叠：上一拍还没回来时这一拍直接跳过。退订之后不再回调，在途的那一拍
 * 回来之后也不回调。
 *
 * @param intervalMs - 采样间隔，毫秒。
 * @param label - 采样失败时写进日志的名字。
 * @param run - 采一次；返回要推给宿主的那份数据。
 * @param emit - 推一份数据给宿主。
 * @returns 退订函数：同步停表。
 */
export function subscribeLoop(intervalMs: number, label: string, run: () => Promise<unknown>, emit: (data: unknown) => void): () => void {
  let alive = true
  let busy = false
  const take = async (): Promise<void> => {
    if (!alive || busy) return
    busy = true
    try {
      const payload = await run()
      if (alive) emit(payload)
    } catch (error) {
      // 定时回调没有调用方可以接住它，抛出去会把整张看板带下来；这一拍跳过，下一拍照常读（D11）。
      console.error(`widget-board: ${label}采样失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      busy = false
    }
  }
  const timer = setInterval(() => { void take() }, intervalMs)
  // 定时器不拽住进程：宿主的退出时机不该由一张卡决定。
  timer.unref()
  void take()
  return () => {
    alive = false
    clearInterval(timer)
  }
}

/** 一个内置数据源的规格：名字、提供方、读一次与按什么节奏采样。 */
export interface DataSourceSpec<T> {
  /** 提供方名；组件 manifest 里按 `提供方:名字` 点名它。 */
  provider: string
  /** 数据源的名字。 */
  id: string
  /** 采样间隔，毫秒。 */
  intervalMs: number
  /** 采样失败时写进日志的名字。 */
  label: string
  /** 读一次数据。 */
  read: (instance: InstanceFace) => Promise<T>
}

/**
 * 按一份规格建出数据源的注册项。
 *
 * 注册项的形状（版本、提供方、名字、读、订阅）在这里定一次：十个内置数据源读的东西各不相同，
 * 它们对宿主的承诺却是同一份。
 *
 * @param spec - 规格。
 * @returns 数据源注册项；它只读宿主自己的东西，不声明权限。
 */
export function dataSourceOf<T>(spec: DataSourceSpec<T>): DataSourceRegistration {
  return {
    apiVersion: WIDGET_BOARD_API_VERSION,
    provider: spec.provider,
    id: spec.id,
    read: (instance: InstanceFace): Promise<T> => spec.read(instance),
    subscribe: (instance: InstanceFace, emit: (data: unknown) => void): () => void =>
      subscribeLoop(spec.intervalMs, spec.label, async () => await spec.read(instance), emit),
  }
}
