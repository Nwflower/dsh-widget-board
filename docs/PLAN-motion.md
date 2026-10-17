# 动效组件方案

一次性文档：全部步骤完成后删除本文件（D14）。它覆盖 [docs/PLAN.md](PLAN.md) 步骤 7 之后的一条支线，前置条件是步骤 7 的尺寸矩阵已经可以运行。方向依据不新写 ADR——D7、D10、D13、D16、D20 已经定完，本文件只排次序与完成判据。

## 交接须知

接手前按顺序读：[AGENTS.md](../AGENTS.md)、[ARCHITECTURE.md](../ARCHITECTURE.md)、[D7](adr/D7-widget-format.md)、[D10](adr/D10-tokens-and-motion.md)、[D13](adr/D13-testing.md)、[D16](adr/D16-card-grid.md)、[D20](adr/D20-component-box-contract.md)。

只改 `packages/*/src/` 与 `packages/widgets/`，不碰 `lib/`。命令表在 `AGENTS.md` 的「命令」一节。单文件接近 750 行时停手并提出拆分方案。视觉改动由用户在浅色与深色下核对。

## 背景

`AGENTS.md` 的「参考来源」一节已经把 `https://transitions.dev/studio.html` 记成视觉参考，写明的形态是：组件由 HTML、CSS、JS 三份文件组成，动效原语用类名声明，时长从根节点的 CSS 变量读。D7 把这种形态定成了公开契约，D10 把原语收进运行时套件。

运行时套件已经实现了一部分，剩下的原子级交互还没有。本方案把缺的部分补齐，让会话里的 agent 可以直接把一类动效加到看板上，不必为每个动效各写一套时长与曲线。

## 目标

- 运行时套件补三条动效原语与三条浮层原语，全部由 `data-t-*` 属性或类名声明，组件不写事件代码（D10）。
- 内置组件补八个，格式与用户组件相同，每个尺寸族在 `samples.json` 里有样例（D7、D13）。
- 新增的时长与曲线先进 `packages/contracts/tokens.json`，再生成 `lib/runtime/tokens.css`，不在样式表里写字面值（D10）。

## 非目标

- 不做详情页、复制代码按钮与参数调节面板。看板本身就是展示面，卡片盒子由用户拖动与缩放（D16）。
- 不引入外部动效库，不联网（D2、D3）。
- 不改动 `client` 的卡片外壳动效。外壳只在使用 View Transitions 的展开浮层上承接转场（D16）。

## 已经有的

写新原语前先读这些，避免重复实现。

| 原语 | 选择器 | 令牌 |
|---|---|---|
| 数字滚动 | `.t-digit-group`、`.t-digit`、`data-same` | `--w-motion-digit`、`-stagger`、`-distance`、`-blur`、`-dir-x`、`-dir-y` |
| 翻页钟 | `.t-flip`、`.t-flip-half`、`.t-flip-page`、`data-dir` | `--w-motion-flip` |
| 文字换字 | `.t-text-swap`、`.t-morph-swap`、`.t-morph-old`、`.t-morph-new` | `--w-motion-morph`、`--w-motion-text-shift`、`--w-motion-text-blur` |
| 图标切换 | `.t-icon-swap`、`.t-icon`、`data-active` | `--w-motion-icon-scale`、`--w-motion-icon-blur` |
| 页签 | `.t-tabs`、`.t-tab`、`.t-tabs-pill` | `--w-motion-press`、`--w-motion-press-scale` |
| 三张卡片模板 | `.t-flip-card`、`.t-magnetic`、`.t-holo` | `--w-motion-card-flip`、`--w-motion-magnetic-*`、`--w-motion-holo-*` |
| 数据骨架 | `.t-data` 及其子类 | 布局令牌 |
| 布局 | `.w-frame`、`.w-actions`、`.w-scroll`、`.w-hide-short`、`.w-hide-narrow` | `--w-space-*`、`--w-type-*` |

指针行为统一在 `packages/runtime/src/motion.ts` 挂：`pointermove` 只写 CSS 变量、不改 `transform`，减弱动效时整套复位。新原语沿用这个分工。

