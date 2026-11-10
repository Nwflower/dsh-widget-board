/**
 * 源码编辑器这个按需加载的分包（技术契约 4）。
 *
 * 浏览器半边的主包里不写 CodeMirror：它在进入高级模式时经 `require.async` 去取这一个分包。分包
 * 的文件名与构建脚本里写的一致，宿主的加载器按它认领这个工厂（D2）。
 */
export { createSourceEditor, languageOf } from './source-editor'
export type { EditorFileKind, SourceEditor } from './source-editor'
