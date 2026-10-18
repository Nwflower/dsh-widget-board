/**
 * `node:crypto` 里宿主模块在演示宿主上会调用的函数，由 Web Crypto 兑现（D25）。
 *
 * 演示宿主复用 `state.ts` 的纯函数，它们从 `node:crypto` 取 `randomUUID` 生成卡片与组的 id。
 * 构建演示宿主时 `node:crypto` 指到这个文件，调用方因此不需要改。
 */

/** 一个随机 UUID。 */
export function randomUUID(): string {
  return crypto.randomUUID()
}
