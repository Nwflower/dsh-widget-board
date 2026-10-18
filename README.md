# dsh-widget-board

[English](README.en.md)

DeepSeek Harness 的组件看板插件：侧栏一个「看板」入口，中栏是几块可以拖动、缩放的卡片看板，每张卡片是一个小组件。组件由你或会话里的 agent 写成三份文件，也可以由其他插件提供。

**[在线演示](https://nwflower.github.io/dsh-widget-board/)** · [安装](#安装) · [上手](#上手) · [写一个组件](#组件库) · [给插件提供方](#给插件提供方)

<p align="center">
  <img src="docs/images/board-light.png" alt="浅色下的组件看板" width="49%">
  <img src="docs/images/board-dark.png" alt="深色下的组件看板" width="49%">
</p>

## 三个特点

1. **一个组件三份文件。** `widget.json` 写名字与尺寸，再加 `index.html`、`style.css`，需要脚本时加 `main.js`。内置组件、你自己写的组件和 agent 生成的组件是同一种格式，agent 写完文件，卡片就出现在组件库里。
2. **沙箱，权限绑在内容上。** 每个组件运行在独立的沙箱 iframe 里，文档带严格的 CSP，不能联网，只经 MessagePort 桥和宿主说话。授权绑定组件内容的哈希，组件改一个字节，之前的授权随之失效，要人重新点一次允许。
3. **其他插件也能提供组件。** 别的插件经 `widgetBoard` 服务注册组件目录、数据源、动作与宿主能力，注册时带 `apiVersion` 做版本协商。提供方被拔掉时，它的卡片留在原位，显示占位说明。

## 在线演示

[演示页](https://nwflower.github.io/dsh-widget-board/)第一屏是插件真实的浏览器半边，卡片都运行在沙箱 iframe 里。可以试这几样：

- 拖卡片顶部的把手移动，拖右下角的手柄改变大小。
- 鼠标移到翻面卡上翻转它。
- 用右上角的按钮切换浅色与深色，用语言开关切换中文与英文。
- 刷新页面，布局还在：它保存在你的浏览器里。

演示页的宿主是只读的，没有数据源和宿主能力，所以天气与 DSH 余额这两张卡没有放进去，装上插件后它们在组件库里。往下滚动还有一段录屏、三个特点的图解与安装命令。

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

## 上手

1. 安装后打开侧栏的「看板」，第一次打开是一块已经铺好卡片的默认看板。
2. 点看板下方居中的加号，选「添加」打开组件库：按住一格拖到看板的任意一列，或轻点加在最矮的一列。
3. 点卡片右上角的齿轮：改组件的 props，填凭据，查看并授权数据源与权限。
4. 在 `$DSH_HOME/widget-board/widgets/<id>/` 下写自己的组件，保存之后在线页面的卡片自动换成新版本。写法见[组件库](#组件库)。

## 功能

### 看板

- **多块看板**：顶部一条标签在几块看板之间切换，活动标签的药丸滑过去；标签条上只有一个新建入口，改名、移除与选中在设置页的「看板」一节。所有看板的卡片同时挂载，切换标签不重挂任何组件，看不见的那些照旧暂停；每块看板有自己的卡片、盒子与修订号，旧版本的单一看板在第一次打开时自动搬成第一块。
- **自由排版**：看板按自身宽度在 1 到 4 列之间切换，卡片有自己的一列宽与高度；高度按 6/10/14/18/22/26/30rem 七档跳，纵向位置按 2rem 一档吸附，拖动与缩放时实时显示尺寸，换窗口宽度、收侧栏都不必重排。
- **题头也是卡片**：一块活的看板的标题、说明与字模图案内置成 `board-hero` 组件卡，可以拖动、缩放、移除；旧看板升级时补一次这张卡，添加按钮只在下方菜单。
- **下方菜单**：看板这一栏下方居中的加号按下后化开成扇面的三个图标，分别是添加、整理与刷新。添加打开悬浮的组件库；整理按当前阅读顺序把卡片密排；刷新让宿主重读组件库并重挂卡片。
- **Windows 桌面端**：窗口让出标题栏、标签条放得下时，它靠左挂进标题栏，比页内小一号、上下留出空隙，看板内容从标题栏下方开始；放不下或不在桌面端时留在页面顶部。
- **状态在宿主上**：卡片的界面状态与数据都存在宿主，切走再切回、页面重载、组件热重载之后都接得上。
- **通知与未读条数**：组件调 `widget.notify(...)` 发一条通知，侧栏的看板入口右上角滑入未读条数；点一下看板入口，未读清零。

### 内置组件

- **通用数据卡**：数字、列表、表格、图表、进度、键值、时间线与图片内置在组件库里；它们共用 `.t-data` 骨架，内容由 data 填、标题由 props 改，卡片大小由看板给。
- **时间与密度**：翻页时钟、表盘与热力图；时钟把时与分逐格翻页、秒在旁边滚动，表盘用环形比例表示配额与目标，热力图按日铺格子并给出总数、有记录的天数与连续天数。
- **日历与改动**：月历把一个月的日期铺成七列，有安排的日期带点，可以翻到前后月份或回到今天；改动卡把统一的 diff 按行铺开，新增行与删除行标出加减号，文件路径自成一行。
- **Markdown 与代码**：Markdown 卡按 GFM 排版，代码块按语言高亮；marked 与 highlight 随插件发布，文档内联，组件不联网。
- **翻面组**：正反各一张普通卡片，共用一个卡片盒子，鼠标移上去翻面；从组件库加入后直接打开槽条，两面各放哪个组件由你挑。换组件会重置那个槽的 props、数据与状态，另一个槽不动；组卡的最小盒子取两面当前组件的最大值。
- **三种动效模板**：翻转卡、磁吸卡、全息卡，加进看板后改 props 里的文案就能用；动效与指针行为在运行时套件里，模板自己不挂事件。

### 设置、数据与能力

- **卡片设置**：卡片右上角、移除按钮旁边的齿轮打开一块设置弹窗，分「组件设置 / 凭据 / 数据与权限 / 关于」四节。props 由组件自己的 schema 生成表单，保存时宿主按同一个 schema 校验；凭据写进宿主的凭据服务，不进看板文件、导出包与工具结果；数据源、权限与「允许 / 撤销」也在这里。
- **宿主能力**：组件在 manifest 里声明能力，经 `widget.call` 调用；能力由插件注册，输入输出按 JSON Schema 校验，要权限的能力先由人授权。内置的 DSH 余额卡就声明 `dsh.account.balance`，读当前登录的 DSH 账号的充值钱包与赠送钱包，不需要 API key。
- **组件的三个来源**：随包发布的内置组件、`$DSH_HOME/widget-board/widgets/` 里你自己的组件，以及插件经 `widgetBoard` 服务注册的组件。组件格式相同：一个目录，`widget.json` 加 `index.html`、`style.css`、可选的 `main.js`。

### 外观与安全

- **跟着宿主的外观走**：卡片的颜色、圆角、时长与曲线来自宿主的令牌，切换浅色深色或换皮肤时当场跟着变，界面语言一起切换。
- **安全隔离**：每个组件运行在独立的沙箱 iframe 里，拿不到宿主的会话、cookie 与网络；组件文档带严格的 CSP，图片与字体以 `data:` 地址内联。

## 组件库

下方菜单的添加动作打开组件库，按来源分组排成网格，每格是一张实时缩略画面，画的正是同一个组件。按住一格拖到看板上松手，卡片落在那一列；轻点一格加在最矮的一列。从卡片右上角移除一张卡；组件坏掉时只有它自己不可用，卡片上写明原因。

写一个组件：在 `$DSH_HOME/widget-board/widgets/<id>/` 下建一个目录，写 `widget.json`、`index.html`、`style.css`，需要脚本时再加 `main.js`。目录一改，宿主重读组件库，在线页面的卡片按新版本重挂。

`widget.json` 还可以声明 `credentials`：设置弹窗据此显示密钥输入框，值由宿主的凭据服务保存，组件读不到，也不会写进看板文件。`source` 写 `提供方:名字` 时点名插件注册的数据源；props 表单的字段标签与提示写进 `text` 的 `props.<字段>.label` 与 `props.<字段>.hint`。

卡片盒子由看板给。运行时把内容盒归到两个方向：`data-box-width` 是 `narrow`、`regular`、`wide`，`data-box-height` 是 `short`、`regular`、`tall`，并给出 `--w-w`、`--w-h` 与 `--w-cols`；组件按这些档位收起或展开内容。`widget.json` 的 `defaultBox` 是加卡片时的默认盒子，`minBox` 是卡片的下限，拖动与缩放不会把卡片压到它下面。间距与字号从 `--w-space-*` 与 `--w-type-*` 取；状态色读 `--w-tone-ok`、`--w-tone-warn`、`--w-tone-danger`、`--w-tone-idle`，再配一行 `.w-sr` 的读屏文字，状态不只靠颜色。套件提供 `.w-frame`、`.w-actions`、`.w-scroll` 三个布局原语，以及 `.w-hide-short`、`.w-hide-narrow` 两个按档位隐藏的类。组件库的缩略画面带 `data-placement="preview"` 与 `data-size="preview"`，可以在这里换一套静态排版。

组件要提示一件事时调 `widget.notify({ title, body })`：标题省略时用组件的标题，正文可选；标题限 120 个字符，正文限 400 个。通知记在侧栏的看板入口上，悬停能读到最近一条的标题与正文，点一下入口算看过。

### 把动效加到组件里

翻面、磁吸与全息是运行时套件的可选项，卡片外壳不会自动加上。给组件加翻面：最外层加 `.t-flip-card` 与 `data-t-flip`，里面放 `.t-flip-card__inner`，正面与背面各用一个 `.t-flip-card__face`，背面再加 `.t-flip-card__back`。磁吸用 `.t-magnetic` 与 `data-t-magnetic`，全息用 `.t-holo` 与 `data-t-holo`。指针与键盘行为由套件处理，组件只写自己的画面；`flip-card`、`magnetic-card`、`holographic-card` 三个内置组件就是可复制的示例。

## 给插件提供方

宿主半边发布 cordis 服务 `widgetBoard`（`WIDGET_BOARD_API_VERSION = 3`）：

- `registerWidgetType({ apiVersion, provider, directory })`：注册一个组件目录，返回一个把手：`provider`、`widgets`、`register({ dataSources, actions, capabilities })` 与 `dispose()`。数据源、动作与能力挂在这个提供方的注册名下，撤下时一并释放。
- `registerDataSource({ apiVersion, provider, id, read, permission? })`：注册一个数据源，卡片可以绑定它取数据；声明了 `permission` 的源要有人给出授权才读得到。
- `registerAction({ apiVersion, provider, id, run, permission? })`：注册一个动作，同样可以声明权限。
- `registerCapability({ apiVersion, provider, id, input?, output?, permission?, credentials?, call })`：注册一个宿主能力，组件在 manifest 里声明后经 `widget.call(id, args)` 调用；参数与结果按 schema 校验，`call` 收到一个中止信号。声明了 `permission` 的能力要有人给出授权。

浏览器半边发布同名服务，`registerWidgetType({ apiVersion, provider, id, component })` 登记一个 React 组件：与组件库里同 id 的组件对上之后，卡片用它渲染，参数与 `window.widget` 同形。版本从 `service.apiVersion` 读，不复制常量。

提供方跨包时按 `import type { WidgetBoardClientService } from 'dsh-widget-board/service'` 取类型，在自己包里 `declare module '@deepseek-ai/cordis'` 把服务挂到 `Context` 上；没有类型检查的纯 JS 提供方仍按同形声明写。运行时只走服务：不要值导入本插件，也不要为绕开这条规则添加 `dsh.client.external`；客户端产物只依赖平台种子。插件停用或卸载时，注册的组件、数据源、动作、能力与它留下的授权一起撤下，已经放着的卡片保留并显示不可用，装回来之后恢复。

## 构建演示页

`npm run demo` 构建[在线演示](#在线演示)的那个页面：一个可以直接放上静态托管（例如 GitHub Pages）的目录，默认写到 `.debug/demo/`，用 `--out <目录>` 或环境变量 `DEMO_OUT` 换位置。页面里的看板由一个只读的、运行在浏览器里的宿主驱动：快照来自构建时生成的默认看板，布局与卡片状态存在浏览器的 IndexedDB。录屏放进输出目录的 `media/`，在 `index.html` 的 `demo-recording` 里写它的相对路径，或构建时加 `--recording <文件>`。`npm run demo:check` 在子路径下的静态服务器上把整页走一遍。演示页不进发布包。

## 状态

开发中，尚未发布。面向会话的工具、会话内联显示、右侧栏、组件的分享与导入还在做。

## 许可

MIT
