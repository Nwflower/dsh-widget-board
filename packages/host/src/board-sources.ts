/**
 * 宿主自己的状态与用量数据源（D6）：会话、工作区、用量、容量、提供方、运行环境与当前看板。
 *
 * 七个数据源只读宿主进程里已经有的东西——不联网、不动文件，也不声明权限。卡片可见期间它们各自按
 * 自己的节奏采样（D32），采样读到的永远是宿主此刻的状态。
 *
 * 用量那两个数据源读的是 `usage.ts` 已经折好的那份汇总：日志只折一遍，两个卡片读的是同一份。
 */
import os from 'node:os'
import { statfs } from 'node:fs/promises'
import { basename } from 'node:path'
import type { DataSourceRegistration, HostSessions, HostWorkspaceRegistry, InstanceFace } from '@dsh-widget-board/contracts'
import type { ProviderHealth } from './provider-health'
import type { Workspace } from './workspace'
import type { WidgetRecord } from './library'
import type { UsageAnswer } from './usage'
import { localDate } from './local-date'
import { stateBytes } from './state'
import { BOARD_STATE_BYTES_LIMIT } from './limits'
import { dataSourceOf } from './git-utils'

/** 这些数据源的提供方：组件 manifest 里写成 `widget-board:sessions.list`。 */
export const BOARD_SOURCE_PROVIDER = 'widget-board'

/** 会话与工作区列表的数据源名。 */
export const SESSIONS_LIST_SOURCE = 'sessions.list'

/** 会话与工作区列表在组件 manifest 里点名的全名。 */
export const SESSIONS_LIST_NAME = `${BOARD_SOURCE_PROVIDER}:${SESSIONS_LIST_SOURCE}`

/** 用量曲线的数据源名。 */
export const USAGE_CHART_SOURCE = 'usage.chart'

/** 用量曲线在组件 manifest 里点名的全名。 */
export const USAGE_CHART_NAME = `${BOARD_SOURCE_PROVIDER}:${USAGE_CHART_SOURCE}`

/** 用量数字的数据源名。 */
export const USAGE_STAT_SOURCE = 'usage.stat'

/** 用量数字在组件 manifest 里点名的全名。 */
export const USAGE_STAT_NAME = `${BOARD_SOURCE_PROVIDER}:${USAGE_STAT_SOURCE}`

/** 容量表盘的数据源名。 */
export const CAPACITY_ITEMS_SOURCE = 'capacity.items'

/** 容量表盘在组件 manifest 里点名的全名。 */
export const CAPACITY_ITEMS_NAME = `${BOARD_SOURCE_PROVIDER}:${CAPACITY_ITEMS_SOURCE}`

/** 提供方表格的数据源名。 */
export const PROVIDERS_TABLE_SOURCE = 'providers.table'

/** 提供方表格在组件 manifest 里点名的全名。 */
export const PROVIDERS_TABLE_NAME = `${BOARD_SOURCE_PROVIDER}:${PROVIDERS_TABLE_SOURCE}`

/** 运行环境键值对的数据源名。 */
export const RUNTIME_KV_SOURCE = 'runtime.kv'

/** 运行环境键值对在组件 manifest 里点名的全名。 */
export const RUNTIME_KV_NAME = `${BOARD_SOURCE_PROVIDER}:${RUNTIME_KV_SOURCE}`

/** 当前看板快照的数据源名。 */
export const BOARD_JSON_SOURCE = 'board.json'

/** 当前看板快照在组件 manifest 里点名的全名。 */
export const BOARD_JSON_NAME = `${BOARD_SOURCE_PROVIDER}:${BOARD_JSON_SOURCE}`

/** 会话列表的采样间隔，毫秒。 */
export const SESSIONS_LIST_INTERVAL_MS = 5000

/** 用量两个数据源的采样间隔，毫秒。 */
export const USAGE_INTERVAL_MS = 15000

