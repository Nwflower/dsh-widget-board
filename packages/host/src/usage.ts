/**
 * 用量汇总能力（D24）：把宿主上的会话日志折成按天的 token 分桶与按小时的结算次数，交给组件。
 *
 * 组件要的是「已经消耗了多少 Token」与一张按周的格子，数据本来就在本机的会话日志里。这里自己读、
 * 自己缓存，看板不必依赖别的插件；装了 dsh-claude-style 时组件会先问它，那份汇总与工作台首页同源，
 * 这里就不再折一遍。
 *
 * 读日志走宿主的 `sessionQuery`：`observeSession` 按一次 stat 定位并交回完整的日志，`readSession`
 * 是只有旧宿主提供时的退路。缓存按日志的大小与修改时间认人，没变的会话不重读。
 */
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { CapabilityRegistration, InstanceFace } from '@dsh-widget-board/contracts'
import { WIDGET_BOARD_API_VERSION } from '@dsh-widget-board/contracts'
import { localDate } from './local-date'
import type { Registries } from './sources'
import { registerSessionUsage } from './session-usage'

/** 能力的名字；组件 manifest 用它声明（D24）。 */
export const USAGE_CAPABILITY = 'usage'

/** 能力的提供方名；设置弹窗与授权记录用它标注归属。 */
export const USAGE_PROVIDER = 'widget-board'

/** 一份会话日志的文件名：`session.jsonl`、`session.vN.jsonl`，可能带 `.zstd`。 */
const SESSION_LOG = /^session(?:\.v([1-9][0-9]*))?\.jsonl(?:\.zstd)?$/i

/** 缓存文件名，放在看板自己的目录里。 */
const CACHE_FILE = 'usage-cache.json'

/** 一次缓存的结构：按存储目录名记下每个会话的指纹与已经折好的天。 */
interface UsageCache {
  savedAt: number
  sessions: Record<string, CachedSession>
}

interface CachedSession {
  size: number
  mtimeMs: number
  days: Record<string, DayBuckets>
}

interface Buckets {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  calls: number
}

/** 一次结算：它在哪一个 turn/step 上、当天的哪一个小时、几个分桶。 */
interface Settlement {
  turn?: number
  step?: number
  buckets: Buckets
  day: string
  hour: number
}

/** 一天：四类分桶与这一天的结算小时数。 */
interface DayBuckets extends Buckets {
  hours: number[]
}

/** 汇总里的某一天：日期的键跟着分桶一起走。 */
interface DatedDay extends DayBuckets {
  date: string
}

/** 能力的回答。 */
export interface UsageAnswer {
  ready: boolean
  computedAt: number | null
  days: (Buckets & { date: string })[]
  /** 全量按小时的结算次数；没有数据时是 24 个零。 */
  hours: number[]
  totals: Buckets
}

const NUMBER = { type: 'number', minimum: 0 } as const

/** 一次调用的参数：组件不传任何东西。 */
const USAGE_INPUT = { type: 'object', additionalProperties: false, properties: {} } as const

/** 回答的形状。 */
const USAGE_OUTPUT = {
  type: 'object',
  additionalProperties: false,
  required: ['ready', 'computedAt', 'days', 'hours', 'totals'],
  properties: {
    ready: { type: 'boolean' },
    computedAt: { type: ['number', 'null'] },
    days: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['date', 'input', 'output', 'cacheRead', 'cacheWrite', 'calls'],
        properties: {
          date: { type: 'string' },
          input: NUMBER,
          output: NUMBER,
          cacheRead: NUMBER,
          cacheWrite: NUMBER,
          calls: NUMBER,
        },
      },
    },
    hours: { type: 'array', items: NUMBER },
    totals: {
      type: 'object',
      additionalProperties: false,
      required: ['input', 'output', 'cacheRead', 'cacheWrite', 'calls'],
      properties: { input: NUMBER, output: NUMBER, cacheRead: NUMBER, cacheWrite: NUMBER, calls: NUMBER },
    },
  },
} as const

/** 一个会话日志与它的指纹。 */
interface SessionLog {
  id: string
  storedName: string
  size: number
  mtimeMs: number
}

