/**
 * 多块看板的存储（D21）：索引、每块一份文件、迁移与按块写入。
 *
 * 工作区落在 `.debug/` 下的临时目录里，读写走真的文件：这一层判定的是磁盘上留下了什么，以及
 * 内存里的那一份与磁盘上的是不是同一份。
 */
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { Board, BoardEvent } from '@dsh-widget-board/contracts'
import type { WidgetRecord } from '../src/library'
import { loadLibrary } from '../src/library'
import { writeBoard } from '../src/state'
import { openWorkspace } from '../src/workspace'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const HASH = 'a'.repeat(64)
const WIDGETS = join(ROOT, 'packages', 'widgets')

/** 一个组件记录。 */
function record(id: string, minBox?: { w: number, h: number }): WidgetRecord {
  return {
    manifest: {
      id,
      title: { zh: id, en: id },
      version: '0.1.0',
      sizes: ['s'],
      ...(minBox === undefined ? {} : { minBox }),
    },
    source: 'builtin',
    dir: `/widgets/${id}`,
    hash: HASH,
    files: new Map(),
  }
}

/** 一块带一张卡的看板。 */
function board(id: string, title: string, height = 22): Board {
  return {
    version: 2,
    id,
    title,
    revision: 0,
    layoutRevision: 0,
    instances: [
      { id: `${id}-card`, widget: 'weather', hash: HASH, props: {}, data: null, state: null, layout: { x: 0, y: 0, w: 1, h: height } },
    ],
  }
}

/** 真实的内置组件库：第一次启动的两块看板按它铺。 */
let library: WidgetRecord[]

beforeAll(async () => {
  library = [...(await loadLibrary([{ dir: WIDGETS, source: 'builtin' }])).records.values()]
})

/** 这一轮起的临时目录，测试结束一并删掉。 */
const homes: string[] = []

afterEach(async () => {
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true })
})

/**
 * 建一个临时 home。
 *
 * @returns 目录路径。
 */
async function tempHome(): Promise<string> {
  await mkdir(join(ROOT, '.debug'), { recursive: true })
  const home = await mkdtemp(join(ROOT, '.debug', 'workspace-test-'))
  homes.push(home)
  return home
}

/**
 * 打开一个工作区，收下它推出来的事件。
 *
 * @param home - 临时目录。
 * @param records - 组件记录。
 * @returns 工作区与事件表。
 */
async function open(home: string, records: WidgetRecord[] = [record('weather')]): Promise<{ workspace: Awaited<ReturnType<typeof openWorkspace>>, events: BoardEvent[] }> {
  const events: BoardEvent[] = []
  const workspace = await openWorkspace(home, new Map(records.map((entry) => [entry.manifest.id, entry])), (event) => { events.push(event) })
  return { workspace, events }
}

/**
 * 先写好只有一块看板的工作区再打开：这些测试关心的是看板的增删与写入，不是第一次启动铺什么。
 *
 * @param home - 临时目录。
 * @returns 工作区与事件表。
 */
async function openStarted(home: string): ReturnType<typeof open> {
  await writeBoard(join(home, 'boards', 'start.json'), board('start', '看板'))
  await writeFile(join(home, 'boards.json'), `${JSON.stringify({ version: 1, active: 'start', boards: ['start'] })}
`, 'utf8')
  return await open(home, library)
}

describe('第一次打开', () => {
  it('没有任何文件时铺两块看板：「我的看板」选中并排第一，「组件画廊」排第二', async () => {
    const home = await tempHome()
    const { workspace } = await open(home, library)
    const boards = workspace.list()
    expect(boards.map((entry) => entry.title)).toEqual(['我的看板', '组件画廊'])
    expect(workspace.activeId()).toBe(boards[0]?.id)
    expect(boards[0]?.instances.length).toBeGreaterThan(0)
    expect(boards[1]?.instances.length).toBeGreaterThan(boards[0]?.instances.length ?? 0)
    expect(existsSync(join(home, 'boards.json'))).toBe(true)
    for (const entry of boards) expect(existsSync(join(home, 'boards', `${entry.id}.json`))).toBe(true)
    const index = JSON.parse(await readFile(join(home, 'boards.json'), 'utf8')) as { active: string, boards: string[] }
    expect(index).toMatchObject({ active: boards[0]?.id, boards: boards.map((entry) => entry.id) })
  })

  it('已有看板的用户不受影响：再次打开读到的还是原来的看板', async () => {
    const home = await tempHome()
    await open(home, library)
    const reopened = (await open(home, library)).workspace
    expect(reopened.list().map((entry) => entry.title)).toEqual(['我的看板', '组件画廊'])
    const kept = await openStarted(await tempHome())
    expect(kept.workspace.list().map((entry) => entry.title)).toEqual(['看板'])
  })

  it('索引版本不认识时报错并保留原文件', async () => {
    const home = await tempHome()
    await writeFile(join(home, 'boards.json'), `${JSON.stringify({ version: 9, active: 'x', boards: ['x'] })}\n`, 'utf8')
    await expect(open(home)).rejects.toThrow(/只认 1/)
    expect(existsSync(join(home, 'boards.json'))).toBe(true)
  })

  it('索引里的看板文件缺失时报错', async () => {
    const home = await tempHome()
    await writeFile(join(home, 'boards.json'), `${JSON.stringify({ version: 1, active: 'ghost', boards: ['ghost'] })}\n`, 'utf8')
    await expect(open(home)).rejects.toThrow()
  })
})