/** 容量与提供方的采样间隔，毫秒。 */
export const CAPACITY_INTERVAL_MS = 5000

/** 运行环境与看板快照的采样间隔，毫秒。 */
export const RUNTIME_INTERVAL_MS = 10000

/** 一个窗口的天数：今天算第一天，往前推七天。 */
const USAGE_WINDOW_DAYS = 7

/** 一 GB 有多少字节。 */
const BYTES_PER_GB = 1024 * 1024 * 1024

/** 看板状态额度换算成 KB。 */
const STATE_QUOTA_KB = Math.round(BOARD_STATE_BYTES_LIMIT / 1024)

/** 建这几个数据源要读的东西；每项都可能缺席，缺席时按兜底走（D11）。 */
export interface BoardSourceDeps {
  /** 宿主的会话服务；读活着的会话。 */
  sessions?: () => HostSessions | undefined
  /** 宿主的工作区登记表；读开着的工作区。 */
  workspaces?: () => HostWorkspaceRegistry | undefined
  /** 读会话用量汇总；折好的结果在这里，日志只折一遍。 */
  readUsage: () => Promise<UsageAnswer>
  /** 提供方的健康记录；读每个提供方的注册数与异常数。 */
  health: ProviderHealth
  /** 看板工作区；读全部看板与当前选中的那一块。 */
  workspace: Pick<Workspace, 'list' | 'active'>
  /** 组件库；读内置与扩展组件的总数。 */
  records: () => ReadonlyMap<string, WidgetRecord>
  /** 看板数据所在的目录；磁盘余量按它所在的卷算。 */
  diskPath: string
  /** 看板自己的版本。 */
  version: string
}

/** 会话与工作区列表里的一行。 */
export interface SessionListItem {
  /** 标题。 */
  title: string
  /** 右侧的次要信息。 */
  meta: string
  /** 状态点。 */
  status: 'ok' | 'idle'
}

/** 一次会话与工作区列表的读取结果。 */
export interface SessionListData {
  items: SessionListItem[]
}

/** 用量曲线上的一个点。 */
export interface UsagePoint {
  /** 那一天的日期，形如 `10-31`。 */
  label: string
  /** 那一天的用量。 */
  value: number
}

/** 一次用量曲线的读取结果；没有任何历史记录时是空对象，组件因此显示自己的样例。 */
export interface UsageChartData {
  points?: UsagePoint[]
  caption?: string
}

/** 一次用量数字的读取结果；没有任何历史记录时是空对象。 */
export interface UsageStatData {
  value?: number
  unit?: string
  delta?: number
  note?: string
  caption?: string
}

/** 容量表盘上的一项。 */
export interface CapacityItem {
  /** 这一项的名字。 */
  label: string
  /** 已经用掉多少。 */
  value: number
  /** 一共多少。 */
  max: number
  /** 一行说明。 */
  note: string
  /** 语气：接近上限时给警告。 */
  tone: 'accent' | 'warn' | 'danger' | 'muted'
}

/** 一次容量读数的读取结果。 */
export interface CapacityData {
  items: CapacityItem[]
}

/** 提供方表格的一列。 */
export interface ProviderColumn {
  /** 列的键。 */
  key: string
  /** 列名。 */
  label: string
  /** 对齐方式。 */
  align?: 'left' | 'right'
}

/** 提供方表格的一行。 */
export interface ProviderRow {
  /** 提供方的名字。 */
  name: string
  /** 在线还是离线。 */
  state: string
  /** 注册项的个数。 */
  registrations: number
  /** 失败与超时的次数。 */
  failures: number
}

/** 一次提供方表格的读取结果。 */
export interface ProvidersTableData {
  columns: ProviderColumn[]
  rows: ProviderRow[]
}

/** 运行环境里的一项。 */
export interface RuntimeItem {
  /** 键。 */
  key: string
  /** 值。 */
  value: string | number
  /** 一行说明。 */
  note?: string
}

