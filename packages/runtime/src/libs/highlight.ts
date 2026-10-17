/**
 * 精选库 `highlight`：代码高亮，以 `window.hljs` 交给组件（D7）。
 *
 * 只装常用的几种语言，控制每次文档的体积；语言表在数组里加一项，组件的代码块就能按它高亮。
 */
import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import css from 'highlight.js/lib/languages/css'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import python from 'highlight.js/lib/languages/python'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'

const LANGUAGES: Array<[string, typeof javascript]> = [
  ['bash', bash],
  ['css', css],
  ['javascript', javascript],
  ['json', json],
  ['python', python],
  ['typescript', typescript],
  ['xml', xml],
]

for (const [name, language] of LANGUAGES) hljs.registerLanguage(name, language)

;(globalThis as typeof globalThis & { hljs?: typeof hljs }).hljs = hljs
