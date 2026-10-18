/**
 * 带状态码的拒绝（D1）：处理器只挑原因，状态码在这里定一次。
 *
 * 路由表把它翻成一条 JSON 响应，`extra` 里的字段跟在一起回给调用方——卡片要知道缺的是哪一份授权、
 * 要向人问什么（D6）。
 */
export class Refusal extends Error {
  /** 跟着这条拒绝一起回给卡片的其他字段：缺少的授权、要问的权限。 */
  readonly extra: Record<string, unknown>

  constructor(readonly status: number, message: string, extra: Record<string, unknown> = {}) {
    super(message)
    this.name = 'Refusal'
    this.extra = extra
  }
}
