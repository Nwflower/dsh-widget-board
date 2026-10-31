/**
 * 改动卡的分组、文件切换与折叠：判定这一层。
 *
 * `main.js` 同时以经典脚本内联进组件文档；这里按副作用模块载入同一份文件，读到的是卡片真正在用的
 * 实现，不是另写一份样例。卡片在浏览器里照着同一份判定画文件清单与手风琴。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import '../../widgets/diff/main.js'

/** 一个文件分组。 */
interface FileGroup {
  path: string
  added: number
  removed: number
  lines: { type: string, text: string }[]
}

/** 这一帧里一个文件的排版数据。 */
interface GroupView {
  path: string
  name: string
  dir: string
  added: number
  removed: number
  lines: { type: string, text: string }[]
  active: boolean
  expanded: boolean
}

/** 这一帧该画的东西。 */
interface View {
  wide: boolean
  multiple: boolean
  groups: GroupView[]
  active: GroupView | null
  summary: string
}

/** 组件的脑子：记住选中的文件与展开的分组。 */
interface Controller {
  setData(lines: unknown): void
  setWide(value: boolean): void
  setLang(value: boolean): void
  select(path: string): void
  toggle(path: string): void
  view(): View
}

interface DiffViewApi {
  LIMIT: number
  groupFiles(lines: unknown, limit?: number): FileGroup[]
  fileNameOf(path: unknown): string
  dirOf(path: unknown): string
  summaryOf(files: FileGroup[], zh: boolean): string
  createController(options?: { zh?: boolean }): Controller
}

const api = (globalThis as unknown as { DiffView: DiffViewApi }).DiffView

/** 两个文件的改动：layout.ts 两增两减，grid.ts 两增一减。 */
const LINES = [
  { type: 'meta', text: 'src/board/layout.ts' },
  { type: 'context', text: 'export function place(cards, columns) {' },
  { type: 'remove', text: '  const gap = 8' },
  { type: 'add', text: '  const gap = 12' },
  { type: 'remove', text: '    x: index % columns,' },
  { type: 'add', text: '    x: index % Math.max(1, columns),' },
  { type: 'meta', text: 'src/board/grid.ts' },
  { type: 'add', text: 'export function columnsOf(width) {' },
  { type: 'remove', text: '  const columns = Math.floor(width / 240)' },
  { type: 'add', text: '  const columns = Math.max(1, Math.floor(width / 200))' }
]

/** 真实样例：组件库与尺寸矩阵读的就是这一份文件。 */
interface SampleData {
  lines?: { type?: string, text?: string }[]
}
const SAMPLES = JSON.parse(
  readFileSync(new URL('../../widgets/diff/samples.json', import.meta.url), 'utf8'),
) as Record<string, { data?: SampleData }>

describe('按文件分组', () => {
  it('每个 meta 行开启一个分组，改动行归到它下面', () => {
    const files = api.groupFiles(LINES)
    expect(files).toHaveLength(2)
    expect(files[0]?.path).toBe('src/board/layout.ts')
    expect(files[1]?.path).toBe('src/board/grid.ts')
    expect(files[0]?.lines).toHaveLength(5)
    expect(files[1]?.lines).toHaveLength(3)
  })

  it('每个分组算自己的新增与删除行数', () => {
    const files = api.groupFiles(LINES)
    expect(files[0]?.added).toBe(2)
    expect(files[0]?.removed).toBe(2)
    expect(files[1]?.added).toBe(2)
    expect(files[1]?.removed).toBe(1)
  })

  it('第一个 meta 行之前的改动行收进一个无名分组', () => {
    const files = api.groupFiles([
      { type: 'add', text: 'const a = 1' },
      { type: 'meta', text: 'src/board/grid.ts' },
      { type: 'add', text: 'const b = 2' }
    ])
    expect(files).toHaveLength(2)
    expect(files[0]?.path).toBe('')
    expect(files[0]?.added).toBe(1)
    expect(files[1]?.path).toBe('src/board/grid.ts')
  })

  it('形状不对的行丢掉，改动行数超过上限时只收前几行', () => {
    expect(api.groupFiles([null, 'x', { text: 1 }, { type: 'add', text: 'kept' }])).toHaveLength(1)
    const many = Array.from({ length: 10 }, (_unused, index) => ({ type: 'add', text: String(index) }))
    expect(api.groupFiles(many, 4)[0]?.lines).toHaveLength(4)
  })

  it('文件短名与目录分开取', () => {
    expect(api.fileNameOf('packages/host/src/git-diff.ts')).toBe('git-diff.ts')
    expect(api.dirOf('packages/host/src/git-diff.ts')).toBe('packages/host/src')
    expect(api.fileNameOf('README.md')).toBe('README.md')
    expect(api.dirOf('README.md')).toBe('')
  })
})

describe('右上角的事实', () => {
  it('多个文件时先说文件数，再给新增与删除', () => {
    const files = api.groupFiles(LINES)
    expect(api.summaryOf(files, true)).toBe('2 个文件 · +4 −3')
    expect(api.summaryOf(files, false)).toBe('2 files · +4 −3')
  })

  it('只有一个文件时只说新增与删除', () => {
    const files = api.groupFiles([{ type: 'add', text: 'a' }, { type: 'remove', text: 'b' }])
    expect(api.summaryOf(files, true)).toBe('+1 −1')
    expect(api.summaryOf(files, false)).toBe('+1 −1')
  })
})

