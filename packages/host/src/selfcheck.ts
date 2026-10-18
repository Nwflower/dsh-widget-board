/**
 * `widget_define` 的自检（D9、D13）：宿主出任务，正在显示那次调用的会话页面量，宿主收报告。
 *
 * 宿主自己画不出组件，量排版要靠一个真实的浏览器页面。会话页面上的工具视图在调用进行中挂着，
 * 它按调用 id 来取任务，把新版本放进几个代表性的盒子，让组件运行时里的检查器量一遍，再把报告
 * 交回来；同一次调用有多个页面在显示时，先交回的那一份算数。没有页面接手、或页面没在时限内交回
 * 时，结论是 `unverified`——组件已经写下，只是没人看过它。
 */
import type { SelfCheckBoxResult, SelfCheckJob, SelfCheckResult } from '@dsh-widget-board/contracts'
import { SELF_CHECK_ROUTE, SELF_CHECK_TIMEOUT_MS, isSelfCheckBoxResults } from '@dsh-widget-board/contracts'
import { readJson } from './body'
import { Refusal } from './refusal'
import { json } from './response'
import type { Route, RouteContext } from './routes'

/** 报告的请求体上限：几个盒子的报告，每份带几条截断的元素名与错误。 */
const REPORT_LIMIT = 64 * 1024

/** 记住多少个已经结束的调用：页面晚到的取任务据此得到「已结束」，而不是一直等下去。 */
const FINISHED_MEMORY = 64

/** 一次进行中的自检。 */
interface Pending {
  job: SelfCheckJob
  settle: (boxes: SelfCheckBoxResult[]) => void
}

/** 自检的登记处。 */
export interface SelfChecks {
  /**
   * 登记一次自检并等它的结论。
   *
   * @param callId - 那次 `widget_define` 调用的 id。
   * @param job - 要画的版本、props、data 与盒子。
   * @param signal - 调用被取消时随之结束。
   * @returns 结论；没人交回报告时是 `unverified`。
   */
  run(callId: string, job: SelfCheckJob, signal: AbortSignal): Promise<SelfCheckResult>
  /** 某次调用的任务；还没登记时 `pending`，已经结束或从未有过时 `gone`。 */
  take(callId: string): SelfCheckJob | 'pending' | 'gone'
  /** 交回报告；只有第一份算数，后到的与没有登记的返回假。 */
  settle(callId: string, boxes: SelfCheckBoxResult[]): boolean
}

/**
 * 把各个盒子的结果读成结论。
 *
 * @param boxes - 页面交回的结果。
 * @returns 结论：每个盒子都应答了、也都没有问题才算通过。
 */
export function verdictOf(boxes: SelfCheckBoxResult[]): SelfCheckResult {
  const problems = [...new Set(boxes.flatMap((box) => box.failure === undefined ? box.problems : [box.failure, ...box.problems]))]
  return { status: problems.length === 0 ? 'passed' : 'failed', boxes, problems }
}

/**
 * 建一个自检登记处。
 *
 * @param timeoutMs - 等一份报告的上限。
 * @returns 登记处。
 */
export function createSelfChecks(timeoutMs = SELF_CHECK_TIMEOUT_MS): SelfChecks {
  const pending = new Map<string, Pending>()
  /** 这个宿主进程里出现过的调用：区分「还没登记」与「已经结束」。 */
  const finished: string[] = []
  const finish = (callId: string): void => {
    pending.delete(callId)
    finished.push(callId)
    if (finished.length > FINISHED_MEMORY) finished.shift()
  }
  return {
    run(callId, job, signal) {
      return new Promise((resolve) => {
        let timer: ReturnType<typeof setTimeout> | undefined
        const end = (result: SelfCheckResult): void => {
          if (timer !== undefined) clearTimeout(timer)
          signal.removeEventListener('abort', onAbort)
          finish(callId)
          resolve(result)
        }
        const onAbort = (): void => { end({ status: 'unverified', boxes: [], problems: [], reason: '调用被取消，自检没有做完' }) }
        if (signal.aborted) {
          onAbort()
          return
        }
        pending.set(callId, { job, settle: (boxes) => { end(verdictOf(boxes)) } })
        signal.addEventListener('abort', onAbort, { once: true })
        timer = setTimeout(() => {
          end({
            status: 'unverified',
            boxes: [],
            problems: [],
            reason: `${String(Math.round(timeoutMs / 1000))} 秒内没有打开着这个会话的页面交回报告；组件已经写下，但没有人看过它的排版`,
          })
        }, timeoutMs)
        timer.unref?.()
      })
    },
    take(callId) {
      const entry = pending.get(callId)
      if (entry !== undefined) return entry.job
      return finished.includes(callId) ? 'gone' : 'pending'
    },
    settle(callId, boxes) {
      const entry = pending.get(callId)
      if (entry === undefined) return false
      entry.settle(boxes)
      return true
    },
  }
}

/** 调用 id 的形状：宿主给的不透明字符串，路径里只认安全字符。 */
const CALL_PATTERN = new RegExp(`^${SELF_CHECK_ROUTE}/([A-Za-z0-9_:.-]{1,200})$`)

/**
 * 自检的两条路由。
 *
 * @returns 路由表。
 */
export function selfCheckRoutes(): Route[] {
  return [
    {
      method: 'GET',
      pattern: CALL_PATTERN,
      limit: 0,
      async handle(context: RouteContext, _request, response, match) {
        const taken = context.selfChecks.take(decodeURIComponent(match[1] as string))
        // 还没登记时回 202：工具视图比宿主写完组件更早挂上，它隔一会儿再来取（D9）。
        if (taken === 'pending') json(response, 202, { pending: true })
        else if (taken === 'gone') throw new Refusal(410, '这次调用的自检已经结束')
        else json(response, 200, { job: taken })
      },
    },
    {
      method: 'POST',
      pattern: CALL_PATTERN,
      limit: REPORT_LIMIT,
      async handle(context: RouteContext, request, response, match) {
        const body = await readJson(request, REPORT_LIMIT)
        const boxes = (body as { boxes?: unknown } | undefined)?.boxes
        if (!isSelfCheckBoxResults(boxes)) throw new Refusal(400, '自检报告的形状不对：需要 boxes')
        const accepted = context.selfChecks.settle(decodeURIComponent(match[1] as string), boxes)
        json(response, 200, { accepted })
      },
    },
  ]
}
