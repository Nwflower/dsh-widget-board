/**
 * 提供方调用的执行器与健康记录（D31、D17）：数据读取、动作执行与宿主能力共用这一套超时与并发。
 *
 * 三件事只在这里实现一次：
 *
 * - 每个提供方一个超时。读取与动作默认 15 秒；能力按注册里声明的 `timeoutMs`，1–25 秒。超时一发生
 *   就对调用方失败，同时中止提供方。
 * - 每个提供方 8 个执行槽。槽在提供方的 promise 真正结束之后才释放：忽略中止信号的旧提供方不能靠
 *   超时多占一个槽，并发上限因此守得住。槽占满时立即抛出，不排队。
 * - 按提供方记的注册数、失败与超时。一个提供方出错不影响别的提供方；计数同时喂给设置页读的快照
 *   （`WorkspaceSnapshot.providers`）。宿主自己的拒绝（{@link Refusal}）是调用方或请求的问题，不是
 *   提供方的失败，不记在这里。
 *
 * 调用方的中止信号与超时合成为一个信号交给提供方：谁先到都中止它，调用方拿到的原因按先到的那个算。
 */
import type { WidgetBoardFeature, WidgetProviderHealth } from '@dsh-widget-board/contracts'
import { Refusal } from './refusal'

/** 读取与动作的默认超时。 */
export const PROVIDER_TIMEOUT_MS = 15_000

/** 一个提供方同时最多几个调用在跑。 */
export const PROVIDER_CONCURRENCY = 8

/** 能力没声明 `timeoutMs` 时等多久。 */
export const CAPABILITY_TIMEOUT_MS = 15_000

/** 能力声明的 `timeoutMs` 下限。 */
export const CAPABILITY_TIMEOUT_MIN_MS = 1_000

/** 能力声明的 `timeoutMs` 上限：再长就与浏览器半边的 30 秒等待撞上了。 */
export const CAPABILITY_TIMEOUT_MAX_MS = 25_000

/** 执行器拒绝的三种原因。 */
export type ProviderCallCode = 'provider-timeout' | 'provider-cancelled' | 'provider-busy'

/**
 * 执行器的拒绝：带原因码与提供方名。
 *
 * 原因码是给路由翻状态码用的（超时 504、并发 429）；消息原样回给卡片，用户看得见是哪个提供方、等了
 * 多久。
 */
export class ProviderCallError extends Error {
  constructor(
    /** 为什么被拒绝。 */
    readonly code: ProviderCallCode,
    message: string,
    /** 哪个提供方。 */
    readonly provider: string,
  ) {
    super(message)
    this.name = 'ProviderCallError'
  }
}

/** 一次调用要报的东西。 */
export interface ProviderCall {
  /** 出错时说的是哪一样东西，例如「数据源 weather.now」。 */
  label: string
  /** 这次最多等多久；省略时按读取与动作的默认值。 */
  timeoutMs?: number
  /** 调用方自己的中止信号：连接断开、调用方取消时中止提供方。 */
  signal?: AbortSignal
}

/** 提供方调用的执行器与健康记录。 */
export interface ProviderHealth {
  /**
   * 一个提供方的把手活着（v3 的 `registerProvider` 拿到了把手）：可用为真，不计入注册数。
   *
   * @param provider - 提供方的包名。
   * @param features - 这次注册声明的功能；省略时保留已经记下的那一份。
   * @returns 撤下时调用的释放函数，可以重复调用。
   */
  present(provider: string, features?: readonly WidgetBoardFeature[]): () => void
  /**
   * 一项注册成功（目录、数据源、动作、能力与市场）：注册数加一，可用为真。
   *
   * @param provider - 提供方的包名。
   * @returns 这一项撤下时调用的释放函数，可以重复调用。
   */
  registered(provider: string): () => void
  /**
   * 记一次失败：提供方抛出的异常与不合格的结果都在这里计一次，两次不叠加。
   *
   * @param provider - 提供方的包名。
   * @param code - 原因码，写进 `lastError` 的开头。
   * @param reason - 给人看的原因。
   */
  failed(provider: string, code: string, reason: string): void
  /**
   * 在一个执行槽里跑一次调用。
   *
   * @param provider - 提供方的包名。
   * @param call - 说的是哪一样东西、等多久、调用方的信号。
   * @param work - 交给提供方的活；收到合成之后的信号。
   * @returns 提供方的结果。
   * @throws {ProviderCallError} 超时、取消，或这个提供方的槽已经占满。
   */
  run<T>(provider: string, call: ProviderCall, work: (signal: AbortSignal) => Promise<T> | T): Promise<T>
  /** 每个提供方一份的健康记录，按第一次出现的次序。 */
  snapshot(): WidgetProviderHealth[]
  /**
   * 健康记录变了（注册、撤下、失败、超时）通知一次。
   *
   * @param listener - 变化时调用。
   * @returns 退订函数。
   */
  onChange(listener: () => void): () => void
}

/** 建执行器时的可调项；生产用默认值，测试把超时调小。 */
export interface ProviderHealthOptions {
  /** 读取与动作的默认超时；省略时是 `PROVIDER_TIMEOUT_MS`。 */
  timeoutMs?: number
}

/** 一个提供方在内部的样子。 */
interface HealthRecord {
  provider: string
  features: readonly WidgetBoardFeature[]
  /** 累计成功的注册数。 */
  registrations: number
  /** 现在活着的项数：把手与每一项注册都算一个。 */
  active: number
  failures: number
  timeouts: number
  /** 现在占着的执行槽。 */
  running: number
  lastError?: string
}

