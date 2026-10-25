# 第三方许可

本插件随包发布三个精选库，构建时打进 `lib/runtime/libs/`，组件文档用到它们时内联：

- **marked** — Markdown 解析器，MIT License，https://github.com/markedjs/marked
- **highlight.js** — 代码高亮，BSD-3-Clause License，https://github.com/highlightjs/highlight.js
- **Three.js** — WebGL 三维渲染，MIT License，https://github.com/mrdoob/three.js

组件包与看板包的 zip 读写用 **fflate**（MIT License，https://github.com/101arrowz/fflate），内联进宿主半边的产物。

「月历」与「今日运势」两个内置组件随目录带一份 **lunar-javascript**（MIT License，https://github.com/6tail/lunar-javascript），放在各自的 `vendor/` 下，经 manifest 的 `scripts` 内联进组件文档；农历、节气、干支与宜忌都由它算。文件原样保留，未做修改。

五个库的版权归各自的作者所有；本插件只做打包与调用。

看板入口的未读通知徽标参考了 transitions.dev 的 **Notification badge**（作者 Jakub Antalík），按它的许可改写为本站的类名与令牌：

- 来源：https://transitions.dev/detail.html?t=notification-badge
- 许可：https://transitions.dev/terms.html
