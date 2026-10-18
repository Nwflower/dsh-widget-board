/**
 * 组件库的读取（D7、D17）：多个来源按优先级合并，单个组件不合格只让它自己不可用。
 *
 * 目录写在 `.debug/` 下，每个测试自己的子目录，跑完删掉；不碰系统临时目录。
 */
import { afterAll, describe, expect, it } from 'vitest'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { contentHash, loadLibrary, readWidget } from '../src/library'

const ROOT = join(process.cwd(), '.debug', 'tests', `library-${String(process.pid)}-${String(Date.now())}`)

/** 一个组件目录的完整写法。 */
interface WidgetSpec {
  id?: string
  version?: string
  files?: Record<string, string>
  /** 不写 widget.json 或把它写坏。 */
  manifest?: string | null
}

/**
 * 在 `root` 下写一个组件目录。
 *
 * @param root - 组件库目录。
 * @param name - 目录名。
 * @param spec - 组件的内容。
 * @returns 组件目录的路径。
 */
async function widget(root: string, name: string, spec: WidgetSpec = {}): Promise<string> {
  const dir = join(root, name)
  await mkdir(dir, { recursive: true })
  const id = spec.id ?? name
  const manifest = spec.manifest === undefined
    ? JSON.stringify({ id, title: { zh: id, en: id }, version: spec.version ?? '0.1.0', sizes: ['s'] })
    : spec.manifest
  if (manifest !== null) await writeFile(join(dir, 'widget.json'), manifest, 'utf8')
  const files: Record<string, string> = { 'index.html': '<p></p>', 'style.css': 'p{}', ...spec.files }
  for (const [path, content] of Object.entries(files)) await writeFile(join(dir, path), content, 'utf8')
  return dir
}

afterAll(async () => {
  await rm(ROOT, { recursive: true, force: true })
})

describe('组件库的来源', () => {
  it('内置与用户目录合并，两个来源的组件都在', async () => {
    const root = join(ROOT, 'merge')
    await widget(join(root, 'builtin'), 'weather')
    await widget(join(root, 'user'), 'todo')
    const load = await loadLibrary([
      { dir: join(root, 'builtin'), source: 'builtin' },
      { dir: join(root, 'user'), source: 'user' },
    ])
    expect([...load.records.keys()].sort()).toEqual(['todo', 'weather'])
    expect(load.records.get('todo')?.source).toBe('user')
    expect(load.errors).toEqual([])
  })

  it('同一个 id 只认先到的来源，后到的记成错误', async () => {
    const root = join(ROOT, 'duplicate')
    await widget(join(root, 'builtin'), 'weather', { files: { 'index.html': '<p>builtin</p>' } })
    await widget(join(root, 'user'), 'weather', { files: { 'index.html': '<p>user</p>' } })
    const load = await loadLibrary([
      { dir: join(root, 'builtin'), source: 'builtin' },
      { dir: join(root, 'user'), source: 'user' },
    ])
    expect(load.records.get('weather')?.files.get('index.html')?.toString()).toBe('<p>builtin</p>')
    expect(load.errors).toHaveLength(1)
    expect(load.errors[0]?.message).toMatch(/已经在/)
  })

  it('用户目录还不存在时按空目录算', async () => {
    const root = join(ROOT, 'missing-user')
    await widget(join(root, 'builtin'), 'weather')
    const load = await loadLibrary([
      { dir: join(root, 'builtin'), source: 'builtin' },
      { dir: join(root, 'user'), source: 'user' },
    ])
    expect(load.records.has('weather')).toBe(true)
    expect(load.errors).toEqual([])
  })

  it('内置目录不存在时抛出：构建没有写出组件', async () => {
    await expect(loadLibrary([{ dir: join(ROOT, 'nowhere'), source: 'builtin' }]))
      .rejects.toThrow(/组件库目录读不出来/)
  })

  it('内置目录一个组件都没有时抛出', async () => {
    const root = join(ROOT, 'empty-builtin')
    await mkdir(root, { recursive: true })
    await expect(loadLibrary([{ dir: root, source: 'builtin' }])).rejects.toThrow(/内置组件库是空的/)
  })
})