/**
 * 一次能力调用等多久：注册声明的时长，缺省或越界时回到默认值。
 *
 * @param declared - 注册里的 `timeoutMs`。
 * @returns 毫秒。
 */
export function capabilityTimeoutOf(declared: unknown): number {
  if (typeof declared !== 'number' || !Number.isFinite(declared) || declared <= 0) return CAPABILITY_TIMEOUT_MS
  return Math.min(CAPABILITY_TIMEOUT_MAX_MS, Math.max(CAPABILITY_TIMEOUT_MIN_MS, Math.round(declared)))
}

/**
 * 建一套执行器与健康记录。
 *
 * @param options - 可调项。
 * @returns 执行器与健康记录。
 */
export function createProviderHealth(options: ProviderHealthOptions = {}): ProviderHealth {
  const defaultTimeoutMs = options.timeoutMs ?? PROVIDER_TIMEOUT_MS
  const records = new Map<string, HealthRecord>()
  const listeners = new Set<() => void>()

  /** 变化通知：订阅者逐个调用，一个订阅者抛出不吞掉。 */
  const changed = (): void => {
    for (const listener of [...listeners]) listener()
  }

  /** 取一个提供方的记录，没有就建一份空的。 */
  const recordOf = (provider: string): HealthRecord => {
    const existing = records.get(provider)
    if (existing !== undefined) return existing
    const created: HealthRecord = { provider, features: Object.freeze([]), registrations: 0, active: 0, failures: 0, timeouts: 0, running: 0 }
    records.set(provider, created)
    return created
  }

  /** 记下一项活着的注册或把手；返回的释放函数可以重复调用。 */
  const hold = (record: HealthRecord, counted: boolean): () => void => {
    record.active += 1
    if (counted) record.registrations += 1
    changed()
    let released = false
    return () => {
      if (released) return
      released = true
      record.active -= 1
      changed()
    }
  }

  return {
    present(provider, features) {
      const record = recordOf(provider)
      if (features !== undefined) record.features = Object.freeze([...features])
      return hold(record, false)
    },
    registered(provider) {
      return hold(recordOf(provider), true)
    },
    failed(provider, code, reason) {
      const record = recordOf(provider)
      record.failures += 1
      record.lastError = `${code}：${reason}`
      changed()
    },
    async run<T>(provider: string, call: ProviderCall, work: (signal: AbortSignal) => Promise<T> | T): Promise<T> {
      const record = recordOf(provider)
      const timeoutMs = call.timeoutMs !== undefined && call.timeoutMs > 0 ? call.timeoutMs : defaultTimeoutMs
      if (call.signal?.aborted === true) {
        throw new ProviderCallError('provider-cancelled', `${call.label} 没有开始：调用方已经取消`, provider)
      }
      if (record.running >= PROVIDER_CONCURRENCY) {
        throw new ProviderCallError(
          'provider-busy',
          `${call.label} 没有开始：${provider} 正有 ${String(PROVIDER_CONCURRENCY)} 个调用在跑，不排队`,
          provider,
        )
      }
      const controller = new AbortController()
      let timedOut = false
      // 执行器自己造的那一个拒绝按身份认：提供方抛出来的同名错误不冒充它，免得把一次失败记成两次。
      let failure: ProviderCallError | undefined
      const failedCall = new Promise<never>((_resolve, reject) => {
        controller.signal.addEventListener('abort', () => {
          failure = timedOut
            ? new ProviderCallError('provider-timeout', `${call.label} 超时：${provider} 在 ${String(timeoutMs)} 毫秒内没有答完`, provider)
            : new ProviderCallError('provider-cancelled', `${call.label} 被取消：调用方不再等 ${provider} 的结果`, provider)
          reject(failure)
        }, { once: true })
      })
      const onCancel = (): void => { controller.abort() }
      call.signal?.addEventListener('abort', onCancel, { once: true })
      const timer = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)
      timer.unref()
      record.running += 1
      const workPromise = (async (): Promise<T> => await work(controller.signal))()
      const release = (): void => { record.running -= 1 }
      // 槽跟着提供方的 promise 走，不跟超时走：忽略信号的提供方跑多久就占多久（D31）。
      workPromise.then(release, release)
      try {
        return await Promise.race([workPromise, failedCall])
      } catch (error) {
        // 执行器自己造的那一个拒绝只算超时；宿主自己的拒绝不算提供方的失败；提供方抛出来的异常记一次
        // 失败。三者不叠加。
        if (error instanceof ProviderCallError && error === failure) {
          if (error.code === 'provider-timeout') {
            record.timeouts += 1
            record.lastError = `provider-timeout：${call.label} 在 ${String(timeoutMs)} 毫秒内没有答完（${provider}）`
            changed()
          }
          throw error
        }
        if (error instanceof Refusal) throw error
        record.failures += 1
        record.lastError = `provider-failure：${call.label} 失败：${error instanceof Error ? error.message : String(error)}`
        changed()
        throw error
      } finally {
        clearTimeout(timer)
        call.signal?.removeEventListener('abort', onCancel)
      }
    },
    snapshot() {
      return [...records.values()].map((record) => ({
        provider: record.provider,
        features: record.features,
        registrations: record.registrations,
        failures: record.failures,
        timeouts: record.timeouts,
        available: record.active > 0,
        ...(record.lastError === undefined ? {} : { lastError: record.lastError }),
      }))
    },
    onChange(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}
