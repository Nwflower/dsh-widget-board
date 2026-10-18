# dsh-widget-board

[English](README.en.md)

DeepSeek Harness 的组件看板插件。侧栏多一个「看板」入口，中栏是几块可以拖动、缩放的卡片看板，顶上一条标签在它们之间切换，每张卡片是一个小组件，由组件库里的目录渲染出来。

- **多块看板**：顶部一条标签在几块看板之间切换，活动标签的药丸滑过去；标签条上只有一个新建入口，改名、移除与选中在设置页的「看板」一节。所有看板的卡片同时挂载，切换标签不重挂任何组件，看不见的那些照旧暂停；每块看板有自己的卡片、盒子与修订号，旧版本的单一看板在第一次打开时自动搬成第一块。
- **自由排版**：看板按自身宽度在 1 到 4 列之间切换，卡片有自己的一列宽与高度；高度按 6/10/14/18/22/26/30rem 七档跳，纵向位置按 2rem 一档吸附，拖动与缩放时实时显示尺寸，换窗口宽度、收侧栏都不必重排。
- **题头也是卡片**：一块活的看板的标题、说明与字模图案内置成 `board-hero` 组件卡，可以拖动、缩放、移除；旧看板升级时补一次这张卡，添加按钮只在下方菜单。
- **下方菜单**：屏幕下方居中的加号按下后化开成扇面的三个图标，分别是添加、整理与刷新。底色、桥接与投影画在同一张 SVG 的 goo 滤镜里；三个动作按 40ms 错峰弹开，加号旋转 45°，收起时整块轻轻下沉 5px 再回弹。添加打开悬浮的组件库：按来源分组排成网格，每格画着组件自己的缩略画面；按住一格拖到看板的任意一列，或轻点加在末尾；整理按当前阅读顺序把卡片密排；刷新让宿主重读组件库并重挂卡片。
- **通用数据卡**：数字、列表、表格、图表、进度、键值、时间线与图片内置在组件库里；它们共用 `.t-data` 骨架，内容由 data 填、标题由 props 改，卡片大小由看板给。
- **Markdown 与代码**：Markdown 卡按 GFM 排版，代码块按语言高亮；marked 与 highlight 随插件发布，文档内联，组件不联网。
- **翻面组（原型）**：正反各一张普通卡片，共用一个卡片盒子，鼠标移上去翻面；暂时固定为数字与图表，从组件库加入，按组移除。
- **三种动效模板**：翻转卡、磁吸卡、全息卡在组件库里，加进看板后改 props 里的文案就能用；动效与指针行为在运行时套件里，模板自己不挂事件。
- **组件的三个来源**：随包发布的内置组件、`$DSH_HOME/widget-board/widgets/` 里你自己的组件，以及插件经 `widgetBoard` 服务注册的组件。组件格式相同：一个目录，`widget.json` 加 `index.html`、`style.css`、可选的 `main.js`。
- **状态在宿主上**：卡片的界面状态与数据都存在宿主，切走再切回、页面重载、组件热重载之后都接得上。
- **通知与未读条数**：组件调 `widget.notify(...)` 发一条通知，侧栏的看板入口右上角按 notification badge 的动效滑入未读条数；点一下看板入口，未读清零。
- **跟着宿主的外观走**：卡片的颜色、圆角、时长与曲线来自宿主的令牌，切换浅色深色或换皮肤时当场跟着变，界面语言一起切换。
- **安全隔离**：每个组件运行在独立的沙箱 iframe 里，拿不到宿主的会话、cookie 与网络；组件文档带严格的 CSP，图片与字体以 `data:` 地址内联。

## 安装

还没发布到 npm，从 GitHub 仓库安装：

```sh
dsh plugin add github:Nwflower/dsh-widget-board
```

`lib/` 是构建产物、不随仓库提交，所以这个包在安装时自己构建一次（`prepare` 跑 `node scripts/build.mjs`）。pnpm 默认拦下依赖的构建脚本，第一次装会被它挡下：在插件市场里点「允许构建脚本并重试」，在终端里把 pnpm 打出的那一行 `allowBuilds` 加进 profile 的 `pnpm-workspace.yaml` 再重试。

