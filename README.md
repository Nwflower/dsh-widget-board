# dsh-widget-board

[English](README.en.md)

DeepSeek Harness 的组件看板插件。侧栏多一个「看板」入口，中栏是一页可以拖动、缩放的卡片看板，每张卡片是一个小组件，由组件库里的目录渲染出来。

- **自由排版**：看板按自身宽度在 1 到 4 列之间切换，卡片有自己的一列宽与高度，拖动与缩放时实时显示尺寸；换窗口宽度、收侧栏都不必重排。
- **组件的三个来源**：随包发布的内置组件、`$DSH_HOME/widget-board/widgets/` 里你自己的组件，以及插件经 `widgetBoard` 服务注册的组件。组件格式相同：一个目录，`widget.json` 加 `index.html`、`style.css`、可选的 `main.js`。
- **状态在宿主上**：卡片的界面状态与数据都存在宿主，切走再切回、页面重载、组件热重载之后都接得上。
- **跟着宿主的外观走**：卡片的颜色、圆角、时长与曲线来自宿主的令牌，切换浅色深色或换皮肤时当场跟着变，界面语言一起切换。
- **安全隔离**：每个组件运行在独立的沙箱 iframe 里，拿不到宿主的会话、cookie 与网络；组件文档带严格的 CSP，图片与字体以 `data:` 地址内联。

## 组件库

看板题头的按钮打开组件库，按来源分组。加一张卡、从卡片右上角移除一张卡；组件坏掉时只有它自己不可用，卡片上写明原因。

写一个组件：在 `$DSH_HOME/widget-board/widgets/<id>/` 下建一个目录，写 `widget.json`、`index.html`、`style.css`，需要脚本时再加 `main.js`。目录一改，宿主重读组件库，在线页面的卡片按新版本重挂。

## 给插件提供方

宿主半边发布 cordis 服务 `widgetBoard`（`WIDGET_BOARD_API_VERSION = 1`）：

- `registerWidgetType({ apiVersion, provider, directory })`：注册一个组件目录，返回释放函数。
- `registerDataSource({ apiVersion, id, read })`：注册一个数据源，卡片可以绑定它取数据。
- `registerAction({ apiVersion, id, run })`：注册一个动作。

浏览器半边发布同名服务，`registerWidgetType({ apiVersion, provider, id, component })` 登记一个 React 组件：与组件库里同 id 的组件对上之后，卡片用它渲染，参数与 `window.widget` 同形。提供方不在运行时导入本插件：在自己包里写同形的 `declare module` 类型声明，按 `apiVersion` 协商。

## 状态

开发中，尚未发布。面向会话的工具、会话内联显示、右侧栏、组件的分享与导入还在做。

## 许可

MIT
