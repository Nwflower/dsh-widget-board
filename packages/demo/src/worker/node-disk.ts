/**
 * 宿主模块里读写磁盘的导入在演示宿主上指到这里（D25）。
 *
 * `state.ts` 为了读写看板文件导入了 `node:fs/promises` 与 `node:path`。Service Worker 里没有一条
 * 调用路径通到那几个函数（看板存在 IndexedDB 里）；构建检查保证这个文件没有任何内容进入产物。
 * 万一哪天有路径通到这里，当场抛出，不会静默地什么也不做。
 */

/** 抛出：演示宿主没有磁盘。 */
function noDisk(name: string): never {
  throw new Error(`演示宿主没有磁盘，不能调用 ${name}（D25）`)
}

export const mkdir = (): never => noDisk('mkdir')
export const readFile = (): never => noDisk('readFile')
export const rename = (): never => noDisk('rename')
export const writeFile = (): never => noDisk('writeFile')
export const dirname = (): never => noDisk('dirname')
