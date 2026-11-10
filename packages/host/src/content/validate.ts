/**
 * 人工内容写入的校验（技术契约 3）：创建与编辑共用这一份判定。
 *
 * 形状不对是 400，额度超出是 413，修订号过期是 409；三类分开，界面才能给出「补哪儿」「换哪儿
 * 重新读」这两种不同的说法。校验顺序固定：先看请求形状，再看 schema，最后看额度——形状都不对
 * 的请求不必编译 schema。
 */
import type { ContentIssue, WidgetManifest } from '@dsh-widget-board/contracts'
import { PARENT_MESSAGE_LIMIT } from '@dsh-widget-board/contracts'
import { BOARD_STATE_BYTES_LIMIT, STATE_BYTES_LIMIT } from '../limits'
import { Refusal } from '../refusal'
import { stateBytes } from '../state'
import { issuesOf } from '../schema'

/** 一次内容写入要核对的全部字节额度。 */
export interface ContentBudget {
  /** 请求体本身的上限；路由已经按它读过一遍，这里只用来写清是哪一个额度超了。 */
  requestBytes: number
  requestLimit: number
  /** 这块看板上其余卡片已经占用的状态字节。 */
  otherStateBytes: number
  /** 只读的校验报告：`PARENT_MESSAGE_LIMIT` 是父页面发给 iframe 的握手额度。 */
  handshakeBytes: number
}

/**
 * 一份 props 或 data 与它声明的 schema 是否相符。
 *
 * @param subject - 界面上叫这个名字的字段，例如 `props`。
 * @param schema - manifest 里对应的 schema；没有声明时不校验。
 * @param value - 准备写进去的值。
 * @returns 逐字段的原因；相符时是空表。
 * @throws {Refusal} 不符时抛出 400，`extra.issues` 带着每条路径。
 */
export function contentIssues(subject: string, schema: Record<string, unknown> | undefined, value: unknown): ContentIssue[] {
  const issues = issuesOf(schema, value)
  if (issues === undefined) return []
  throw new Refusal(400, `${subject} 与组件的 schema 不符`, { subject, issues })
}

/**
 * 一次内容写入的字节额度（技术契约 3）。
 *
 * 单卡状态、整板状态与 iframe 握手三道分开报；只写「超限」会让作者不知道是请求体、状态还是桥
 * 消息的问题。整板额度把其余卡片已经占用的那一份算进来，写入之后的总量才是判定依据。
 *
 * @param state - 写入之后这张卡的状态。
 * @param budget - 这次写入的相关额度。
 * @throws {Refusal} 超限时抛出 413，`extra.code` 指出是哪一个额度。
 */
export function checkContentBudget(state: unknown, budget: ContentBudget): void {
  if (budget.requestBytes > budget.requestLimit) {
    throw new Refusal(413, `请求体超过 ${String(budget.requestLimit)} 字节`, { code: 'request-too-large' })
  }
  const own = stateBytes(state)
  if (own > STATE_BYTES_LIMIT) {
    throw new Refusal(413, `这张卡的状态超过 ${String(STATE_BYTES_LIMIT)} 字节：${String(own)} 字节`, { code: 'state-too-large' })
  }
  const total = budget.otherStateBytes + own
  if (total > BOARD_STATE_BYTES_LIMIT) {
    throw new Refusal(413, `这块看板的状态合计超过 ${String(BOARD_STATE_BYTES_LIMIT)} 字节：${String(total)} 字节`, { code: 'board-state-too-large' })
  }
  if (budget.handshakeBytes > PARENT_MESSAGE_LIMIT) {
    throw new Refusal(413, `这张卡的握手消息超过 ${String(PARENT_MESSAGE_LIMIT)} 字节：${String(budget.handshakeBytes)} 字节`, { code: 'handshake-too-large' })
  }
}

/**
 * 一次握手消息的字节数：`init` 带着 props、data、state 与文案，前端把这一份递给组件。
 *
 * 卡片状态小于额度不等于握手一定装得下——组件自己声明的文案也算在里面（技术契约 3）。没点名的那几项
 * 由调用方并上实例上的原值再进来，这里的三个键都是最终值。
 *
 * @param manifest - 组件 manifest。
 * @param content - 这次要交出去的几项。
 * @returns 序列化之后的字节数。
 */
export function handshakeBytes(manifest: WidgetManifest, content: { props?: unknown, data?: unknown, state?: unknown }): number {
  return stateBytes({
    type: 'init',
    props: content.props,
    data: content.data,
    state: content.state,
    text: manifest.text ?? {},
  })
}
