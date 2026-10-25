/**
 * 第一次启动的两块看板（D17）：精选的「我的看板」与按类别排开的「组件画廊」。
 *
 * 清单只写在这个文件里：「我的看板」逐张写明组件、位置与内容，宽屏四列时第一屏放得下，它也是看板
 * 被删光后补上的那一块（D21）；画廊把每个内置组件各铺一张，按类别分行，同一行的卡片同高。清单里的
 * 组件不在内置组件库里时抛出，不静默少铺（D11）。
 */
import type { Board, BoardInstance, CardLayout } from '@dsh-widget-board/contracts'
import { POSITION_STEP_REM } from '@dsh-widget-board/model'
import type { WidgetRecord } from './library'
import { defaultBoxOf, emptyBoard, instanceOf, withGroupAdded } from './state'

/** 精选看板的标题。 */
export const MY_BOARD_TITLE = '我的看板'

/** 画廊看板的标题。 */
export const GALLERY_BOARD_TITLE = '组件画廊'

/** 一张卡写进看板时带的内容；没写的项保持组件自己的默认。 */
interface CardContent {
  props?: Record<string, unknown>
  data?: unknown
}

/** 精选看板上的一个位置：一张卡，或一组正反两面的翻面卡（D19）。 */
type MyBoardEntry =
  | ({ widget: string, layout: CardLayout } & CardContent)
  | { group: { front: string, back: string }, layout: CardLayout }

/**
 * 「我的看板」：第一行三张，第二行三张，日历组与余额卡占第三行；第四列的热力图排在清单最后。
 *
 * 看板按容器宽度在一到四列之间取列数，1440 宽的窗口加侧栏只有三列：第四列的卡片放在清单最后，
 * 三列时它们按 D16 的规则落到第三列的底部，前面的卡片不被推乱；四列时热力图上补第一行右端。
 * 行高第一行 18rem，第二行 14rem，第三行 22rem，纵向位置是上一行的 y 加高度再留 2rem。
 *
 * 日历组占第三行左侧两列：正面月历要这么高才写得下农历行，背面今日运势分到同一个盒子。
 */
const MY_BOARD: readonly MyBoardEntry[] = [
  { widget: 'board-hero', layout: { x: 0, y: 0, w: 2, h: 18 } },
  { widget: 'weather', layout: { x: 2, y: 0, w: 1, h: 18 } },
  { widget: 'pomodoro', layout: { x: 0, y: 20, w: 1, h: 14 } },
  { widget: 'todo', layout: { x: 1, y: 20, w: 1, h: 14 } },
  { widget: 'clock', layout: { x: 2, y: 20, w: 1, h: 14 } },
  { group: { front: 'calendar', back: 'fortune' }, layout: { x: 0, y: 36, w: 2, h: 22 } },
  { widget: 'dsh-balance', layout: { x: 2, y: 36, w: 1, h: 22 } },
  { widget: 'heatmap', layout: { x: 3, y: 0, w: 1, h: 18 } },
]

/** 画廊按三列排：1440 宽的窗口加侧栏只有三列，更宽时右边留空，也比三列窗口里卡片被推乱好。 */
const GALLERY_COLUMNS = 3

/** 画廊的类别，按显示的先后；每个类别里的组件也按这里的先后，相邻的几个正好排满一行。 */
const GALLERY_CATEGORIES: readonly { title: string, widgets: readonly string[] }[] = [
  { title: '数据展示', widgets: ['stat', 'gauge', 'progress', 'chart', 'heatmap', 'table', 'kv', 'list', 'timeline', 'image', 'markdown', 'json', 'diff', 'dsh-balance', 'github-issues'] },
  { title: '工具', widgets: ['board-hero', 'clock', 'calendar', 'fortune', 'year-progress', 'weather', 'pomodoro', 'todo', 'links', 'light-switch'] },
  { title: '动效模板', widgets: ['flip-card', 'holographic-card', 'magnetic-card'] },
]

/** 没有列进任何类别的内置组件放在最后，按 id 排。 */
const OTHER_CATEGORY = '其他'

/**
 * 画廊里需要写入内容的卡：这两个组件没有数据时画的是一份自带的样例，样例里有像故障的状态。
 * 表格与键值的行来自 data，所以写 data。
 */
const GALLERY_CONTENT: Readonly<Record<string, CardContent>> = {
  table: {
    data: {
      columns: [
        { key: 'name', label: '服务' },
        { key: 'state', label: '状态' },
        { key: 'latency', label: '延迟', align: 'right' },
      ],
      rows: [
        { name: '宿主', state: '在线', latency: '12 ms' },
        { name: '组件库', state: '在线', latency: '4 ms' },
        { name: '事件推送', state: '在线', latency: '8 ms' },
        { name: '数据源', state: '就绪', latency: '21 ms' },
      ],
    },
  },
  kv: {
    data: {
      items: [
        { key: '插件', value: 'dsh-widget-board', note: '组件看板' },
        { key: '宿主', value: 'DeepSeek Harness' },
        { key: '看板', value: 2, note: '我的看板 · 组件画廊' },
        { key: '来源', value: '内置 · 用户 · 插件' },
      ],
    },
  },
}

