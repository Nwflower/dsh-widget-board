/**
 * 面向会话的工具（D9）：工具的定义、参数校验与它们对看板的改动。
 *
 * 这一层不碰真实宿主：路由上下文用替身，写入链是内存里的一次替换。判的是工具自己的行为——名字与
 * 描述齐全、参数是合法的 JSON Schema、坏输入被拒绝并说明原因、放卡与推数据真的改了看板。
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import Ajv from 'ajv'
import type { Board, BoardEvent, BoardValue, DefineValue, ShowValue, ToolCall, WidgetRoot, WidgetToolRegistration } from '@dsh-widget-board/contracts'
import { WIDGET_TOOL_NAMES, ToolRefusal } from '@dsh-widget-board/contracts'
import type { RouteContext } from '../src/routes'
import { createSelfChecks } from '../src/selfcheck'
import type { WidgetRecord } from '../src/library'
import { createToolContext, toolRegistrations } from '../src/tools'
import { dataError } from '../src/schema'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(async (dir) => { await rm(dir, { recursive: true, force: true }) }))
})

/** 一个组件记录。 */
function record(id: string, extra: Partial<WidgetRecord['manifest']> = {}): WidgetRecord {
  return {
    manifest: {
      id,
      title: { zh: id, en: id },
      version: '0.1.0',
      sizes: ['s'],
      data: { type: 'object', required: ['n'], properties: { n: { type: 'number' } } },
      ...extra,
    },
    source: 'builtin',
    dir: `/widgets/${id}`,
    hash: id.padEnd(64, 'a').slice(0, 64),
    files: new Map([['index.html', Buffer.from('<p></p>')], ['style.css', Buffer.from('p{}')]]),
  }
}

/** 一张看得见的空看板。 */
function emptyBoard(id = 'board', title = '看板'): Board {
  return { version: 2, id, title, revision: 0, layoutRevision: 0, instances: [] }
}

/** 一套替身：看板在内存里，写入链是同步的一次替换。 */
function harness(options: { records?: WidgetRecord[], roots?: WidgetRoot[], boards?: Board[] } = {}) {
  const records = new Map((options.records ?? [record('stat'), record('chart')]).map((entry) => [entry.manifest.id, entry]))
  const boards = new Map((options.boards ?? [emptyBoard()]).map((board) => [board.id, board]))
  const active = 'board'
  const events: BoardEvent[] = []
  const saveBoard = async (
    boardId: string,
    change: (current: Board) => Board,
    opts: { layoutChanged?: boolean, event: (next: Board, id: string) => BoardEvent },
  ): Promise<Board> => {
    const current = boards.get(boardId)
    if (current === undefined) throw new Error(`没有这块看板：${boardId}`)
    const next = {
      ...change(current),
      revision: current.revision + 1,
      layoutRevision: current.layoutRevision + (opts.layoutChanged === true ? 1 : 0),
    }
    boards.set(boardId, next)
    events.push(opts.event(next, boardId))
    return next
  }
  const workspace = {
    activeId: () => active,
    active: () => boards.get(active) as Board,
    list: () => [...boards.values()],
    has: (id: string) => boards.has(id),
    board: (id: string) => {
      const board = boards.get(id)
      if (board === undefined) throw new Error(`没有这块看板：${id}`)
      return board
    },
    findInstance: (id: string) => {
      for (const board of boards.values()) {
        const instance = board.instances.find((candidate) => candidate.id === id)
        if (instance !== undefined) return { board, instance }
      }
      return undefined
    },
    save: saveBoard,
    setActive: async () => undefined,
  }
  const context = {
    records,
    entries: [...records.values()].map((entry) => ({
      id: entry.manifest.id,
      source: entry.source,
      title: entry.manifest.title,
      sizes: entry.manifest.sizes,
      hash: entry.hash,
    })),
    library: { records, entries: [], errors: [] },
    roots: options.roots ?? [{ dir: '/home/widgets', source: 'user' as const }],
    versions: { remember: async () => undefined, get: async () => undefined },
    get board() { return boards.get(active) as Board },
    workspace,
    save: async () => { throw new Error('未替换') },
    live: {
      assets: { tokensCss: '', suiteCss: '', runtimeJs: '', libs: {} },
      revision: 0,
      subscribe: () => undefined,
      publish: () => undefined,
      notify: () => undefined,
      close: () => undefined,
    },
    connection: undefined,
    refresh: async () => undefined,
    sources: {
      registerDataSource: () => () => undefined,
      registerAction: () => () => undefined,
      hasDataSource: () => false,
      resolveDataSource: () => undefined,
      resolveAction: () => undefined,
      readSource: async () => ({ n: 7 }),
      runAction: async () => null,
      namesOf: () => ({ dataSources: [], actions: [] }),
    },
    grants: {
      all: () => [],
      has: () => false,
      grant: async (input: { kind: 'action' | 'source', hash: string, id: string, widget: string }) => ({ key: 'k', ...input, at: 'now' }),
      revoke: async () => false,
      forget: async () => 0,
    },
    // 自检要等在线页面交回报告；这一层没有页面，等一小会儿就给出 unverified。
    selfChecks: createSelfChecks(20),
  } as unknown as RouteContext
  const save = async (
    change: (current: Board) => Board,
    opts: { layoutChanged?: boolean, event: (next: Board) => BoardEvent },
  ): Promise<Board> => await saveBoard(active, change, { ...opts, event: (next) => opts.event(next) })
  const toolContext = createToolContext(context, save, async () => undefined)
  const tools = new Map(toolRegistrations(toolContext).map((tool) => [tool.name, tool]))
  return { context, events, tools, toolContext }
}