describe('单一看板的迁移', () => {
  it('board.json 搬成第一块看板，搬完删掉原文件', async () => {
    const home = await tempHome()
    const legacy = board('legacy', '老看板', 26)
    await writeBoard(join(home, 'board.json'), legacy)
    const { workspace } = await open(home)
    expect(workspace.list().map((entry) => entry.id)).toEqual(['legacy'])
    expect(workspace.board('legacy').title).toBe('老看板')
    expect(workspace.board('legacy').instances[0]?.layout.h).toBe(26)
    expect(existsSync(join(home, 'board.json'))).toBe(false)
    expect(existsSync(join(home, 'boards', 'legacy.json'))).toBe(true)
  })
})

describe('看板的增删改与选中', () => {
  it('新建的空看板排在末尾并成为当前选中', async () => {
    const home = await tempHome()
    const { workspace, events } = await openStarted(home)
    const first = workspace.list()[0]?.id ?? ''
    const created = await workspace.create()
    expect(workspace.list().map((entry) => entry.id)).toEqual([first, created.id])
    expect(created.instances).toHaveLength(0)
    expect(created.title).toBe('未命名看板')
    expect(workspace.activeId()).toBe(created.id)
    const second = await workspace.create()
    expect(second.title).toBe('未命名看板 2')
    expect(events.filter((event) => event.type === 'board')).toHaveLength(2)
    const index = JSON.parse(await readFile(join(home, 'boards.json'), 'utf8')) as { active: string, boards: string[] }
    expect(index.active).toBe(second.id)
    expect(index.boards).toEqual([first, created.id, second.id])
  })

  it('改名写进那一块看板自己的文件', async () => {
    const home = await tempHome()
    const { workspace } = await openStarted(home)
    const id = workspace.activeId()
    await workspace.rename(id, '工作')
    expect(workspace.board(id).title).toBe('工作')
    expect(workspace.board(id).revision).toBe(1)
    const stored = JSON.parse(await readFile(join(home, 'boards', `${id}.json`), 'utf8')) as Board
    expect(stored.title).toBe('工作')
  })

  it('移除一块看板：文件删掉、索引不再提它', async () => {
    const home = await tempHome()
    const { workspace } = await openStarted(home)
    const first = workspace.activeId()
    const second = await workspace.create()
    await workspace.remove(second.id)
    expect(workspace.list().map((entry) => entry.id)).toEqual([first])
    expect(existsSync(join(home, 'boards', `${second.id}.json`))).toBe(false)
    expect(workspace.activeId()).toBe(first)
  })

  it('移除最后一块看板时补上空看板并选中它', async () => {
    const home = await tempHome()
    const { workspace, events } = await openStarted(home)
    const first = workspace.activeId()
    const before = events.length
    await workspace.remove(first)
    const boards = workspace.list()
    expect(boards).toHaveLength(1)
    const replacement = boards[0] as Board
    expect(replacement.id).not.toBe(first)
    expect(replacement.title.trim()).not.toBe('')
    expect(replacement.instances).toEqual([])
    expect(workspace.activeId()).toBe(replacement.id)
    expect(existsSync(join(home, 'boards', `${first}.json`))).toBe(false)
    expect(existsSync(join(home, 'boards', `${replacement.id}.json`))).toBe(true)
    expect(events.slice(before)).toEqual([{ type: 'board' }])
    const index = JSON.parse(await readFile(join(home, 'boards.json'), 'utf8')) as { active: string, boards: string[] }
    expect(index).toEqual({ version: 1, active: replacement.id, boards: [replacement.id] })
    const reopened = (await open(home)).workspace
    expect(reopened.list().map((entry) => entry.id)).toEqual([replacement.id])
    expect(reopened.activeId()).toBe(replacement.id)
  })

  it('缺少默认组件时仍可移除最后一块并补上空看板', async () => {
    const home = await tempHome()
    await writeBoard(join(home, 'boards', 'start.json'), board('start', '看板'))
    await writeFile(join(home, 'boards.json'), `${JSON.stringify({ version: 1, active: 'start', boards: ['start'] })}\n`, 'utf8')
    const { workspace } = await open(home, library.filter((entry) => entry.manifest.id !== 'heatmap'))
    await workspace.remove('start')
    expect(workspace.list()).toHaveLength(1)
    expect(workspace.activeId()).not.toBe('start')
    expect(workspace.active().instances).toEqual([])
    expect(existsSync(join(home, 'boards', 'start.json'))).toBe(false)
    const index = JSON.parse(await readFile(join(home, 'boards.json'), 'utf8')) as { active: string, boards: string[] }
    expect(index).toEqual({ version: 1, active: workspace.activeId(), boards: [workspace.activeId()] })
  })

  it('选中只改索引，同一块重复选中不再写', async () => {
    const home = await tempHome()
    const { workspace, events } = await openStarted(home)
    const first = workspace.activeId()
    const second = await workspace.create()
    const before = events.length
    await workspace.setActive(first)
    expect(events.slice(before)).toEqual([{ type: 'active', board: first }])
    await workspace.setActive(first)
    expect(events.slice(before)).toHaveLength(1)
  })
})