describe('宽盒子：左列文件清单与右边的文件切换', () => {
  it('左列给出每个文件的名字、目录与增删行数', () => {
    const controller = api.createController({ zh: true })
    controller.setData(LINES)
    controller.setWide(true)
    const view = controller.view()
    expect(view.wide).toBe(true)
    expect(view.multiple).toBe(true)
    expect(view.groups.map((group) => group.name)).toEqual(['layout.ts', 'grid.ts'])
    expect(view.groups.map((group) => group.dir)).toEqual(['src/board', 'src/board'])
    expect(view.groups.map((group) => group.added)).toEqual([2, 2])
    expect(view.groups.map((group) => group.removed)).toEqual([2, 1])
  })

  it('默认选中第一个文件，右边画的就是它', () => {
    const controller = api.createController({ zh: true })
    controller.setData(LINES)
    controller.setWide(true)
    const view = controller.view()
    expect(view.active?.path).toBe('src/board/layout.ts')
    expect(view.groups[0]?.active).toBe(true)
    expect(view.groups[1]?.active).toBe(false)
    expect(view.active?.lines).toHaveLength(5)
  })

  it('点了左列另一个文件，右边换成那个文件', () => {
    const controller = api.createController({ zh: true })
    controller.setData(LINES)
    controller.setWide(true)
    controller.select('src/board/grid.ts')
    const view = controller.view()
    expect(view.active?.path).toBe('src/board/grid.ts')
    expect(view.active?.lines).toHaveLength(3)
    expect(view.groups[1]?.active).toBe(true)
    expect(view.groups[0]?.active).toBe(false)
  })

  it('只有一个文件时不摆文件清单，右边直接画那个文件', () => {
    const controller = api.createController({ zh: true })
    controller.setData([{ type: 'meta', text: 'src/board/grid.ts' }, { type: 'add', text: 'const a = 1' }])
    controller.setWide(true)
    const view = controller.view()
    expect(view.multiple).toBe(false)
    expect(view.groups).toHaveLength(1)
    expect(view.active?.path).toBe('src/board/grid.ts')
  })
})

describe('窄盒子与常规盒子：手风琴', () => {
  it('默认只展开第一个文件，其余收着', () => {
    const controller = api.createController({ zh: true })
    controller.setData(LINES)
    controller.setWide(false)
    const view = controller.view()
    expect(view.wide).toBe(false)
    expect(view.multiple).toBe(true)
    expect(view.groups[0]?.expanded).toBe(true)
    expect(view.groups[1]?.expanded).toBe(false)
  })

  it('点了文件头展开那一个，再点一次收回去', () => {
    const controller = api.createController({ zh: true })
    controller.setData(LINES)
    controller.setWide(false)
    controller.toggle('src/board/grid.ts')
    expect(controller.view().groups[1]?.expanded).toBe(true)
    controller.toggle('src/board/grid.ts')
    expect(controller.view().groups[1]?.expanded).toBe(false)
  })

  it('点开的那个同时成为当前选中的文件，切到宽盒子时右边就是它', () => {
    const controller = api.createController({ zh: true })
    controller.setData(LINES)
    controller.setWide(false)
    controller.toggle('src/board/grid.ts')
    controller.setWide(true)
    expect(controller.view().active?.path).toBe('src/board/grid.ts')
  })
})

describe('数据源每 5 秒推来新改动', () => {
  it('同名文件还在时保留选中的文件与展开的状态', () => {
    const controller = api.createController({ zh: true })
    controller.setData(LINES)
    controller.select('src/board/grid.ts')
    controller.toggle('src/board/grid.ts')
    controller.setData([...LINES, { type: 'add', text: '  return { columns, gutter }' }])
    const view = controller.view()
    expect(view.active?.path).toBe('src/board/grid.ts')
    expect(view.groups[1]?.expanded).toBe(true)
    expect(view.groups).toHaveLength(2)
    expect(view.groups[1]?.added).toBe(3)
  })

  it('选中的文件不在新改动里时落到第一个文件', () => {
    const controller = api.createController({ zh: true })
    controller.setData(LINES)
    controller.select('src/board/grid.ts')
    controller.setData([{ type: 'meta', text: 'src/board/board.ts' }, { type: 'add', text: 'const a = 1' }])
    const view = controller.view()
    expect(view.active?.path).toBe('src/board/board.ts')
    expect(view.groups[1]).toBeUndefined()
  })
})

describe('样例数据', () => {
  it('每个尺寸族的样例都有两个文件的改动', () => {
    let checked = 0
    for (const [key, sample] of Object.entries(SAMPLES)) {
      const lines = sample.data?.lines ?? []
      const files = lines.filter((line) => line.type === 'meta')
      expect(files.length, key).toBeGreaterThanOrEqual(2)
      checked += 1
    }
    expect(checked).toBeGreaterThanOrEqual(2)
  })
})