/** 宿主的会话读取服务，只取这里用到的两个入口。 */
interface SessionReader {
  observeSession?(id: string, options?: { projectionMode?: 'all' | 'none' }): Promise<{ events: unknown, [Symbol.dispose]?(): void, dispose?(): void }>
  readSession?(id: string): Promise<{ events?: unknown } | null | undefined>
}

/** 宿主日志里的一条用量样本，字段名沿用宿主的叫法。 */
interface UsageSample {
  inputTokens?: unknown
  outputTokens?: unknown
  cacheReadTokens?: unknown
  cacheWriteTokens?: unknown
}

/** 折的时候读到的一条事件；只认用量相关的形状。 */
interface UsageEvent {
  type?: string
  time?: number
  turn?: number
  step?: number
  data?: {
    usage?: UsageSample
    turn?: number
    step?: number
    stream?: { type?: string, chunk?: { type?: string, usage?: UsageSample } }[]
  }
}

/**
 * 这条事件带回来的用量样本：`assistant/message` 用它自己的 `usage`，其余取流里最后一条 usage 块。
 *
 * @param event - 日志里的一条事件。
 * @returns 样本；不是用量事件时是 `undefined`。
 */
function sampleOf(event: UsageEvent): UsageSample | undefined {
  const data = event.data
  if (data === null || data === undefined || typeof data !== 'object') return undefined
  if (event.type === 'assistant/message' && data.usage !== undefined) return data.usage
  if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') return undefined
  const stream = data.stream
  if (!Array.isArray(stream)) return undefined
  for (let index = stream.length - 1; index >= 0; index -= 1) {
    const record = stream[index]
    if (record !== null && typeof record === 'object' && record.type === 'chunk'
      && record.chunk !== null && typeof record.chunk === 'object' && record.chunk.type === 'usage') {
      return record.chunk.usage
    }
  }
  return undefined
}

/**
 * 一条样本的四个分桶。四者互不重叠：读进提示的、写回来的、命中缓存读出的、写进缓存的。
 *
 * @param sample - 用量样本。
 * @returns 分桶与这一次结算。
 */
function bucketsOf(sample: UsageSample | undefined): Buckets {
  const count = (value: unknown) => (Number.isFinite(Number(value)) ? Number(value) : 0)
  return {
    input: count(sample?.inputTokens),
    output: count(sample?.outputTokens),
    cacheRead: count(sample?.cacheReadTokens),
    cacheWrite: count(sample?.cacheWriteTokens),
    calls: 1,
  }
}

/**
 * 把一个会话的事件折成按天的分桶。同一个 turn/step 上的重试替换上一次的样本，不累加；被替换的那份
 * 从原来的那一天减掉。每天的结算落在哪一个小时也一并记下来，卡片据此找高峰时段。
 *
 * @param events - 会话的持久事件。
 * @returns 按天分桶，含当天各小时的结算次数。
 */
export function foldSession(events: UsageEvent[]): Record<string, DayBuckets> {
  const days: Record<string, DayBuckets> = {}
  const fresh = (): DayBuckets => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, calls: 0, hours: new Array(24).fill(0) as number[] })
  const bump = (day: string, hour: number, buckets: Buckets, sign: number) => {
    const target = days[day] ?? (days[day] = fresh())
    target.input += buckets.input * sign
    target.output += buckets.output * sign
    target.cacheRead += buckets.cacheRead * sign
    target.cacheWrite += buckets.cacheWrite * sign
    target.calls += buckets.calls * sign
    target.hours[hour] += sign
    if (target.calls <= 0 && target.input === 0 && target.output === 0 && target.cacheRead === 0 && target.cacheWrite === 0) delete days[day]
  }
  let last: Settlement | null = null
  for (const event of events) {
    if (event.type === 'llm/retry-started') {
      const data = event.data
      if (last !== null && last.turn === data?.turn && last.step === data?.step) last = null
      continue
    }
    const sample = sampleOf(event)
    if (sample === undefined || typeof event.time !== 'number') continue
    const day = localDate(event.time)
    if (day === null) continue
    const hour = new Date(event.time).getHours()
    const turn = typeof event.turn === 'number' ? event.turn : event.data?.turn
    const step = typeof event.step === 'number' ? event.step : event.data?.step
    const buckets = bucketsOf(sample)
    const previous = last as Settlement | null
    const replacing = previous !== null && previous.turn === turn && previous.step === step
    if (replacing && previous !== null
      && previous.buckets.input === buckets.input && previous.buckets.output === buckets.output
      && previous.buckets.cacheRead === buckets.cacheRead && previous.buckets.cacheWrite === buckets.cacheWrite) continue
    if (replacing && previous !== null) bump(previous.day, previous.hour, previous.buckets, -1)
    bump(day, hour, buckets, 1)
    last = { turn, step, buckets, day, hour }
  }
  return days
}

