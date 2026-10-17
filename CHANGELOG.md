# 变更记录

本文件由 `npm run changelog` 从 `docs/changes/` 里待发布的条目生成，勿手改。一次改动在
`docs/changes/` 下加一个 JSON 文件，发布时由 `npm run changelog -- --release <版本>` 收进它自己
的版本段。

## [Unreleased]

[中文](#cn-unreleased) | [English](#en-unreleased)

<h3 id="cn-unreleased">新增功能</h3>

- 侧栏多一个「看板」入口，中栏打开一页空看板。
- 第一张卡片：天气卡。天空、图标、温度与天气文字随预报日一起过渡，尺寸族在窄窗口里降级，系统要求减弱动效时天空静置。
- 组件热重载：宿主监视 `lib/`，组件或运行时一改就重读，在线页面按新哈希把卡片重挂，不用刷新。
- 番茄钟卡片：选一段专注时长开始倒计时，剩余分钟、进度刻度与按钮文字跟着走。

### 体验优化

- 看板改成信息流布局：列数跟着容器宽度在一到四列之间连续变化，卡片高度由组件自己上报，位置按最矮列装箱。
- 新增的内置组件自动出现在已有的看板上：加入卡片的面板做出来之前，这是看到新组件的唯一路径。
- 卡片内部的控件不再跟随宿主的强调色：切换栏药丸、选中文字、主按钮与焦点框改用卡片画面自己的墨色。

### 问题修复

- 看板快照读不出来：插件路由改到 `/api/widget-board`，浏览器半边改用文档相对地址。桌面外壳的页面来源是自定义协议，只有 `/api/*` 会被转给宿主。
- 深色下卡片四角露出白色：iframe 的文档画布在圆角之外是白的，父页面现在按同一份圆角令牌裁剪卡片。
- 热重载之后页面里指向旧哈希的帧不再变成 404：宿主留着一个组件出现过的若干版本，按哈希取文档。

<h3 id="en-unreleased">New Features</h3>

- A Board entry in the sidebar, opening an empty board page in the centre column.
- The first card: weather. Sky, icon, temperature and condition transition together as the forecast day changes; the size family degrades in a narrow window, and the sky stands still when the system asks for reduced motion.
- Widget hot reload: the host watches `lib/`, re-reads the library when a widget or the runtime changes, and open pages remount their cards on the new hash without a refresh.
- Pomodoro card: pick a focus length and start; the remaining minutes, the progress ticks and the button label follow the session.

### Improvements

- The board is an information flow now: one to four columns follow the container width, each card's height comes from the widget itself, and cards pack into the shortest column.
- New built-in widgets appear on an existing board by themselves until the add-card panel exists.
- Controls inside a card no longer take the host's accent colour: the switcher pill, the selected label, the primary button and the focus rings use the card's own ink.

### Bug Fixes

- The board snapshot failed to load: the plugin's routes moved under `/api/widget-board` and the browser half now uses document-relative addresses. The desktop shell serves the page from a custom protocol and only forwards `/api/*` to the host.
- Card corners showed white in dark mode: the iframe document canvas is white outside the rounded card, so the page now clips each card to the shared corner-radius token.
- A frame still pointing at the previous hash no longer 404s after a reload: the host keeps the versions a widget has appeared as and serves documents by hash.

