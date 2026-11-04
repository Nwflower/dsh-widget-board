/**
 * 仓库改动的数据源：读的是真的 Git 改动，解析、目录选择与订阅生命周期都由单元测试盯着。
 *
 * 临时仓库写在 `.debug/` 下，跑完按文件逐个删掉；不碰系统临时目录（根 AGENTS）。
 */
import { execFile } from 'node:child_process'
import { mkdir, readFile, readdir, rmdir, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import type { DataSourceRegistration, InstanceFace, WidgetManifest } from '@dsh-widget-board/contracts'
import type { GitDiffData } from '../src/git-diff'
import {
  GIT_DIFF_INTERVAL_MS,
  GIT_DIFF_LINE_LIMIT,
  GIT_DIFF_NAME,
  GIT_DIFF_PROVIDER,
  GIT_DIFF_SOURCE,
  createGitDiffSource,
  parseUnifiedDiff,
} from '../src/git-diff'
import { dataError } from '../src/schema'

/** 组件目录：读它的 manifest，核对数据源的名字与 data schema。 */
const WIDGET_DIR = join(process.cwd(), 'packages', 'widgets', 'diff')

/** 临时仓库写在 `.debug/` 下：这一条要经过真的文件读写与真的 Git，不碰系统临时目录。 */
const ROOT = join(process.cwd(), '.debug', 'tests', `git-diff-${String(process.pid)}-${String(Date.now())}`)

const FACE: InstanceFace = { id: 'card', widget: 'diff', props: {} }

/**
 * 删掉一棵目录树：按文件逐个删，再从最深处往上删空目录。
 *
 * 不做递归删除（根 AGENTS）：链接只删链接本身，目录要空了才删得掉。
 *
 * @param dir - 要删的目录。
 */
async function removeTree(dir: string): Promise<void> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      await removeTree(full)
      continue
    }
    await unlink(full)
  }
  await rmdir(dir)
}

/**
 * 在一个目录里跑一条 Git 命令。
 *
 * @param cwd - 目标目录。
 * @param args - 命令的参数。
 * @returns 命令的标准输出。
 */
async function git(cwd: string, ...args: string[]): Promise<string> {
  return await new Promise((resolve, reject) => {
    execFile('git', args, { cwd, windowsHide: true, encoding: 'utf8' }, (error, stdout) => {
      if (error) reject(error)
      else resolve(stdout)
    })
  })
}

/**
 * 建一个真的 Git 仓库：一次提交，文件里是给定的内容。
 *
 * @param name - 仓库目录名。
 * @param content - 提交进仓库的文件内容。
 * @returns 仓库目录。
 */
async function makeRepo(name: string, content: string): Promise<string> {
  const dir = join(ROOT, name)
  await mkdir(dir, { recursive: true })
  await git(dir, 'init')
  await git(dir, 'config', 'user.email', 'board@example.com')
  await git(dir, 'config', 'user.name', 'Widget Board')
  await git(dir, 'config', 'commit.gpgsign', 'false')
  await writeFile(join(dir, 'a.ts'), content, 'utf8')
  await git(dir, 'add', 'a.ts')
  await git(dir, 'commit', '-m', 'first')
  return dir
}

/**
 * 等一个条件成立。
 *
 * @param ready - 条件。
 * @param what - 等不到时说什么。
 */
async function until(ready: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (ready()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`等不到${what}`)
}

/**
 * 读一次数据源。
 *
 * @param source - 数据源。
 * @param face - 读哪张卡。
 * @returns 读到的数据。
 */
async function read(source: DataSourceRegistration, face: InstanceFace = FACE): Promise<GitDiffData> {
  return await source.read(face) as GitDiffData
}

afterAll(async () => {
  await removeTree(ROOT)
})

describe('仓库改动的数据源', () => {
  it('用 manifest 里点名的名字注册，并且不要权限', () => {
    const source = createGitDiffSource({})
    expect(source.provider).toBe(GIT_DIFF_PROVIDER)
    expect(source.id).toBe(GIT_DIFF_SOURCE)
    expect(GIT_DIFF_NAME).toBe('widget-board:git.diff')
    expect(source.permission).toBeUndefined()
  })

  it('组件 manifest 声明的就是这一个数据源', async () => {
    const manifest = JSON.parse(await readFile(join(WIDGET_DIR, 'widget.json'), 'utf8')) as WidgetManifest
    expect(manifest.source).toBe(GIT_DIFF_NAME)
  })
})