/** 一次运行环境读数的读取结果。 */
export interface RuntimeKvData {
  items: RuntimeItem[]
}

/** 当前看板的一份快照。 */
export interface BoardSnapshot {
  /** 看板的标题。 */
  board: string
  /** 看板的修订号。 */
  revision: number
  /** 布局的修订号。 */
  layoutRevision: number
  /** 卡片数。 */
  cards: number
  /** 每种组件各几张卡。 */
  widgets: Record<string, number>
  /** 注册着的提供方。 */
  providers: string[]
}

/** 一次看板快照的读取结果。 */
export interface BoardJsonData {
  value: BoardSnapshot
  caption: string
}

/** 用量折算结果里的一天。 */
type UsageDay = UsageAnswer['days'][number]

/**
 * 从今天往前推若干天的本地日期。
 *
 * @param offset - 往前推几天；0 是今天。
 * @returns 日期的键，形如 `2026-10-31`。
 */
function dayKeyOf(offset: number): string {
  const date = new Date()
  date.setDate(date.getDate() - offset)
  return localDate(date.getTime()) ?? ''
}

/**
 * 取一个窗口里的每一天，按从早到晚的次序；没有记录的那天按零算。
 *
 * @param days - 按日期索引的分桶。
 * @param start - 窗口的第一天往前推几天。
 * @param count - 窗口有几天。
 * @returns 窗口里的每一天。
 */
function windowOf(days: Map<string, UsageDay>, start: number, count: number): UsageDay[] {
  const window: UsageDay[] = []
  for (let offset = start + count - 1; offset >= start; offset -= 1) {
    const key = dayKeyOf(offset)
    window.push(days.get(key) ?? { date: key, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, calls: 0 })
  }
  return window
}

/**
 * 一天的四类 token 加起来。
 *
 * @param day - 一天的分桶。
 * @returns 这一天的 token 数。
 */
function tokensOf(day: UsageDay): number {
  return day.input + day.output + day.cacheRead + day.cacheWrite
}

/**
 * 卡片要的是 token 还是调用次数。
 *
 * @param instance - 读这张卡片。
 * @returns 指标名。
 */
function metricOf(instance: InstanceFace): 'tokens' | 'calls' {
  return instance.props?.metric === 'tokens' ? 'tokens' : 'calls'
}

/**
 * 一天在这个指标上的值。
 *
 * @param day - 一天的分桶。
 * @param metric - 指标名。
 * @returns 这一天的值。
 */
function valueOf(day: UsageDay, metric: 'tokens' | 'calls'): number {
  return metric === 'tokens' ? tokensOf(day) : day.calls
}

/**
 * 读用量汇总，并按两个七天窗口摆开。
 *
 * 没有任何历史记录时是 `undefined`：两个用量数据源据此给空对象，卡片因此显示自己的样例而不是一个
 * 假的 0。
 *
 * @param deps - 宿主的服务与看板。
 * @param instance - 读这张卡片。
 * @returns 两个窗口与这张卡要的指标；没有历史记录时是 `undefined`。
 */
async function usageWindows(deps: BoardSourceDeps, instance: InstanceFace): Promise<{ metric: 'tokens' | 'calls', current: UsageDay[], previous: UsageDay[] } | undefined> {
  const answer = await deps.readUsage()
  if (answer.days.length === 0) return undefined
  const byDate = new Map(answer.days.map((day) => [day.date, day]))
  return {
    metric: metricOf(instance),
    current: windowOf(byDate, 0, USAGE_WINDOW_DAYS),
    previous: windowOf(byDate, USAGE_WINDOW_DAYS, USAGE_WINDOW_DAYS),
  }
}

/**
 * 字节数写成 GB，保留一位小数。
 *
 * @param bytes - 字节数。
 * @returns GB 数。
 */
