# 第三方许可

本地图片处理使用 **sharp 0.35.5**（Apache-2.0，https://github.com/lovell/sharp），依赖的 libvips 及平台二进制按其随附许可分发；不向外部服务上传图片。

校园事项的 IANA 时区及夏令时处理使用 **Luxon 3.7.2**（MIT，https://github.com/moment/luxon）。共享纯模型在构建时内联进标准校园组件；不请求外部时间服务。

本插件随包发布三个精选库，构建时打进 `lib/runtime/libs/`，组件文档用到它们时内联：

- **marked** — Markdown 解析器，MIT License，https://github.com/markedjs/marked
- **highlight.js** — 代码高亮，BSD-3-Clause License，https://github.com/highlightjs/highlight.js
- **Three.js** — WebGL 三维渲染，MIT License，https://github.com/mrdoob/three.js

组件包与看板包的 zip 读写用 **fflate**（MIT License，https://github.com/101arrowz/fflate），内联进宿主半边的产物。

高级源码编辑器用 **CodeMirror 6**（MIT License，https://github.com/codemirror/view），构建时打进 `lib/client.source-editor.js`；源码面板在进入高级模式时才按需加载它，用到的部分有 `@codemirror/view`、`@codemirror/state`、`@codemirror/commands`、`@codemirror/search`、`@codemirror/language`、`@codemirror/autocomplete`、`@codemirror/lint`、`@codemirror/lang-html`、`@codemirror/lang-css`、`@codemirror/lang-javascript`、`@codemirror/lang-json` 与 `@codemirror/theme-one-dark`。

倒计时的IANA时区及夏令时处理使用 **Luxon 3.7.2**（MIT，https://github.com/moment/luxon），构建时内联进组件脚本，不请求外部时间服务。

「月历」与「今日运势」两个内置组件随目录带一份 **lunar-javascript**（MIT License，https://github.com/6tail/lunar-javascript），放在各自的 `vendor/` 下，经 manifest 的 `scripts` 内联进组件文档；农历、节气、干支与宜忌都由它算。文件原样保留，未做修改。

CSV 读取与导出使用 **Papa Parse 5.7.0**（MIT，https://github.com/mholt/PapaParse）；ICS 解析、重复规则与标准序列化使用 **ical.js 2.2.1**（MPL-2.0，https://github.com/kewisch/ical.js）。两者构建进宿主半边，保留各自许可声明；ical.js 源文件没有修改，源代码可从对应版本的上游仓库取得。

上述库的版权归各自的作者所有；本插件只做打包与调用。

看板入口的未读通知徽标参考了 transitions.dev 的 **Notification badge**（作者 Jakub Antalík），按它的许可改写为本站的类名与令牌：

- 来源：https://transitions.dev/detail.html?t=notification-badge
- 许可：https://transitions.dev/terms.html