/** 通读一份缓存；文件不在或读不成时当作没有缓存。 */
async function readCache(file: string): Promise<UsageCache> {
  if (!existsSync(file)) return { savedAt: 0, sessions: {} }
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as Partial<UsageCache>
    if (parsed === null || typeof parsed !== 'object' || parsed.sessions === null || typeof parsed.sessions !== 'object') {
      return { savedAt: 0, sessions: {} }
    }
    return { savedAt: Number(parsed.savedAt) || 0, sessions: parsed.sessions }
  } catch {
    // 缓存读不成只说明这一次要重折：它不是数据源，坏了就重建（D11）。
    return { savedAt: 0, sessions: {} }
  }
}

/** 写回缓存；写失败不影响这一次的回答。 */
async function writeCache(file: string, cache: UsageCache): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(cache), 'utf8')
}

/** 宿主的 `sessionQuery` 服务。 */
function readerOf(context: unknown): SessionReader | undefined {
  const get = (context as { get?: (name: string) => unknown }).get
  if (typeof get !== 'function') return undefined
  const query = get.call(context, 'sessionQuery') as SessionReader | undefined
  return query ?? undefined
}

/** 释放一次观察的租约：宿主经 `Symbol.dispose` 收回，也有宿主给一个具名的 `dispose`。 */
function release(observation: { [Symbol.dispose]?(): void, dispose?(): void }): void {
  if (typeof observation.dispose === 'function') {
    observation.dispose()
    return
  }
  const dispose = (observation as { [Symbol.dispose]?: () => void })[Symbol.dispose]
  if (typeof dispose === 'function') dispose.call(observation)
}

/**
 * 读一个会话的日志。
 *
 * @param reader - 宿主的读取服务。
 * @param id - 会话的逻辑 id。
 * @returns 事件数组；读不到时是 null。
 */
async function readEvents(reader: SessionReader, id: string): Promise<UsageEvent[] | null> {
  try {
    if (typeof reader.observeSession === 'function') {
      const observation = await reader.observeSession(id, { projectionMode: 'none' })
      try {
        return Array.isArray(observation.events) ? observation.events as UsageEvent[] : null
      } finally {
        release(observation)
      }
    }
    if (typeof reader.readSession !== 'function') return null
    const snapshot = await reader.readSession(id)
    return Array.isArray(snapshot?.events) ? snapshot.events as UsageEvent[] : null
  } catch (error) {
    // 一个会话读不出来（日志损坏、会话已经删掉）只把它留到下一趟，别的会话照旧（D11）。
    return null
  }
}

/** 一个会话目录里最新的一代日志。 */
async function newestLog(dir: string): Promise<{ size: number, mtimeMs: number } | null> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return null
    throw error
  }
  let best: { name: string, version: number, compressed: boolean } | null = null
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const match = SESSION_LOG.exec(entry.name)
    if (match === null) continue
    const version = Number(match[1] ?? 0)
    const compressed = /\.zstd$/i.test(entry.name)
    if (best === null || version > best.version || (version === best.version && Number(compressed) > Number(best.compressed))) {
      best = { name: entry.name, version, compressed }
    }
  }
  if (best === null) return null
  try {
    const info = await stat(join(dir, best.name))
    return { size: info.size, mtimeMs: info.mtimeMs }
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return null
    throw error
  }
}

