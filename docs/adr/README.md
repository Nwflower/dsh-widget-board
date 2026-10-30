# 架构决策

本文件由 `npm run docs:index` 从各决策文件生成，勿手改。

每条决策记一个方向，正文只有背景、决定、后果与重审条件。编号是稳定标识，代码注释按编号引用；被取代的编号作废、不复用（D14）。

| 编号 | 决策 | 取代 |
|---|---|---|
| [D1](D1-host-surfaces.md) | 只走宿主扩展点 | — |
| [D2](D2-packages-and-build.md) | 按依赖分包，TypeScript 与 esbuild | — |
| [D3](D3-isolation-and-trust.md) | 组件隔离与信任分级 | — |
| [D5](D5-host-authority.md) | 宿主权威、存储与修订号 | — |
| [D6](D6-data-sources-and-actions.md) | 数据源、动作与授权 | — |
| [D7](D7-widget-format.md) | 组件格式与内容寻址版本 | — |
| [D8](D8-library-and-sharing.md) | 分享、导入与组件库 | — |
| [D9](D9-session-tools.md) | 面向会话的工具与自检 | — |
| [D10](D10-tokens-and-motion.md) | 令牌与动效 | — |
| [D11](D11-fail-fast.md) | 快速失败与可见故障 | — |
| [D13](D13-testing.md) | 测试分层与共用检查器 | — |
| [D14](D14-documentation.md) | 文档分层 | — |
| [D16](D16-card-grid.md) | 卡片盒子的自由布局 | D15、D4 |
| [D17](D17-library-sources.md) | 组件库的来源、提供方注册与数据源 | — |
| [D18](D18-board-events.md) | 变更通知按事件推送 | — |
| [D19](D19-card-groups.md) | 组卡：两张普通卡片共享一个盒子 | — |
| [D20](D20-component-box-contract.md) | 组件的盒子契约 | — |
| [D21](D21-multiple-boards.md) | 多块看板 | — |
| [D23](D23-write-budget.md) | 状态写入的预算与合并 | — |
| [D24](D24-host-capabilities.md) | 宿主能力：一条通用调用与能力注册表 | — |
| [D25](D25-demo-host.md) | 演示页与只读的浏览器端宿主 | — |
| [D26](D26-widget-open-links.md) | 组件请宿主打开链接 | — |
| [D27](D27-card-editor.md) | 卡片设置弹窗：配置、日志与关于 | D22 |
| [D28](D28-widget-requests.md) | 组件对外的请求由宿主代发 | — |
| [D29](D29-browser-capabilities.md) | 落在浏览器里的能力与整页转场 | — |
| [D30](D30-market.md) | 组件市场：索引、分发、信任与接入点 | — |
| [D31](D31-provider-contract-v3.md) | 提供方契约：两侧把手、作者域与执行上限 | D12 |
| [D32](D32-capability-metadata-and-data-push.md) | 能力元数据、按需读与数据推送 | — |

## 作废的编号

D4（由 D16 取代）、D12（由 D31 取代）、D15（由 D16 取代）、D22（由 D27 取代）。