function gbOf(bytes: number): number {
  return Math.round((bytes / BYTES_PER_GB) * 10) / 10
}

/**
 * 占用比例对应哪一种语气。
 *
 * @param ratio - 占用比例，0 到 1。
 * @returns 语气。
 */
function toneOf(ratio: number): 'accent' | 'warn' | 'danger' {
  if (ratio > 0.85) return 'danger'
  if (ratio > 0.7) return 'warn'
  return 'accent'
}

/**
 * 看板数据所在卷的容量。
 *
 * @param path - 卷上的任一目录。
 * @returns 可用与总字节数；读不出来时是 null。
 */
async function diskOf(path: string): Promise<{ total: number, available: number } | null> {
  try {
    const stats = await statfs(path)
    return { total: stats.blocks * stats.bsize, available: stats.bavail * stats.bsize }
  } catch {
    // 磁盘是次读：读不出来时这一项写明读不到，内存与看板额度照常给（D11）。
    return null
  }
}

/**
 * 建出会话与工作区列表的数据源。
 *
 * 活跃的会话各一行，开着的工作区各一行；两样都没有时给一条看板自己的摘要，列表因此永远反映宿主
 * 此刻的状态。
 *
 * @param deps - 宿主的服务与看板。
 * @returns 数据源注册项；它只读宿主自己的东西，不声明权限。
 */
export function createSessionsListSource(deps: BoardSourceDeps): DataSourceRegistration {
  const collect = async (): Promise<SessionListData> => {
    const items: SessionListItem[] = []
    for (const session of deps.sessions?.()?.list() ?? []) {
      const cwd = session.header?.cwd
      items.push({
        title: `会话 ${session.id.slice(0, 8)}`,
        meta: (typeof cwd === 'string' && cwd !== '' ? basename(cwd) : '运行中').slice(0, 40),
        status: 'ok',
      })
    }
    for (const space of deps.workspaces?.()?.list() ?? []) {
      const path = space.path
      items.push({
        title: `工作区 · ${basename(path || space.id)}`.slice(0, 120),
        meta: path.slice(-40),
        status: 'idle',
      })
    }
    if (items.length === 0) {
      const cards = deps.workspace.list().reduce((sum, board) => sum + board.instances.length, 0)
      items.push({ title: '组件看板在线', meta: `${cards} 张卡片`, status: 'ok' })
    }
    return { items }
  }
  return dataSourceOf({
    provider: BOARD_SOURCE_PROVIDER,
    id: SESSIONS_LIST_SOURCE,
    intervalMs: SESSIONS_LIST_INTERVAL_MS,
    label: '会话',
    read: async (): Promise<SessionListData> => await collect(),
  })
}

/**
 * 建出用量曲线的数据源。
 *
 * 曲线画的是最近七天，每一天一个点：默认是那天的调用次数，卡片把 `metric` 设成 `tokens` 时是
 * 那天的 token 数。
 *
 * @param deps - 宿主的服务与看板。
 * @returns 数据源注册项；它只读宿主自己的东西，不声明权限。
 */
export function createUsageChartSource(deps: BoardSourceDeps): DataSourceRegistration {
  const collect = async (instance: InstanceFace): Promise<UsageChartData> => {
    const windows = await usageWindows(deps, instance)
    // 没有任何历史记录时给空对象：组件因此回退到自己的样例，画廊与矩阵不会空着。
    if (windows === undefined) return {}
    const points = windows.current.map((day) => ({
      label: day.date.slice(5),
      value: valueOf(day, windows.metric),
    }))
    return {
      points,
      caption: windows.metric === 'tokens' ? '最近 7 天 · 每日 Token 用量' : '最近 7 天 · 每日调用次数',
    }
  }
  return dataSourceOf({
    provider: BOARD_SOURCE_PROVIDER,
    id: USAGE_CHART_SOURCE,
    intervalMs: USAGE_INTERVAL_MS,
    label: '用量曲线',
    read: async (instance: InstanceFace): Promise<UsageChartData> => await collect(instance),
  })
}