/** 一次调用的身份：自检按它对上会话页面（D9）。 */
const CALL = { callId: 'call-1', signal: new AbortController().signal }

/** 取一个工具；没有时抛出。调用身份省略时用 {@link CALL}。 */
function toolOf(harnessed: ReturnType<typeof harness>, name: string): Omit<WidgetToolRegistration, 'execute'> & {
  execute(args: unknown, exec?: ToolCall): Promise<unknown>
} {
  const tool = harnessed.tools.get(name)
  if (tool === undefined) throw new Error(`没有工具 ${name}`)
  return { ...tool, execute: async (args, exec = CALL) => await tool.execute(args, exec) }
}

describe('工具的定义', () => {
  it('七个工具的名字与描述齐全', () => {
    const harnessed = harness()
    expect([...harnessed.tools.keys()].sort()).toEqual(Object.values(WIDGET_TOOL_NAMES).sort())
    for (const tool of harnessed.tools.values()) {
      expect(tool.description.length).toBeGreaterThan(20)
      expect(tool.parameters.type).toBe('object')
    }
  })

  it('每个工具的 parameters 都是合法的 JSON Schema，且与描述一起能被编译', () => {
    const ajv = new Ajv({ strict: false })
    for (const tool of harness().tools.values()) {
      expect(() => ajv.compile(tool.parameters), tool.name).not.toThrow()
    }
  })

  it('每个工具都能渲染自己的返回值', async () => {
    const harnessed = harness()
    const catalog = await toolOf(harnessed, WIDGET_TOOL_NAMES.catalog).execute({})
    expect(toolOf(harnessed, WIDGET_TOOL_NAMES.catalog).output.render(undefined, catalog)[0]?.type).toBe('text')
    const board = await toolOf(harnessed, WIDGET_TOOL_NAMES.board).execute({})
    expect(toolOf(harnessed, WIDGET_TOOL_NAMES.board).output.render(undefined, board)[0]?.text).toContain('看板')
  })

  it('每个工具都声明了返回值的 schema 与一个纯渲染', () => {
    for (const tool of harness().tools.values()) {
      expect(tool.output.schema, tool.name).toBeTypeOf('object')
      expect(typeof tool.output.render, tool.name).toBe('function')
    }
  })
})

describe('widget_catalog', () => {
  it('列出组件与它们的声明', async () => {
    const value = await toolOf(harness({ records: [record('stat', { source: 'demo:count', actions: [{ id: 'demo:run' }] })] }), WIDGET_TOOL_NAMES.catalog).execute({})
    const catalog = value as { widgets: { id: string, source_id?: string, actions?: string[] }[] }
    expect(catalog.widgets).toHaveLength(1)
    expect(catalog.widgets[0]).toMatchObject({ id: 'stat', source_id: 'demo:count', actions: ['demo:run'] })
  })

  it('可以按来源与 id 过滤', async () => {
    const harnessed = harness()
    const value = await toolOf(harnessed, WIDGET_TOOL_NAMES.catalog).execute({ source: 'plugin' })
    expect((value as { widgets: unknown[] }).widgets).toEqual([])
  })
})