describe('不合格的组件', () => {
  it('manifest 不合格只让它自己不可用，其余组件照常读进来', async () => {
    const root = join(ROOT, 'quarantine')
    await widget(join(root, 'builtin'), 'weather')
    await widget(join(root, 'user'), 'broken', { manifest: JSON.stringify({ id: 'Broken Id', title: { zh: '坏', en: 'bad' }, version: '0.1.0', sizes: ['s'] }) })
    const load = await loadLibrary([
      { dir: join(root, 'builtin'), source: 'builtin' },
      { dir: join(root, 'user'), source: 'user' },
    ])
    expect(load.records.has('weather')).toBe(true)
    expect(load.records.has('broken')).toBe(false)
    expect(load.errors).toHaveLength(1)
    expect(load.errors[0]).toMatchObject({ source: 'user', dir: join(root, 'user', 'broken') })
    expect(load.entries.some((entry) => entry.error !== undefined)).toBe(true)
  })

  it('缺少 index.html 时记下原因', async () => {
    const root = join(ROOT, 'missing-file')
    await widget(join(root, 'builtin'), 'weather')
    const dir = join(root, 'builtin', 'todo')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'widget.json'), JSON.stringify({ id: 'todo', title: { zh: '待办', en: 'Todo' }, version: '0.1.0', sizes: ['s'] }), 'utf8')
    await writeFile(join(dir, 'style.css'), 'p{}', 'utf8')
    const load = await loadLibrary([{ dir: join(root, 'builtin'), source: 'builtin' }])
    expect(load.errors[0]?.message).toMatch(/缺少 index\.html/)
  })

  it('凭据声明与提供方限定的数据源名都能读进来', async () => {
    const root = join(ROOT, 'credentials')
    await widget(join(root, 'builtin'), 'weather', {
      manifest: JSON.stringify({
        id: 'weather',
        title: { zh: '天气', en: 'Weather' },
        version: '0.1.0',
        sizes: ['s'],
        source: 'test-provider:demo',
        credentials: [{ ref: 'TEST_KEY', label: { zh: '密钥', en: 'Key' }, required: true }],
      }),
    })
    const load = await loadLibrary([{ dir: join(root, 'builtin'), source: 'builtin' }])
    const record = load.records.get('weather')
    expect(record?.manifest.source).toBe('test-provider:demo')
    expect(record?.manifest.credentials?.[0]).toMatchObject({ ref: 'TEST_KEY', required: true })
  })

  it('凭据 ref 不合法或重复时只让这一个组件不可用', async () => {
    const root = join(ROOT, 'bad-credentials')
    await widget(join(root, 'builtin'), 'weather')
    const base = { version: '0.1.0', sizes: ['s'] }
    await widget(join(root, 'user'), 'bad-ref', {
      manifest: JSON.stringify({ ...base, id: 'bad-ref', title: { zh: '坏', en: 'Bad' }, credentials: [{ ref: '1BAD', label: { zh: '密钥', en: 'Key' } }] }),
    })
    await widget(join(root, 'user'), 'duplicate', {
      manifest: JSON.stringify({
        ...base,
        id: 'duplicate',
        title: { zh: '重', en: 'Duplicate' },
        credentials: [
          { ref: 'TEST_KEY', label: { zh: '密钥', en: 'Key' } },
          { ref: 'TEST_KEY', label: { zh: '密钥', en: 'Key' } },
        ],
      }),
    })
    const load = await loadLibrary([
      { dir: join(root, 'builtin'), source: 'builtin' },
      { dir: join(root, 'user'), source: 'user' },
    ])
    expect(load.records.has('weather')).toBe(true)
    expect(load.records.has('bad-ref')).toBe(false)
    expect(load.records.has('duplicate')).toBe(false)
    expect(load.errors).toHaveLength(2)
    expect(load.errors.map((error) => error.message).join('\n')).toMatch(/重复声明/)
  })
})

describe('内容哈希', () => {
  it('同一份内容算出同一个哈希，与写出顺序无关', async () => {
    const root = join(ROOT, 'hash')
    const one = await readWidget(await widget(join(root, 'one'), 'weather', { files: { 'main.js': 'x()', 'samples.json': '{}' } }), { source: 'builtin' })
    const two = await readWidget(await widget(join(root, 'two'), 'weather', { files: { 'samples.json': '{}', 'main.js': 'x()' } }), { source: 'builtin' })
    expect(one.hash).toBe(two.hash)
  })

  it('改一个字节就换一个哈希', async () => {
    const root = join(ROOT, 'hash-change')
    const before = await readWidget(await widget(join(root, 'a'), 'weather'), { source: 'builtin' })
    const after = await readWidget(await widget(join(root, 'b'), 'weather', { files: { 'style.css': 'p{color:red}' } }), { source: 'builtin' })
    expect(after.hash).not.toBe(before.hash)
  })

  it('哈希覆盖全部文件，不只是 manifest', async () => {
    const files = new Map([['widget.json', Buffer.from('{}')], ['index.html', Buffer.from('<p></p>')]])
    expect(contentHash(files)).toHaveLength(64)
    expect(contentHash(new Map([...files, ['logo.svg', Buffer.from('<svg/>')]]))).not.toBe(contentHash(files))
  })
})