/**
 * 建出用量数字的数据源。
 *
 * 数字是最近七天的合计，环比是它与前一个七天窗口相比的整数百分比。
 *
 * @param deps - 宿主的服务与看板。
 * @returns 数据源注册项；它只读宿主自己的东西，不声明权限。
 */
export function createUsageStatSource(deps: BoardSourceDeps): DataSourceRegistration {
  const collect = async (instance: InstanceFace): Promise<UsageStatData> => {
    const windows = await usageWindows(deps, instance)
    // 没有任何历史记录时给空对象：卡片因此显示「暂无数据」，而不是一个假的 0。
    if (windows === undefined) return {}
    const { metric, current, previous } = windows
    const value = current.reduce((sum, day) => sum + valueOf(day, metric), 0)
    const before = previous.reduce((sum, day) => sum + valueOf(day, metric), 0)
    const activeDays = current.filter((day) => valueOf(day, metric) > 0).length
    return {
      value,
      unit: metric === 'tokens' ? 'Tokens' : '次调用',
      delta: before === 0 ? 0 : Math.round(((value - before) / before) * 100),
      note: '较前 7 天',
      caption: `最近 7 天累计 · 活跃 ${activeDays} 天`,
    }
  }
  return dataSourceOf({
    provider: BOARD_SOURCE_PROVIDER,
    id: USAGE_STAT_SOURCE,
    intervalMs: USAGE_INTERVAL_MS,
    label: '用量数字',
    read: async (instance: InstanceFace): Promise<UsageStatData> => await collect(instance),
  })
}

/**
 * 建出容量表盘的数据源。
 *
 * 三项：机器的内存、看板数据所在卷的余量，以及看板自己占的状态额度。磁盘读不出来时那一项写明
 * 读不到，其余照旧。
 *
 * @param deps - 宿主的服务与看板。
 * @returns 数据源注册项；它只读宿主自己的东西，不声明权限。
 */
export function createCapacityItemsSource(deps: BoardSourceDeps): DataSourceRegistration {
  const collect = async (): Promise<CapacityData> => {
    const total = os.totalmem()
    const used = total - os.freemem()
    const disk = await diskOf(deps.diskPath)
    const state = deps.workspace.list()
      .reduce((sum, board) => sum + board.instances.reduce((inner, instance) => inner + stateBytes(instance.state), 0), 0)
    const stateKb = Math.round(state / 1024)
    const items: CapacityItem[] = [
      {
        label: '系统内存',
        value: gbOf(used),
        max: gbOf(total),
        note: `${gbOf(used)} / ${gbOf(total)} GB`,
        tone: toneOf(total > 0 ? used / total : 0),
      },
    ]
    if (disk === null) {
      items.push({ label: '磁盘空间', value: 0, max: 0, note: '读不到', tone: 'muted' })
    } else {
      const diskUsed = disk.total - disk.available
      items.push({
        label: '磁盘空间',
        value: gbOf(diskUsed),
        max: gbOf(disk.total),
        note: `${gbOf(diskUsed)} / ${gbOf(disk.total)} GB`,
        tone: toneOf(disk.total > 0 ? diskUsed / disk.total : 0),
      })
    }
    items.push({
      label: '看板状态额度',
      value: stateKb,
      max: STATE_QUOTA_KB,
      note: `${stateKb} / ${STATE_QUOTA_KB} KB`,
      tone: 'accent',
    })
    return { items }
  }
  return dataSourceOf({
    provider: BOARD_SOURCE_PROVIDER,
    id: CAPACITY_ITEMS_SOURCE,
    intervalMs: CAPACITY_INTERVAL_MS,
    label: '容量',
    read: async (): Promise<CapacityData> => await collect(),
  })
}

