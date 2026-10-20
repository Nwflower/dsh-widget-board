/**
 * 虚拟 skill `widget-authoring` 的正文（D9）。
 *
 * 模型加载这条 skill 之后要能直接写出一个合格的组件：目录格式、manifest 的字段、运行时接口、盒子
 * 契约、套件里的类与令牌，以及几个容易踩空的地方。正文按 D7、D10、D16、D20 写，是这几条决定的
 * 面向作者的投影；决定本身不在这里改。
 */

/** 编写指南的正文。 */
export const WIDGET_AUTHORING_GUIDE = `# 写一个看板组件

看板上每张卡片是一个沙箱里的小组件：一个目录，三份文件。宿主按内容哈希给版本，改动之后自动重载。

## 目录

\`\`\`
<id>/
  widget.json    必需
  index.html     必需，标记片段（不是整页）
  style.css      必需
  main.js        可选，组件的行为
  samples.json   可选，每个尺寸族的样例 props 与 data
  assets/        可选，图片与字体
\`\`\`

\`<id>\` 要匹配 \`^[a-z][a-z0-9-]{1,39}$\`。用户与 agent 写的组件放在 \`$DSH_HOME/widget-board/widgets/<id>/\`。

## widget.json

\`\`\`json
{
  "id": "my-widget",
  "title": { "zh": "我的组件", "en": "My widget" },
  "description": { "zh": "一句话", "en": "One line" },
  "author": "agent",
  "version": "0.1.0",
  "sizes": ["s", "m"],
  "props": { "type": "object", "properties": { "label": { "type": "string" } } },
  "data": { "type": "object", "required": ["n"], "properties": { "n": { "type": "number" } } },
  "source": "plugin-name:source-id",
  "credentials": [{ "ref": "DEEPSEEK_API_KEY", "label": { "zh": "DeepSeek 密钥", "en": "DeepSeek key" }, "required": true }],
  "capabilities": ["plugin-name:some-capability"],
  "actions": [{ "id": "plugin-name:action-id", "label": { "zh": "跑", "en": "Run" } }],
  "libs": ["marked"],
  "text": {
    "hint": { "zh": "提示", "en": "Hint" },
    "props.title.label": { "zh": "标题", "en": "Title" },
    "props.title.hint": { "zh": "显示在卡片上", "en": "Shown on the card" }
  },
  "minBox": { "w": 1, "h": 10 },
  "defaultBox": { "w": 1, "h": 22 }
}
\`\`\`

- \`sizes\`：\`s\`、\`m\`、\`l\`、\`wide\`、\`xl\`、\`hero\`、\`expanded\`、\`inline\`、\`rail\`。看板这一处只用到位置与盒子，尺寸族给会话内联与右侧栏用。
- \`props\` 与 \`data\` 是 JSON Schema。\`data\` 用来校验数据源读回来的数据，不合格的不会写进卡片。
- \`source\` 是默认数据源的名字；要别人装的插件提供，写 \`提供方:名字\`。
- \`credentials\` 声明组件要用的凭据：\`ref\` 是环境变量名，\`label\` 与 \`description\` 显示在设置弹窗里。**密钥只放这里，不写进 props 或 state**；值由宿主的凭据服务保存，组件读不到它。
- \`source\` 写 \`"http"\` 时，再用 \`request.url\` 给出宿主代发的地址。URL 里的 \`{名字}\` 在每次读取时换成卡片 props 里的同名值，没有时换成 props schema 给这个属性写的 \`default\`；主机必须列在 \`permissions.hosts\` 里。返回的 JSON 原样作为 \`data\` 交给组件，解析与映射由组件自己的脚本做。\`request.cacheMs\` 可选：给了就让宿主按这个毫秒数缓存同一个地址的响应。
- \`actions\` 里写插件动作的全名。**没有声明的动作一律被拒绝**；要权限的动作还要有人在卡片上给出授权之后才跑得起来。
- \`capabilities\` 里写宿主能力的全名（例如 \`dsh.account.balance\`）。**没有声明的调用一律被拒绝**；能力的参数与返回值按提供方声明的 JSON Schema 校验，要权限的能力同样先要一份授权。读当前登录的 DSH 账号余额就用 \`dsh.account.balance\`，不需要 API key；读某个 GitHub 账号创建的 issue 用 \`github.issues\`，它按卡片上配的 \`GITHUB_TOKEN\` 认账号。
- 设置弹窗按 \`props\` schema 生成表单。字段标签与提示写进 \`text\` 的 \`props.<字段>.label\` 与 \`props.<字段>.hint\`；字符串、数字、布尔与字符串枚举直接出控件，对象、数组与其他写法用 JSON 编辑。
- \`libs\`：\`marked\`、\`highlight\` 由宿主内联进这份文档，组件里直接用全局名。
- \`scripts\`：组件目录里的额外脚本，按顺序在 \`main.js\` 之前内联，与它共用同一个全局作用域。一份 \`main.js\` 写到太长时用它按职责拆开，例如把绘图与交互分开。
- \`minBox\` 是这张卡缩到多小还排得下；低于它的缩放会被停在下限。
- \`defaultBox\` 是加卡片时的默认盒子，按内容量给：图表、表格与 Markdown 用两列，数字、翻转、磁吸用一列偏矮。省略时是一列宽、22rem 高。

## 运行时：window.widget

\`\`\`js
widget.props            // manifest 的 props 实例值，只读快照
widget.onProps(fn)      // props 变了
widget.data             // 数据源读回来的数据
widget.onData(fn)
widget.state            // 宿主上存下来的界面状态，切走再回来还在
widget.setState(patch)  // 合并一份状态进宿主；对象只合并一层
widget.onState(fn)
widget.size             // { w, h, family, placement, cols }
widget.onSize(fn)
widget.paused           // 卡片被暂停了：离开视口
widget.onPause(fn)      // 暂停状态变了；计时器与逐帧绘制在这里停下与恢复
widget.action(id, payload)   // 发出 manifest 里声明过的动作
widget.call(capability, args) // 调用 manifest 里声明过的宿主能力，返回 Promise
widget.open(url)        // 请宿主在新标签页打开一个网页（http 或 https）
widget.t(key)           // manifest 的 text 里的一条文案，按当前语言
widget.fit()            // 把内容高度报给宿主（内联显示时用）
widget.reportError(err) // 把失败原因写在这张卡上
\`\`\`

组件在 iframe 里跑，拿不到网络、cookie 与父页面。要数据就声明数据源（要网上的数据用 \`"http"\`，见上面 \`request.url\`），要动手就声明动作，需要参数、返回值或取消就声明能力并调 \`widget.call\`；能力的失败原因会原样回给组件。

组件自己不能导航：链接用 \`widget.open(url)\` 交给包着它的页面去开，而且必须写在点击处理里——浏览器只认跟在用户操作后面的那一次打开。地址限 \`http\` 与 \`https\`，其余一律不开。

\`setState\` 由父页面合并：同一个 250 毫秒窗口里的几条补丁合成一次提交，暂停、页面隐藏与卸载时立即提交。状态有额度（一张卡 64KB，一块看板 1MB），超出的写入会被拒绝并在卡片上显示原因；不要拿它存动画帧或大块数据。

## 盒子契约

卡片的盒子由用户拖动与缩放给出，组件按盒子排版：

- 根节点上有 \`data-box-width\`：\`narrow\`（<320px）、\`regular\`、\`wide\`（≥600px）。
- 根节点上有 \`data-box-height\`：\`short\`（<260px）、\`regular\`、\`tall\`（≥360px）。
- 还有 \`data-placement\`（\`board\`、\`inline\`、\`rail\`、\`expanded\` 或 \`preview\`）与 \`data-size\`。
- 内联显示（会话里的 \`widget_show\`）按内容给高度：用 \`widget.fit()\` 把内容高度报上去，回答里就占那么高；看板上的卡片高度由用户给，这条消息不参与。

矮盒子里收掉次要信息，窄盒子里换排版。用套件里的 \`.w-hide-short\`、\`.w-hide-narrow\` 更省事。

## 样式

只用令牌，不写字面值：\`var(--w-space-md)\`、\`var(--w-type-title)\`、\`var(--w-radius-card)\`、\`var(--w-color-fg)\`、\`var(--w-motion-base)\` 等。宿主令牌（\`--dsw-*\`）由外壳解析成字面值推进来，也可以直接用。

数据卡共用 \`.t-data\` 的标题区：\`.t-data__title\` 写标题；\`.t-data__kicker\` 与 \`.t-data__meta\` 只在有事实可写时出现（范围、来源、条数、最新值），空着就自己隐藏。不要用编号或装饰性全大写标签，微标签最小 12px，数字用 \`tabular-nums\`。

状态色读套件的 \`--w-tone-ok\`、\`--w-tone-warn\`、\`--w-tone-danger\`、\`--w-tone-idle\`，不要自己写颜色。状态不能只靠颜色表达：再放一个 \`.w-sr\` 的读屏文字。

套件提供布局原语：\`.w-frame\`（居中的最大内容宽度）、\`.w-actions\`（等宽操作行）、\`.w-scroll\`（纵向滚动区）、\`.w-chip\`、\`.w-meter\`、\`.w-fit\`。

## 容易踩空的地方

- 内容不能撑高卡片：卡片的高度是用户定的。超出时自己滚动或收掉次要信息。
- 组件文档只允许 \`index.html\`、\`style.css\`、\`main.js\` 三份文件；图片与字体写 \`{{asset:相对路径}}\`，宿主把它换成 \`data:\` 地址。
- 消息有长度与频率上限：状态补丁要小，不要每秒发很多条；\`setState\` 本身会被合并，但状态总量有额度。
- 沙箱里没有 \`fetch\`、没有 \`localStorage\`；状态用 \`widget.setState\`。
- 密钥放 \`credentials\`，不放 \`props\` 或 \`state\`：后两者会进看板文件、导出包与工具结果，也不会出现在设置弹窗的密码框里。
- 组件的**内容哈希**就是版本：改一个字符，之前给的授权与固定版本都不再匹配。
`