三条曲线令牌的现行取值：`--w-motion-ease-smooth: cubic-bezier(0.22, 1, 0.36, 1)`、`--w-motion-ease-pop: cubic-bezier(0.34, 1.45, 0.64, 1)`、`--w-motion-ease-decel: cubic-bezier(0.165, 0.84, 0.44, 1)`。新原语优先复用这三条。

## 缺的

| 参考行为 | 现状 | 归属步骤 |
|---|---|---|
| 成功勾选：淡入、旋转、模糊、纵向气泡、SVG 路径描画 | 无 | 1、3 |
| 头像组：指针所在头像弹起，邻居按距离衰减跟随 | 无 | 1、3 |
| 错误态：输入框抖动，结束后自动回正 | 无 | 1、3 |
| 菜单下拉：从触发元素的角生长 | 无，且现有组件把 `transform-origin` 写死为居中 | 2、3 |
| 模态：缩放进出，遮罩淡入，居中 | 无 | 2、3 |
| 侧板：从侧向揭示 | 无 | 2、3 |
| 页面左进右出：前进与后退的方向感 | 无 | 3 |
| 卡片尺寸变化：内容随盒子重排 | 令牌 `--w-motion-morph-resize` 已有，组件没有 | 3 |

## 步骤

### 1. 三条动效原语

在 `packages/runtime/src/suite/suite.css` 补，令牌先在 `packages/contracts/tokens.json` 加。

- `.t-success-check`，配 `data-t-success`。内联 SVG 的 `path` 用 `stroke-dasharray` 与 `stroke-dashoffset` 描画，固定 `viewBox`，长度写进组件样式表，不在运行时读 `getTotalLength()`；描画完成后勾整体做一次淡入、旋转与纵向位移。
- `.t-avatar-falloff`，配 `data-t-avatar`。指针进入的一组头像里，被指的那张按 `--w-motion-avatar-scale` 放大并上移，邻居按与它的索引距离乘 `--w-motion-avatar-falloff` 衰减同一段位移。
- `.t-shake`，配 `data-t-shake`。抖动三下，`animationend` 之后运行时移除类名，回到静置。

新增令牌：

| 令牌 | 取值 | 理由 |
|---|---|---|
| `--w-motion-success-draw` | 400ms | 路径描画比位移慢，勾成形要看得清 |
| `--w-motion-success-draw-delay` | 80ms | 容器先淡入，描画后开始 |
| `--w-motion-success-pop` | 320ms | 勾成形后的回弹，复用 `--w-motion-ease-pop` |
| `--w-motion-success-bob` | 3px | 纵向气泡距离，与 `--w-motion-float-distance` 同量级 |
| `--w-motion-avatar-falloff` | 0.6 | 相邻头像的位移衰减系数 |
| `--w-motion-avatar-scale` | 1.08 | 被指头像的放大倍数 |
| `--w-motion-avatar-lift` | 6px | 被指头像的上移 |
| `--w-motion-shake-distance` | 6px | 抖动幅度 |
| `--w-motion-shake` | 400ms | 三下抖动的总时长 |

完成判据：
- [ ] 三条原语在 `samples.json` 覆盖的每个尺寸族下静置正确，没有残留位移与透明度。
- [ ] `prefers-reduced-motion: reduce` 下三条原语都给出静止状态：成功勾只保留描画完成后的画面，头像组不弹起，抖动不播放。
- [ ] 位移、模糊、时长全部从 `--w-motion-*` 读，样式表里没有字面时长。
- [ ] 三条原语不读 `getBoundingClientRect()`，指针位置由 `motion.ts` 写变量。

### 2. 三条浮层原语

- `.t-popover`，配 `data-t-origin`。运行时把 `transform-origin` 写成触发元素朝向弹层那一侧的角，取值来自 `--w-motion-popover-origin-radius`；`motion.ts` 负责在挂载时按 `data-t-origin` 指向的元素测算。
- `.t-modal`，配 `data-t-modal`。缩放起点 `--w-motion-modal-scale-from` 与遮罩淡入 `--w-motion-modal-backdrop`，居中，不参与 origin 生长。
- `.t-panel`，配 `data-t-panel`。从 `data-t-panel="left|right|bottom"` 指定的边揭示，位移取内容盒的百分比。

新增令牌：