/**
 * 建出提供方表格的数据源。
 *
 * 表格读的是提供方的健康记录：谁在线、名下有几项注册、失败与超时各多少次。
 *
 * @param deps - 宿主的服务与看板。
 * @returns 数据源注册项；它只读宿主自己的东西，不声明权限。
 */
export function createProvidersTableSource(deps: BoardSourceDeps): DataSourceRegistration {
  const collect = async (): Promise<ProvidersTableData> => {
    const list = deps.health.snapshot()
    const rows: ProviderRow[] = list.length === 0
      ? [{ name: BOARD_SOURCE_PROVIDER, state: '在线', registrations: 0, failures: 0 }]
      : list.map((entry) => ({
        name: entry.provider,
        state: entry.available ? '在线' : '离线',
        registrations: entry.registrations,
        failures: entry.failures + entry.timeouts,
      }))
    return {
      columns: [
        { key: 'name', label: '提供方' },
        { key: 'state', label: '状态' },
        { key: 'registrations', label: '注册项', align: 'right' },
        { key: 'failures', label: '异常', align: 'right' },
      ],
      rows,
    }
  }
  return dataSourceOf({
    provider: BOARD_SOURCE_PROVIDER,
    id: PROVIDERS_TABLE_SOURCE,
    intervalMs: CAPACITY_INTERVAL_MS,
    label: '提供方',
    read: async (): Promise<ProvidersTableData> => await collect(),
  })
}

/**
 * 建出运行环境键值对的数据源。
 *
 * 四项：插件自己的名字与版本、Node.js 的版本与平台、看板与卡片数、组件库里的组件数。
 *
 * @param deps - 宿主的服务与看板。
 * @returns 数据源注册项；它只读宿主自己的东西，不声明权限。
 */
export function createRuntimeKvSource(deps: BoardSourceDeps): DataSourceRegistration {
  const collect = async (): Promise<RuntimeKvData> => {
    const boards = deps.workspace.list()
    const cards = boards.reduce((sum, board) => sum + board.instances.length, 0)
    return {
      items: [
        { key: '插件', value: 'dsh-widget-board', note: `v${deps.version}` },
        { key: 'Node.js', value: process.version, note: `${process.platform} ${process.arch}` },
        { key: '看板', value: boards.length, note: `${cards} 张卡片` },
        { key: '组件库', value: deps.records().size, note: '内置与扩展组件' },
      ],
    }
  }
  return dataSourceOf({
    provider: BOARD_SOURCE_PROVIDER,
    id: RUNTIME_KV_SOURCE,
    intervalMs: RUNTIME_INTERVAL_MS,
    label: '运行环境',
    read: async (): Promise<RuntimeKvData> => await collect(),
  })
}

/**
 * 建出当前看板快照的数据源。
 *
 * 快照里有看板的标题与修订号、卡片数、每种组件各几张卡，以及注册着的提供方。
 *
 * @param deps - 宿主的服务与看板。
 * @returns 数据源注册项；它只读宿主自己的东西，不声明权限。
 */
export function createBoardJsonSource(deps: BoardSourceDeps): DataSourceRegistration {
  const collect = async (): Promise<BoardJsonData> => {
    const active = deps.workspace.active()
    const widgets: Record<string, number> = {}
    for (const instance of active.instances) {
      widgets[instance.widget] = (widgets[instance.widget] ?? 0) + 1
    }
    return {
      value: {
        board: active.title,
        revision: active.revision,
        layoutRevision: active.layoutRevision,
        cards: active.instances.length,
        widgets,
        providers: deps.health.snapshot().map((entry) => entry.provider),
      },
      caption: '当前看板实时快照',
    }
  }
  return dataSourceOf({
    provider: BOARD_SOURCE_PROVIDER,
    id: BOARD_JSON_SOURCE,
    intervalMs: RUNTIME_INTERVAL_MS,
    label: '看板快照',
    read: async (): Promise<BoardJsonData> => await collect(),
  })
}
