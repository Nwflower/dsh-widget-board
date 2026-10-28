/**
 * 文件名与语言的对应（技术契约 4）。
 *
 * 主包与按需加载的那个分包都要它：主包在分包取回来之前就要按文件名挑语言，两边给出不同的判定
 * 会让同一个文件在两个地方用不同的语法高亮。
 */

/** 编辑器要画的那些文件。 */
export type EditorFileKind = 'json' | 'html' | 'css' | 'javascript' | 'text'

/**
 * 按文件名给出语言。
 *
 * @param path - 组件目录里的相对路径。
 * @returns 语言。
 */
export function languageOf(path: string): EditorFileKind {
  const lower = path.toLowerCase()
  if (lower.endsWith('.json')) return 'json'
  if (lower.endsWith('.html')) return 'html'
  if (lower.endsWith('.css')) return 'css'
  if (lower.endsWith('.js') || lower.endsWith('.mjs')) return 'javascript'
  return 'text'
}
