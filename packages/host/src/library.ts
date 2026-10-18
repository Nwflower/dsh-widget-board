/**
 * 组件库：读组件目录，校验 manifest，算出内容哈希（D7）。
 *
 * 组件库有多个来源（D17）：包内的内置组件、用户目录里的组件、插件注册的目录。来源按传入的顺序
 * 优先，同一个 id 只认第一个。一个目录读不出来、manifest 不合格、或 id 已被占用，都只让这一个
 * 类型不可用：它进 `entries` 并带上原因，其余组件照常可用。用户与插件来源的目录不存在时按空目录
 * 算，包内的来源例外——它读不出东西说明构建没有写完，直接抛出。
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import Ajv from 'ajv'
import type { WidgetLibraryEntry, WidgetLibraryError, WidgetManifest, WidgetRoot } from '@dsh-widget-board/contracts'
import { WIDGET_MANIFEST_SCHEMA } from '@dsh-widget-board/contracts'
import { isRecord } from './guards'

/** 一个可用的组件版本：manifest、来源、目录、内容哈希与目录里的全部文件。 */
export interface WidgetRecord {
  manifest: WidgetManifest
  source: WidgetRoot['source']
  provider?: string
  dir: string
  hash: string
  /** 组件目录内的相对路径（正斜杠）到内容。 */
  files: Map<string, Buffer>
}

/** 一次读组件库的结果：可用的组件、给界面的全部类型与失败的原因。 */
export interface LibraryLoad {
  records: Map<string, WidgetRecord>
  entries: WidgetLibraryEntry[]
  errors: WidgetLibraryError[]
}

const ajv = new Ajv({ allErrors: true, strict: true })
const validate = ajv.compile(WIDGET_MANIFEST_SCHEMA)

/**
 * 一个目录里的全部文件，键是相对路径。
 *
 * @param dir - 组件目录。
 * @param prefix - 已经走过的相对路径。
 * @returns 相对路径到内容的映射。
 */
async function readTree(dir: string, prefix = ''): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>()
  for (const entry of await readdir(join(dir, prefix), { withFileTypes: true })) {
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) {
      for (const [name, content] of await readTree(dir, path)) files.set(name, content)
    } else if (entry.isFile()) {
      files.set(path, await readFile(join(dir, path)))
    }
  }
  return files
}

/**
 * 内容哈希：排序后的「路径加内容」（D7）。
 *
 * @param files - 组件目录里的全部文件。
 * @returns 十六进制摘要。
 */
export function contentHash(files: Map<string, Buffer>): string {
  const digest = createHash('sha256')
  for (const path of [...files.keys()].sort()) {
    digest.update(path)
    digest.update('\0')
    digest.update(createHash('sha256').update(files.get(path) as Buffer).digest())
  }
  return digest.digest('hex')
}

/**
 * 一份 manifest 的问题（D7、D22）：schema 校验与凭据引用的唯一性。
 *
 * 读组件库与 `widget_define` 共用这一条，免得两处对同一份 manifest 给出不同的判定。
 *
 * @param value - 解出来的 widget.json。
 * @returns 不合格时的原因，合格时为 `undefined`。
 */
export function manifestProblem(value: unknown): string | undefined {
  if (!isRecord(value)) return 'manifest 要是一个对象'
  if (!validate(value)) {
    const reasons = (validate.errors ?? []).map((error) => `${error.instancePath || '/'} ${error.message ?? ''}`.trim())
    return `manifest 不合格：${reasons.join('；')}`
  }
  const manifest = value as unknown as WidgetManifest
  const refs = manifest.credentials?.map((credential) => credential.ref) ?? []
  const duplicate = refs.find((ref, index) => refs.indexOf(ref) !== index)
  if (duplicate !== undefined) return `manifest 不合格：凭据 ${duplicate} 重复声明`
  return undefined
}

/**
 * 读一个组件目录。
 *
 * @param dir - 组件目录。
 * @param root - 它属于哪个来源。
 * @returns 校验通过的组件记录。
 * @throws {Error} manifest 缺失或不合法，或缺少必需的标记文件。
 */
