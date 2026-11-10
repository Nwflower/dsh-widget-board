/**
 * 按需加载的源码编辑器（技术契约 4）。
 *
 * CodeMirror 有几百 KB，大多数人不会进高级模式：它单独打成一个分包，源码面板第一次打开时才去
 * 取。宿主给的 `require` 带一个 `async`，经它去取这一个分包（D2）。
 *
 * 取不到时给出一句能看见的说法，不静默退回一个没有高亮的文本框（D11）。
 */
import type { EditorFileKind, SourceEditor } from './source-editor'

export { languageOf } from './editor-language'
export type { EditorFileKind, SourceEditor }

/** 这个分包的文件名：与构建脚本和宿主的加载器约定一致。 */
const CHUNK = './client.source-editor.js'

/** 加载器给的 require：带一个 `async` 去取按需加载的分包。 */
interface AsyncRequire {
  (specifier: string): unknown
  async?: (specifier: string) => Promise<unknown>
}

/**
 * 加载器把 require 放在这个全局上。
 *
 * 加载器不把它交给插件的 `apply`：插件是在工厂执行之后才被 cordis 调用的，那时它拿不到 require。
 * 构建脚本在工厂执行时把它记在这里，这里再取出来（D2）。
 */
const REQUIRE_KEY = '__dshWidgetBoardRequire'

/** 取加载器给的 require。 */
function loaderRequire(): AsyncRequire | null {
  const value = (globalThis as Record<string, unknown>)[REQUIRE_KEY]
  return typeof value === 'function' ? value as AsyncRequire : null
}

/**
 * 分包已经取过一次时的结果。
 */
let loaded: typeof import('./source-editor') | null = null

/** 正在取的那一次：并发打开源码面板时只取一遍。 */
let pending: Promise<typeof import('./source-editor')> | null = null

/**
 * 取源码编辑器这个分包。
 *
 * @returns 编辑器工厂与语言判定。
 * @throws {Error} 加载器没有给异步的 require，或分包取不到。
 */
export async function loadSourceEditor(): Promise<typeof import('./source-editor')> {
  if (loaded !== null) return loaded
  if (pending === null) {
    pending = (async () => {
      const require = loaderRequire()
      if (require?.async === undefined) {
        throw new Error('宿主的加载器没有给出按需加载的能力，源码编辑器用不了')
      }
      const chunk = await require.async(CHUNK) as { createSourceEditor?: unknown, languageOf?: unknown }
      const create = chunk?.createSourceEditor
      const language = chunk?.languageOf
      if (typeof create !== 'function' || typeof language !== 'function') {
        throw new Error('源码编辑器那个分包里没有编辑器')
      }
      loaded = {
        createSourceEditor: create as typeof import('./source-editor').createSourceEditor,
        languageOf: language as typeof import('./source-editor').languageOf,
      } as unknown as typeof import('./source-editor')
      return loaded
    })().catch((error: unknown) => {
      pending = null
      throw error instanceof Error ? error : new Error(String(error))
    })
  }
  return await pending
}