describe('unified diff 的解析', () => {
  it('一个文件里的新增、删除与上下文各归各的类，文件路径自成一行', () => {
    const raw = [
      'diff --git a/src/a.ts b/src/a.ts',
      'index 1111111..2222222 100644',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,4 +1,4 @@',
      ' const one = 1',
      '-const two = 2',
      '+const two = 22',
      ' const three = 3',
      '',
    ].join('\n')
    expect(parseUnifiedDiff(raw)).toEqual([
      { type: 'meta', text: 'src/a.ts' },
      { type: 'context', text: 'const one = 1' },
      { type: 'remove', text: 'const two = 2' },
      { type: 'add', text: 'const two = 22' },
      { type: 'context', text: 'const three = 3' },
    ])
  })

  it('多个文件各有一段，路径按次序出现', () => {
    const raw = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1 +1 @@',
      '-const one = 1',
      'diff --git a/src/b.ts b/src/b.ts',
      'new file mode 100644',
      'index 0000000..3333333',
      '--- /dev/null',
      '+++ b/src/b.ts',
      '@@ -0,0 +1,2 @@',
      '+export const four = 4',
      '+export const five = 5',
      '',
    ].join('\n')
    expect(parseUnifiedDiff(raw)).toEqual([
      { type: 'meta', text: 'src/a.ts' },
      { type: 'remove', text: 'const one = 1' },
      { type: 'meta', text: 'src/b.ts' },
      { type: 'add', text: 'export const four = 4' },
      { type: 'add', text: 'export const five = 5' },
    ])
  })

  it('删除的文件从另一侧取路径', () => {
    const raw = [
      'diff --git a/gone.ts b/gone.ts',
      'deleted file mode 100644',
      'index 1111111..0000000',
      '--- a/gone.ts',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-export const gone = true',
      '',
    ].join('\n')
    expect(parseUnifiedDiff(raw)).toEqual([
      { type: 'meta', text: 'gone.ts' },
      { type: 'remove', text: 'export const gone = true' },
    ])
  })

  it('二进制与改名的文件头不带改动内容', () => {
    const raw = [
      'diff --git a/logo.png b/logo.png',
      'index 1111111..2222222 100644',
      'Binary files a/logo.png and b/logo.png differ',
      'diff --git a/old.ts b/new.ts',
      'similarity index 100%',
      'rename from old.ts',
      'rename to new.ts',
      '',
    ].join('\n')
    expect(parseUnifiedDiff(raw)).toEqual([])
  })

  it('最多收 400 行', () => {
    const body = Array.from({ length: 500 }, (_, index) => `+line ${String(index)}`)
    const raw = ['diff --git a/a.ts b/a.ts', '--- a/a.ts', '+++ b/a.ts', '@@ -1,0 +1,500 @@', ...body, ''].join('\n')
    const lines = parseUnifiedDiff(raw)
    expect(lines).toHaveLength(GIT_DIFF_LINE_LIMIT)
    expect(lines[0]).toEqual({ type: 'meta', text: 'a.ts' })
    expect(lines[GIT_DIFF_LINE_LIMIT - 1]).toEqual({ type: 'add', text: 'line 398' })
  })

  it('一行文字最长 400 个字符', () => {
    const raw = ['diff --git a/a.ts b/a.ts', '--- a/a.ts', '+++ b/a.ts', '@@ -1 +1 @@', `+${'x'.repeat(600)}`, ''].join('\n')
    expect(parseUnifiedDiff(raw)[1]?.text).toHaveLength(400)
  })
})

describe('读一个真的仓库', () => {
  it('读的是工作区里未提交的改动', async () => {
    const dir = await makeRepo('dirty', 'const one = 1\nconst two = 2\n')
    await writeFile(join(dir, 'a.ts'), 'const one = 1\nconst two = 22\n', 'utf8')
    const data = await read(createGitDiffSource({ defaultCwd: dir }))
    expect(data.lines).toContainEqual({ type: 'remove', text: 'const two = 2' })
    expect(data.lines).toContainEqual({ type: 'add', text: 'const two = 22' })
    expect(data.lines).toContainEqual({ type: 'meta', text: 'a.ts' })
  })

  it('工作区干净时退回最近一次提交的改动', async () => {
    const dir = await makeRepo('clean', 'const committed = 1\n')
    const data = await read(createGitDiffSource({ defaultCwd: dir }))
    expect(data.lines).toContainEqual({ type: 'add', text: 'const committed = 1' })
    expect(data.lines).toContainEqual({ type: 'meta', text: 'a.ts' })
  })

  it('目录不存在时给空改动，不抛出去', async () => {
    const data = await read(createGitDiffSource({ defaultCwd: join(ROOT, 'missing') }))
    expect(data).toEqual({ lines: [] })
  })

  it('仓库还没有第一次提交时给空改动', async () => {
    const dir = join(ROOT, 'fresh')
    await mkdir(dir, { recursive: true })
    await git(dir, 'init')
    const data = await read(createGitDiffSource({ defaultCwd: dir }))
    expect(data).toEqual({ lines: [] })
  })

  it('读到的数据与组件 manifest 的 data schema 相符', async () => {
    const dir = await makeRepo('schema', 'const one = 1\n')
    await writeFile(join(dir, 'a.ts'), 'const one = 2\n', 'utf8')
    const manifest = JSON.parse(await readFile(join(WIDGET_DIR, 'widget.json'), 'utf8')) as WidgetManifest
    const data = await read(createGitDiffSource({ defaultCwd: dir }))
    expect(dataError(manifest.data, data)).toBeUndefined()
  })
})

