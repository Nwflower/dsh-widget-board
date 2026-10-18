/**
 * 演示页自己的文案：中英两套写在这一处，调用处只写键（D25）。
 *
 * 看板里的文案属于插件（`packages/client/src/copy.ts` 与各组件的 manifest），按页面的 `lang` 取；
 * 这里只有看板外面的那些：标题、提示、录屏位、三个要点与安装。
 */

/** 页面语言。 */
export type Lang = 'zh' | 'en'

/** 一条文案的两种说法。 */
interface Pair {
  zh: string
  en: string
}

const COPY = {
  title: { zh: '组件看板 · DSH Widget Board', en: 'Widget Board · DSH' },
  description: {
    zh: 'DeepSeek Harness 的组件看板插件：可拖动、缩放、翻面的卡片看板，组件运行在沙箱里。这一页上的看板是插件真实的浏览器半边。',
    en: 'The widget board plugin for DeepSeek Harness: a board of cards you can drag, resize and flip, with every widget running in a sandbox. The board on this page is the plugin\'s real browser half.',
  },
  brand: { zh: '组件看板', en: 'Widget Board' },
  tagline: {
    zh: 'DeepSeek Harness 的组件看板插件。下面是它真实的看板，拖一拖试试。',
    en: 'The widget board plugin for DeepSeek Harness. The board below is the real thing; drag something.',
  },
  language: { zh: '语言', en: 'Language' },
  themeToLight: { zh: '切换到浅色', en: 'Switch to light' },
  themeToDark: { zh: '切换到深色', en: 'Switch to dark' },
  reset: { zh: '恢复默认看板', en: 'Reset the board' },
  resetting: { zh: '正在恢复…', en: 'Resetting…' },
  boardLabel: { zh: '组件看板', en: 'Widget board' },
  starting: { zh: '正在启动演示宿主…', en: 'Starting the demo host…' },
  startFailed: { zh: '演示宿主没有启动', en: 'The demo host did not start' },
  startFailedHint: {
    zh: '这个页面需要 Service Worker 与 IndexedDB。隐私窗口或禁用了站点数据的浏览器里它们可能不可用，换一个普通窗口再试。',
    en: 'This page needs a service worker and IndexedDB. They may be unavailable in private windows or when site data is blocked; try a regular window.',
  },
  boardHint: {
    zh: '拖卡片顶部的把手移动，拖右下角的手柄改变大小，鼠标移到翻面卡上翻转它。布局保存在这个浏览器里，刷新后还在。',
    en: 'Drag the handle at the top of a card to move it, drag the corner to resize, and hover a flip card to turn it. The layout is stored in this browser and survives a reload.',
  },
  boardNoteIntro: {
    zh: '这个演示页的宿主是只读的，没有数据源和宿主能力。需要它们的组件没有放进来：',
    en: 'The host on this page is read-only and has no data sources or host capabilities. Widgets that need them are left out: ',
  },
  boardNoteOutro: {
    zh: '。装上插件后它们在组件库里。',
    en: '. With the plugin installed they are in the library.',
  },
  recordingTitle: { zh: '在 DSH 里，从一句话到一张卡', en: 'Inside DSH, from one sentence to one card' },
  recordingLead: {
    zh: '60 到 90 秒的录屏：让 agent 写一个组件，看它出现在组件库、被拖上看板、改 props，再拔掉提供方插件，看卡片变成占位。',
    en: 'A 60 to 90 second recording: ask the agent for a widget, watch it land in the library, drag it onto the board, change its props, then unplug the provider and watch the card turn into a placeholder.',
  },
  recordingPlaceholder: { zh: '录屏即将放在这里', en: 'The recording will play here' },
  recordingMissing: {
    zh: '把视频放进 media/，在 index.html 的 demo-recording 里写它的相对路径（例如 media/demo.mp4）。',
    en: 'Put the video in media/ and set its relative path (for example media/demo.mp4) in the demo-recording tag of index.html.',
  },
  step1: { zh: '让 agent 写一个组件', en: 'Ask the agent for a widget' },
  step2: { zh: '它出现在组件库里', en: 'It shows up in the library' },
  step3: { zh: '拖上看板', en: 'Drag it onto the board' },
  step4: { zh: '改它的 props', en: 'Change its props' },
  step5: { zh: '拔掉提供方插件，卡片变成占位', en: 'Unplug the provider; the card becomes a placeholder' },
  pointsTitle: { zh: '三个设计要点', en: 'Three design points' },
  point1Title: { zh: '一个组件只有三份文件', en: 'A widget is three files' },
  point1Body: {
    zh: 'index.html、style.css 和 main.js，外加一份写明名字与尺寸的 widget.json。内置组件、用户写的组件和 agent 生成的组件是同一种格式，过同一份校验、同一个尺寸矩阵，所以 agent 写完文件，卡片就能出现在组件库里。',
    en: 'index.html, style.css and main.js, plus a widget.json that names it and sizes it. Built-in, hand-written and agent-written widgets share one format, one validation and one size matrix, so once the agent has written the files the card appears in the library.',
  },
  point2Title: { zh: '沙箱，加按内容哈希授权', en: 'A sandbox, plus grants by content hash' },
  point2Body: {
    zh: '每张卡片是一个 sandbox="allow-scripts" 的 iframe，文档带严格的 CSP，不能联网，只经 MessagePort 桥和宿主说话。权限绑在组件内容的哈希上：组件改一个字节，哈希就变，之前的授权随之失效，要人重新点一次允许。',
    en: 'Every card is an iframe with sandbox="allow-scripts" and a strict CSP: no network, and it talks to the host only over a MessagePort bridge. Permissions are bound to the hash of the widget\'s content, so changing one byte changes the hash and drops every earlier grant until a person allows it again.',
  },
  point3Title: { zh: '其他插件可以提供组件', en: 'Other plugins can provide widgets' },
  point3Body: {
    zh: '别的插件经 widgetBoard 服务注册组件目录、数据源和动作。宿主半边和浏览器半边各有一份服务，注册时带 apiVersion 做版本协商，对不上就拒绝并写明原因。提供方被拔掉时，它的卡片留在原位，显示占位说明。',
    en: 'Other plugins register widget directories, data sources and actions through the widgetBoard service. The host half and the browser half each publish one, and a registration carries an apiVersion for negotiation; a mismatch is refused with the reason. When a provider is unplugged its cards stay where they are and show a placeholder.',
  },
  installTitle: { zh: '安装', en: 'Install' },
  installLead: {
    zh: '在装有 DeepSeek Harness 的机器上安装：',
    en: 'On a machine with DeepSeek Harness:',
  },
  copy: { zh: '复制', en: 'Copy' },
  copied: { zh: '已复制', en: 'Copied' },
  repository: { zh: '源码仓库', en: 'Source repository' },
  package: { zh: 'npm 包', en: 'npm package' },
  license: { zh: 'MIT 许可', en: 'MIT licensed' },
  figure1: { zh: '三份文件组成一张卡片', en: 'Three files make one card' },
  figure2: { zh: '沙箱 iframe、消息桥与按哈希的授权', en: 'Sandboxed iframe, message bridge and hash-bound grant' },
  figure3: { zh: '提供方插件、服务版本协商与占位卡片', en: 'Provider plugin, service version negotiation and the placeholder card' },
  figFiles: { zh: '组件文件', en: 'Widget files' },
  figManifest: { zh: '写明名字与尺寸', en: 'names and sizes it' },
  figCard: { zh: '卡片', en: 'Card' },
  figHost: { zh: '宿主页面', en: 'Host page' },
  figFrame: { zh: '沙箱 iframe', en: 'Sandboxed iframe' },
  figBridge: { zh: 'MessagePort 桥', en: 'MessagePort bridge' },
  figNoNet: { zh: '没有网络', en: 'No network' },
  figGranted: { zh: '已授权', en: 'Granted' },
  figNeedsGrant: { zh: '要重新授权', en: 'Needs a new grant' },
  figEdit: { zh: '改一个字节', en: 'one byte changed' },
  figProvider: { zh: '提供方插件', en: 'Provider plugin' },
  figService: { zh: 'widgetBoard 服务', en: 'widgetBoard service' },
  figNegotiate: { zh: '版本协商', en: 'version check' },
  figBoard: { zh: '看板', en: 'Board' },
  figUnplugged: { zh: '提供方已移除', en: 'Provider removed' },
  figPlaceholder: { zh: '占位', en: 'Placeholder' },
} satisfies Record<string, Pair>

/** 一条文案的键。 */
export type CopyKey = keyof typeof COPY

/**
 * 取一条文案。
 *
 * @param key - 文案的键。
 * @param lang - 页面语言。
 * @returns 这个语言下的说法。
 */
export function text(key: CopyKey, lang: Lang): string {
  return COPY[key][lang]
}