export async function readWidget(dir: string, root: Pick<WidgetRoot, 'source' | 'provider'>): Promise<WidgetRecord> {
  const files = await readTree(dir)
  const manifestFile = files.get('widget.json')
  if (manifestFile === undefined) throw new Error(`${dir} 里没有 widget.json（D7）`)
  const manifest = JSON.parse(manifestFile.toString('utf8')) as WidgetManifest
  const problem = manifestProblem(manifest)
  if (problem !== undefined) throw new Error(`${dir}/widget.json：${problem}`)
  for (const required of ['index.html', 'style.css']) {
    if (!files.has(required)) throw new Error(`${dir} 缺少 ${required}（D7）`)
  }
  return { manifest, source: root.source, ...(root.provider === undefined ? {} : { provider: root.provider }), dir, hash: contentHash(files), files }
}

/** 一个记录在界面上的样子。 */
function entryOf(record: WidgetRecord): WidgetLibraryEntry {
  const { manifest } = record
  return {
    id: manifest.id,
    source: record.source,
    ...(record.provider === undefined ? {} : { provider: record.provider }),
    title: manifest.title,
    ...(manifest.description === undefined ? {} : { description: manifest.description }),
    sizes: manifest.sizes,
    hash: record.hash,
  }
}

/** 一个读不出来的目录在界面上的样子：名字取目录名，原因写在 `error` 里。 */
function failureEntry(root: WidgetRoot, dir: string, message: string): WidgetLibraryEntry {
  const name = dir.split(/[\\/]/).pop() ?? dir
  return {
    id: `${root.provider ?? root.source}/${name}`,
    source: root.source,
    ...(root.provider === undefined ? {} : { provider: root.provider }),
    title: { zh: name, en: name },
    sizes: [],
    error: message,
  }
}

/**
 * 读一个来源下的全部组件；单个组件不合格只记下原因，不进组件库。
 *
 * @param root - 来源目录。
 * @param load - 正在拼起来的结果。
 */
async function readRoot(root: WidgetRoot, load: LibraryLoad): Promise<void> {
  let entries
  try {
    entries = await readdir(root.dir, { withFileTypes: true })
  } catch (error) {
    // 用户与插件来源的目录可以还不存在；包内来源读不出来是构建没写完（D11）。
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' && root.source !== 'builtin') return
    throw new Error(`组件库目录读不出来：${root.dir}（${(error as Error).message}）`)
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dir = join(root.dir, entry.name)
    let record: WidgetRecord
    try {
      record = await readWidget(dir, root)
    } catch (error) {
      const message = (error as Error).message
      load.errors.push({
        source: root.source,
        ...(root.provider === undefined ? {} : { provider: root.provider }),
        dir,
        message,
      })
      load.entries.push(failureEntry(root, dir, message))
      continue
    }
    const existing = load.records.get(record.manifest.id)
    if (existing !== undefined) {
      const message = `组件 id ${record.manifest.id} 已经在 ${existing.dir} 里用过，这一个没有读进来`
      load.errors.push({
        source: root.source,
        ...(root.provider === undefined ? {} : { provider: root.provider }),
        dir,
        id: record.manifest.id,
        message,
      })
      continue
    }
    load.records.set(record.manifest.id, record)
    load.entries.push(entryOf(record))
  }
}

/**
 * 把一个组件目录整个写出来：先清掉旧的，再逐份写。
 *
 * 覆盖时先清掉旧目录：删掉的文件不该留在新版本里——版本就是整个目录的内容（D7）。
 *
 * @param dir - 组件目录的绝对路径。
 * @param files - 相对路径与内容；路径已经由调用方校验过不越出目录。
 */
export async function writeWidgetDirectory(dir: string, files: readonly { path: string, content: Uint8Array }[]): Promise<void> {
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })
  for (const file of files) {
    const target = join(dir, file.path)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, file.content)
  }
}

/**
 * 读组件库的全部来源。
 *
 * @param roots - 来源目录，按优先级排列；包内的来源必须能读出组件。
 * @returns 可用的组件、给界面的全部类型与失败的原因。
 * @throws {Error} 包内的来源目录读不出来，或它一个组件都没读出来。
 */
export async function loadLibrary(roots: readonly WidgetRoot[]): Promise<LibraryLoad> {
  const load: LibraryLoad = { records: new Map(), entries: [], errors: [] }
  let builtin = 0
  for (const root of roots) {
    const before = load.records.size
    await readRoot(root, load)
    if (root.source === 'builtin') builtin += load.records.size - before
  }
  if (builtin === 0) {
    throw new Error(`内置组件库是空的：${roots.filter((root) => root.source === 'builtin').map((root) => root.dir).join('、')}（D7）`)
  }
  return load
}