/**
 * 这台机器上存着的全部会话日志。
 *
 * @param root - `$DSH_HOME/sessions`。
 * @returns 每个会话的最新一份日志与指纹。
 */
export async function listSessionLogs(root: string): Promise<SessionLog[]> {
  const out: SessionLog[] = []
  if (!existsSync(root)) return out
  for (const project of await readdir(root, { withFileTypes: true })) {
    if (!project.isDirectory()) continue
    let sessions
    try {
      sessions = await readdir(join(root, project.name), { withFileTypes: true })
    } catch (error) {
      if ((error as { code?: string }).code === 'ENOENT') continue
      throw error
    }
    for (const session of sessions) {
      if (!session.isDirectory()) continue
      const log = await newestLog(join(root, project.name, session.name))
      if (log === null) continue
      out.push({ id: session.name, storedName: session.name, size: log.size, mtimeMs: log.mtimeMs })
    }
  }
  return out
}

/**
 * 折一遍全部会话，没变的会话直接用缓存。
 *
 * @param context - 宿主上下文，用来找 home 与服务。
 * @param cacheFile - 缓存文件。
 * @returns 折的结果。
 */
async function foldAll(context: unknown, cacheFile: string): Promise<{ days: DatedDay[], hours: number[], computedAt: number }> {
  const root = harnessPath(context, 'sessions')
  const cache = await readCache(cacheFile)
  const reader = readerOf(context)
  const logs = await listSessionLogs(root)
  const sessions: Record<string, CachedSession> = {}
  let changed = false
  for (const log of logs) {
    const held = cache.sessions[log.storedName]
    if (held !== undefined && held.size === log.size && held.mtimeMs === log.mtimeMs) {
      sessions[log.storedName] = held
      continue
    }
    if (reader === undefined) continue
    const events = await readEvents(reader, log.id)
    if (events === null) {
      if (held !== undefined) sessions[log.storedName] = held
      continue
    }
    sessions[log.storedName] = { size: log.size, mtimeMs: log.mtimeMs, days: foldSession(events) }
    changed = true
  }
  if (changed || Object.keys(cache.sessions).length !== Object.keys(sessions).length) {
    try {
      await writeCache(cacheFile, { savedAt: Date.now(), sessions })
    } catch {
      // 写不进缓存只是下一次要重折，答得出来就先答（D11）。
    }
  }
  return summarize(sessions)
}

/** 把各会话的按天分桶加起来，小时直方图按天累进总量。 */
function summarize(sessions: Record<string, CachedSession>): { days: DatedDay[], hours: number[], computedAt: number } {
  const merged: Record<string, DayBuckets> = {}
  const hours = new Array(24).fill(0) as number[]
  for (const session of Object.values(sessions)) {
    for (const [date, buckets] of Object.entries(session.days)) {
      const target = merged[date] ?? (merged[date] = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, calls: 0, hours: new Array(24).fill(0) as number[] })
      target.input += buckets.input
      target.output += buckets.output
      target.cacheRead += buckets.cacheRead
      target.cacheWrite += buckets.cacheWrite
      target.calls += buckets.calls
      for (let hour = 0; hour < 24; hour += 1) {
        const count = buckets.hours?.[hour] ?? 0
        target.hours[hour] += count
        hours[hour] += count
      }
    }
  }
  const days = Object.entries(merged)
    .map(([date, buckets]) => ({ date, ...buckets }))
    .sort((left, right) => (left.date < right.date ? -1 : 1))
  return { days, hours, computedAt: Date.now() }
}

/** 读用量能力的回答：没有会话时是空的一份。 */
export function emptyUsageAnswer(): UsageAnswer {
  return { ready: true, computedAt: null, days: [], hours: new Array(24).fill(0) as number[], totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, calls: 0 } }
}

/**
 * 把一天的分桶加成总量。
 *
 * @param days - 每天的分桶。
 * @returns 总量。
 */
