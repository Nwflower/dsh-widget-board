/**
 * 浏览器半边能接住的能力（D29）。
 *
 * 宿主能力走 `/instance/<id>/call`，适合读进程里的服务；有些能力的落点在浏览器：主题、界面语言、
 * 指针与视口。这里按能力名登记它们的浏览器实现，卡片先问这一张表，接不住时再走宿主路由。表是
 * 整页共用的一份，登记项随插件卸载撤下。
 */
import type { BoardInstance, WidgetSummary } from '@dsh-widget-board/contracts'

/** 一次本地能力调用能看到的上下文。 */
export interface ClientCapabilityCall {
  /** 能力名，与 manifest 里声明的一致。 */
  capability: string
  /** 已经按提供方 schema 校验过的参数；本地实现自己也做一次运行时判定。 */
  args: unknown
  /** 发起调用的卡片。 */
  instance: BoardInstance
  /** 发起调用的组件。 */
  widget: WidgetSummary
  /** 沙箱 iframe；原生组件与一次性快照没有。 */
  frame: HTMLIFrameElement | null
  /** 组件取消这次调用时中止。 */
  signal: AbortSignal
  /** 组件库里的缩略画面：只画，不接收交互。 */
  preview: boolean
  /** 会话里的一次性快照：不在看板上，调用没有去处。 */
  detached: boolean
}

/** 一个浏览器侧的能力实现。 */
export interface ClientCapability {
  /** 现在能不能接；不能时这次调用落到宿主路由上（D11）。 */
  available(): boolean
  /**
   * 这个能力需要人的授权（D6）。
   *
   * 声明了它的实现不会被浏览器本地执行：授权只由人在确认页给出，宿主路由那一侧才查得到，
   * 本地执行会绕开这道闸门。
   */
  permission?: string
  /** 跑一次；结果按 manifest 的 output schema 与宿主侧同样对待，由组件自己判定。 */
  call(call: ClientCapabilityCall): unknown | Promise<unknown>
}

/** 能力名到实现的表。 */
const capabilities = new Map<string, ClientCapability>()

/**
 * 登记一个浏览器侧能力。
 *
 * @param id - 能力名。
 * @param capability - 实现。
 * @returns 撤下这次登记的函数。
 * @throws {Error} 同一个名字已经有人登记。
 */
export function registerClientCapability(id: string, capability: ClientCapability): () => void {
  if (capabilities.has(id)) throw new Error(`浏览器侧能力 ${id} 已经登记过`)
  capabilities.set(id, capability)
  return () => {
    if (capabilities.get(id) === capability) capabilities.delete(id)
  }
}

/**
 * 取一个能力名对应的浏览器实现。
 *
 * @param id - 能力名。
 * @returns 实现，或 `undefined`。
 */
export function clientCapabilityOf(id: string): ClientCapability | undefined {
  return capabilities.get(id)
}
