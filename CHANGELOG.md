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

### 问题修复

- 看板快照读不出来：插件路由改到 `/api/widget-board`，浏览器半边改用文档相对地址。桌面外壳的页面来源是自定义协议，只有 `/api/*` 会被转给宿主。

<h3 id="en-unreleased">New Features</h3>

- A Board entry in the sidebar, opening an empty board page in the centre column.
- The first card: weather. Sky, icon, temperature and condition transition together as the forecast day changes; the size family degrades in a narrow window, and the sky stands still when the system asks for reduced motion.
- Widget hot reload: the host watches `lib/`, re-reads the library when a widget or the runtime changes, and open pages remount their cards on the new hash without a refresh.

### Bug Fixes

- The board snapshot failed to load: the plugin's routes moved under `/api/widget-board` and the browser half now uses document-relative addresses. The desktop shell serves the page from a custom protocol and only forwards `/api/*` to the host.