export function totalsOf(days: Buckets[]): Buckets {
  const totals: Buckets = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, calls: 0 }
  for (const day of days) {
    totals.input += day.input
    totals.output += day.output
    totals.cacheRead += day.cacheRead
    totals.cacheWrite += day.cacheWrite
    totals.calls += day.calls
  }
  return totals
}

/** `$DSH_HOME` 下的路径；宿主给了 `dshHomePath` 就用它的。 */
function harnessPath(context: unknown, ...segments: string[]): string {
  const get = (context as { get?: (name: string) => unknown }).get
  const resolvePath = typeof get === 'function' ? get.call(context, 'dshHomePath') : undefined
  if (typeof resolvePath === 'function') return (resolvePath as (...parts: string[]) => string)(...segments)
  return join(process.env.DSH_HOME ?? join(process.env.USERPROFILE ?? process.env.HOME ?? '.', '.dsh'), ...segments)
}

/**
 * 读一次用量汇总：折出来的结果按能力的形状拼好。
 *
 * @param context - 宿主上下文。
 * @param cacheFile - 缓存文件的路径。
 * @returns 用量汇总；没有会话日志时是空的一份。
 */
async function answerOf(context: unknown, cacheFile: string): Promise<UsageAnswer> {
  const folded = await foldAll(context, cacheFile)
  if (folded.days.length === 0) return emptyUsageAnswer()
  return {
    ready: true,
    computedAt: folded.computedAt,
    days: folded.days.map((day) => ({
      date: day.date,
      input: day.input,
      output: day.output,
      cacheRead: day.cacheRead,
      cacheWrite: day.cacheWrite,
      calls: day.calls,
    })),
    hours: folded.hours,
    totals: totalsOf(folded.days),
  }
}

/**
 * 建一个读用量汇总的函数：看板的数据源与用量能力读的是同一份折算结果，日志只折一遍。
 *
 * @param context - 宿主上下文。
 * @param home - 看板自己的目录；缓存文件放在它下面。
 * @returns 读一次用量汇总的函数。
 */
export function createUsageReader(context: unknown, home: string): () => Promise<UsageAnswer> {
  const cacheFile = join(home, CACHE_FILE)
  return async (): Promise<UsageAnswer> => await answerOf(context, cacheFile)
}

/**
 * 建出用量能力。
 *
 * @param context - 宿主上下文。
 * @param cacheFile - 缓存文件的路径。
 * @returns 能力的注册。
 */
export function usageCapability(context: unknown, cacheFile: string): CapabilityRegistration {
  return {
    apiVersion: WIDGET_BOARD_API_VERSION,
    provider: USAGE_PROVIDER,
    id: USAGE_CAPABILITY,
    title: { zh: '会话用量', en: 'Session usage' },
    description: {
      zh: '读取本机会话日志折出来的用量：每天的四类 token 分桶与按小时的结算次数。',
      en: 'Reads the usage folded from this machine’s session logs: four token buckets per day and settlements per hour.',
    },
    input: USAGE_INPUT,
    output: USAGE_OUTPUT,
    async call(_instance: InstanceFace, _args: unknown, _signal: AbortSignal): Promise<UsageAnswer> {
      return await answerOf(context, cacheFile)
    },
  }
}

/**
 * 把用量能力与实时用量的数据源一起注册进看板的注册表。
 *
 * 两者在同一个调用里建立、在同一个返回的释放函数里撤下：历史汇总折的是日志，实时数据源在取到
 * dsh-usage 的启动前快照之后才订阅 `session/event`（issue #6），组件的 manifest 按名字各取所需。
 *
 * 读那份快照要走一次 HTTP，所以这个注册是异步的：`startedAt` 因此落在历史快照之后。
 *
 * @param sources - 看板的注册表。
 * @param context - 宿主上下文。
 * @param home - 看板自己的目录。
 * @returns 撤下这次注册的函数。
 */
export async function registerUsage(sources: Registries, context: unknown, home: string): Promise<() => void> {
  const disposeCapability = sources.registerCapability(usageCapability(context, join(home, CACHE_FILE)))
  const disposeSessionUsage = await registerSessionUsage(sources, context)
  return () => {
    disposeSessionUsage()
    disposeCapability()
  }
}
