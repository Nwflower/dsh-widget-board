/**
 * 浏览器半边的界面文案（D14）：两套语言在一处写全，调用处只写键。
 *
 * 语言取自宿主页面的 `lang`；宿主没有给时按 `navigator.language` 判断。文案随插件一起发布，
 * 不需要等任何请求到达。
 */
import type { LocalizedText, WidgetSource } from '@dsh-widget-board/contracts'

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
  flipBack: { zh: '翻到背面', en: 'Show the back' },
  flipFront: { zh: '翻回正面', en: 'Show the front' },
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
  boardTabs: { zh: '看板标签', en: 'Board tabs' },
  newBoard: { zh: '新建看板', en: 'New board' },
  boards: { zh: '看板列表', en: 'Board list' },
  boardListLoading: { zh: '正在读看板列表…', en: 'Reading the boards…' },
  boardCards: { zh: '张卡片', en: 'cards' },
  boardName: { zh: '看板名称', en: 'Board name' },
  selectBoard: { zh: '选中这块看板', en: 'Select this board' },
  rename: { zh: '改名', en: 'Rename' },
  renameConfirm: { zh: '确定', en: 'Save' },
  renameCancel: { zh: '取消', en: 'Cancel' },
  removeBoard: { zh: '移除看板', en: 'Remove board' },
  settings: { zh: '设置', en: 'Settings' },
  cardSettings: { zh: '卡片设置', en: 'Card settings' },
  groupSettings: { zh: '组件组', en: 'Widget group' },
  componentSettings: { zh: '组件设置', en: 'Widget settings' },
  credentials: { zh: '凭据', en: 'Credentials' },
  dataAndPermissions: { zh: '数据与权限', en: 'Data & permissions' },
  about: { zh: '关于', en: 'About' },
  done: { zh: '完成', en: 'Done' },
  save: { zh: '保存', en: 'Save' },
  saved: { zh: '已保存', en: 'Saved' },
  cancel: { zh: '取消', en: 'Cancel' },
  reset: { zh: '恢复默认', en: 'Reset' },
  noProps: { zh: '这个组件没有声明可配置的 props', en: 'This widget declares no configurable props' },
  noCredentials: { zh: '这个组件没有声明凭据', en: 'This widget declares no credentials' },
  noSource: { zh: '这张卡没有绑定数据源', en: 'This card has no data source' },
  credentialConfigured: { zh: '已配置', en: 'Configured' },
  credentialMissing: { zh: '未配置', en: 'Not configured' },
  credentialEnv: { zh: '由启动环境提供，不能在这里修改', en: 'Provided by the launch environment; read-only' },
  credentialFile: { zh: '保存在凭据文件里', en: 'Stored in the credential file' },
  credentialSave: { zh: '保存密钥', en: 'Save key' },
  credentialRemove: { zh: '移除', en: 'Remove' },
  credentialRemoveConfirm: { zh: '确认移除', en: 'Confirm removal' },
  credentialRequired: { zh: '必需', en: 'Required' },
  credentialPlaceholder: { zh: '粘贴密钥', en: 'Paste the key' },
  credentialDotenv: { zh: '由 .env 提供，不能在这里修改', en: 'Provided by a .env file; read-only' },
  credentialNoService: { zh: '宿主没有凭据服务', en: 'The host has no credential service' },
  saving: { zh: '保存中…', en: 'Saving…' },
  refreshed: { zh: '已刷新', en: 'Refreshed' },
  credentialReadOnly: { zh: '只读', en: 'Read-only' },
  credentialPrivacy: {
    zh: '值由宿主保存，组件读不到它。',
    en: 'The host stores the value; the widget cannot read it.',
  },
  source: { zh: '数据源', en: 'Data source' },
  provider: { zh: '提供方', en: 'Provider' },
  permissionHosts: { zh: '主机', en: 'Hosts' },
  permissionCommands: { zh: '命令', en: 'Commands' },
  permissionNone: { zh: '不需要额外授权', en: 'No extra grant needed' },
  granted: { zh: '已授权', en: 'Granted' },
  notGranted: { zh: '未授权', en: 'Not granted' },
  revoke: { zh: '撤销', en: 'Revoke' },
  refreshNow: { zh: '立即刷新', en: 'Refresh now' },
  version: { zh: '版本', en: 'Version' },
  refreshPolicy: { zh: '刷新策略', en: 'Refresh policy' },
  onDemand: { zh: '按需', en: 'On demand' },
  interval: { zh: '定时', en: 'Interval' },
  widgetSource: { zh: '来源', en: 'Source' },
  groupSlots: { zh: '槽', en: 'Slots' },
  changeWidget: { zh: '更换组件', en: 'Change widget' },
  pickWidget: { zh: '选一个组件', en: 'Pick a widget' },
  pickHint: { zh: '选一个组件放进这个槽', en: 'Choose a widget for this slot' },
  back: { zh: '返回', en: 'Back' },
  current: { zh: '当前', en: 'Current' },
  slotFront: { zh: '正面', en: 'Front' },
  slotBack: { zh: '背面', en: 'Back' },
  replaceWarning: {
    zh: '更换会清空这个槽的 props、数据与状态，另一个槽不动。',
    en: 'Replacing clears this slot’s props, data and state; the other slot stays.',
  },
  replaceConfirm: { zh: '换掉', en: 'Replace' },
  minBoxWarning: { zh: '组卡会被抬到更大的最小盒子。', en: 'The group will grow to the larger minimum box.' },
  editorLoading: { zh: '正在读设置…', en: 'Reading settings…' },
  editorFailed: { zh: '设置读不出来', en: 'Settings could not be read' },
  editorInstanceMissing: { zh: '这张卡已经不在了', en: 'This card is gone' },
  editorGroupMissing: { zh: '这一组已经不在了', en: 'This group is gone' },
  propsJson: { zh: 'JSON', en: 'JSON' },
  propsForm: { zh: '表单', en: 'Form' },
  propsJsonInvalid: { zh: 'JSON 语法不对', en: 'Invalid JSON' },
  unsaved: { zh: '有未保存的修改，关闭会丢掉。', en: 'You have unsaved changes; closing will discard them.' },
  discard: { zh: '放弃修改', en: 'Discard' },
  keepEditing: { zh: '继续编辑', en: 'Keep editing' },
  groupWidgetMissing: { zh: '组件不在库里', en: 'Widget is missing' },
  // 会话里的工具视图（D9）。
  checkTitle: { zh: '自检', en: 'Self-check' },
  checkPassed: { zh: '排版正常', en: 'Layout fine' },
  checkFailed: { zh: '有问题', en: 'Problems' },
  checkUnverified: { zh: '没有页面接手自检', en: 'No page took the check' },
  checkWaiting: { zh: '等一个看得到这个会话的页面接手自检…', en: 'Waiting for a page showing this conversation…' },
  checkRunning: { zh: '正在量盒子…', en: 'Measuring boxes…' },
  checkFinished: { zh: '自检做完了', en: 'Self-check done' },
  defineName: { zh: '写组件', en: 'Define widget' },
  inlinePreparing: { zh: '组件正在准备…', en: 'Preparing the widget…' },
  inlineEmpty: { zh: '这次调用没有可显示的组件', en: 'This call has no widget to show' },
  inlineDetached: {
    zh: '这是一次性预览，动作没有去处；把它放上看板之后就能按。',
    en: 'This is a one-off preview, so actions have nowhere to go; place it on the board to use them.',
  },
} satisfies Record<string, Pair>

/** 一条文案的键。 */
export type CopyKey = keyof typeof COPY

/** 当前的界面语言：浏览器的文档语言优先，没有文档时按中文（单元测试与纯函数用）。 */
function currentLang(): string {
  const fromDocument = typeof document === 'undefined' ? '' : document.documentElement.lang
  const fromNavigator = typeof navigator === 'undefined' ? '' : navigator.language
  return fromDocument || fromNavigator || 'zh-CN'
}

/** 宿主界面的语言是不是中文。 */
export function isChinese(): boolean {
  return currentLang().toLowerCase().startsWith('zh')
}

/** 当前的界面语言，按宿主页面的语言取。 */
export function activeLang(): string {
  return currentLang()
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

/**
 * 一段双语文案按当前语言取一条。
 *
 * @param text - 双语文案。
 * @returns 当前语言下的那一条。
 */
export function textOf(text: LocalizedText): string {
  return isChinese() ? text.zh : text.en
}

/**
 * 组件来源的说法。
 *
 * @param source - 组件来源。
 * @returns 当前语言下的来源名。
 */
export function sourceLabel(source: WidgetSource): string {
  if (source === 'builtin') return t('builtin')
  if (source === 'user') return t('user')
  return t('plugin')
}