describe('widget_board', () => {
  it('默认读选中的看板，并列出全部看板', async () => {
    const harnessed = harness({ boards: [emptyBoard(), emptyBoard('second', '第二块')] })
    const value = await toolOf(harnessed, WIDGET_TOOL_NAMES.board).execute({}) as BoardValue
    expect(value.board).toBe('board')
    expect(value.boards).toEqual([
      { id: 'board', title: '看板', active: true, cards: 0 },
      { id: 'second', title: '第二块', active: false, cards: 0 },
    ])
  })

  it('按 board 读另一块，没有那块看板时拒绝', async () => {
    const harnessed = harness({ boards: [emptyBoard(), emptyBoard('second', '第二块')] })
    const value = await toolOf(harnessed, WIDGET_TOOL_NAMES.board).execute({ board: 'second' }) as BoardValue
    expect(value.title).toBe('第二块')
    await expect(toolOf(harnessed, WIDGET_TOOL_NAMES.board).execute({ board: 'ghost' })).rejects.toThrow(ToolRefusal)
  })
})

describe('widget_place', () => {
  /** 一个数据源可换的替身：读数据是放卡路径上要判的一环。 */
  function harnessWithSource(read: () => unknown, records = [record('stat', { source: 'demo:count' })]) {
    const harnessed = harness({ records })
    harnessed.context.sources.readSource = async () => read()
    return harnessed
  }

  it('放一张新卡：写进看板、布局修订号前进', async () => {
    const harnessed = harness()
    const value = await toolOf(harnessed, WIDGET_TOOL_NAMES.place).execute({ widget: 'stat', layout: { x: 0, y: 0, w: 2, h: 14 } })
    expect((value as { widget: string }).widget).toBe('stat')
    expect(harnessed.context.board.instances).toHaveLength(1)
    expect(harnessed.context.board.instances[0]?.layout).toMatchObject({ x: 0, y: 0, w: 2, h: 14 })
    expect(harnessed.context.board.layoutRevision).toBe(1)
  })

  it('按 board 把新卡放到另一块看板，选中的看板不变', async () => {
    const harnessed = harness({ boards: [emptyBoard(), emptyBoard('second', '第二块')] })
    const placed = await toolOf(harnessed, WIDGET_TOOL_NAMES.place).execute({ widget: 'stat', board: 'second' }) as { id: string }
    expect(harnessed.context.workspace.board('second').instances).toHaveLength(1)
    expect(harnessed.context.board.instances).toHaveLength(0)
    // 已有卡改盒子也落在它自己的看板上；点名另一块看板时拒绝。
    await toolOf(harnessed, WIDGET_TOOL_NAMES.place).execute({ widget: 'stat', id: placed.id, layout: { x: 1, y: 2 } })
    expect(harnessed.context.workspace.board('second').instances[0]?.layout).toMatchObject({ x: 1, y: 2 })
    await expect(toolOf(harnessed, WIDGET_TOOL_NAMES.place).execute({ widget: 'stat', id: placed.id, board: 'board' })).rejects.toThrow(/另一块看板/)
    await expect(toolOf(harnessed, WIDGET_TOOL_NAMES.place).execute({ widget: 'stat', board: 'ghost' })).rejects.toThrow(ToolRefusal)
  })

  it('组件不在库里时拒绝', async () => {
    await expect(toolOf(harness(), WIDGET_TOOL_NAMES.place).execute({ widget: 'nope' })).rejects.toThrow(ToolRefusal)
  })

  it('盒子的数不是数时拒绝', async () => {
    await expect(toolOf(harness(), WIDGET_TOOL_NAMES.place).execute({ widget: 'stat', layout: { x: '0' } })).rejects.toThrow(/layout\.x/)
  })

  it('改已有卡：挪位置、换 props，不换组件', async () => {
    const harnessed = harness()
    const placed = await toolOf(harnessed, WIDGET_TOOL_NAMES.place).execute({ widget: 'stat' })
    const id = (placed as { id: string }).id
    await toolOf(harnessed, WIDGET_TOOL_NAMES.place).execute({ widget: 'stat', id, layout: { x: 1, y: 6 }, props: { label: 'x' } })
    const instance = harnessed.context.board.instances[0]
    expect(instance?.layout).toMatchObject({ x: 1, y: 6 })
    expect(instance?.props).toEqual({ label: 'x' })
    // 只改 props 不动布局修订号。
    const before = harnessed.context.board.layoutRevision
    await toolOf(harnessed, WIDGET_TOOL_NAMES.place).execute({ widget: 'stat', id, props: { label: 'y' } })
    expect(harnessed.context.board.layoutRevision).toBe(before)
  })

  it('props 与 manifest 的 props schema 不符时拒绝', async () => {
    const schema = {
      type: 'object',
      additionalProperties: false,
      properties: { title: { type: 'string' } },
    }
    const harnessed = harness({ records: [record('stat', { props: schema })] })
    const placed = await toolOf(harnessed, WIDGET_TOOL_NAMES.place).execute({ widget: 'stat', props: { title: 'x' } })
    const id = (placed as { id: string }).id
    await expect(toolOf(harnessed, WIDGET_TOOL_NAMES.place).execute({ widget: 'stat', id, props: { title: 1 } }))
      .rejects.toThrow(/props schema/)
    expect(harnessed.context.board.instances[0]?.props).toEqual({ title: 'x' })
  })

  it('不让一张卡改成另一种组件', async () => {
    const harnessed = harness()
    const placed = await toolOf(harnessed, WIDGET_TOOL_NAMES.place).execute({ widget: 'stat' })
    await expect(toolOf(harnessed, WIDGET_TOOL_NAMES.place).execute({ widget: 'chart', id: (placed as { id: string }).id })).rejects.toThrow(/不能改成/)
  })

  it('组件声明的数据源在放卡时读一次', async () => {
    const harnessed = harnessWithSource(() => ({ n: 7 }))
    await toolOf(harnessed, WIDGET_TOOL_NAMES.place).execute({ widget: 'stat' })
    expect(harnessed.context.board.instances[0]?.data).toEqual({ n: 7 })
  })

  it('数据与 schema 不符时把原因写进说明，数据不写入', async () => {
    const harnessed = harnessWithSource(() => ({ n: 'seven' }))
    const value = await toolOf(harnessed, WIDGET_TOOL_NAMES.place).execute({ widget: 'stat' })
    expect((value as { notes?: string[] }).notes?.join('')).toMatch(/data schema/)
    expect(harnessed.context.board.instances[0]?.data).toBeNull()
  })
})

