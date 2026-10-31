# 变更记录

本文件由 `npm run changelog` 从 `docs/changes/` 里待发布的条目生成，勿手改。一次改动在
`docs/changes/` 下加一个 JSON 文件，发布时由 `npm run changelog -- --release <版本>` 收进它自己
的版本段。

## [Unreleased]

[中文](#cn-unreleased) | [English](#en-unreleased)

<h3 id="cn-unreleased">新增功能</h3>

- 组件库浮窗按角色分成三个区：示例、内置与市场。新增两个组件来源：`example`（包内 `packages/widgets-examples/`，给 agent 的写法样例）与 `market`（市场插件装进来的组件，落在 `$DSH_HOME/widget-board/market-widgets/`）。加载顺序是内置 → 我的 → 市场 → 插件 → 示例，同 id 先到者胜。`widget_catalog` 可以按这两种来源过滤。「市场」区显示已接入的市场提供方给的条目；没有提供方时显示固定的空状态。
- 新增一组给 agent 的示例组件：`example-basic`（最小目录）、`example-props`（props 与设置弹窗）、`example-data`（data schema 与空态）、`example-state`（setState 与暂停恢复）、`example-action`（动作与失败原因）、`example-size`（盒子契约）、`example-asset`（资源引用）。它们在组件库的「示例」区，`widget_catalog` 按 `source: "example"` 列出并给出目录路径；widget-authoring 技能里有「想学什么 → 看哪个示例」的对照表。
- 组件市场：宿主服务新增 `registerMarketProvider`，插件实现 `list()` 与 `fetch()` 交出远端条目与包；安装走 `POST /library/market/install`，依次核对大小与 sha256、解包校验、包内 id 与条目一致、索引声明与包内声明一致，再检查来源冲突后写进市场来源目录并记录来源。市场条目的 id 必须带作者域（`<作者域>.<名字>`），本地组件继续用扁平 id；已有本地组件同名时拒绝安装并说明来源。提供方读取有 15 秒超时、最多 256 条，失败只影响市场区。
- 组件市场原型：索引格式 1 的 JSON Schema、原生 HTML 的浏览页与两个示例包挂在 GitHub Pages 的 `market/` 子路径下。`npm run market` 从仓库里的组件目录重新打包并改写索引；`node scripts/market.mjs --check` 核对索引与包（sha256、字节数、包内 id 与版本、尺寸族、声明），在 `npm run verify` 与 Pages 部署前各跑一次。
- 提供方接入改成一个把手管一个提供方：服务新增 `registerProvider`，返回的把手一次挂上组件目录、数据源、动作、能力、市场与原生组件，子注册不写版本与提供方名；旧入口继续接受版本 2 与 3，同一侧同一个提供方只有一个活动把手，新旧入口不能混用。服务与把手都报 `supportedApiVersions`、`features` 与 `supports`，首版四项按侧给出；新把手挂的组件目录、市场组件与原生组件的 id 必须写成 `<作者域>.<名字>`，本地组件与既有记录保留扁平 id。新增 `dsh-widget-board/provider` 纯值 SDK，构造并校验注册入参。读取与动作每次 15 秒、能力 1 到 25 秒、每个提供方 8 个并发，组件、数据源、动作与能力的上限是 128、64、64、64，占满执行槽时立即拒绝而不排队；宿主按提供方记录注册数、失败、超时与可用性，设置页列出这张表。停用或卸载时这些注册与授权一起撤下，卡片保留并显示不可用，装回来恢复。
- 组件能拿到能力元数据并按需读一次数据源：握手时带上每一项能力的标题、说明、参数与结果 schema、权限与现在可不可用，`widget.capabilities` 仍是可用名的数组；新增能力 `widget-board:data.read`，manifest 的 `source` 与 `sources` 是允许读的源，读回来的数据不改写卡片。能力调用的参数可以整个省略：声明了 input schema 的按空对象校验，没声明的提供方仍收到 `undefined`。数据源新增可选的 `subscribe`：卡片可见时由它持续推数据，离开视口退订，props 变化时先退订再按最新的一面重订；推上来的数据按组件 schema 校验后走与读取同一条写入路径。内置的运行成本卡与最近 Token 用量卡改用它：运行成本在可见期间每 5 秒一份新采样，「再测一次」经按需读拿一份，Token 卡按会话事件推、另有一条 10 秒的节奏。
- 内置的「改动」卡接上了真实的 Git 改动：新增数据源 `widget-board:git.diff`，卡片可见时每 5 秒读一次本地仓库的未提交改动，工作区干净时退回最近一次提交。读哪个目录由卡片设置里的「仓库路径」决定，留空时跟随当前活跃会话或第一个工作区。目录不是仓库、还没有第一次提交或 Git 读不出来时给一份空改动，卡片显示「暂无改动」。改动按文件分组：宽盒子左边给一份文件清单，点一个文件右边就换成它；窄盒子与常规盒子把每个文件收成手风琴的一节，默认只展开第一个文件。

### 体验优化

- 会话里的 agent 不再收到插件注入的系统提示段：看板的存在与使用边界只写在 widget-authoring 的技能描述里，其余任务不被告知看板。描述写明什么时候该碰看板（用户点名看板、卡片、组件，或要改的卡片已经在板上）、看板归用户所有（未经请求不新增、删除、重排卡片，也不改既有卡片的 props 或数据源、不向它推数据；改前读回、改后确认），以及请求缺宾语时先查状态证据再澄清。工具清单只留在 skill 里，七个工具与「放卡与改卡是同一个工具」的说法一致，翻面组整组移除、换数据源只读一次与刷新策略也写进了指南。
- 握手把这张卡可用的能力告诉组件：`init` 消息带上 `capabilities`（manifest 声明过、宿主当前解析得到的那些），运行时暴露为 `widget.capabilities`。热力图卡按它筛掉没装插件提供的能力，不再先发一次注定失败的调用再回退。

### 问题修复

- 主题切换时卡片不再被整页快照拍进去，切换本身轻了；新配色按圆点扫到各张卡的时刻分批推送，发起切换的卡片立即换、圆外的卡片留在旧配色，转场结束时全部换好，不再出现圆点还没到、卡片先变了的情况。转场被跳过、页面切走或宿主迟迟不让转场开始时，页面上的标记、卡片暂停与扣住的令牌都会收回。

<h3 id="en-unreleased">New Features</h3>

- The widget library panel is now split into three sections by role: examples, installed, and market. Two sources are new: example (authoring samples shipped in packages/widgets-examples for agents) and market (widgets installed by a market plugin, stored under $DSH_HOME/widget-board/market-widgets/). Load order is built-in, mine, market, plugin, examples; with duplicate ids the earlier source wins. widget_catalog can filter by either source. The market section lists the entries of connected market providers and shows a fixed empty state when none is connected.
- A set of authoring examples for agents: example-basic (minimal directory), example-props (props and the settings dialog), example-data (data schema and empty state), example-state (setState and pause/resume), example-action (actions and failure reasons), example-size (the box contract), and example-asset (asset references). They live in the library's Examples section; widget_catalog lists them under source "example" with their directory paths, and the widget-authoring skill maps each authoring question to the example that answers it.
- Widget market: the host service gains registerMarketProvider, where a plugin supplies remote listings and packages through list() and fetch(). Installation goes through POST /library/market/install, which checks size and sha256, unpacks and validates, matches the package id against the listing, verifies the index declarations against the package, then checks source conflicts before writing into the market source directory and recording provenance. Market listing ids carry an author domain (<author>.<name>) while local widgets keep flat ids; a local widget with the same id blocks installation with a visible reason. Provider reads time out after 15 seconds and cap at 256 entries, and failures are confined to the market section.
- A widget market prototype: a format-1 index schema, a plain-HTML browse page and two sample packages under the market/ subpath of GitHub Pages. npm run market repacks from the repository's widget directories and rewrites the index; node scripts/market.mjs --check verifies the index against the packages (sha256, byte count, package id and version, size families, declarations) and runs before both npm run verify and the Pages deployment.
- Provider access now runs through one handle per provider: the service gains `registerProvider`, whose handle mounts widget directories, data sources, actions, capabilities, the market and native components, and child registrations omit the version and provider name; the older entry points keep accepting version 2 and 3, one provider name has one active handle per side, and the two kinds cannot be mixed. Both the service and the handles report `supportedApiVersions`, `features` and `supports`, with four features answered per side; widget directories, market widgets and native components mounted by the new handle use ids of the form `<author>.<name>`, while local widgets and existing records keep flat ids. `dsh-widget-board/provider` is a new value-only SDK that builds and validates registration arguments. Reads and actions wait 15 seconds, capabilities 1 to 25 seconds, each provider runs 8 calls at a time, and widgets, data sources, actions and capabilities cap at 128, 64, 64 and 64; a full set of slots fails at once instead of queueing. The host records registrations, failures, timeouts and availability per provider and the settings page lists that table. Disabling or unloading a provider withdraws those registrations and grants, keeps its cards as unavailable, and restoring the provider brings them back.
- Widgets can now read capability metadata and fetch a data source on demand: the handshake carries each capability's title, description, argument and result schemas, permission and whether it is available right now, while `widget.capabilities` stays the array of available names; a new `widget-board:data.read` capability reads a source, with the manifest's `source` and `sources` as the whitelist, and the value it returns never rewrites the card. Capability arguments may be omitted entirely: a declared input schema is validated against an empty object, and a schema-less capability still receives `undefined`. Data sources gain an optional `subscribe`: while the card is visible the source keeps pushing, the subscription is dropped when the card leaves the viewport, and a props change unsubscribe-then-resubscribes on the latest card face; pushed data is checked against the widget schema and written through the same path as a read. The built-in running cost and recent token usage cards now use it: running cost samples every 5 seconds while visible and the measure-again button reads on demand, while the token card pushes per session event with a 10 second tick.
- The built-in Diff card now shows real Git changes: a new `widget-board:git.diff` data source reads the local repository's uncommitted changes every 5 seconds while the card is visible, falling back to the most recent commit when the working tree is clean. Which directory it reads is decided by the card's repository path setting; left empty it follows the active session or the first workspace. A directory that is not a repository, a repository without a first commit and a failed Git read all yield an empty change list, and the card shows no changes. Changes are grouped by file: wide boxes put a file list on the left and clicking a file swaps the right side to it, while narrow and regular boxes fold each file into an accordion section with only the first file expanded by default.

### Improvements

- A session agent no longer receives a system prompt section injected by the plugin: the board's existence and its usage boundaries live in the widget-authoring skill description, and other tasks are told nothing about a board. The description states when the board is in scope (the user names the board, a card, or a widget, or the card being changed is already on the board), that the board belongs to the user (no cards added, removed, or reordered, no props or data source changes and no data pushes without a request, and every change is read back before and after), and that a request with a missing object gets the cheapest state evidence first. The tool list lives only in the skill, which states the seven tools and that widget_place covers both placing and editing; it also notes that removing one side of a flip group removes both, that a rebound data source is read once, and how to declare a refresh policy.
- The handshake now tells a widget which of its declared capabilities are actually available: the init message carries capabilities (declared in the manifest and resolvable in the host), exposed as widget.capabilities in the runtime. The activity card filters by it and no longer sends a call bound to fail before falling back.

### Bug Fixes

- A theme switch no longer takes a viewport snapshot with every card in it, so the switch itself is lighter; the new palette reaches each card when the circle covers it, the card that started the switch changes at once, cards outside the circle keep the old palette, and the rest land as the transition ends, so no card changes before the circle arrives. A skipped transition, a page left for another tab, or a host that never lets the transition start now all have their mark, suspension and held tokens taken back.

## [0.1.6] - 2026-10-26

[中文](#cn-0.1.6) | [English](#en-0.1.6)

<h3 id="cn-0.1.6">新增功能</h3>

- 新增内置组件「开关灯」：一盏台灯，按底座上的开关在日间与夜间之间切换，窗外的太阳、月亮、星点与灯下的光束一起变化。切换经通用的 dsh.theme 能力完成；浏览器半边把整页的新配色从灯下的一点以圆点展开，旧画面留在圆外，卡片里的波纹与整页圆点共用按下点，并且等新配色落到卡片时才一起开始；圆心与半径用百分比写，1.5 倍像素密度的桌面上也不会偏向左上角。旧快照拍完后暂停其它卡片的逐帧绘制，转场结束分批恢复，按下的一刻其它卡片不会被提前停住；浏览器不支持 View Transitions 或系统要求减弱动效时退回直接切换。宿主半边也能读改写主题偏好，作为兜底。
- 天气卡新增六座城市街景：北京国贸 CBD（中国尊、国贸三期）、上海陆家嘴（东方明珠、三件套、江面）、纽约曼哈顿、东京涩谷、伦敦金融城与赛博霓虹峡谷；每座城有媒体立面、动画广告屏、霓虹招牌、人流与车流，按城市自动出现，也能在设置里直接指定。
- 六座城市的街景不再用同一条街道模板：北京改成楼顶俯瞰 CBD、上海改在外滩隔江看陆家嘴、纽约改成低机位仰视一线天、东京改成路口斜上方俯看斑马线与人潮、伦敦改成河上船看塔桥、赛博霓虹改成驾驶位车景；每座城都带自己的镜头轨道（横移、仰视、环绕、随船起伏、随车前进）。
- 新增会话用量能力：看板自己读本机的会话日志，折出每天的四类 token 分桶与按小时的结算次数，结果按日志的大小与修改时间缓存在看板自己的目录里；组件用它就不必依赖别的插件。
- 天气卡按城市换景：北京一线是古建塔殿、苏杭是水墨山峦与庭院，设置里还能指定景观与动画方式（漂移、静止、轮播）；文字尺寸改为按卡片宽高比例缩放，大卡片不再被 px 上限卡住。
- 新增内置数据源 widget-board:session.usage 与内置的「最近 Token 用量」卡片：插件启动之后订阅会话事件，按所选会话、本地当天与全部三个窗口给出带用量调用的 token 合计、最近一次与最近 30 个点，读数里只出现会话 id 的前 8 位；同时卡片离开视口后暂停刷新，回到视口时补读一次数据。

### 体验优化

- 组件库从浮在下方菜单上的小窗改成从底部上拉的整窗，铺满看板这一栏；打开与关闭用 Panel reveal 过渡（上移 100px、2px 交叉虚化，打开 400ms、关闭 350ms），开始拖动组件时面板先收起，落点直接露出来。
- 天气卡换成 Three.js 搭的立体窗景：三层楼群与窗灯、湿路面上的车流、雨雪与雷电、塔顶航空灯与扫过的探照灯，镜头缓慢推拉并跟随指针；新增精选库 three，只有声明 libs 的组件才内联它。
- 「活动」卡片改成一张用量图：上排一个已经消耗的 Token 总量，下面按卡片的实际宽高铺满用量格子。格子边长、列数与行数都由盒子算出来，格子总数跟着记录长度走并封顶 364 格，悬停读出当天用量；装了 dsh-claude-style 时先读它折好的那份，没装就用看板自己的汇总。
- 卡片设置里的城市字段改成可检索的选择器：边输入边列出候选（中文名、英文名、地区），点一条就把城市名、双语地名与坐标一次填好，选中后显示已解析的坐标并能「换一座」。
- 七个工具改为启动时一次全部注册，不再由 widget_catalog 的 expose 逐个放出来：工具表在会话中途变化会让宿主那条线路的前缀缓存整段失效（Kimi 线路上实测一次就是 62 万 token 的重算），所以 expose 保留为记账参数、不再改变模型能调用什么。
- 内置组件按盒子重排：宽而矮的卡片改成横排（标题在左、内容在右或按列铺开），窄而高的卡片在竖直方向铺开，正方与常规仍是上下结构；大字读数按宽高一起收，长条里不再出现左边一小块、右边一大片空白。月历在矮卡片里改画一整周；组件套件新增 `.t-data--split`，数据卡骨架的内边距与标题字号也按档位收一档。
- 天气卡恢复为低开销的 Canvas 窗景，并在这一版上重做界面：窗外加入黎明、黄金时刻、暮色与夜幕的二维天光，太阳/月亮位置、云的颜色与地平线暖光随当地时刻和日出日落变化；卡片头部加了阶段标记与地点光点，天气图标改成磨砂圆章，天气与高低温并成一行，底部预报改成带背景模糊的薄底舱；玻璃上的雨雪、水珠与城市灯火保留，像素比上限降到 1.5，浅色/深色按宿主令牌判断。
- 「最近 Token 用量」卡片的 today 与 all 两个窗口开始合并插件启动之前的历史：注册时先读一次 dsh-usage 的用量总览，再建立实时订阅，两段来源不重复计数；session 窗口仍只用实时数字。插件可能在宿主绑上端口之前启动，那一次读会失败，所以这两个窗口最多再补读两次（含首次共三次尝试，成功或形状不合格即停）；补上时实时起点移到读完之后、这之间的实时累计整份清空，两段仍然不重复。没装 dsh-usage 时，这个地址上的 401 与 404 一样按未安装记——它自己的总览对回环请求放行，装上之后不会有 401，未装时先答话的是宿主的兜底鉴权。读不到或答出来的形状不合格时，卡片保留实时数据，并在读数里写明历史这一路的状态。

### 问题修复

- 宿主存得下的数据现在送得进组件：父页面发给组件的消息改用单独的 320 KiB 上限（原先与组件发出的消息共用 64 KiB），大快照的 data、state 与 init 不再在桥上被丢弃。
- 删除所有看板后补上的不再是空白的「未命名看板」，而是首次启动的默认看板「我的看板」：卡片与布局都回到默认。
- 放一张绑着需授权数据源的卡不再报错：卡片照加、数据留空，在卡片上给出「允许」之后再读就有数据；界面上加卡失败与卡片凭空出现的矛盾组合消失。
- 设置弹窗画出来的凭据现在都存得进去：能力提供方声明的凭据与组件自己声明的在读写两侧按同一份清单核对，填了值不再被「组件没有声明这个凭据」拒绝。
- 页面不再被旧快照盖掉刚收到的改动：快照带上变更通知的修订号，重取与写入答复换上快照之后，把比它新的事件按修订号重放一遍，状态与布局不再短暂回退。
- widget_define 的自检在真实会话里量得出结果了：检查改经端口送进组件运行时（原先直接跨源读沙箱帧的窗口，必然失败），自检画廊也把组件的双语文案递进去，不再整页显示成 key。
- 变更通知的心跳更稳：单个观众断线不再打断心跳，看板功能关掉再打开之后新连接的心跳也会重新起起来，长时间没有消息的连接不再被反向代理掐掉。
- 界面交互的一批修复：从组件库拖出浏览器窗口松手不再让拖放层卡死、回窗点击也不再误加卡片（Escape 可取消）；设置里的数字框可以正常输入小数与科学计数法；在「关于」页做授权不再清空「配置」页的未保存草稿；布局提交期间加卡与刷新不再与它打架；组件库预览里的动作与能力调用不再发到宿主；关页前的最后一次状态保存改用 keepalive，更可靠；导入同名不同内容的组件时可以选「覆盖安装」。
- 宿主侧持久化与拆除的一批修复：版本库与组件目录改用先写临时再换名的原子写法，崩溃不再留下半份文件；定时刷新的一批读取里一张卡被移除不再让整批失败；授权表里不合格的记录改为当场报错，不再被下次写入静默抹掉；widget_place 给出部分布局不再产出无效坐标，点名不存在的数据源先拒绝再动看板；卡片移除时它的请求日志一并回收；插件拆除时目录来源、授权与热更新订阅收干净；并发删除同一组回到 404。

### 安全

- 导入安全加固：看板包里内嵌的组件文件按组件包同一组上限校验（路径不越出目录、扩展名白名单、文件数与大小），解压在解包前按声明的大小逐项拦截，内嵌的 manifest 与哈希同落盘内容核对不上就整包拒绝。
- 会话工具读数据源补上授权闸门：widget_place 与 widget_show 的读取改走界面手动读的同一条路径，需要授权的数据源在没有人的允许之前不再被工具直接读取。

<h3 id="en-0.1.6">New Features</h3>

- New built-in widget, Light switch: a desk lamp whose base switch flips the room between day and night, moving the sun, moon, stars and the light beam together. The switch goes through the generic dsh.theme capability; the browser half reveals the new palette across the whole page as a circle growing from the lamp, with the old picture left outside it. The card's ripple shares the press point and starts with the page circle once the new tokens reach the card; the circle's center and radius are percentages, so a 1.5x display no longer pulls it toward the top-left. Other cards are suspended only after the old snapshot is taken and resumed in batches, so the press never freezes them early; when View Transitions are unavailable or reduced motion is requested it switches directly, and the host half can read and write the theme preference as a fallback.
- Six new city-scape scenes for the weather card: Beijing CBD with the CITIC Tower, Shanghai Lujiazui with the Pearl Tower and the Bund, Manhattan, Shibuya, the City of London, and a cyberpunk neon canyon; each has animated media facades, billboard screens, neon signs, pedestrians and traffic, picked by city or chosen in settings.
- The six city scenes no longer share one street template: Beijing is a rooftop view over the CBD, Shanghai looks across the river from the Bund, New York is a low upward view through a canyon, Tokyo looks down on the scramble crossing, London rides a boat toward Tower Bridge, and the cyberpunk scene is a driver's-seat view; each scene brings its own camera track.
- Add the session-usage capability: the board reads this machine's session logs itself, folds them into four token buckets per day and settlements per hour, and caches the result by each log's size and modification time in its own directory, so a widget no longer depends on another plugin for these figures.
- The weather card now matches the city: historic towers and halls for Beijing, ink-wash mountains or a walled courtyard for Jiangnan cities, with settings for the scene and motion (drift, still, rotate); text now scales with the card instead of hitting a fixed pixel cap.
- Add the built-in widget-board:session.usage data source and the built-in recent-token-usage card: from the moment the plugin starts it subscribes to session events and reports token totals for the selected session, the local day and everything since start, plus the latest call and the last 30 points, with only the first 8 characters of a session id in the reading. Cards also stop refreshing while they are out of view and read once when they come back.

### Improvements

- The widget library is now a full-height panel that rises from the bottom of the board pane instead of a small window above the dock; opening and closing use the Panel reveal transition (100px rise, 2px cross-blur, 400ms in and 350ms out), and a drag dismisses the panel first so the drop target is visible.
- The weather card now renders a Three.js cityscape: three depth bands of towers with lit windows, traffic on wet asphalt, rain, snow and lightning, rooftop beacons and sweeping searchlights, with a camera that drifts and follows the pointer; a new curated library, three, is inlined only into widgets that declare it.
- The Activity card becomes a usage chart: the tokens spent so far, then a grid of daily usage that fits the card&#39;s own width and height. Cell size, columns and rows all follow the box; the number of cells follows how long the record actually is, capped at 364, and each day reads out on hover. It reads dsh-claude-style&#39;s fold when that plugin is installed and the board&#39;s own otherwise.
- The city field in card settings is now a searchable picker: typing lists suggestions (Chinese name, English name, region), picking one fills the city name, both names and the coordinates, and the chosen place shows its coordinates with a Change button.
- All seven tools are now registered at startup instead of being revealed one by one through widget_catalog's expose: a tool list that changes mid-session invalidates the whole prompt prefix cache on the host route (measured once at 620k tokens on the Kimi line), so expose stays as bookkeeping and no longer changes what the model can call.
- Built-in widgets are laid out per box: wide-and-short cards read horizontally (title left, content right or in columns), narrow-and-tall cards distribute vertically, square and regular cards keep the stacked flow; large readouts scale with width and height, so a wide strip no longer leaves a small cluster on the left and empty space everywhere else. The calendar draws a single week in short cards; the suite gains `.t-data--split`, and the data-card skeleton tightens its padding and title size per box class.
- The weather card returns to the lightweight canvas window scene, with a refined interface on top: the view now has two-dimensional dawn, golden hour, dusk and night light, with the sun/moon position, cloud colors and horizon glow following local time and sunrise/sunset; the header gains a phase marker and location dot, the weather icon becomes a frosted medallion, condition and high/low share one row, and the forecast becomes a softly blurred dock. Rain, snow, glass drops and city lamps remain, pixel ratio is capped at 1.5, and light/dark follows the host tokens.
- The recent-token-usage card's today and all windows now merge the usage recorded before the plugin started: the board reads dsh-usage's overview once, then opens the live subscription, so the two sources never count the same stretch twice, while the session window stays live-only. The plugin can start before the host has bound its port and that first read then fails, so these two windows retry at most twice more (three attempts in total, stopping as soon as the history is available or its shape is unusable); a successful retry moves the live starting point to the moment it finishes and clears the live ledger recorded in between, so the two stretches still never overlap. Without dsh-usage installed, a 401 on that address counts as not installed just like a 404, because its own overview lets loopback requests through and never answers 401 once it is there, while the host's fallback authorization answers first when it is not. When the history cannot be read or answers in a shape the board cannot use, the card keeps its live figures and states the history source's condition in the reading.

### Bug Fixes

- Data the host accepts can now reach the widget: messages from the parent page to a widget use their own 320 KiB limit (previously shared the 64 KiB cap with widget-originated messages), so large data snapshots, states, and init payloads are no longer dropped at the bridge.
- Deleting every board now leaves the default "My board" from the first launch instead of a blank "Untitled board", with its cards and layout restored.
- Adding a card bound to a source that needs authorization no longer fails: the card is added with empty data, and after the user allows it on the card the data arrives; the confusing mix of an error toast and a card that appeared anyway is gone.
- Every credential shown in the card settings dialog can now be saved: credentials declared by capability providers and by the widget itself are checked against the same list on both the read and the write side, so filling one in no longer fails with "the widget does not declare this credential".
- Pages no longer lose freshly received changes to an older snapshot: snapshots now carry the change-notification revision, and events newer than the snapshot are replayed by revision after it is adopted, so state and layout no longer briefly revert.
- The widget_define self-check now produces results in a real session: the inspection travels over the message port into the widget runtime (it previously read the sandboxed frame's window cross-origin, which always failed), and the gallery passes the widget's localized text so labels no longer render as raw keys.
- Change notifications keep a steadier heartbeat: one broken viewer no longer interrupts the beat, and connections opened after the board was toggled off and back on get their heartbeat restarted, so idle connections are no longer cut by reverse proxies.
- A batch of UI fixes: releasing a library drag outside the browser window no longer leaves the drag layer stuck and a stray click no longer drops a card (Escape cancels); number fields accept decimals and scientific notation; granting on the About tab no longer wipes unsaved drafts on the Config tab; adding cards and refreshing no longer race an in-flight layout submit; actions and capability calls from library previews no longer reach the host; the final state save before page close uses keepalive; and importing a same-id widget with different content now offers a replace option.
- A batch of host-side persistence and teardown fixes: the version store and widget directories use write-temp-then-swap atomic writes so a crash no longer leaves half-written files; one removed card no longer fails a whole scheduled refresh batch; malformed grant records now fail loudly instead of being silently erased on the next write; widget_place no longer produces invalid coordinates from a partial layout and rejects unknown data sources before touching the board; a removed card's request log is reclaimed; plugin teardown removes its directories, grants, and hot-update subscription; and concurrent removal of the same group now returns 404.

### Security

- Hardened imports: widget files embedded in board packages now pass the same checks as widget packages (paths stay inside the directory, extension whitelist, file count and size limits), decompression is rejected per entry by declared size before unpacking, and an embedded manifest or hash that disagrees with the embedded files rejects the whole package.
- Session tools now pass the authorization gate when reading data sources: widget_place and widget_show reuse the same path as manual reads from the UI, so sources that require permission are no longer read by tools without a human grant.

## [0.1.5] - 2026-10-23

[中文](#cn-0.1.5) | [English](#en-0.1.5)

<h3 id="cn-0.1.5">新增功能</h3>

- 新增内置组件「今日宜休」：按卡片设置里的 GitHub 令牌认账号，列出这个账号名下还开着的 issue，带仓库、编号、标签与开了几天；点一行就在新标签页里打开那一条。组件自己不能导航，跳转交给宿主页面完成。
- 新增内置组件「运行成本」：左边是宿主进程的常驻内存，右边是一块机器体检面板——堆与外部内存、系统内存、CPU 核数与负载、看板数据所在卷的磁盘余量、系统版本，外加卡片数、状态序列化总量、文档体积与组件库规模，最近 60 次采样画成折线。面板上的「再测一次」由宿主经同一条读取路径重读一次。数据源 `widget-board:system.metrics` 只读宿主自己的内存、机器读数与工作区，没有观众时不采样；卡片离开视口或页面隐藏时停止绘制与状态写入。矮盒子里保留四行带条形图的读数，堆、系统内存、CPU 与磁盘始终看得到。
- 组件可以把链接交给宿主打开：`widget.open(url)` 发一条桥消息，由宿主页面在新标签页里开出这一页，协议只限 http 与 https。沙箱仍然不给导航与弹窗，组件拿到的只是「请宿主开一个网页」这一件事；会话里内联显示的卡片同样可用。
- 天气卡改成按城市名取天气：设置里写「杭州」或「Hangzhou」，保存时由设置界面解析成经纬度与双语地名，卡片按它取 Open-Meteo 的五天预报；旁边新增「定位」，先问浏览器位置，拿不到时按网络出口确定城市。城市名、地名与坐标由同一份配置一起写进卡片，城市名与坐标不会再各说各的。组件的 props schema 新增两个可选的 `format`：`city` 是一个可以定位的城市名，`fills` 指明解析出的地名与坐标写到哪几个字段；`hidden` 的字段不出控件，留给这类派生值。

### 体验优化

- 月历重做：日期格第二行写农历，按「节气 → 节日 → 初一写月名 → 农历日」取一条，节气与节日各有颜色；日期格的字按格子的实际宽高算出来，一到四列、六到三十行的盒子各有自己的排版，宽盒子里日程写成条目，很矮的盒子只留网格；卡片没有数据时不编样例日程，格子里不会冒出假的安排。新增内置组件「今日运势」：分数只由当天的黄道黑道、建除十二值星、星宿吉凶与宜忌条数加权，同一天永远同一个数，另排日期、农历、节气、建除、星宿、值神与当天的宜忌。组件组换成「日历组」：正面月历、背面今日运势，共用一个盒子，右上角的翻面按钮换面；换面不再接管指针，月历自己的翻月按钮因此点得动。组件格式新增 `scripts`，随组件发布的第三方库放在 `vendor/` 下。
- 设置页的看板列表可以移除全部看板：移除最后一块时宿主补一块空的「未命名看板」并选中它，看板页始终有一块可以显示。
- 天气卡改成「窗外是一幅画，卡片是它前面的一层玻璃」。晴天与多云是一幅清朗的窗景：蓝天、太阳或月亮、一朵朵有体积的积云——云面沿受光方向从亮到暗，鼓出来的地方有高光，上缘一道受光的亮边，日月从云后透出一圈光；云飘在城市后面，画面不闪。夜里换成月亮与满天星，晴朗的夜空里月亮不会被云盖住。阴天从多云里分出来，有了自己的天空。下雨下雪时，水珠落在玻璃上长大、顺着玻璃滑下并留下水痕，每颗大水珠真折射出它身后的世界；水珠会一直补足，长时间开着也不会滚空。雷暴另有闪电，两三秒一次，一亮一暗再补一下。组件格式新增 `scripts`：组件可以把逻辑按职责拆成目录里的多份脚本。
- 卡片设置弹窗改成三节：配置、日志、关于。配置一节是一张两列的表，字段按组件自己声明的类型出输入框、数字、开关或下拉，组件声明的凭据与它们排在一起，值由宿主保存、界面只显示状态。日志一节列出这张卡对外的每一次请求（方法、主机与路径、状态与耗时）。内置组件去掉了「标题」「眉题」这类只换一行字的占位字段，剩下的字段补上了中英文名字。
- 「今日宜休」按 GitHub 工作台那种排法重画：一行三段——左边状态点，中间标题加副行（仓库、编号、谁开的、标签、回复数），右边一列写「更新」与其下的时刻；标签用 GitHub 自带的颜色，列表上方多一行开放数。能力回的结果随之加上「最后更新时刻」「作者」与带颜色的标签。
- 天气卡在大盒子里把城市、温度与天气文字一起放大：字号按卡片的实际宽高计算，温度再按高度收住，城市最大 40px、温度最大 200px，天气文字与高低温、预报栏跟着变大；城市、温度与天气各自压一层更厚的投影与上下柔光，浅色与深色下都更容易读。窄盒子把天气与高低温排成可以折行的一行，矮盒子收掉预报栏与日期，只留城市、天气、温度与高低温。

### 问题修复

- 组件库浮窗不再被别的插件给所有对话窗定的尺寸框住：它不再声明 `dialog` 这个角色，高度上限仍按与下方菜单的间距算，题头与关闭钮不会再被推到窗口上缘之外。
- 月历与翻页时钟在矮盒子里不再被截断：盒子落到 6rem 高时，月历收掉导航按钮与星期行、把日期数字收小，翻页时钟的字号下界跟着盒子高度收小。尺寸矩阵的纵向截断判据下全部组件通过。DSH 余额卡的读数改成始终保留两位小数、十亿起只留整数并标近似号，窄盒子放不下时依次收货币代码、收紧一档、折行；卡片多一个可选的标签（kicker）。

### 其他变更

- README 的状态一节写明 npm 上的版本为 0.1.5。

<h3 id="en-0.1.5">New Features</h3>

- New built-in widget "Rest today": uses the GitHub token from the card settings to find the account and lists the open issues on its repositories, with repository, number, labels and age; clicking a row opens it in a new tab. Widgets cannot navigate themselves, so the host page opens the link.
- New built-in widget "Running cost": the host process's resident memory on the left and a machine check panel on the right — heap and external memory, system memory, CPU cores and load, free space on the volume holding board data, and the OS version, plus card count, serialized state size, document weight and library size, with the last 60 samples drawn as a sparkline. The panel's "Measure again" button asks the host to reread through the same path. The `widget-board:system.metrics` source reads only the host's own memory, machine readings and workspace; it samples nothing without an audience and stops drawing and writing state when the card leaves the viewport or the page is hidden. Short boxes keep four rows with bars, so heap, system memory, CPU and disk stay visible.
- Widgets can hand a link to the host: `widget.open(url)` sends one bridge message and the host page opens it in a new tab, limited to http and https. The sandbox still grants no navigation or popups — a widget only gets to ask the host to open a page, and inline cards in a session can do it too.
- The weather card now takes a city name: type “杭州” or “Hangzhou” in the settings, and the dialog resolves it into coordinates and a bilingual place name that the card uses for the five-day Open-Meteo forecast; a new Locate button asks the browser first and falls back to the city of this network. The name, place and coordinates are written together, so the city shown and the weather fetched no longer disagree. The widget props schema gained two optional formats: `city` marks a locatable city name, with `fills` naming the props that receive the resolved place and coordinates; `hidden` fields get no control and are left for those derived values.

### Improvements

- The month calendar is redone: the second line of every day carries the lunar date, picked as solar term, then festival, then the month name on the first day, then the lunar day, with terms and festivals coloured; the type in a day cell is derived from the cell's measured width and height, so one to four columns and six to thirty rem boxes each get their own layout, a wide box writes plans out as bars and a very short box keeps the grid alone, and a card without data invents no sample plans, so no fake entries appear in the cells. New built-in widget "Today's fortune": the score is weighted only by the day's auspicious or inauspicious deity, the twelve duty officers, the mansion's luck and the length of the almanac lists, so the same day always scores the same, beside the date, lunar date, solar terms, duty officer, mansion, deity and the day's do and avoid lists. The default group is now the calendar group: a month calendar on the front and today's fortune on the back sharing one box, flipped by the button in the top right corner; flipping no longer takes the pointer, so the calendar's own month buttons stay clickable. The widget format gained `scripts`, and a third-party library shipped with a widget lives under `vendor/`.
- The board list in settings can now remove every board: removing the last one leaves a fresh empty "Untitled board" selected, so the board page always has one to show.
- The weather card is now a view outside a window with the card as the glass in front of it. Clear and cloudy days are a crisp window view: blue sky, a sun or moon, and cumulus clouds with real volume — each cloud shades from lit to shadowed along the light direction, its bumps catch highlights, its upper edge carries a lit rim, and the sun or moon bleeds a glow through it. The clouds drift behind the city and nothing strobes. At night the moon and stars take over, and a clear night leaves the moon unobstructed. Overcast is its own sky rather than a shade of cloudy. In rain and snow, droplets land on the glass, grow, slide down leaving wet trails, and the large ones genuinely refract the world behind them; the glass keeps replenishing its droplets, so it never runs dry however long the card stays open. A thunderstorm adds lightning every two or three seconds, a bright strike with a second, fainter pulse. The widget format gained `scripts`, so a widget can split its logic into several files by responsibility.
- The card settings dialog now has three sections: configuration, log and about. Configuration is a two-column table — each field gets a text input, number input, switch or dropdown according to the type the widget declares, and the widget's credentials sit in the same table, stored by the host with only their status on screen. The log section lists every request the card makes, with method, host and path, status and time. Built-in widgets dropped the placeholder title/kicker fields, and the remaining fields gained labels.
- The Rest today card is redrawn after the GitHub workbench layout: each row has a state dot on the left, the title plus a sub line (repository, number, author, labels, replies) in the middle, and an "Updated" column with the time on the right; labels keep their GitHub colors, and a count line sits above the list. The capability result now carries the last-updated time, the author, and colored labels.
- In large boxes the weather card scales the city, temperature and condition together: type sizes come from the card's measured width and height, the temperature is further capped by height, the city grows to 40px and the temperature to 200px, and the condition, highs and lows and forecast bar grow with them; a stronger shadow and top/bottom scrim keep all three readable in light and dark. Narrow boxes let the condition and highs wrap onto one line, and short boxes drop the forecast bar and the date, keeping the city, condition, temperature and highs.

### Bug Fixes

- The widget library no longer takes the size another plugin gives every dialog: it no longer declares the dialog role, so its own cap — the space above the menu — keeps the header and close button inside the window.
- The calendar and the flip clock are no longer clipped in short boxes: at 6rem the calendar drops its nav buttons and weekday row and shrinks the day numbers, and the flip clock's minimum font size follows the box height. Every widget now passes the size matrix's vertical-clipping check. The DSH balance card keeps two decimals up to a billion and shows whole numbers with an approximation mark above that; in narrow boxes it drops the currency code, tightens a step, then wraps. The card gains an optional kicker label.

### Chores

- The README status section names the version on npm as 0.1.5.

## [0.1.4] - 2026-10-18

[中文](#cn-0.1.4) | [English](#en-0.1.4)

<h3 id="cn-0.1.4">其他变更</h3>

- README 的状态一节写明 npm 上的版本。

<h3 id="en-0.1.4">Chores</h3>

- The README status section names the version on npm.

## [0.1.3] - 2026-10-18

[中文](#cn-0.1.3) | [English](#en-0.1.3)

<h3 id="cn-0.1.3">其他变更</h3>

- README 的安装一节与状态一节写明 npm 上的版本。
- 演示页的安装一节改成从 npm 安装，并列出 npm 包地址；源码仓库的链接留在原处。

<h3 id="en-0.1.3">Chores</h3>

- The README install and status sections name the version on npm.
- The demo page's install section installs from npm and links the package on npm; the source repository link stays.

## [0.1.2] - 2026-10-18

[中文](#cn-0.1.2) | [English](#en-0.1.2)

<h3 id="cn-0.1.2">其他变更</h3>

- 改从 npm 安装：`dsh plugin add dsh-widget-board`，安装目录里带着构建好的产物，不必再等 `prepare` 在安装时构建。从 GitHub 仓库安装的方式照旧可用。

<h3 id="en-0.1.2">Chores</h3>

- Install from npm with `dsh plugin add dsh-widget-board`: the tarball carries the build output, so nothing has to be built at install time. Installing from the GitHub repository still works the same way.

## [0.1.1] - 2026-10-18

[中文](#cn-0.1.1) | [English](#en-0.1.1)

<h3 id="cn-0.1.1">新增功能</h3>

- widget_define 带自检：调用进行中由看得到这个会话的页面把新组件放进代表性盒子，用组件运行时里的检查器量一遍，结论写进工具结果；没有页面接手时标 unverified。widget_define 的结果在会话正文里画出结论、问题与预览，会话重新打开时按同一份重画。检查器只剩一份，尺寸矩阵也改用它的判定（新增文字与控件被纵向截掉的判据），并且铺满组件库里每个组件。
- 组件可以调 `widget.notify({ title, body })` 发起通知：侧栏的看板入口右上角滑入未读条数，悬停读到最近一条的标题与正文，点一下看板入口之后清零；番茄钟到点会自己发一条。
- 看板从一块变成多块：顶部一条标签在几块看板之间切换，每块看板有自己的卡片、盒子与修订号；存储拆成一份索引加每块看板一份文件，旧版本的单一看板在第一次打开时自动搬成第一块看板。
- 会话里的 agent 现在能用六个工具读写看板：列组件（widget_catalog）、写或改一个组件（widget_define）、读看板上的卡片（widget_board）、放卡或改卡（widget_place）、移除卡（widget_remove）、推数据（widget_push）。工具跟着总开关出现与撤下，并带一条虚拟 skill「widget-authoring」，写组件的格式、运行时接口与盒子契约都在里面。
- 组件可以在 widget.json 里声明刷新策略：按需（默认），或「看着的时候按间隔读」。宿主上只有一条定时链，按有哪些卡片要刷新、现在有几个看板页在看算出跑不跑、跑多快；没有观众时一律不读。数据源也能声明自己需要的权限，要权限的数据源与动作一样，读之前要有人在卡片上给出授权。
- 组件可以导出成 .dshw 再导入回来，看板可以导出成 .dshboard（带上它用到的全部组件；数据与状态默不带，带 ?data=true 才带）。解包前校验路径、扩展名、文件数与大小；同 id 不同内容先回 409 并给出两边的哈希，带上 replace 才覆盖，内置与插件提供的组件永远不被覆盖。组件库浮窗里每一格有「导出」，头部有「导入」。
- 卡片右上角多了设置弹窗：组件设置、凭据、数据与权限、关于四节；props 由组件自己的 schema 生成表单，保存时宿主按同一个 schema 校验；凭据写进宿主的凭据服务，不进看板文件、导出包与工具结果。翻面组也在弹窗里挑两个槽的组件，换一个槽会重置它自己的设置，另一个槽不动。
- 组件可以声明由宿主代发的 HTTPS 请求：widget.json 里写 "source": "http" 与 request.url，地址里的 {名字} 在读取时换成卡片 props（没有时用 props schema 的默认值），主机必须列在 permissions.hosts 里；回环、内网与 IP 字面量一律拒绝，重定向不跟随，响应有超时与大小上限；request.cacheMs 给出同一个地址的缓存时长，返回的 JSON 原样作为 data 交给组件。
- 新增三个内置组件：翻页时钟、表盘与热力图。时钟把时与分逐格翻页、秒用数字滚动，可按 IANA 时区名显示；表盘用环形比例表示配额与目标，支持四种色调；热力图按日铺格子，按盒子宽度显示 16、26 或 53 周，并给出总数、有记录的天数与连续天数。
- 组件桥多了一条通用的宿主能力调用：组件在 manifest 里声明能力名，用 widget.call 传参数并拿返回值，可以取消、有超时；能力由插件注册，输入与输出按 JSON Schema 校验，要权限的能力先由人授权。内置的 DSH 余额卡声明 dsh.account.balance，直接读当前登录的 DSH 账号充值钱包与赠送钱包，不需要 API key。
- 新增两个内置组件：月历与改动。月历按周一起头铺出一个月的日期网格，有安排的日期带点，可以翻到前后月份或回到今天，翻月的位置经 state 存在宿主上；改动卡把统一的 diff 按行铺开，新增与删除标出加减号，文件路径作为分节标题。
- 会话里的 agent 多了一个工具 widget_show：把一个组件内联显示在回答里，不必切到看板。给 id 时显示看板上已有的那张卡，状态与动作双向同步；给 widget 与 props 时画一份一次性快照，它不在看板上，状态只留在页面上。视图按线上工具名注册在 tool.call.toolview 上，这次调用的载荷由工具经 presentationMeta 投影进结果的 meta，视图只读它。
- 新增三个内置组件：链接、JSON 与年度进度。链接卡把一组地址排成带首字母色块的列表，域名从地址里取；JSON 卡把一段值画成可以逐层折叠的树，值按类型着色；年度进度卡给出今年的百分比、按季度分段的进度条与剩余天数。

### 体验优化

- 卡片高度改成七档档位：6、10、14、18、22、26、30rem，缩放时在档位之间跳，不再逐像素拉伸。
- 卡片顶部的纵向位置改成每 2rem 一档：拖动与落点吸附到 0、2、4…rem，自动堆叠向下推开时向上取整，整理也落在这张网格上。
- 组件库改成按来源分组的网格，每格是组件自己的实时缩略画面；按住一格拖到看板，轻点一格加在末尾。
- 右下角的缩放手柄改成贴着卡片圆角的一段弧：静置时不画，悬停时半透明，拖动时完整露出；改变大小时，尺寸读数铺成覆盖整张卡的遮罩。
- 番茄钟的刻度进度条在矮卡片里也保留，时长范围改成 5 到 60 分钟，读数在卡片中间居中，并在开始按钮上方加了 5 分钟、25 分钟两个快捷按钮：点一下直接开始倒计时，跑起来之后这排按钮收起，不能拿来重新计时。
- 番茄钟在大卡片里把读数、刻度与按钮收进居中的一列，数字随卡片尺寸放大，开始按钮不再拉满整张卡。
- 组件在 widget.json 里声明的最小盒子（minBox）现在会生效：新卡片与拖动落点抬到下限，缩放停在下限，载入看板与组件库热重载时把低于下限的卡片抬上来；组卡取正反两面的并集。
- 组件拿到宽度与高度两个方向的尺寸档（data-box-width、data-box-height）；令牌补上间距与字号阶梯，运行时套件补 .w-frame、.w-actions、.w-scroll 三个布局原语与按档位隐藏的类。
- 删掉一张卡片时，卡片按附件磁贴入场的反向退场：淡出并缩到 0.85，250ms，曲线与磁贴入场同一条；退场走完才换快照，其它卡片这时才开始收拢。
- 动作与数据源带上了归属：跨提供方重名时后到的注册被拒绝并说明原因，组件用「提供方:名字」点名；动作可以声明自己需要的权限，声明了权限的动作要有人在卡片上给出授权（绑在这个组件版本上）之后才跑得起来，组件内容一变就要重新授权。提供方的注册现在是一个生命周期把手：撤下时目录、它名下的数据源与动作、它留下的授权与目录监视一并撤下。
- 组件库的缩略画面标成 preview 位置，组件可以在这里换一套静态排版；番茄钟的缩略画面收掉快捷时长与开始按钮，待办收掉输入行，只留标题、读数与内容。
- 看板页顶部多了一条标签：每块看板一个标签，活动标签的药丸滑过去；标签条上只放一个新建入口，切换标签时不重挂任何组件——所有看板的卡片同时挂载，看不见的那些照旧暂停。
- 内置组件的视觉收了一遍：数据卡的标题区只留标题与一条有事实的右上信息，12px 以下的等宽全大写标签、编号 kicker 与「7 POINTS」这类计数默认不再出现；字号与间距改读类型、间距令牌，数字统一等宽。状态色收进套件的 --w-tone-* 四个变量，列表与时间线再加一行读屏文字，不再只靠颜色。图表补了峰值、最新值与读屏摘要，表格补了 aria 标签与列作用域，进度条的动画从 width 改成 transform。全息卡加了一层压暗文字区的 scrim，磁吸卡把舞台收回成卡片自己的表面、去掉重复的点阵底，翻转卡背面改成前景与底色对调，浅色与深色下都从令牌来。每个内置组件补了与内容量相称的 defaultBox 与 minBox；题头去掉 kicker，说明改成一句具体的用途。
- 看板的重命名、移除与选中收进设置页里的「看板」一节：列出每块看板的标题与卡片数，标题可以就地改，只剩一块时不给移除。
- 第一次打开看板时不再把全部组件按字母序铺满一页：现在是两块看板，「我的看板」是精选的一屏（题头、天气、番茄钟、待办、日程、翻面组、改动对比、余额、时钟、活动热力图），「组件画廊」按数据展示、工具、动效模板把每个内置组件各放一张；画廊里的表格与键值写入了正常的示例内容。看板页的标签条在滚动时有了一条垫底，底部的加号后面也有一条渐隐底，不再压在卡片边缘；切到较矮的看板时底部不再有一段空白的滚动区域。已有看板的用户不受影响。
- 新增 `npm run demo`：构建一个可以直接放上静态托管的演示页。页面第一屏是插件真实的看板（可以拖动、缩放、翻面、切浅色深色，布局存在浏览器里），其后是录屏位、三个设计要点与安装命令，中英双语；看板由一个只读的浏览器端宿主驱动，需要数据源与宿主能力的组件不放进来。演示页不进发布包。
- 月历、翻页时钟、改动、表盘与热力图跟上数据卡的标题区与盒子：编号 kicker 与全大写等宽微标签默认不再出现，右上信息改成条数、周数或行数，状态色读套件的 --w-tone-*；日历的翻月与今天按钮放大到 32px，热力图图例与说明提到 12px；每张卡补了与内容量相称的 defaultBox 与 minBox。
- 新加的八个内置组件跟上视觉规范：标题区去掉编号 kicker 与大写计数，右上角改成按语言书写的事实（条数、周数、时区、年份）；字号与间距改读类型令牌与间距令牌；表盘、月历与 JSON 的状态色改用 --w-tone-*，月历的日期格补 aria 标签；每张卡补上 defaultBox 与 minBox；时钟与年度进度在卡片暂停时停下定时器。
- 看板下方的加号菜单与组件库浮窗改成按看板这一栏的中线定位：左右侧栏收放、拖宽时它们跟着卡片区走，不再按整扇窗口居中。
- 天气卡改用 Open-Meteo 的真实数据：组件自己把原始响应映射成五天预报（WMO 天气代码、双语星期与天气文字、高低温），地点与经纬度从卡片 props 取；按五小时刷新，宿主把 Open-Meteo 的响应按地址缓存同样久，重新打开看板不会连着请求接口；数据没到时显示等待，超时后写明暂时无法获取；内置看板第一次打开时旧的天气卡会自动接上数据源。
- 组件状态写入由父页面按 250 毫秒窗口合并，宿主按卡 64KB、按看板 1MB 与每秒次数限额拒绝超出的写入并显示原因；状态事件在对象合并时只带补丁；布局提交成功只回这次落定的盒子；定时刷新覆盖全部看板；看板没有选中时卡片也暂停，运行时新增 `paused` 与 `onPause`；同一份组件版本库在启动时不再重写已存在的文件。
- 定时刷新把同一块看板在同一轮到期的卡片合成一次写入，不再每张卡各写一遍整块看板；读失败的卡只影响自己。
- 打开看板时，声明了定时刷新的卡片先读一次，之后按间隔读；不用等满一个间隔才看到当下的数据。
- Windows 桌面端把看板标签条挂进窗口标题栏：标题栏让出那一条、宽度放得下时，标签条靠左挂在 Desktop 菜单之后，比页内小一号、上下留出空隙，圆角 9999；看板内容从标题栏下方开始。标签条换成 transitions.dev 的 Tabs sliding，活动标签的药丸滑过去，首帧不补间。放不下或不在桌面端时仍留在页面顶部。
- 组件在 widget.json 里声明默认数据源之后，看板上没有绑定数据源的旧卡片在加载时接上它，不必重新加卡。
- 会话工具的看板操作扩展到全部看板：widget_board 列出所有看板并可指定读哪一块，widget_place 可把新卡放到指定的看板，widget_push 与 widget_remove 按全工作区唯一的卡片 id 找到那张卡，不必先切换选中的看板。
- 看板页只挂当前看板的卡片：切换标签时旧的卡片卸载、新的重新挂载，iframe、计时与动画的成本收在一块看板内。组件在切回来时重新初始化，界面状态与数据由宿主恢复。
- 提供方的服务类型现在有一个只含类型的入口（`dsh-widget-board/service`）：用 `import type` 取类型，运行时只走服务，从 `service.apiVersion` 读版本，不复制常量，也不为绕开规则添加 `dsh.client.external`。客户端产物只依赖平台种子，这一条由构建检查；原生组件的重名注册被拒绝并保留先到的那一个，把手名下的数据源与动作必须与把手同名。插件停用或卸载时，组件、数据源、动作与它留下的授权一起撤下，卡片保留并显示不可用，启用之后恢复。
- 内置组件的视觉统一：标题区不再带英文眉标与编号，右上角的统计随界面语言显示；番茄钟与天气回到单色基调，强调色只留给进度、当前项与主按钮，饱和色只留给图片、全息与磁吸卡，这几张在深色下各有一套从看板底色推出来的明度；翻转卡用令牌的正反两面；数字、表盘、时钟、翻转卡、表格、待办空态与余额按高度档位放大读数；图表补上面积填充、刻度值与末端数据点；天气预报每天带温度，「今天」按预报所在地的日期判定，缓存跨零点后自动丢掉过去的日子；题头右侧改成一块缩小的看板图案；键值卡与 Markdown 卡的示例收短，滚动区在行首吸附，Markdown 卡的最小高度抬到 18rem 以放下默认内容；余额卡没有登录时显示「登录后显示余额」，只有调用出错才用错误色；时钟、改动、表盘与热力图的默认盒子按内容量重新取过：改动与热力图默认两列宽。

### 问题修复

- 从仓库安装时这个包自己构建一次：`prepare` 跑构建，装出来的包里带上 `lib/host/index.js`，不再因为缺宿主半边而启用失败；lint 在发布入口指向 `lib/` 时要求 `scripts.prepare` 存在。
- 看板页顶部的标签条不再被内容压短：它保持自己的高度，药丸套住活动标签，文字不会再跑到条外、药丸落到文字下方。
- 加卡片时的第一次数据读取也过授权：要权限的数据源在有人于卡片上给出授权之前不再被读一次，加卡请求按 403 回给界面，卡片留在看板上；请求本身失败时只记一条日志，不再让加卡失败，卡片的数据留空。
- 设置页里的「看板」一节重新画得完整：它不再与卡片右上角的设置按钮共用样式类名——卡片按钮的绝对定位与 20px 尺寸曾一并套在设置面板上，把这一节压成一个小点。
- 加卡片时组件库立刻收起，不等宿主写完：数据源读得慢时，晚收会把用户在这期间重新打开的组件库关掉。

### 其他变更

- 新增尺寸矩阵检查（npm run matrix，并接入 npm run verify）：每个内置组件在代表性的看板盒子与缩略画面里检查横向溢出、空画面、被裁的可见控件与控制台错误。
- 新增 `node scripts/worktree.mjs remove <路径>`：`.debug/` 下借主树 `node_modules` 的临时工作树先摘掉顶层链接再交给 git，Windows 上不再顺着链接删掉主树的目录；`scripts/lint.mjs` 只允许这一处发出删除工作树的命令，`packages/testing/` 补一条回归测试。

<h3 id="en-0.1.1">New Features</h3>

- widget_define is self-checked: while the call runs, a page showing the session puts the new widget into representative boxes and measures it with the inspector in the widget runtime; the verdict lands in the tool result, and no page means unverified. The widget_define result shows the verdict, the problems and a preview inline in the conversation, redrawn the same way when the session reopens. The inspector now exists once: the size matrix uses its judgement too (with vertical text and control clipping added) and covers every widget in the library.
- Widgets can call `widget.notify({ title, body })` to raise a notification: the Board entry in the sidebar slides in the unread count, hovering reads the latest title and body, clicking the entry clears it, and the pomodoro raises one when its session ends.
- The board now holds several boards: a tab strip at the top switches between them, and each board keeps its own cards, boxes and revisions; storage splits into one index plus one file per board, and an older single board is carried over as the first one when it opens.
- An agent in a session can now read and write the board with six tools: list widgets (widget_catalog), write or replace a widget (widget_define), read the cards on the board (widget_board), place or change a card (widget_place), remove a card (widget_remove), and push data (widget_push). The tools follow the master switch, and a virtual skill named widget-authoring carries the widget format, runtime interface and box contract.
- A widget can declare a refresh policy in widget.json: on demand (the default) or "read on an interval while watched". One timer on the host decides whether and how fast to run from which cards ask for it and how many board pages are watching; nothing is read without a viewer. A data source can also declare the permissions it needs, and a gated source is granted on the card before it can be read, exactly like a gated action.
- A widget can be exported as .dshw and imported back, and a board as .dshboard with every widget it uses embedded (data and state are left out unless ?data=true). Packages are checked for paths, extensions, file count and size before they are unpacked; the same id with different content answers 409 and names both hashes, and only replace overwrites — built-in and plugin-provided widgets are never overwritten. Each tile in the library panel has an Export, and its header has an Import.
- Cards gain a settings modal with four sections: widget settings, credentials, data and permissions, and about. Props render from the widget's own schema and the host validates them against the same schema on save; credentials go to the host's credential service and never enter board files, exports or tool output. A flip group also picks its two slot widgets in the modal: replacing one resets that slot's own settings and leaves the other alone.
- A widget can declare an HTTPS request the host makes for it: write "source": "http" and request.url in widget.json. Each {name} in the URL is replaced from the card's props (or the props schema default), and the host must be listed in permissions.hosts. Loopback, private and IP-literal hosts are refused, redirects are not followed, and responses have a timeout and a size cap; request.cacheMs sets how long the same URL is cached, and the returned JSON becomes the widget's data as-is.
- Adds three built-in widgets: a flip clock, ring gauges and a heatmap. The clock flips hours and minutes cell by cell and rolls the seconds, and takes an IANA time zone; the gauges show quotas and goals as rings in four tones; the heatmap lays out daily cells across 16, 26 or 53 weeks by box width and reports totals, active days and a streak.
- The widget bridge gains a generic host-capability call: a widget declares capability names in its manifest and uses widget.call with arguments and a return value, with cancellation and a timeout; plugins register capabilities, arguments and results are checked against JSON Schema, and one with a permission needs a person's grant first. The built-in DSH balance card declares dsh.account.balance and reads the recharge and bonus wallets of the signed-in DSH account, with no API key.
- Adds two built-in widgets: a calendar and a diff. The calendar lays a month out from Monday with a dot on days that have plans, steps to the previous or next month or back to today, and keeps the shown month in host state; the diff card prints a unified diff line by line with add and remove signs and file paths as section headings.
- A session agent gains widget_show: it draws a widget inline in the answer itself, with no panel switch. Passing an id shows that card from the board, sharing state and actions both ways; passing a widget with props draws a one-off snapshot that is on no board and keeps its state only on the page. The view registers on tool.call.toolview by wire tool name, and the tool projects this call's payload into the result meta through presentationMeta, which is all the view reads.
- Adds three built-in widgets: links, JSON and year progress. The links card lists addresses with a letter mark and the host taken from each address; the JSON card draws a value as a tree that folds level by level with values colored by type; the year-progress card shows the percentage of the year, a bar split into quarters and the days left.

### Improvements

- Card height now snaps to seven steps — 6, 10, 14, 18, 22, 26 and 30 rem — so resizing jumps between steps instead of stretching by the pixel.
- Card tops now snap to 2 rem steps: dragging and dropping land on 0, 2, 4… rem, automatic stacking rounds up to the grid, and Tidy uses the same rows.
- The widget library is now a grid grouped by source, each tile showing a live thumbnail of the widget itself; hold a tile to drag it onto the board, or tap one to add it at the end.
- The bottom-right resize handle is now an arc that follows the card's rounded corner — hidden at rest, semi-transparent on hover and fully shown while dragging; while resizing, the size readout becomes a mask over the whole card.
- The pomodoro keeps its tick progress bar in short cards, spans 5 to 60 minutes, centers the readout in the card, and adds 5-minute and 25-minute buttons above Start that begin the countdown right away; once a session runs, that row is hidden so it cannot restart the clock.
- Large pomodoro cards center the readout, ticks and buttons in one column, scale the clock with the card, and stop stretching Start across the whole card.
- The minimum box a widget declares in widget.json now applies: new cards and drop points are raised to it, resizing stops at it, and cards below it are raised when a board loads or the library hot-reloads; a flip group uses the union of both sides.
- Widgets now get width and height size classes (data-box-width, data-box-height); the token set gains spacing and type scales, and the runtime suite gains the .w-frame, .w-actions and .w-scroll layout primitives plus size-class hiding helpers.
- Removing a card now plays the attachment tile's entrance in reverse — fade out and shrink to 0.85 over 250 ms on the same curve — and the board swaps the snapshot only after the exit, so the other cards start closing in afterwards.
- Actions and data sources now carry an owner: a duplicate name from another provider is refused with a reason and a widget can address one as "provider:name". An action can declare the permissions it needs, and such an action only runs after a person grants it on the card (bound to that widget version); changing the widget asks again. A provider registration is now a lifecycle handle: disposing it removes the directory, the data sources and actions registered under it, its leftover grants and its directory watch.
- Library thumbnails now carry the preview placement so a widget can switch to a static layout there; the pomodoro thumbnail drops the quick-length and Start buttons, and the to-do thumbnail drops the input row, keeping the title, readout and content.
- The board page gains a tab strip: one tab per board with a pill that slides to the active one, a single New entry on the strip, and no widget is remounted when you switch — every board's cards stay mounted, and the ones you cannot see stay paused.
- The built-in widgets had a visual pass. Data cards now show a title plus one factual meta line: the sub-12px uppercase mono labels, numbered kickers and counts such as '7 POINTS' are gone by default, type and spacing read from tokens, and numbers share tabular figures. Status colors live in four suite-level --w-tone-* variables, and list and timeline rows carry a screen-reader status line so color is not the only signal. The chart gains peak and latest values plus a spoken summary; the table gains an aria label and column scopes; the progress bar animates transform instead of width. The holographic card gets a text-side scrim, the magnetic card turns its stage back into the card surface and drops the duplicate dot pattern, and the flip card's back swaps foreground and background, both from tokens in either theme. Every built-in widget declares a defaultBox and minBox suited to its content; the board hero loses its kicker and gains a concrete tagline.
- Renaming, removing and selecting a board move into a Board section in settings: it lists each board with its title and card count, the title can be edited in place, and the last remaining board cannot be removed.
- A first launch no longer pours every widget onto one page in alphabetical order. It now creates two boards: "My board", a curated first screen (hero, weather, pomodoro, to-do, calendar, flip group, diff, balance, clock, activity heatmap), and "Widget gallery", one card per built-in widget grouped into data display, tools and motion templates, with sensible sample content in its table and key-value cards. The tab strip now has a backing while the board scrolls, the add button sits on a fading base instead of on top of card edges, and switching to a shorter board no longer leaves blank scroll space at the bottom. Existing boards are untouched.
- New `npm run demo` builds a demo page you can drop onto static hosting. The first screen is the plugin's real board (drag, resize, flip, light and dark, with the layout kept in the browser), followed by a slot for a recording, three design points and the install command, in Chinese and English. A read-only host running in the browser drives the board; widgets that need data sources or host capabilities are left out. The demo page is not part of the published package.
- Calendar, flip clock, diff, gauge and heatmap join the data-card header and box system: numbered kickers and uppercase mono micro-labels are gone by default, the top-right fact is now a count of events, weeks or lines, and status colors read the suite's --w-tone-* variables. Calendar's month controls grow to 32px, the heatmap legend and caption move to 12px, and each card declares a defaultBox and minBox suited to its content.
- The eight new built-in widgets follow the visual pass: titles drop numbered kickers and uppercase counts, and the top-right meta becomes a factual line in the current language (items, weeks, time zone, year); type and spacing read from the type and spacing tokens; the gauges, calendar and JSON take their status colors from --w-tone-*, and calendar days gain aria labels; every card declares a defaultBox and minBox; the clock and year progress stop their timers while the card is paused.
- The bottom plus menu and the widget library now centre on the board column: collapsing, expanding or dragging the sidebars keeps them on the card area's midline instead of the window's.
- The weather card now reads real data from Open-Meteo: the widget itself maps the raw response into a five-day forecast (WMO weather codes, bilingual weekdays and conditions, highs and lows), with the place and coordinates taken from the card props. It refreshes every five hours and the host caches the Open-Meteo response per URL for as long, so reopening the board does not hit the API again; it shows a waiting state until data arrives and names the failure after a timeout. Existing weather cards are bound to the source when their board is first opened.
- Widget state writes are coalesced in a 250 ms window in the parent page; the host rejects writes over 64 KB per card, 1 MB per board or the per-second write limits and shows the reason. State events carry an object patch, a successful layout commit returns only the boxes it stored, scheduled refresh covers every board, cards pause when their board is not selected, the runtime gains `paused` and `onPause`, and the version store no longer rewrites blobs that already exist at startup.
- Scheduled refresh batches the cards that are due on the same board into one write instead of rewriting the whole board once per card; a failed read only affects its own card.
- When a board is opened, cards with an interval refresh read once right away and then on their interval, so current data appears without waiting a full interval.
- On the Windows desktop the board tab strip now rides in the window's caption row: when the shell reserves that row and the strip fits, it sits at the left after the desktop menu, a size smaller than in the page with air above and below and 9999px corners, and the board starts below it. The strip now uses transitions.dev's Tabs sliding, with the pill sliding to the active tab and no tween on first paint; when it does not fit, or outside the desktop, it stays at the top of the page.
- Once a widget declares a default data source in widget.json, existing cards on a board that have none are bound to it when the board loads, without re-adding them.
- The session tools now work across all boards: widget_board lists every board and reads a chosen one, widget_place can add a card to a chosen board, and widget_push and widget_remove find the card by its workspace-wide instance id without switching the selected board first.
- The board page mounts only the active board's cards: switching tabs unmounts the old cards and mounts the new ones, so iframe, timer, and animation costs stay within one board. Components initialize again when switched back, with UI state and data restored from the host.
- Provider service types now have a type-only entry (`dsh-widget-board/service`): import types with `import type`, call through the service at runtime, read the version from `service.apiVersion`, and never add `dsh.client.external` to get around the rule. The client artifact depends only on the platform seeds, and the build checks it; a duplicate native widget id is refused with the first registration kept, and a handle's data sources and actions must carry the handle's provider. Disabling or unloading a provider withdraws its widgets, data sources, actions and leftover grants, leaves its cards in place as unavailable, and restores them when it returns.
- Built-in widget visuals are unified. Title areas no longer carry English eyebrows or numbers, and the top-right counts follow the interface language. Pomodoro and weather return to the monochrome base with the accent reserved for progress, the current item and the primary button; saturated color stays on the image, holographic and magnetic cards, each with a dark-scheme value derived from the board background, while the flip card uses the token pair on its two faces. Stat, gauge, clock, flip card, table, the todo empty state and balance scale their readouts by height tier. The chart gains an area fill, tick values and an end dot. Each weather forecast day shows its temperature, and "today" follows the forecast location's date, dropping past days from a cached response. The board hero art becomes a miniature board. The key-value and Markdown samples are shorter, scroll areas snap to row starts and the Markdown card's minimum height is raised to 18rem so its default content fits. The balance card shows "Sign in to see your balance" when no account is signed in and uses the error color only when the call fails. Clock, diff, gauge and heatmap get default boxes sized to their content, with diff and heatmap two columns wide by default.

### Bug Fixes

- The package now builds itself when installed from the repository: `prepare` runs the build, so the installed copy carries `lib/host/index.js` and no longer fails to activate without its host half; lint requires `scripts.prepare` whenever a published entry points into `lib/`.
- The tab strip at the top of the board page no longer collapses under tall content: it keeps its height and the pill stays on the active tab, so labels no longer sit outside the strip with the pill below them.
- The first data read when a card is added now goes through grants too: a gated source is not read before a person allows it on the card, the add request answers 403, and the card stays on the board. If the request itself fails, the add still succeeds with empty data and the reason goes to the log.
- The Board section in settings draws in full again: it no longer shares a style class with the settings button in a card's corner, whose absolute positioning and 20px box used to apply to the settings panel too and squeeze the section into a dot.
- The library panel now closes as soon as a card is added instead of waiting for the host to finish, so a slow data source cannot close the panel the user reopened in the meantime.

### Chores

- Adds a size-matrix check (npm run matrix, wired into npm run verify): every built-in widget is checked in representative board boxes and the thumbnail view for horizontal overflow, an empty surface, clipped visible controls and console errors.
- Adds `node scripts/worktree.mjs remove <path>`: a scratch worktree under `.debug/` that borrows the main tree's `node_modules` has its top-level links unlinked before git is handed the directory, so Windows no longer deletes the directories those links name; `scripts/lint.mjs` allows the worktree removal command in that one place only, with a regression test in `packages/testing/`.

## [0.1.0] - 2026-10-17

[中文](#cn-0.1.0) | [English](#en-0.1.0)

<h3 id="cn-0.1.0">新增功能</h3>

- 侧栏多一个「看板」入口，中栏打开一页空看板。
- 第一张卡片：天气卡。天空、图标、温度与天气文字随预报日一起过渡，尺寸族在窄窗口里降级，系统要求减弱动效时天空静置。
- 组件热重载：宿主监视 `lib/`，组件或运行时一改就重读，在线页面按新哈希把卡片重挂，不用刷新。
- 番茄钟卡片：选一段专注时长开始倒计时，剩余分钟、进度刻度与按钮文字跟着走。
- 待办卡片：一张卡片上的清单，回车加一条、勾掉做完的，进度条跟着走；条目存在宿主上，切走再切回、页面重载之后都还在。
- 三个通用卡片动效模板：翻转卡、磁吸卡、全息卡；套件提供动效与指针行为，组件只填 props 里的文案。
- 八个通用数据组件：数字、列表、表格、图表、进度、键值、时间线与图片；内容由 data 填、标题由 props 改，共用 .t-data 骨架。
- 翻面组原型：正反各一张普通卡片，共用一个卡片盒子，鼠标移上去翻面；固定为数字与图表，从组件库加入，整组移除。
- Markdown 与代码卡：GFM 排版、表格、引用与按语言高亮的代码块；新增精选库 marked 与 highlight，随插件内联进组件文档，不联网。
- 组件库有了三个来源：包内的内置组件、`$DSH_HOME/widget-board/widgets/` 里的用户组件，以及插件经 `widgetBoard` 服务注册的目录。版本按内容哈希留在磁盘上，跨重启可用；某个组件坏掉只让它自己不可用，看板里的卡片显示原因与移除入口。
- 看板题头多了一个添加组件的按钮：从组件库按来源分组挑一个，卡片出现在最矮的一列底部；卡片的右上角可以把它移除。
- 组件的按钮有了去处：`window.widget.action` 发出的动作由宿主交给注册的动作执行，只有 manifest 里声明过的动作才会被接受。插件可以经 `widgetBoard.registerAction` 提供动作。
- 插件可以把组件画在页面里：浏览器侧的 `widgetBoard.registerWidgetType` 登记一个 React 组件，与组件库里同 id 的组件对上之后，卡片改用这个组件渲染，参数与 `window.widget` 同形，抛错只废掉那一张卡。组件还可以在 manifest 里声明默认的数据源，加卡片时按它取第一次数据。仓库带了一个提供方 fixture，冒烟装上它走一遍注册、显示与移除。
- 看板下方出现居中的菜单：添加组件打开悬浮的组件库，按住一行拖到看板可指定落点；整理把卡片按阅读顺序密排；刷新让宿主重读组件库并重挂卡片。

### 体验优化

- 新增的内置组件自动出现在已有的看板上：加入卡片的面板做出来之前，这是看到新组件的唯一路径。
- 卡片内部的控件不再跟随宿主的强调色：切换栏药丸、选中文字、主按钮与焦点框改用卡片画面自己的墨色。
- 卡片的握手不再随每次快照刷新重建：props、data、state 的更新走各自的消息。切回看板时先用上一份快照画出内容，再取最新的。
- 卡片的界面状态存在宿主上：番茄钟切走再切回、页面重载之后接着计时，天气卡记得选中的是哪一个预报日。组件的 `setState` 现在有地方落，重挂之后经 `init` 拿回来。
- 看板改成卡片盒子：卡片可以拖动位置、缩放宽高，组件按卡片给的盒子重新排版；布局存在宿主上，刷新与别的窗口都跟着走。
- 番茄钟显示到秒：剩余时间按 `mm:ss` 走，换数字时把数字分成上下两半翻页——变大翻页上去，变小翻页下来。翻页做成了套件的原语（`.t-flip`），转动的半页画组件自己的底色，翻转过程中看不出多出一块。
- 看板换了外观：左侧题头、右侧点阵与字模图案，卡片右下角的蓝色手柄在拖动时显示实时尺寸。
- 拖动时卡片跟着指针走，松手后的落点用虚影标在格子里；缩放时卡片跟着右下角走，尺寸读数显示当前大小。
- 看板下方菜单改成参考 gooey-plus-menu 的扇面：加号化开成三个图标动作，底色、桥接与投影由同一张 SVG goo 滤镜画出，展开按 40ms 错峰，收起时整块下沉 5px 再回弹。
- 原来的固定题头改成组件库里的看板题头卡，可以拖动、缩放、移除；旧看板升级时补一次这张卡，添加按钮只留在下方菜单。
- 卡片状态与数据的写入不再让每个开着的页面重取整份看板：宿主推的是这张卡改了什么，页面就地合并。布局提交同理。
- 切换浅色深色、换皮肤或改系统动画偏好时，卡片里的组件当场跟着变，不再等重新加载；组件的文案与文档的 `lang` 也跟着宿主的界面语言走。

### 问题修复

- 看板快照读不出来：插件路由改到 `/api/widget-board`，浏览器半边改用文档相对地址。桌面外壳的页面来源是自定义协议，只有 `/api/*` 会被转给宿主。
- 深色下卡片四角露出白色：iframe 的文档画布在卡片圆角之外是白的，而 `border-radius` 裁不动 iframe 的内容。外壳改用 `clip-path` 按圆角令牌裁剪，卡片的边框与投影也由外壳画，组件只管自己的画面。
- 热重载之后页面里指向旧哈希的帧不再变成 404：宿主留着一个组件出现过的若干版本，按哈希取文档。
- 偶发加载不出内容：构建重写 `lib/` 的瞬间，宿主可能读到空的运行时并把没有运行时的文档发给卡片。构建改成先写临时文件再改名，宿主拒收空资产并沿用上一份；卡片六秒收不到任何消息就在卡片上说明没接上。
- 卡片外圈那道一像素的浅色描边去掉了：卡片的边由它自己的画面收口，外壳只留投影。
- 新组件不用重启宿主也能出现在看板上：热重载读到组件库里的新组件时，看板给它补一张卡。之前只在启动时补，改组件看得见、加组件得重启一次。
- 翻面与磁吸卡片的 iframe 不再露白：画布先铺一层宿主底色和点阵，翻面时卡片两侧与组件留白都跟着主题走。

<h3 id="en-0.1.0">New Features</h3>

- A Board entry in the sidebar, opening an empty board page in the centre column.
- The first card: weather. Sky, icon, temperature and condition transition together as the forecast day changes; the size family degrades in a narrow window, and the sky stands still when the system asks for reduced motion.
- Widget hot reload: the host watches `lib/`, re-reads the library when a widget or the runtime changes, and open pages remount their cards on the new hash without a refresh.
- Pomodoro card: pick a focus length and start; the remaining minutes, the progress ticks and the button label follow the session.
- To-do card: a list on a card — press Enter to add, tick what is done, and the progress bar follows; items live on the host, so they survive a panel switch or a page reload.
- Three reusable card templates: flip, magnetic and holographic; the runtime suite owns the motion and pointer behaviour, and props own the copy.
- Eight generic data widgets: stat, list, table, chart, progress, key-value, timeline and image; data fills the content, props change the headings, and all share the .t-data skeleton.
- Flip group prototype: two ordinary cards, one per side, sharing one card box and flipping on hover; fixed to stat and chart, added from the library and removed as a group.
- Markdown and code card: GFM typesetting, tables, quotes and language-highlighted code blocks; adds the curated marked and highlight libraries, inlined into widget documents and kept offline.
- The widget library reads three sources: the built-in widgets in the package, the reader's own under `$DSH_HOME/widget-board/widgets/`, and directories that plugins register through the `widgetBoard` service. Versions are kept on disk by content hash across restarts, and one broken widget only takes itself out — its cards show the reason and a way to remove them.
- The board header has an add-widget button: pick from the library, grouped by source, and the card lands at the bottom of the shortest column. A card's top-right corner removes it.
- A widget's buttons have somewhere to go: an action sent through `window.widget.action` runs the registered action on the host, and only actions declared in the manifest are accepted. Plugins can provide actions through `widgetBoard.registerAction`.
- Plugins can draw a widget in the page: the browser-side `widgetBoard.registerWidgetType` registers a React component, and once it matches a library widget by id the card renders it with the same parameters as `window.widget`, while a throw only breaks that one card. A widget can also name a default data source in its manifest, read when the card is added. The repository ships a provider fixture that the smoke installs, renders and removes.
- A centred menu now sits at the bottom of the board: Add opens a floating library whose rows can be dragged onto a chosen column, Tidy compacts all cards in reading order, and Refresh re-reads the library and remounts the cards.

### Improvements

- New built-in widgets appear on an existing board by themselves until the add-card panel exists.
- Controls inside a card no longer take the host's accent colour: the switcher pill, the selected label, the primary button and the focus rings use the card's own ink.
- A card's handshake is no longer rebuilt on every snapshot refresh — prop, data and state updates travel on their own messages. Returning to the board draws the last snapshot first, then refreshes it.
- A card's interface state lives on the host now: the pomodoro keeps counting across a panel switch or a page reload, and the weather card remembers which forecast day was open. Widget `setState` has somewhere to land and comes back through `init` after a remount.
- The board is a grid of card boxes now: drag a card to move it, resize it from the corner, and the widget lays itself out inside the box. Layouts live on the host and survive reloads and other windows.
- The pomodoro shows seconds now: the remaining time counts down as mm:ss and each digit turns over in halves — up when it grows, down when it shrinks. The flip is a suite primitive (`.t-flip`) whose page paints the widget's own background, so a turning half does not show a slab.
- The board has a new look: an editorial masthead with a dot grid and a character field, and a blue corner handle that shows a card's live size while it is being resized.
- A dragged card follows the pointer while a ghost marks the grid cell it will land in; resizing follows the bottom-right corner and the size readout tracks the current size.
- The bottom menu now follows the gooey-plus-menu fan: the plus splits into three icon actions whose fill, bridges and shadow come from one SVG goo filter, with a 40 ms stagger on open and a 5 px dip before the close settles.
- The fixed masthead is now a Board hero card in the widget library that can be dragged, resized and removed; older boards receive the card once on upgrade, and Add lives only in the bottom menu.
- A card state or data write no longer makes every open page refetch the whole board: the host pushes what changed on that card and the page merges it in place. Layout commits work the same way.
- Switching light and dark, changing skin or the system motion preference updates the components in place instead of waiting for a reload, and the widget document's `lang` follows the host's interface language.

### Bug Fixes

- The board snapshot failed to load: the plugin's routes moved under `/api/widget-board` and the browser half now uses document-relative addresses. The desktop shell serves the page from a custom protocol and only forwards `/api/*` to the host.
- Card corners showed white in dark mode: the iframe document canvas is white outside the card's rounded corner, and border-radius does not clip iframe content. The page clips each card with clip-path to the shared corner-radius token, and draws the card border and shadow itself.
- A frame still pointing at the previous hash no longer 404s after a reload: the host keeps the versions a widget has appeared as and serves documents by hash.
- Intermittent empty cards: while a build rewrote `lib/` the host could read an empty runtime and serve documents without it. The build now writes each artifact to a temporary file and renames it, the host refuses empty assets and keeps the previous ones, and a card that hears nothing for six seconds says so on the card.
- The one-pixel light outline around each card is gone: a card's edge is its own artwork now, and the page only draws the shadow.
- A new widget reaches the board without restarting the host: when a hot reload finds a widget the board has no card for, one is added. Before, that only happened at startup, so editing a widget showed up but adding one needed a restart.
- Flipping and magnetic cards no longer show a white iframe backdrop: the document canvas now paints the host background and dot grid, so the sides of a flipping card and any empty space follow the theme.

