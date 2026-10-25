/**
 * 共用资产：构建写出的令牌样式表、组件套件、运行时脚本与精选库。
 *
 * 都由 `scripts/build.mjs` 写到 `lib/runtime/`，宿主启动时读一次；文档路由把它们内联进每份
 * 组件文档（D3、D7）。构建正在重写 `lib/` 时可能读到空文件，空资产一律当作没写出来拒掉，宿主于是
 * 继续用上一份，而不是把一份没有运行时的文档发给卡片。
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DocumentAssets } from './document'

/** 随包发布的精选库：manifest 的 `libs` 按这些 id 点名（D7）。 */
const LIBS = ['marked', 'highlight', 'three']

/**
 * 读共用资产。
 *
 * @param dir - `lib/runtime` 目录。
 * @returns 令牌样式表、套件样式表、运行时脚本与精选库。
 * @throws {Error} 少了一份或读出来是空的，说明构建没有写完。
 */
export async function loadAssets(dir: string): Promise<DocumentAssets> {
  const read = async (name: string): Promise<string> => {
    let text: string
    try {
      text = await readFile(join(dir, name), 'utf8')
    } catch (error) {
      throw new Error(`读不到 ${join(dir, name)}：构建没有写出它（${(error as Error).message}）`)
    }
    if (text.trim() === '') throw new Error(`${join(dir, name)} 是空的：构建没有写完`)
    return text
  }
  const libs: Record<string, string> = {}
  for (const id of LIBS) libs[id] = await read(join('libs', `${id}.js`))
  return {
    tokensCss: await read('tokens.css'),
    suiteCss: await read('suite.css'),
    runtimeJs: await read('runtime.js'),
    libs,
  }
}
