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
  boardMenuOpen: { zh: '更多操作', en: 'More actions' },
  boardMenuTitle: { zh: '管理这块看板', en: 'Manage this board' },
  renameBoardTitle: { zh: '给看板改名', en: 'Rename board' },
  removeBoardTitle: { zh: '删除这块看板', en: 'Delete board' },
  boardTitleEmpty: { zh: '看板名不能是空的', en: 'A board name cannot be empty' },
  boardTitleTooLong: { zh: '看板名最多 {n} 个字符', en: 'A board name can be at most {n} characters' },
  boardTitleCount: { zh: '字符', en: 'characters' },
  deleteBoardConfirm: { zh: '确认删除', en: 'Delete board' },
  deleteBoardBusy: { zh: '正在删除…', en: 'Deleting…' },
  deleteBoardLast: {
    zh: '这是最后一块看板，删掉之后会有一块新的空看板。',
    en: 'This is the last board; a fresh empty board takes its place.',
  },
  deleteBoardWarning: {
    zh: '这块看板上的卡片、它们保存的内容与布局一起删除，不能撤销。',
    en: 'The cards on this board, the content and the layout they saved are removed with it, and this cannot be undone.',
  },
  cellsCount: { zh: '{n} 格', en: '{n} cells' },
  cardsCount: { zh: '{n} 张卡片', en: '{n} cards' },
  settings: { zh: '设置', en: 'Settings' },
  cardSettings: { zh: '卡片设置', en: 'Card settings' },
  groupSettings: { zh: '组件组', en: 'Widget group' },
  config: { zh: '配置', en: 'Configuration' },
  log: { zh: '日志', en: 'Log' },
  noConfig: { zh: '这个组件没有可配置的项', en: 'This widget has nothing to configure' },
  locate: { zh: '定位', en: 'Locate' },
  locating: { zh: '定位中…', en: 'Locating…' },
  locateFailed: { zh: '拿不到当前位置，也问不到网络所在的城市', en: 'Could not get your location or the city of this network' },
  cityEmpty: { zh: '先写一个城市名', en: 'Enter a city name first' },
  cityLookupFailed: { zh: '城市查不到坐标', en: 'Could not resolve the city' },
  cityNotFound: { zh: '找不到这个城市，换一个名字试试', en: 'City not found; try another name' },
  cityHint: {
    zh: '输入中文名、英文名或拼音，从列表里挑一个；也可以直接按「定位」用当前位置。',
    en: 'Type a Chinese name, an English name or pinyin and pick one; or press Locate to use where you are.',
  },
  citySearching: { zh: '正在查…', en: 'Searching…' },
  cityNoMatch: { zh: '没有匹配的城市，换个写法试试', en: 'No matching city; try another spelling' },
  cityPicked: { zh: '已选', en: 'Selected' },
  cityChange: { zh: '换一座', en: 'Change' },
  noRequests: { zh: '这张卡还没有发出请求', en: 'This card has not made any requests yet' },
  requestLogHint: {
    zh: '只记方法、主机、状态与耗时；凭据不在里面。',
    en: 'Only the method, host, status and time are recorded; credentials are not.',
  },
  requestFailed: { zh: '失败', en: 'Failed' },
  dataAndPermissions: { zh: '数据与权限', en: 'Data & permissions' },
  about: { zh: '关于', en: 'About' },
  done: { zh: '完成', en: 'Done' },
  save: { zh: '保存', en: 'Save' },
  saved: { zh: '已保存', en: 'Saved' },
  cancel: { zh: '取消', en: 'Cancel' },
  noSource: { zh: '这张卡没有绑定数据源', en: 'This card has no data source' },
  credentialConfigured: { zh: '已配置', en: 'Configured' },
  credentialMissing: { zh: '未配置', en: 'Not configured' },
  credentialEnv: { zh: '由启动环境提供，不能在这里修改', en: 'Provided by the launch environment; read-only' },
  credentialFile: { zh: '保存在凭据文件里', en: 'Stored in the credential file' },
  credentialRemove: { zh: '移除', en: 'Remove' },
  credentialRemoveConfirm: { zh: '确认移除', en: 'Confirm removal' },
  credentialRequired: { zh: '必需', en: 'Required' },
  credentialPlaceholder: { zh: '粘贴密钥', en: 'Paste the key' },
  credentialDotenv: { zh: '由 .env 提供，不能在这里修改', en: 'Provided by a .env file; read-only' },
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
  previewNoAction: {
    zh: '组件库预览里动作没有去处；把它放上看板之后就能按。',
    en: 'Actions have nowhere to go in the library preview; place it on the board to use them.',
  },
  importConflict: {
    zh: '组件库里已经有这个组件，内容不一样；覆盖安装会换掉看板外的那份目录。',
    en: 'The library already has this widget with different content; replacing it overwrites the installed copy.',
  },
  overwrite: { zh: '覆盖安装', en: 'Replace' },
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