describe('widget_push 与 widget_remove', () => {
  it('推数据先按 schema 校验，合格才写入', async () => {
    const harnessed = harness()
    const placed = await toolOf(harnessed, WIDGET_TOOL_NAMES.place).execute({ widget: 'stat' })
    const id = (placed as { id: string }).id
    await toolOf(harnessed, WIDGET_TOOL_NAMES.push).execute({ id, data: { n: 1 } })
    expect(harnessed.context.board.instances[0]?.data).toEqual({ n: 1 })
    await expect(toolOf(harnessed, WIDGET_TOOL_NAMES.push).execute({ id, data: { n: 'x' } })).rejects.toThrow(/data schema/)
  })

  it('推给不存在的卡时拒绝', async () => {
    await expect(toolOf(harness(), WIDGET_TOOL_NAMES.push).execute({ id: 'nope', data: {} })).rejects.toThrow(/没有这张卡/)
  })

  it('移除一张卡，布局修订号前进', async () => {
    const harnessed = harness()
    const placed = await toolOf(harnessed, WIDGET_TOOL_NAMES.place).execute({ widget: 'stat' })
    const id = (placed as { id: string }).id
    const before = harnessed.context.board.layoutRevision
    await toolOf(harnessed, WIDGET_TOOL_NAMES.remove).execute({ id })
    expect(harnessed.context.board.instances).toHaveLength(0)
    expect(harnessed.context.board.layoutRevision).toBe(before + 1)
  })

  it('另一块看板上的卡也能推数据与移除', async () => {
    const harnessed = harness({ boards: [emptyBoard(), emptyBoard('second', '第二块')] })
    const placed = await toolOf(harnessed, WIDGET_TOOL_NAMES.place).execute({ widget: 'stat', board: 'second' })
    const id = (placed as { id: string }).id
    await toolOf(harnessed, WIDGET_TOOL_NAMES.push).execute({ id, data: { n: 2 } })
    expect(harnessed.context.workspace.board('second').instances[0]?.data).toEqual({ n: 2 })
    expect(harnessed.context.board.instances).toHaveLength(0)
    await toolOf(harnessed, WIDGET_TOOL_NAMES.remove).execute({ id })
    expect(harnessed.context.workspace.board('second').instances).toHaveLength(0)
  })
})