从本仓库开发时先构建，再按目录安装：

```sh
npm install
npm run build
dsh plugin add <本仓库路径>
```

## 组件库

下方菜单的添加动作打开组件库，按来源分组排成网格，每格是一张实时缩略画面，画的正是同一个组件。按住一格拖到看板上松手，卡片落在那一列；轻点一格加在最矮的一列。从卡片右上角移除一张卡；组件坏掉时只有它自己不可用，卡片上写明原因。

写一个组件：在 `$DSH_HOME/widget-board/widgets/<id>/` 下建一个目录，写 `widget.json`、`index.html`、`style.css`，需要脚本时再加 `main.js`。目录一改，宿主重读组件库，在线页面的卡片按新版本重挂。

卡片盒子由看板给。运行时把内容盒归到两个方向：`data-box-width` 是 `narrow`、`regular`、`wide`，`data-box-height` 是 `short`、`regular`、`tall`，并给出 `--w-w`、`--w-h` 与 `--w-cols`；组件按这些档位收起或展开内容。`widget.json` 的 `minBox` 是卡片的下限，拖动与缩放不会把卡片压到它下面。间距与字号从 `--w-space-*` 与 `--w-type-*` 取；套件提供 `.w-frame`、`.w-actions`、`.w-scroll` 三个布局原语，以及 `.w-hide-short`、`.w-hide-narrow` 两个按档位隐藏的类。组件库的缩略画面带 `data-placement="preview"` 与 `data-size="preview"`，可以在这里换一套静态排版。

组件要提示一件事时调 `widget.notify({ title, body })`：标题省略时用组件的标题，正文可选；标题限 120 个字符，正文限 400 个。通知记在侧栏的看板入口上，悬停能读到最近一条的标题与正文，点一下入口算看过。

### 把动效加到组件里

翻面、磁吸与全息是运行时套件的可选项，卡片外壳不会自动加上。给组件加翻面：最外层加 `.t-flip-card` 与 `data-t-flip`，里面放 `.t-flip-card__inner`，正面与背面各用一个 `.t-flip-card__face`，背面再加 `.t-flip-card__back`。磁吸用 `.t-magnetic` 与 `data-t-magnetic`，全息用 `.t-holo` 与 `data-t-holo`。指针与键盘行为由套件处理，组件只写自己的画面；`flip-card`、`magnetic-card`、`holographic-card` 三个内置组件就是可复制的示例。

## 给插件提供方

宿主半边发布 cordis 服务 `widgetBoard`（`WIDGET_BOARD_API_VERSION = 2`）：

- `registerWidgetType({ apiVersion, provider, directory })`：注册一个组件目录，返回把手（`provider`、`widgets`、`register`、`dispose`）。
- `registerDataSource({ apiVersion, provider, id, read })`：注册一个数据源，可以带 `permission`。
- `registerAction({ apiVersion, provider, id, run })`：注册一个动作，可以带 `permission`。

浏览器半边发布同名服务，`registerWidgetType({ apiVersion, provider, id, component })` 登记一个 React 组件：与组件库里同 id 的组件对上之后，卡片用它渲染，参数与 `window.widget` 同形。版本从 `service.apiVersion` 读，不复制常量。

提供方跨包时按 `import type { WidgetBoardClientService } from 'dsh-widget-board/service'` 取类型，在自己包里 `declare module '@deepseek-ai/cordis'` 把服务挂到 `Context` 上；没有类型检查的纯 JS 提供方仍按同形声明写。运行时只走服务：不要值导入本插件，也不要为绕开这条规则添加 `dsh.client.external`；客户端产物只依赖平台种子。插件停用或卸载时，注册的组件、数据源、动作与它留下的授权一起撤下，已经放着的卡片保留并显示不可用，装回来之后恢复。

## 状态

开发中，尚未发布。面向会话的工具、会话内联显示、右侧栏、组件的分享与导入还在做。

## 许可

MIT