| 令牌 | 取值 | 理由 |
|---|---|---|
| `--w-motion-popover-origin-radius` | 8px | 弹层的圆角，决定 `transform-origin` 落在哪个角 |
| `--w-motion-modal-scale-from` | 0.95 | 与 D10 对 scale 起点的要求一致，不从 0 开始 |
| `--w-motion-modal-backdrop` | 200ms | 遮罩比内容快一档，避免同时到达 |
| `--w-motion-panel` | 240ms | 与 `--w-motion-morph-resize` 同档，侧板与卡片尺寸变化手感统一 |

完成判据：
- [ ] 弹层从触发元素的角生长，模态居中，侧板从指定边进入；三者在 `narrow` 宽度下都不溢出。
- [ ] 键盘焦点顺序在打开后落在内容上，按 Escape 关闭，焦点回到触发元素。
- [ ] 减弱动效下三者都不播放位移与缩放，只切换可见性。

### 3. 八个内置组件

每个一个目录 `packages/widgets/<id>/`：`widget.json`、`index.html`、`style.css`、`samples.json`，需要脚本时加 `main.js`。

| 组件 id | 用到的原语 | 尺寸族 | 要点 |
|---|---|---|---|
| `success-check` | 1 | `s`、`l` | props 给标题与一句说明；重播用 `main.js` 调一次 |
| `avatar-group` | 1 | `s`、`l` | props 给头像数量与字号；没有图片时用首字母 |
| `form-error` | 1 | `s`、`l` | 触发抖动与错误文案，输入框由组件自己画 |
| `menu-dropdown` | 2 | `s`、`l` | 触发元素在卡片内，`data-t-origin` 指向它 |
| `modal-dialog` | 2 | `l` | 只在 `l` 提供，`s` 下折叠成行内提示 |
| `side-panel` | 2 | `l` | `s` 下不提供该尺寸族 |
| `page-transition` | — | `l` | 卡内两块画面按前进与后退换位，方向由 props 指定 |
| `card-resize` | — | `s`、`l` | 两档内容宽度之间切换，复用 `--w-motion-morph-resize` |

完成判据：
- [ ] 每个组件的每个尺寸族在 `samples.json` 里有样例，`npm run matrix` 全部通过。
- [ ] `narrow` 宽度下没有横向溢出，可见的交互控件没有被裁掉。
- [ ] 组件不写 `transition` 的字面时长；需要新档位时先在第 1、2 步的令牌里挑。
- [ ] 组件不挂指针事件，需要指针反馈时用 `data-t-*` 交给运行时。

### 4. 回归

- `npm run verify` 全绿；`npm run matrix` 全绿。
- 减弱动效下渲染一次，确认八个组件都静置。
- 浅色与深色下由用户核对一次。

### 5. 文档

- 行为变化在 `docs/changes/` 每条一个 JSON：`group` 取现有的组，`order` 顺延，`at` 写当天，`external` 写 `false`，`zh` 与 `en` 各一行。跑 `npm run changelog`。
- 双语 README 的「组件库」一节加一行「动效组件」，列出八个 id。
- 新增令牌若是新的一档，在 D10 的「一种效果只有一档」约束下逐条说明为什么现有档位不够。
- 不改 ADR。若第 2 步证明 `transform-origin` 需要在 `client` 的卡片外壳里也生效，那时才写一条取代 D10 的 ADR。

## 未决

- **`page-transition` 与 D16 的冲突**：D16 规定 iframe 不换父节点，页面之间的整体转场做不到。方案里退成卡内两块画面换位。若用户要的是真正的整页转场，需要先改 D16。
- **成功勾的路径长度**：固定 `viewBox` 让长度可以手算写进样式表，代价是组件不能换成任意形状的勾。若要任意路径，需要在运行时用 `getTotalLength()` 测量并写 `--t-success-length`。
- **头像组的邻居距离**：按索引距离衰减在头像数量多时会失真，按实际像素距离衰减需要读几何信息，与「指针只写变量」的分工冲突。先在索引距离上做，数量超过八个时再看。
- **`side-panel` 在 `s` 下的形态**：写成模态，或直接不提供 `s`。方案取后者，理由是小卡里没有可以揭示的空间。
