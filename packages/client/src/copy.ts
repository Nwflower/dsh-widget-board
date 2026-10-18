/**
 * 浏览器半边的界面文案（D14）：两套语言在一处写全，调用处只写键。
 *
 * 语言取自宿主页面的 `lang`；宿主没有给时按 `navigator.language` 判断。文案随插件一起发布，
 * 不需要等任何请求到达。
 */

/** 一条文案的两种说法。 */
interface Pair {
  zh: string
  en: string
}

/** 插件自己的全部界面文案。 */
const COPY = {
  loading: { zh: '正在读看板…', en: 'Reading the board…' },
  empty: { zh: '看板还没有卡片，从下方菜单添加一个组件', en: 'No cards yet — add a widget from the menu below' },
  move: { zh: '拖动卡片', en: 'Move card' },
  resize: { zh: '调整卡片大小', en: 'Resize card' },
  resizeHint: { zh: '拖右下角 · 高度按档', en: 'Drag corner · height steps' },
  moveHint: { zh: '拖动卡片', en: 'Move card' },
  remove: { zh: '移除卡片', en: 'Remove card' },
  add: { zh: '添加组件', en: 'Add widget' },
  menu: { zh: '菜单', en: 'Menu' },
  closeMenu: { zh: '关闭菜单', en: 'Close menu' },
  tidy: { zh: '整理', en: 'Tidy' },
  refresh: { zh: '刷新', en: 'Refresh' },
  refreshing: { zh: '刷新中…', en: 'Refreshing…' },
  libraryHint: { zh: '按住组件拖到看板，或轻点加在末尾', en: 'Drag a widget onto the board, or tap to add at the end' },
  dropHint: { zh: '拖到看板', en: 'Drop on the board' },
  flipHint: { zh: '移上去翻面', en: 'Hover to flip' },
  close: { zh: '关闭', en: 'Close' },
  library: { zh: '组件库', en: 'Widget library' },
  libraryEmpty: { zh: '组件库是空的', en: 'The library is empty' },
  builtin: { zh: '内置', en: 'Built-in' },
  user: { zh: '我的', en: 'Mine' },
  plugin: { zh: '插件', en: 'Plugins' },
  unavailable: { zh: '这个组件不可用', en: 'This widget is unavailable' },
  noAnswer: { zh: '组件没有应答，切回看板重新加载这一张', en: 'The widget did not answer; reopen the board to reload it' },
  saveFailed: { zh: '存不下这张卡的状态', en: 'Could not save this card' },
  layoutFailed: { zh: '存不下卡片布局', en: 'Could not save the card layout' },
  allow: { zh: '允许', en: 'Allow' },
  export: { zh: '导出', en: 'Export' },
  import: { zh: '导入', en: 'Import' },
  unread: { zh: '条未读通知', en: 'unread notifications' },
} satisfies Record<string, Pair>

/** 一条文案的键。 */
export type CopyKey = keyof typeof COPY

/** 宿主界面的语言是不是中文。 */
export function isChinese(): boolean {
  const lang = document.documentElement.lang || navigator.language || 'zh-CN'
  return lang.toLowerCase().startsWith('zh')
}

/** 当前的界面语言，按宿主页面的语言取。 */
export function activeLang(): string {
  return document.documentElement.lang || navigator.language || 'zh-CN'
}

/**
 * 取一条文案。
 *
 * @param key - 文案的键。
 * @returns 当前语言下的说法。
 */
export function t(key: CopyKey): string {
  return COPY[key][isChinese() ? 'zh' : 'en']
}
