/**
 * 精选库 `marked`：Markdown 解析器，以 `window.marked` 交给组件（D7）。
 *
 * 库随插件发布，宿主把这一段内联进用到它的组件文档；组件不联网。
 */
import { marked } from 'marked'

;(globalThis as typeof globalThis & { marked?: typeof marked }).marked = marked
