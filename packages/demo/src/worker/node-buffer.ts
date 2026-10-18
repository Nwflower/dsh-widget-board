/**
 * `Buffer` 里宿主模块在演示宿主上会调用的那一个函数（D25）。
 *
 * `state.ts` 用 `Buffer.byteLength` 核对状态额度（D23）。构建演示宿主时这个文件以 `Buffer` 之名
 * 注入，额度的判定与真实宿主逐字节一致。
 */
export const Buffer = {
  /**
   * 一段文本编码成 UTF-8 之后的字节数。
   *
   * @param text - 文本。
   * @param encoding - 编码，只认 `utf8`。
   * @returns 字节数。
   */
  byteLength(text: string, encoding: 'utf8'): number {
    if (encoding !== 'utf8') throw new Error(`演示宿主的 Buffer.byteLength 只认 utf8：${String(encoding)}`)
    return new TextEncoder().encode(text).length
  },
}
