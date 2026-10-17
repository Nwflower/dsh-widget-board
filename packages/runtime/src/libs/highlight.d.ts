/**
 * highlight.js 的语言文件没有随包的声明；这一条只描述精选库用到的那一组模块。
 */
declare module 'highlight.js/lib/languages/*' {
  import type { LanguageFn } from 'highlight.js'

  const language: LanguageFn
  export default language
}
