# D7. 组件格式与内容寻址版本

## 背景

新增组件要容易、门槛低：用户在会话里描述想要的组件，agent 当场写出来。LLM 最熟悉的形态是 HTML、CSS、JS 三份文件，参考链接的组件正是这种形态：动效原语用类名声明，时长从根节点的 CSS 变量读。组件会被修改、分享、导入，而会话记录里内联显示过的组件要在以后重新打开时照样画出来。

## 决定

- 一个组件一个目录，内置、用户、agent 生成、导入的组件全部是这一种格式：

  ```
  <id>/
    widget.json    id、名字与描述（中英）、作者、semver、支持的尺寸族与降级顺序、
                   props 与 data 的 JSON Schema、actions、权限（网络主机、命令）、刷新策略、所需的库、文案
    index.html     标记片段
    style.css
    main.js        可选
    samples.json   每个尺寸族的样例 props 与 data
    assets/        可选，图片与字体
  ```

- `widget.json` 按 `contracts` 里的 JSON Schema 校验，校验用 Ajv。manifest 不合格的组件不进入组件库，错误原样返回给作者。
- 运行时接口 `window.widget`：`props`、`data`、`onData`、`state`、`setState`、`size`、`onResize`、`action`、`t`、`fit`、`reportError`。
- CSS 套件提供令牌、动效原语（数字滚动、文字变形、图标切换、骨架闪烁、列表重排）与基础件（`.w-chip`、`.w-meter`、`.w-fit`）。组件用套件即可做出一致的外观与动效（D10）。
- 精选库架子：组件在 manifest 里写 `libs`，从插件随包发布、按哈希提供的库里取用（首批 `marked`、`uplot`），不联网。加一个库就是加一个目录加它的许可。
- 内置一批「数据即组件」的通用组件：`stat`、`list`、`table`、`chart`、`markdown`、`progress`、`kv`、`timeline`、`image`。agent 只推数据不写代码就能出一张卡。
- 版本是内容哈希：对排序后的「路径加内容」计算，与打包方式无关；manifest 的 semver 只用于显示。每个出现过的版本存进 `blobs/<hash>.dshw`，当前版本的可编辑副本在 `widgets/<id>/`。
- 用户与 agent 的组件存在 `$DSH_HOME/widget-board/widgets/<id>/`，宿主监视目录，改动后校验并热重载。
- 实例默认跟随组件的当前版本，也可以固定到某个哈希。会话里内联显示的组件总是按工具结果里记录的哈希重画。
- 组件的 props 不符合新版本的 schema 时，卡片显示「需要更新」与具体的校验错误，并提供交给 agent 修复的入口。

## 后果

- 内置组件不享有用户组件拿不到的能力，内置组件就是编写格式的示例与回归样本。
- blob 会一直累积；删除组件不删 blob，因为会话记录可能还引用它，清理要显式触发（D8）。
- 编写格式是公开契约，改动它要给出旧组件的迁移。

## 重审条件

- 大量组件需要同一类框架能力（例如响应式状态）时，考虑把它加进运行时，或加进精选库。