describe('widget_show', () => {
  it('显示看板上已有的卡：带上它的 props、data、state 与所在看板', async () => {
    const harnessed = harness({ records: [record('stat', { sizes: ['s', 'l'] })] })
    const placed = await toolOf(harnessed, WIDGET_TOOL_NAMES.place).execute({ widget: 'stat' })
    const id = (placed as { id: string }).id
    const value = await toolOf(harnessed, WIDGET_TOOL_NAMES.show).execute({ id }) as ShowValue
    expect(value).toMatchObject({
      id,
      widget: 'stat',
      hash: (harnessed.context.board.instances[0] as { hash: string }).hash,
      family: 'l',
      board: { id: 'board', title: '看板' },
      props: {},
      state: null,
    })
    expect(value.summary.title).toEqual({ zh: 'stat', en: 'stat' })
    expect(value.summary.hash).toBe(value.hash)
  })

  it('显示看板上没有的卡时拒绝', async () => {
    await expect(toolOf(harness(), WIDGET_TOOL_NAMES.show).execute({ id: 'nope' })).rejects.toThrow(/没有这张卡/)
  })

  it('一次性快照：不在看板上、不改看板，id 由宿主起', async () => {
    const harnessed = harness({ records: [record('stat', { sizes: ['s', 'l'] })] })
    const value = await toolOf(harnessed, WIDGET_TOOL_NAMES.show).execute({ widget: 'stat', props: {} }) as ShowValue
    expect(value.id.startsWith('inline-')).toBe(true)
    expect(value.board).toBeUndefined()
    expect(value.family).toBe('l')
    expect(harnessed.context.board.instances).toHaveLength(0)
    expect(value.summary.hash).toBe(value.hash)
  })

  it('一次性快照按组件声明的数据源读一次，数据与 schema 不符时拒绝', async () => {
    const harnessed = harness({ records: [record('stat', { source: 'demo:count' })] })
    const value = await toolOf(harnessed, WIDGET_TOOL_NAMES.show).execute({ widget: 'stat' }) as ShowValue
    expect(value.data).toEqual({ n: 7 })
    expect(value.source).toBe('demo:count')
    // 直接给的数据先过 schema。
    await expect(toolOf(harnessed, WIDGET_TOOL_NAMES.show).execute({ widget: 'stat', data: { n: 'x' } }))
      .rejects.toThrow(/data schema/)
    harnessed.context.sources.readSource = async () => ({ n: 'seven' })
    await expect(toolOf(harnessed, WIDGET_TOOL_NAMES.show).execute({ widget: 'stat' }))
      .rejects.toThrow(/data schema/)
  })

  it('props、size 与参数组合不合规时拒绝', async () => {
    const schema = { type: 'object', additionalProperties: false, properties: { title: { type: 'string' } } }
    const harnessed = harness({ records: [record('stat', { props: schema, sizes: ['s'] })] })
    await expect(toolOf(harnessed, WIDGET_TOOL_NAMES.show).execute({ widget: 'stat', props: { title: 1 } }))
      .rejects.toThrow(/props schema/)
    await expect(toolOf(harnessed, WIDGET_TOOL_NAMES.show).execute({ widget: 'stat', size: 'xl' }))
      .rejects.toThrow(/没有 xl 这个尺寸族/)
    await expect(toolOf(harnessed, WIDGET_TOOL_NAMES.show).execute({}))
      .rejects.toThrow(/要写明 id/)
    await expect(toolOf(harnessed, WIDGET_TOOL_NAMES.show).execute({ id: 'a', widget: 'stat' }))
      .rejects.toThrow(/只能给一个/)
    await expect(toolOf(harnessed, WIDGET_TOOL_NAMES.show).execute({ widget: 'ghost' }))
      .rejects.toThrow(ToolRefusal)
  })

  it('返回值同时是工具视图的载荷', async () => {
    const harnessed = harness({ records: [record('stat', { sizes: ['s'] })] })
    const tool = toolOf(harnessed, WIDGET_TOOL_NAMES.show)
    const value = await tool.execute({ widget: 'stat' })
    expect(tool.output.presentationMeta).toBeTypeOf('function')
    expect(tool.output.presentationMeta?.(undefined, value)).toEqual(value)
    // 没有视图的工具不声明载荷。
    expect(toolOf(harnessed, WIDGET_TOOL_NAMES.catalog).output.presentationMeta).toBeUndefined()
  })
})