/** 画廊里相邻两行之间留的纵向空隙，落在 2rem 的位置档上（D16）。 */
const ROW_GAP_REM = POSITION_STEP_REM

/**
 * 取内置组件的记录。
 *
 * @param records - 已校验的组件。
 * @param id - 组件 id。
 * @returns 记录。
 * @throws {Error} 内置组件库里没有这个组件。
 */
function builtinRecord(records: Map<string, WidgetRecord>, id: string): WidgetRecord {
  const record = records.get(id)
  if (record === undefined || record.source !== 'builtin') {
    throw new Error(`默认看板的清单里有内置组件 ${id}，但内置组件库里没有它（D17）`)
  }
  return record
}

/**
 * 一张带内容的卡。
 *
 * @param record - 组件记录。
 * @param layout - 卡片的盒子。
 * @param content - 要写入的 props 与数据。
 * @returns 卡片。
 */
function cardOf(record: WidgetRecord, layout: CardLayout, content: CardContent): BoardInstance {
  const source = record.manifest.source
  const instance = instanceOf(record, [], {
    ...(source === undefined ? {} : { source }),
    ...(content.props === undefined ? {} : { props: content.props }),
    layout,
  })
  return content.data === undefined ? instance : { ...instance, data: content.data }
}

/**
 * 精选看板。
 *
 * @param records - 已校验的组件。
 * @returns 看板。
 */
function myBoard(records: Map<string, WidgetRecord>): Board {
  const instances: BoardInstance[] = []
  for (const entry of MY_BOARD) {
    if ('group' in entry) {
      const front = builtinRecord(records, entry.group.front)
      const back = builtinRecord(records, entry.group.back)
      instances.push(...withGroupAdded(emptyBoard(MY_BOARD_TITLE), front, back, { layout: entry.layout }).board.instances)
    } else {
      instances.push(cardOf(builtinRecord(records, entry.widget), entry.layout, entry))
    }
  }
  return { ...emptyBoard(MY_BOARD_TITLE), instances }
}

/**
 * 画廊看板：每个类别从新的一行开始，卡片按默认宽度排满三列再换行，同一行的卡片取这一行里最高的一档。
 *
 * @param records - 已校验的组件。
 * @returns 看板。
 */
function galleryBoard(records: Map<string, WidgetRecord>): Board {
  const listed = new Set(GALLERY_CATEGORIES.flatMap((category) => category.widgets))
  const others = [...records.values()]
    .filter((record) => record.source === 'builtin' && !listed.has(record.manifest.id))
    .map((record) => record.manifest.id)
    .sort((left, right) => left.localeCompare(right))
  const categories = others.length === 0 ? GALLERY_CATEGORIES : [...GALLERY_CATEGORIES, { title: OTHER_CATEGORY, widgets: others }]
  const instances: BoardInstance[] = []
  let y = 0
  for (const category of categories) {
    let row: { record: WidgetRecord, x: number, w: number, h: number }[] = []
    let column = 0
    const flush = (): void => {
      if (row.length === 0) return
      const height = Math.max(...row.map((cell) => cell.h))
      for (const cell of row) {
        const id = cell.record.manifest.id
        instances.push(cardOf(cell.record, { x: cell.x, y, w: cell.w, h: height }, GALLERY_CONTENT[id] ?? {}))
      }
      y += height + ROW_GAP_REM
      row = []
      column = 0
    }
    for (const id of category.widgets) {
      const record = builtinRecord(records, id)
      const box = defaultBoxOf(record)
      const w = Math.min(box.w, GALLERY_COLUMNS)
      if (column + w > GALLERY_COLUMNS) flush()
      row.push({ record, x: column, w, h: box.h })
      column += w
    }
    flush()
  }
  return { ...emptyBoard(GALLERY_BOARD_TITLE), instances }
}

/**
 * 默认看板：第一次启动排第一的「我的看板」。
 *
 * 看板被删光时补上这一块（D21）；只有内置组件会铺卡，用户与插件来源的组件从添加面板加入，
 * 装了插件不该顺带改变别人的看板（D17）。
 *
 * @param records - 已校验的组件。
 * @returns 默认看板。
 * @throws {Error} 清单里的内置组件不在组件库里。
 */
export function defaultBoard(records: Map<string, WidgetRecord>): Board {
  return myBoard(records)
}

/**
 * 第一次启动的看板：默认看板排第一，「组件画廊」排第二。
 *
 * @param records - 已校验的组件。
 * @returns 两块新看板，按标签的次序。
 * @throws {Error} 清单里的内置组件不在组件库里。
 */
export function seedBoards(records: Map<string, WidgetRecord>): [Board, Board] {
  return [defaultBoard(records), galleryBoard(records)]
}
