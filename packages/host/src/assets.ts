/**
 * 共用资产：构建写出的令牌样式表、组件套件与运行时脚本。
 *
 * 三者由 `scripts/build.mjs` 写到 `lib/runtime/`，宿主启动时读一次；文档路由把它们内联进每份
 * 组件文档（D3）。
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DocumentAssets } from './document'

/**
 * 读三份资产。
 *
 * @param dir - `lib/runtime` 目录。
 * @returns 令牌样式表、套件样式表与运行时脚本。
 * @throws {Error} 少了一份，说明构建没有跑过。
 */
export async function loadAssets(dir: string): Promise<DocumentAssets> {
  const read = async (name: string): Promise<string> => {
    try {
      return await readFile(join(dir, name), 'utf8')
    } catch (error) {
      throw new Error(`读不到 ${join(dir, name)}：构建没有写出它（${(error as Error).message}）`)
    }
  }
  return {
    tokensCss: await read('tokens.css'),
    suiteCss: await read('suite.css'),
    runtimeJs: await read('runtime.js'),
  }
}