describe('按块写入', () => {
  it('每块看板各算各的修订号', async () => {
    const home = await tempHome()
    const { workspace } = await openStarted(home)
    const first = workspace.activeId()
    const second = await workspace.create()
    await workspace.save(second.id, (current) => ({ ...current, instances: [] }), { layoutChanged: true, event: () => ({ type: 'board' }) })
    expect(workspace.board(second.id).layoutRevision).toBe(1)
    expect(workspace.board(second.id).revision).toBe(1)
    expect(workspace.board(first).layoutRevision).toBe(0)
    expect(workspace.board(first).revision).toBe(0)
  })

  it('布局修订号过期时抛出，磁盘上不留半份', async () => {
    const home = await tempHome()
    const { workspace } = await openStarted(home)
    const id = workspace.activeId()
    await workspace.save(id, (current) => current, { layoutChanged: true, event: () => ({ type: 'board' }) })
    await expect(workspace.save(id, (current) => current, { expectedLayoutRevision: 0, layoutChanged: true, event: () => ({ type: 'board' }) })).rejects.toThrow(/布局修订号/)
    expect(workspace.board(id).layoutRevision).toBe(1)
  })

  it('找得到任意一块看板上的卡片与组', async () => {
    const home = await tempHome()
    const { workspace } = await openStarted(home)
    const first = workspace.activeId()
    const firstCard = workspace.board(first).instances[0]?.id ?? ''
    const second = await workspace.create()
    await workspace.save(second.id, (current) => ({
      ...current,
      instances: [
        { id: 'card', widget: 'weather', hash: HASH, props: {}, data: null, state: null, layout: { x: 0, y: 0, w: 1, h: 22 }, group: { id: 'group', side: 'front', template: 'flip' } },
      ],
    }), { event: () => ({ type: 'board' }) })
    expect(workspace.findInstance('card')?.board.id).toBe(second.id)
    expect(workspace.findInstance('missing')).toBeUndefined()
    expect(workspace.findGroup('group')?.id).toBe(second.id)
    expect(workspace.findGroup('nope')).toBeUndefined()
    expect(workspace.findInstance(firstCard)?.board.id).toBe(first)
  })

  it('组件的最小盒子变了时把每块看板里低于下限的卡片抬上来', async () => {
    const home = await tempHome()
    const { workspace } = await openStarted(home)
    const first = workspace.activeId()
    const second = await workspace.create()
    // 两块看板各放一张 6rem 高的卡：都在下限之下。
    const low = board('x', 'x', 6).instances
    await workspace.save(first, (current) => ({ ...current, instances: low }), { event: () => ({ type: 'board' }) })
    await workspace.save(second.id, (current) => ({ ...current, instances: low }), { event: () => ({ type: 'board' }) })
    const minBoxOf = (): { w: number, h: number } => ({ w: 1, h: 14 })
    expect(await workspace.relayout(minBoxOf)).toBe(true)
    expect(workspace.board(first).instances[0]?.layout.h).toBe(14)
    expect(workspace.board(second.id).instances[0]?.layout.h).toBe(14)
    expect(await workspace.relayout(minBoxOf)).toBe(false)
  })
})

describe('重建索引', () => {
  it('打开时读到磁盘上的次序与当前选中', async () => {
    const home = await tempHome()
    await mkdir(join(home, 'boards'), { recursive: true })
    await writeBoard(join(home, 'boards', 'a.json'), board('a', '甲'))
    await writeBoard(join(home, 'boards', 'b.json'), board('b', '乙'))
    await writeFile(join(home, 'boards.json'), `${JSON.stringify({ version: 1, active: 'b', boards: ['b', 'a'] })}\n`, 'utf8')
    const { workspace } = await open(home)
    expect(workspace.list().map((entry) => entry.id)).toEqual(['b', 'a'])
    expect(workspace.activeId()).toBe('b')
  })
})
