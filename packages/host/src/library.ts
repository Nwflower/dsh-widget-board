/**
 * 组件库：读组件目录，校验 manifest，算出内容哈希（D7）。
 *
 * 校验用 Ajv，schema 在 `contracts` 里；不合格的组件不进组件库，错误原样写出。哈希对排序后的
 * 「路径加内容」计算，与打包方式无关，同一个组件在别的机器上算出同一个哈希。
 */
import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import Ajv from 'ajv'
import type { WidgetManifest } from '@dsh-widget-board/contracts'
import { WIDGET_MANIFEST_SCHEMA } from '@dsh-widget-board/contracts'

/** 一个可用的组件版本：manifest、目录、内容哈希与目录里的全部文件。 */
export interface WidgetRecord {
  manifest: WidgetManifest
  dir: string
  hash: string
  /** 组件目录内的相对路径（正斜杠）到内容。 */
  files: Map<string, Buffer>
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
function contentHash(files: Map<string, Buffer>): string {
  const digest = createHash('sha256')
  for (const path of [...files.keys()].sort()) {
    digest.update(path)
    digest.update('\0')
    digest.update(createHash('sha256').update(files.get(path) as Buffer).digest())
  }
  return digest.digest('hex')
}

/**
 * 读一个组件目录。
 *
 * @param dir - 组件目录。
 * @returns 校验通过的组件记录。
 * @throws {Error} manifest 缺失或不合法，或缺少必需的标记文件。
 */
export async function readWidget(dir: string): Promise<WidgetRecord> {
  const files = await readTree(dir)
  const manifestFile = files.get('widget.json')
  if (manifestFile === undefined) throw new Error(`${dir} 里没有 widget.json（D7）`)
  const manifest = JSON.parse(manifestFile.toString('utf8')) as WidgetManifest
  if (!validate(manifest)) {
    const reasons = (validate.errors ?? []).map((error) => `${error.instancePath || '/'} ${error.message ?? ''}`.trim())
    throw new Error(`${dir}/widget.json 不合格：${reasons.join('；')}`)
  }
  for (const required of ['index.html', 'style.css']) {
    if (!files.has(required)) throw new Error(`${dir} 缺少 ${required}（D7）`)
  }
  return { manifest, dir, hash: contentHash(files), files }
}

/**
 * 读组件库目录下的全部组件。
 *
 * @param dir - 组件库目录，其下每个子目录是一个组件。
 * @returns 组件 id 到记录的映射。
 * @throws {Error} 目录读不出来，或某个组件不合格。
 */
export async function loadLibrary(dir: string): Promise<Map<string, WidgetRecord>> {
  const library = new Map<string, WidgetRecord>()
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    throw new Error(`组件库目录读不出来：${dir}（${(error as Error).message}）`)
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const record = await readWidget(join(dir, entry.name))
    const existing = library.get(record.manifest.id)
    if (existing !== undefined) throw new Error(`两个组件用了同一个 id：${record.manifest.id}（${existing.dir} 与 ${record.dir}）`)
    library.set(record.manifest.id, record)
  }
  if (library.size === 0) throw new Error(`组件库是空的：${dir}`)
  return library
}
