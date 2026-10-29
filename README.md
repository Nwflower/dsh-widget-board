# dsh-widget-board

[English](README.en.md)

DeepSeek Harness 的组件看板：一页可以拖动、缩放的卡片，每张卡片是一个小组件。组件由你或会话里的 agent 写成三份文件，也可以由其他插件提供。

**[在线演示](https://nwflower.github.io/dsh-widget-board/)** · [安装](#安装) · [写一个组件](#写一个组件) · [给插件提供方](#给插件提供方)

<p align="center">
  <img src="docs/images/board-light.png" alt="浅色下的组件看板" width="49%">
  <img src="docs/images/board-dark.png" alt="深色下的组件看板" width="49%">
</p>

<hr>

## 三份文件

`widget.json` 写名字与尺寸，加 `index.html`、`style.css`，需要脚本时加 `main.js`。内置组件、你自己写的、agent 生成的，都是这一种格式。写完文件，卡片出现在组件库里。

<hr>

## 一个沙箱

每次运行都在自己的沙箱 iframe 里：严格 CSP，没有网络与 cookie，与宿主只经 MessagePort 桥通信。授权绑在组件内容的哈希上，改一个字节就要重新点一次允许。

<hr>

## 几个入口

| 侧栏的「看板」 | 切换看板标签，拖动与整理卡片；第一次打开时已铺好默认看板 |
| 标签上的更多按钮 | 给这块看板改名或删掉它；右键标签是同一张菜单，不切换当前看板 |
|---|---|
| 加号菜单 | 添加、整理、刷新；添加打开从底部上拉的组件库面板 |
| 卡片齿轮 | 改组件的 props，填凭据，查看并授权数据源与权限 |
| 会话工具 | agent 列出组件、写组件、放卡、推数据；`widget_show` 在回答里当场画一张。默认只露出 `widget_catalog`，其余工具经它的 `expose` 点名后出现 |
| `widgetBoard` 服务 | 其他插件注册组件、数据源、动作、宿主能力与市场 |

<hr>

## 安装

```sh
dsh plugin add dsh-widget-board
```

pnpm 拦下依赖的构建脚本时，按它提示的 `allowBuilds` 允许后重试。仓库里不带 `lib/`，从 GitHub 安装时需要包在安装时自己构建一次：`dsh plugin add github:Nwflower/dsh-widget-board`。

从本仓库开发：

```sh
npm install
npm run build
dsh plugin add <本仓库路径>
```

<hr>

## 写一个组件

在 `$DSH_HOME/widget-board/widgets/<id>/` 下建一个目录：

```text
widget.json     名字、尺寸、props、数据源、凭据
index.html      画面
style.css       样式，只用运行时套件的令牌
main.js         可选
samples.json    可选，每个尺寸族的样例
scripts         可选，按顺序排在 main.js 之前的额外脚本
vendor/         可选，随组件发布的第三方库（各自的许可照原样保留）
```

保存后宿主重读组件库，在线页面上的卡片换成新版本。

<hr>

### 盒子

看板给卡片定尺寸。运行时把内容盒归成两档：`data-box-width` 是 `narrow`、`regular`、`wide`，`data-box-height` 是 `short`、`regular`、`tall`，并给出 `--w-w`、`--w-h`、`--w-cols`。`defaultBox` 是加卡片时的默认盒子，`minBox` 是下限。

### 外观

间距与字号取 `--w-space-*`、`--w-type-*`；状态色取 `--w-tone-ok`、`--w-tone-warn`、`--w-tone-danger`、`--w-tone-idle`，配一行 `.w-sr` 读屏文字。布局原语是 `.w-frame`、`.w-actions`、`.w-scroll`，按档位隐藏用 `.w-hide-short`、`.w-hide-narrow`。

### 动效

翻面、磁吸、全息由运行时套件处理指针与键盘，组件只写画面。最外层加 `.t-flip-card` 与 `data-t-flip`，里面放 `.t-flip-card__inner`，两面各一个 `.t-flip-card__face`，背面再加 `.t-flip-card__back`；磁吸用 `.t-magnetic` 与 `data-t-magnetic`，全息用 `.t-holo` 与 `data-t-holo`。`flip-card`、`magnetic-card`、`holographic-card` 三个内置组件是可复制的示例。

### 数据与调用

`source` 写 `提供方:名字` 时点名插件注册的数据源。`credentials` 让设置弹窗出现密钥输入框，值由宿主的凭据服务保存，组件读不到。在 manifest 里声明能力后经 `widget.call(id, args)` 调用，参数与结果按 JSON Schema 校验。内置组件「今日宜休」就是这么拿到的账号：「凭据」里填一个 `GITHUB_TOKEN`，卡上列出自己维护的仓库里还开着的 issue，用户名不用另填；点一行就在新标签页里打开那一条。

内置的「最近 Token 用量」卡绑定插件注册的 `widget-board:session.usage` 数据源，按 10 秒的间隔重读；看板上没有人看着这张卡时不读，卡片自己也不计时。「今天」与「全部」把 dsh-usage 记下的历史用量与本插件启动之后的事件合在一起，标题旁标出「历史 dsh-usage」；dsh-usage 没装或读不出来时保留实时读数与空态，标成「历史未接入」或「历史不可用」，不拿零值冒充历史。「所选会话」不合并历史，标成「仅实时」。历史只给今天与全部的合计和四项分项，最近一次调用与走势始终来自实时事件：这段时间只有历史用量时，卡片照旧显示总量与分项，不显示最近一次调用。

组件自己不能导航，也不弹窗。要把链接开出去，用 `widget.open(url)` 交给包着它的页面，写在点击处理里；地址限 `http` 与 `https`。

<hr>

## 给插件提供方

宿主半边与浏览器半边各发布一个 cordis 服务 `widgetBoard`。两侧都报版本与功能清单：`service.apiVersion` 是主版本，`service.supportedApiVersions` 是旧入口接受的版本（2 与 3），`service.features` 与 `service.supports(name)` 说明这一侧现在有没有某一项。

新写的提供方走 `registerProvider({ apiVersion: 3, provider, features })`，拿回一个把手，组件目录、数据源、动作、能力与市场都经它挂上：

| 宿主侧把手 | 做什么 |
|---|---|
| `registerWidgets({ directory })` | 挂一个组件目录，读一次 |
| `registerDataSource()` | 挂数据源，卡片绑定后取数据 |
| `registerAction()` | 挂动作 |
| `registerCapability()` | 挂宿主能力，组件经 `widget.call` 调用 |
| `registerMarketProvider()` | 挂一个市场，交出条目与取包函数 |
| `dispose()` | 把这个提供方留下的全部注册一次撤下 |

浏览器侧的把手上是 `registerNativeWidget({ id, component })`，登记一个与组件库同 id 的 React 组件，对上之后由它渲染。子注册不写版本与提供方名，由把手注入。

既有提供方继续用 `registerWidgetType`、`registerDataSource`、`registerAction`、`registerCapability`、`registerMarketProvider`，注册时带版本 2 或 3 都行。同一侧同一个提供方包名只有一个活动把手，新旧入口不能混用；`dispose` 之后可以重新注册。

`features` 是用途声明，不改变这一侧提供什么：`capabilityMetadata`、`eventData`、`marketProvider`、`pushData` 四项按侧给出，缺的项按项降级。

新把手挂的组件目录、市场组件与原生组件的 id 必须写成 `<作者域>.<名字>`；本地组件与旧入口继续用扁平 id，已经装好的组件不改名。

一次读取、一次动作与一次能力调用最多等 15 秒（能力可以声明 1 到 25 秒），每个提供方同时 8 个调用，占满时立即返回错误而不排队。宿主按提供方记录注册数、失败、超时与现在是否可用，设置页的看板那一节列出这张表；卡片照自己的故障显示原因。

提供方跨包时取类型：

```ts
import type { WidgetBoardClientService } from 'dsh-widget-board/service'
```

`dsh-widget-board/provider` 是纯值 SDK，构造并校验注册要用的入参对象。运行时不值导入本插件、不加 `dsh.client.external`。插件停用或卸载时，它注册的组件、数据源、动作、能力、市场与授权一起撤下，已放着的卡片保留并显示不可用；装回来就恢复。

完整规则见 [docs/provider.md](docs/provider.md)。

<hr>

## 状态

开发中，0.1.5 已发布到 npm。右侧栏、组件库页面、组件的版本历史与分享、导入还在做。

## 许可

MIT
