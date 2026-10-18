# 变更记录

本文件由 `npm run changelog` 从 `docs/changes/` 里待发布的条目生成，勿手改。一次改动在
`docs/changes/` 下加一个 JSON 文件，发布时由 `npm run changelog -- --release <版本>` 收进它自己
的版本段。

## [Unreleased]

[中文](#cn-unreleased) | [English](#en-unreleased)

<h3 id="cn-unreleased">其他变更</h3>

- README 的状态一节写明 npm 上的版本。

<h3 id="en-unreleased">Chores</h3>

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