describe('读哪个目录', () => {
  it('卡片自己填的路径最优先', async () => {
    const alpha = await makeRepo('pinned-alpha', 'const alpha = 1\n')
    const beta = await makeRepo('pinned-beta', 'const beta = 1\n')
    const source = createGitDiffSource({
      sessions: () => ({ list: () => [{ id: 'one', header: { cwd: alpha } }] }),
      workspaces: () => ({ list: () => [{ id: 'space', path: beta }] }),
      defaultCwd: alpha,
    })
    const data = await read(source, { id: 'card', widget: 'diff', props: { cwd: beta } })
    expect(data.lines).toContainEqual({ type: 'add', text: 'const beta = 1' })
    expect(data.lines).not.toContainEqual({ type: 'add', text: 'const alpha = 1' })
  })

  it('没填路径时跟最后一个有工作目录的会话', async () => {
    const alpha = await makeRepo('session-alpha', 'const alpha = 1\n')
    const beta = await makeRepo('session-beta', 'const beta = 1\n')
    const source = createGitDiffSource({
      sessions: () => ({ list: () => [{ id: 'one', header: { cwd: alpha } }, { id: 'two', header: { cwd: beta } }] }),
      workspaces: () => ({ list: () => [{ id: 'space', path: alpha }] }),
      defaultCwd: alpha,
    })
    const data = await read(source)
    expect(data.lines).toContainEqual({ type: 'add', text: 'const beta = 1' })
  })

  it('会话没有工作目录时取第一个工作区', async () => {
    const alpha = await makeRepo('space-alpha', 'const alpha = 1\n')
    const beta = await makeRepo('space-beta', 'const beta = 1\n')
    const source = createGitDiffSource({
      sessions: () => ({ list: () => [{ id: 'one' }] }),
      workspaces: () => ({ list: () => [{ id: 'space', path: beta }, { id: 'other', path: alpha }] }),
      defaultCwd: alpha,
    })
    const data = await read(source)
    expect(data.lines).toContainEqual({ type: 'add', text: 'const beta = 1' })
  })

  it('都没有时用兜底的目录', async () => {
    const alpha = await makeRepo('fallback-alpha', 'const alpha = 1\n')
    const data = await read(createGitDiffSource({ defaultCwd: alpha }))
    expect(data.lines).toContainEqual({ type: 'add', text: 'const alpha = 1' })
  })
})

describe('订阅的生命周期', () => {
  afterEach(() => { vi.useRealTimers() })

  it('订阅时先给一份当下的改动，之后每个间隔再给一份', async () => {
    // 只假 setInterval：Git 要真的跑，等推送要借真的 setTimeout。
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const dir = await makeRepo('sub', 'const sub = 1\n')
    const source = createGitDiffSource({ defaultCwd: dir })
    const subscribe = source.subscribe
    if (subscribe === undefined) throw new Error('仓库改动的数据源应当声明 subscribe')
    const pushed: GitDiffData[] = []
    const stop = subscribe(FACE, (data) => { pushed.push(data as GitDiffData) })
    await until(() => pushed.length >= 1, '订阅时的第一份改动')
    expect(pushed[0]?.lines).toContainEqual({ type: 'add', text: 'const sub = 1' })
    vi.advanceTimersByTime(GIT_DIFF_INTERVAL_MS)
    await until(() => pushed.length >= 2, '下一个间隔的那一份改动')
    stop()
  })

  it('退订之后不再回调', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const dir = await makeRepo('stop', 'const stop = 1\n')
    const source = createGitDiffSource({ defaultCwd: dir })
    const subscribe = source.subscribe
    if (subscribe === undefined) throw new Error('仓库改动的数据源应当声明 subscribe')
    const pushed: GitDiffData[] = []
    const stop = subscribe(FACE, (data) => { pushed.push(data as GitDiffData) })
    await until(() => pushed.length >= 1, '订阅时的第一份改动')
    stop()
    vi.advanceTimersByTime(GIT_DIFF_INTERVAL_MS * 3)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(pushed).toHaveLength(1)
  })

  it('目录不在时给空改动，不报失败', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const source = createGitDiffSource({ defaultCwd: join(ROOT, 'gone') })
      const subscribe = source.subscribe
      if (subscribe === undefined) throw new Error('仓库改动的数据源应当声明 subscribe')
      const pushed: GitDiffData[] = []
      const stop = subscribe(FACE, (data) => { pushed.push(data as GitDiffData) })
      await until(() => pushed.length >= 1, '订阅时的第一份改动')
      stop()
      // 目录不在时读出来的是空改动，不是失败。
      expect(pushed[0]).toEqual({ lines: [] })
      expect(errors).not.toHaveBeenCalled()
    } finally {
      errors.mockRestore()
    }
  })
})