describe('widget_define', () => {
  /** 一个可写的临时用户目录。 */
  async function userRoot(): Promise<WidgetRoot> {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-widget-board-define-'))
    roots.push(dir)
    return { dir, source: 'user' }
  }

  it('写下组件目录、manifest 与文件，并重读组件库', async () => {
    const root = await userRoot()
    const harnessed = harness({ roots: [root] })
    let reloaded = 0
    harnessed.toolContext.reload = async () => {
      reloaded += 1
      harnessed.context.records.set('mine', record('mine'))
    }
    const value = await toolOf(harnessed, WIDGET_TOOL_NAMES.define).execute({
      id: 'mine',
      manifest: { id: 'mine', title: { zh: '我的', en: 'Mine' }, version: '0.1.0', sizes: ['s'] },
      files: { 'index.html': '<p>hi</p>', 'style.css': 'p{}', 'main.js': 'void 0' },
    })
    expect((value as { id: string }).id).toBe('mine')
    expect(reloaded).toBe(1)
    const written = JSON.parse(await readFile(join(root.dir, 'mine', 'widget.json'), 'utf8')) as { id: string }
    expect(written.id).toBe('mine')
    expect(await readFile(join(root.dir, 'mine', 'main.js'), 'utf8')).toBe('void 0')
  })

  it('自检把任务交给会话页面，页面交回的报告写进结果与模型看到的文字', async () => {
    const harnessed = harness({ roots: [await userRoot()] })
    harnessed.toolContext.reload = async () => {
      harnessed.context.records.set('mine', record('mine', { minBox: { w: 2, h: 14 } }))
    }
    const tool = toolOf(harnessed, WIDGET_TOOL_NAMES.define)
    const running = tool.execute({
      id: 'mine',
      manifest: { id: 'mine', title: { zh: '我的', en: 'Mine' }, version: '0.1.0', sizes: ['s'], data: { type: 'object', properties: { n: { type: 'number' } } } },
      files: { 'index.html': '<p>hi</p>', 'style.css': 'p{}' },
      preview: { props: {}, data: { n: 3 } },
    }, { callId: 'define-1', signal: new AbortController().signal })
    // 会话页面：轮询到任务，量完交回一个有问题的盒子。
    let job = harnessed.context.selfChecks.take('define-1')
    for (let attempt = 0; attempt < 50 && job === 'pending'; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1))
      job = harnessed.context.selfChecks.take('define-1')
    }
    expect(job).toMatchObject({ widget: 'mine', data: { n: 3 }, boxes: [{ cols: 2, h: 14 }, { cols: 4, h: 30 }] })
    harnessed.context.selfChecks.settle('define-1', [{ box: { cols: 2, h: 14 }, problems: ['脚本错误：boom'] }])
    const value = await running as DefineValue
    expect(value.check).toMatchObject({ status: 'failed', problems: ['脚本错误：boom'] })
    expect(value.preview).toEqual({ props: {}, data: { n: 3 } })
    const text = tool.output.render({}, value)[0]?.text ?? ''
    expect(text).toMatch(/自检发现问题[\s\S]*boom[\s\S]*replace: true/)
    expect(tool.output.presentationMeta?.({}, value)).toEqual(value)
  })

  it('没有页面接手时结果写明 unverified', async () => {
    const harnessed = harness({ roots: [await userRoot()] })
    harnessed.toolContext.reload = async () => { harnessed.context.records.set('mine', record('mine')) }
    const value = await toolOf(harnessed, WIDGET_TOOL_NAMES.define).execute({
      id: 'mine',
      manifest: { id: 'mine', title: { zh: '我的', en: 'Mine' }, version: '0.1.0', sizes: ['s'] },
      files: { 'index.html': '<p>hi</p>', 'style.css': 'p{}' },
    }) as DefineValue
    expect(value.check.status).toBe('unverified')
    expect(value.preview).toEqual({ props: {}, data: null })
  })

  it('preview 不符合组件自己的 schema 时在写盘之前拒绝', async () => {
    const root = await userRoot()
    const harnessed = harness({ roots: [root] })
    await expect(toolOf(harnessed, WIDGET_TOOL_NAMES.define).execute({
      id: 'mine',
      manifest: { id: 'mine', title: { zh: '我的', en: 'Mine' }, version: '0.1.0', sizes: ['s'], data: { type: 'object', required: ['n'] } },
      files: { 'index.html': '<p></p>', 'style.css': 'p{}' },
      preview: { data: {} },
    })).rejects.toThrow(/preview\.data/)
    await expect(readFile(join(root.dir, 'mine', 'widget.json'), 'utf8')).rejects.toThrow()
  })

  it('缺 index.html 或 style.css 时拒绝', async () => {
    const harnessed = harness({ roots: [await userRoot()] })
    await expect(toolOf(harnessed, WIDGET_TOOL_NAMES.define).execute({
      id: 'mine',
      manifest: { id: 'mine', title: { zh: '我的', en: 'Mine' }, version: '0.1.0', sizes: ['s'] },
      files: { 'index.html': '<p></p>' },
    })).rejects.toThrow(/style\.css/)
  })

  it('manifest 不合格时把原因说清楚', async () => {
    const harnessed = harness({ roots: [await userRoot()] })
    await expect(toolOf(harnessed, WIDGET_TOOL_NAMES.define).execute({
      id: 'mine',
      manifest: { id: 'mine', title: { zh: '我的' }, version: 'nope', sizes: [] },
      files: { 'index.html': '<p></p>', 'style.css': 'p{}' },
    })).rejects.toThrow(/manifest 不合格/)
  })

  it('文件路径不许越出组件目录', async () => {
    const harnessed = harness({ roots: [await userRoot()] })
    await expect(toolOf(harnessed, WIDGET_TOOL_NAMES.define).execute({
      id: 'mine',
      manifest: { id: 'mine', title: { zh: '我的', en: 'Mine' }, version: '0.1.0', sizes: ['s'] },
      files: { 'index.html': '<p></p>', 'style.css': 'p{}', '../escape.js': 'x' },
    })).rejects.toThrow(/留在组件目录之内/)
  })

  it('覆盖已有的组件要显式带上 replace', async () => {
    const root = await userRoot()
    const harnessed = harness({ roots: [root] })
    // 覆盖一个不在组件库里的 id：没有 replace 时拒绝，带上之后重读发现它没进库也拒绝。
    const args = {
      id: 'fresh',
      manifest: { id: 'fresh', title: { zh: '新的', en: 'Fresh' }, version: '0.1.0', sizes: ['s'] },
      files: { 'index.html': '<p></p>', 'style.css': 'p{}' },
    }
    await expect(toolOf(harnessed, WIDGET_TOOL_NAMES.define).execute({ ...args, replace: true })).rejects.toThrow(/重读之后没有/)
    harnessed.context.records.set('fresh', record('fresh'))
    await expect(toolOf(harnessed, WIDGET_TOOL_NAMES.define).execute(args)).rejects.toThrow(/replace: true/)
  })
})

describe('数据校验的接缝', () => {
  it('没有 schema 时任何数据都放行', () => {
    expect(dataError(undefined, { anything: true })).toBeUndefined()
  })
})
