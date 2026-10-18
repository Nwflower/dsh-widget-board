/**
 * 卡片状态的待写队列（D5、D23）：把组件连续送来的 setState 合成几次提交。
 *
 * 组件每秒可以发几百条消息；每条都写一次宿主时，整块看板就要重写一次。这个队列放在受信任的
 * 父页面里，把补丁按一层合并，最多每 delayMs 发一次；合并后的补丁接近路由上限时提前发。暂停、
 * 页面隐藏与卸载时立即发送。同一张卡同时只有一个请求在途，失败按退避重试，最终失败交给卡片显示。
 */
import { mergeState } from './state-merge'

/** 第一次重试等多久。 */
const RETRY_BASE_MS = 1000

/** 重试间隔的上限。 */
const RETRY_MAX_MS = 8000

/** 连续失败几次之后不再自动重试；下一次 push 会重新开始。 */
const RETRY_LIMIT = 5

/** 默认的合并窗口。 */
const DEFAULT_DELAY_MS = 250

/** 补丁接近路由的 16KB 上限时就提前发。 */
const DEFAULT_BURST_BYTES = 12 * 1024

/** 建一个状态队列要的东西。 */
export interface StateQueueOptions {
  /** 两次发送之间的最短间隔，默认 250 毫秒。 */
  delayMs?: number
  /** 合并后的补丁超过多少字节就提前发送，默认 12KB。 */
  burstBytes?: number
  /** 真正把补丁交给宿主；失败时抛出。 */
  send: (patch: unknown) => Promise<void>
  /** 一次发送失败；队列自己会重试，卡片据此显示原因。 */
  onError: (error: Error) => void
  /** 一次发送成功；卡片据此收起失败提示。 */
  onSaved?: () => void
  /** 定时器留给测试替换。 */
  setTimer?: (callback: () => void, ms: number) => { cancel: () => void }
}

/** 一张卡的状态队列。 */
export interface StateQueue {
  /** 记下一条补丁，按窗口合并之后再发。 */
  push(patch: unknown): void
  /** 立刻把待写的补丁送出去；有请求在途时等它结束。 */
  flush(): Promise<void>
  /** 停掉定时器，并把最后一份补丁送出去。 */
  dispose(): void
}

/** 补丁的 JSON 字节数；`undefined` 按 0 算。 */
function sizeOf(value: unknown): number {
  const text = JSON.stringify(value)
  return text === undefined ? 0 : text.length
}

/** 默认的定时器。 */
function defaultTimer(callback: () => void, ms: number): { cancel: () => void } {
  const handle = setTimeout(callback, ms)
  return { cancel: () => { clearTimeout(handle) } }
}

/**
 * 建一张卡的状态队列。
 *
 * @param options - 发送、失败回调与窗口。
 * @returns 队列。
 */
export function createStateQueue(options: StateQueueOptions): StateQueue {
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS
  const burstBytes = options.burstBytes ?? DEFAULT_BURST_BYTES
  const setTimer = options.setTimer ?? defaultTimer

  let pending: unknown
  let hasPending = false
  let timer: { cancel: () => void } | undefined
  let inFlight: Promise<void> | undefined
  let failures = 0
  let retryDelay: number | undefined
  let disposed = false

  /** 排一次发送。 */
  const schedule = (delay = delayMs): void => {
    if (disposed || timer !== undefined || inFlight !== undefined) return
    timer = setTimer(() => {
      timer = undefined
      void flushNow()
    }, delay)
  }

  /** 现在就把待写的补丁送出去。 */
  const flushNow = async (): Promise<void> => {
    if (inFlight !== undefined) {
      await inFlight
      if (hasPending) await flushNow()
      return
    }
    if (!hasPending) return
    timer?.cancel()
    timer = undefined
    const patch = pending
    pending = undefined
    hasPending = false
    const run = (async () => {
      try {
        await options.send(patch)
        failures = 0
        if (!disposed) options.onSaved?.()
      } catch (error) {
        // 失败的补丁放回队首；请求在途时新来的那一份并到它后面。
        pending = hasPending ? mergeState(patch, pending) : patch
        hasPending = true
        failures += 1
        retryDelay = failures <= RETRY_LIMIT
          ? Math.min(RETRY_BASE_MS * 2 ** (failures - 1), RETRY_MAX_MS)
          : undefined
        if (!disposed) options.onError(error instanceof Error ? error : new Error(String(error)))
      }
    })()
    inFlight = run
    try {
      await run
    } finally {
      if (inFlight === run) inFlight = undefined
      if (hasPending && !disposed && failures <= RETRY_LIMIT) {
        schedule(retryDelay)
        retryDelay = undefined
      }
    }
  }

  return {
    push(patch) {
      if (disposed) return
      if (failures > RETRY_LIMIT) failures = 0
      pending = hasPending ? mergeState(pending, patch) : patch
      hasPending = true
      if (sizeOf(pending) >= burstBytes) {
        void flushNow()
        return
      }
      schedule()
    },
    async flush() {
      await flushNow()
    },
    dispose() {
      if (disposed) return
      disposed = true
      timer?.cancel()
      timer = undefined
      const done = inFlight ?? Promise.resolve()
      void done.then(async () => { await flushNow() })
    },
  }
}
