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
- 卡片的握手不再随每次快照刷新重建：props、data、state 的更新走各自的消息。切回看板时先用上一份快照画出内容，再取最新的。
- 卡片的界面状态存在宿主上：番茄钟切走再切回、页面重载之后接着计时，天气卡记得选中的是哪一个预报日。组件的 `setState` 现在有地方落，重挂之后经 `init` 拿回来。
- 番茄钟显示到秒：剩余时间按 `mm:ss` 走，换数字时把数字分成上下两半翻页——变大翻页上去，变小翻页下来。翻页做成了套件的原语（`.t-flip`），转动的半页画组件自己的底色，翻转过程中看不出多出一块。

### 问题修复

- 看板快照读不出来：插件路由改到 `/api/widget-board`，浏览器半边改用文档相对地址。桌面外壳的页面来源是自定义协议，只有 `/api/*` 会被转给宿主。
- 深色下卡片四角露出白色：iframe 的文档画布在卡片圆角之外是白的，而 `border-radius` 裁不动 iframe 的内容。外壳改用 `clip-path` 按圆角令牌裁剪，卡片的边框与投影也由外壳画，组件只管自己的画面。
- 热重载之后页面里指向旧哈希的帧不再变成 404：宿主留着一个组件出现过的若干版本，按哈希取文档。
- 偶发加载不出内容：构建重写 `lib/` 的瞬间，宿主可能读到空的运行时并把没有运行时的文档发给卡片。构建改成先写临时文件再改名，宿主拒收空资产并沿用上一份；卡片六秒收不到任何消息就在卡片上说明没接上。

<h3 id="en-unreleased">New Features</h3>

- A Board entry in the sidebar, opening an empty board page in the centre column.
- The first card: weather. Sky, icon, temperature and condition transition together as the forecast day changes; the size family degrades in a narrow window, and the sky stands still when the system asks for reduced motion.
- Widget hot reload: the host watches `lib/`, re-reads the library when a widget or the runtime changes, and open pages remount their cards on the new hash without a refresh.
- Pomodoro card: pick a focus length and start; the remaining minutes, the progress ticks and the button label follow the session.

### Improvements

- The board is an information flow now: one to four columns follow the container width, each card's height comes from the widget itself, and cards pack into the shortest column.
- New built-in widgets appear on an existing board by themselves until the add-card panel exists.
- Controls inside a card no longer take the host's accent colour: the switcher pill, the selected label, the primary button and the focus rings use the card's own ink.
- A card's handshake is no longer rebuilt on every snapshot refresh — prop, data and state updates travel on their own messages. Returning to the board draws the last snapshot first, then refreshes it.
- A card's interface state lives on the host now: the pomodoro keeps counting across a panel switch or a page reload, and the weather card remembers which forecast day was open. Widget `setState` has somewhere to land and comes back through `init` after a remount.
- The pomodoro shows seconds now: the remaining time counts down as mm:ss and each digit turns over in halves — up when it grows, down when it shrinks. The flip is a suite primitive (`.t-flip`) whose page paints the widget's own background, so a turning half does not show a slab.

### Bug Fixes

- The board snapshot failed to load: the plugin's routes moved under `/api/widget-board` and the browser half now uses document-relative addresses. The desktop shell serves the page from a custom protocol and only forwards `/api/*` to the host.
- Card corners showed white in dark mode: the iframe document canvas is white outside the card's rounded corner, and border-radius does not clip iframe content. The page clips each card with clip-path to the shared corner-radius token, and draws the card border and shadow itself.
- A frame still pointing at the previous hash no longer 404s after a reload: the host keeps the versions a widget has appeared as and serves documents by hash.
- Intermittent empty cards: while a build rewrote `lib/` the host could read an empty runtime and serve documents without it. The build now writes each artifact to a temporary file and renames it, the host refuses empty assets and keeps the previous ones, and a card that hears nothing for six seconds says so on the card.

