/**
 * 用户组件的共享写入服务（技术契约 4）。
 *
 * 三条入口——`widget_define` 工具、页面里的高级源码编辑、`.dshw` 导入——都经这一份写入，不各自写
 * 一套来源保护与并发核对（技术契约 4 的「工具入口、UI 入口和导入入口均执行来源保护」）。
 *
 * 一条写入分成三步：先核对来源与并发（只读源不能就地改，版本对不上就冲突），再把新目录完整地搭
 * 出来并验证，最后用同父目录的暂存→验证→交换替换旧目录。旧版本在交换之后才清理：读库时看到的是
 * 完整的一份，不是半写的（D5）。
 */
import { mkdir, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { WidgetManifest, WidgetRoot, WidgetSource } from '@dsh-widget-board/contracts'
import { isRecord } from '../guards'
import { manifestProblem, readWidget, writeTree } from '../library'
import type { WidgetRecord } from '../library'
import { Refusal } from '../refusal'
import { buildDocument, freshNonce } from '../document'
import type { DocumentAssets } from '../document'

/** 组件 id 的形状：与 `widget_define` 与 manifest 的 schema 一致。 */
export const WIDGET_ID_PATTERN = /^[a-z][a-z0-9-]{1,39}$/

/** 一个组件目录里最多几个文件（技术契约 4）。 */
export const WIDGET_MAX_FILES = 64

/** 单个文件最多多少字节。 */
export const WIDGET_MAX_FILE_BYTES = 4 * 1024 * 1024

/** 整个组件目录最多多少字节。 */
export const WIDGET_MAX_TOTAL_BYTES = 16 * 1024 * 1024

/** 一份文件：相对路径与内容。 */
export interface WidgetFileInput {
  path: string
  content: string | Buffer
}

/** 一次写入要落到磁盘的全部内容。 */
export interface WidgetWriteRequest {
  /** 组件 id：它决定目录名，manifest 的 id 要与它一致。 */
  id: string
  /** manifest 的内容。 */
  manifest: unknown
  /** 组件目录里的文件；`widget.json` 由 manifest 生成，不必在这里。 */
  files: readonly WidgetFileInput[]
  /**
   * 更新时读到的版本哈希。
   *
   * 新建时不带；更新时必须带。对不上就是并发冲突，由调用方回 409（C4）。
   */
  expectedHash?: string
}

/** 一次写入的结果。 */
export interface WidgetWriteResult {
  id: string
  hash: string
  created: boolean
  dir: string
  files: string[]
}

/**
 * 把一个路径规范化成组件目录里的相对路径。
 *
 * 绝对路径、回到上一层与空路径都拒绝：组件目录里的文件不许越出它（D3）。
 *
 * @param path - 原始路径。
 * @returns 规范化的相对路径。
 * @throws {Refusal} 路径不合法。
 */
export function normalizeWidgetPath(path: string): string {
  const normalized = path.replaceAll('\\', '/')
  if (normalized === '') throw new Refusal(400, '组件目录里有一个空路径')
  if (normalized.startsWith('/')) throw new Refusal(400, `文件路径 ${path} 要留在组件目录之内`)
  if (/^[a-zA-Z]:/.test(normalized)) throw new Refusal(400, `文件路径 ${path} 要留在组件目录之内`)
  if (normalized.split('/').some((part) => part === '..' || part === '.' || part === '' || /[<>:"|?*\u0000-\u001f]/.test(part) || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Refusal(400, `文件路径 ${path} 要留在组件目录之内`)
  return normalized
}

/**
 * 校验一组文件能不能写进组件目录。
 *
 * 文件数、单个文件与总量各有上限；`widget.json` 不在这一组里——它由 manifest 生成。
 *
 * @param files - 这次要写的文件。
 * @throws {Refusal} 数量或体积超限。
 */
export function checkWidgetFiles(files: readonly WidgetFileInput[]): void {
  if (files.length > WIDGET_MAX_FILES) {
    throw new Refusal(413, `组件目录最多 ${String(WIDGET_MAX_FILES)} 个文件，这里有 ${String(files.length)} 个`)
  }
  let total = 0
  for (const file of files) {
    const bytes = typeof file.content === 'string' ? Buffer.byteLength(file.content, 'utf8') : file.content.byteLength
    if (bytes > WIDGET_MAX_FILE_BYTES) {
      throw new Refusal(413, `${file.path} 超过 ${String(WIDGET_MAX_FILE_BYTES)} 字节`)
    }
    total += bytes
  }
  if (total > WIDGET_MAX_TOTAL_BYTES) {
    throw new Refusal(413, `组件目录解开之后超过 ${String(WIDGET_MAX_TOTAL_BYTES)} 字节`)
  }
}

/**
 * 用户组件的目录：写入与读取都按它找地方。
 *
 * @param roots - 组件来源表。
 * @returns 用户来源的目录。
 * @throws {Refusal} 没有可写的用户目录。
 */
export function userRootOf(roots: readonly WidgetRoot[]): WidgetRoot {
  const root = roots.find((candidate) => candidate.source === 'user')
  if (root === undefined) throw new Refusal(500, '没有可写的用户组件目录')
  return root
}

/**
 * 一个只读来源上的建议 id：另存为一个新的用户组件时用它做默认名（C4）。
 *
 * @param id - 原组件的 id。
 * @param source - 原组件的来源。
 * @returns 建议的用户组件 id。
 */
export function suggestedUserId(id: string, source: WidgetSource): string {
  void source
  const slug = id.replace(/[^a-z0-9-]/g, '-').replace(/^-+/, '').replace(/-+$/, '').slice(0, 24) || 'widget'
  // 目录名要与 manifest 的 id 一致（C4）；`user-` 前缀说明它是从别处复制来的。
  return `user-${slug}-${randomUUID().slice(0, 8)}`.slice(0, 40)
}

/**
 * 把一次写入要落的文件摊开：manifest 生成 `widget.json`，其余按原样。
 *
 * @param manifest - 校验过的 manifest。
 * @param files - 其余文件。
 * @returns 目录里的全部文件。
 */
function filesOf(manifest: WidgetManifest, files: readonly WidgetFileInput[]): { path: string, content: Buffer }[] {
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`
  const all = [
    { path: 'widget.json', content: Buffer.from(manifestText, 'utf8') },
    ...files.map((file) => ({ path: file.path, content: typeof file.content === 'string' ? Buffer.from(file.content, 'utf8') : file.content })),
  ]
  const seen = new Set<string>()
  for (const file of all) {
    const key = file.path.toLowerCase()
    if (seen.has(key)) throw new Refusal(400, `文件 ${file.path} 出现了两次`)
    seen.add(key)
  }
  return all
}

/**
 * 写一个用户组件类型：核对来源与并发，搭出完整的新目录，再替换旧目录。
 *
 * 只读来源（内置与插件提供）不能就地改：调用方先把它另存为一个新的用户组件 id，再走这里。更新
 * 已有用户组件时要带 `expectedHash`：对不上说明别人改过，返回 409 而不是覆盖（C4）。
 *
 * `records` 是取当前组件库的方法而不是它自己：重读组件库会换掉整张表（D17），拿着旧的那一份
 * 会在写完之后以为组件没进库。
 *
 * @param options.roots - 组件来源表。
 * @param options.records - 取当前组件库。
 * @param options.request - 这次写入的内容。
 * @param options.reload - 写完之后重读组件库。
 * @returns 写下的组件。
 * @throws {Refusal} 来源不允许、并发冲突、manifest 或文件不合法、超过上限。
 */
const writes = new Map<string, Promise<unknown>>()

export async function writeWidgetType(options: Parameters<typeof writeUnlocked>[0]): Promise<WidgetWriteResult> {
  return await withUserWidgetWrite(options.roots, async () => await writeUnlocked(options))
}

/** 正常写入与导入恢复共用同一用户目录队列，版本核对和目录交换在队列内完成。 */
export async function withUserWidgetWrite<T>(roots: readonly WidgetRoot[], change: () => Promise<T>): Promise<T> {
  const key = userRootOf(roots).dir
  const previous = writes.get(key) ?? Promise.resolve()
  const pending = previous.catch(() => undefined).then(change)
  writes.set(key, pending)
  try {
    return await pending
  } finally {
    if (writes.get(key) === pending) writes.delete(key)
  }
}

async function writeUnlocked(options: {
  assets?: DocumentAssets
  roots: readonly WidgetRoot[]
  records: () => Map<string, WidgetRecord>
  request: WidgetWriteRequest
  reload: () => Promise<void>
}): Promise<WidgetWriteResult> {
  const { roots, request, reload } = options
  if (!WIDGET_ID_PATTERN.test(request.id)) {
    throw new Refusal(400, `组件 id 要匹配 ${WIDGET_ID_PATTERN.source}：${request.id}`)
  }
  const problem = manifestProblem(request.manifest)
  if (problem !== undefined) throw new Refusal(400, problem)
  const manifest = request.manifest as WidgetManifest
  if (manifest.id !== request.id) {
    throw new Refusal(400, `manifest.id 是 ${manifest.id}，与 id ${request.id} 不一致`)
  }
  const files = request.files.map((file) => ({ path: normalizeWidgetPath(file.path), content: file.content }))
  checkWidgetFiles(files)
  const all = filesOf(manifest, files)
  checkWidgetFiles(all)

  const root = userRootOf(roots)
  const existing = options.records().get(request.id)
  if (existing !== undefined && existing.source !== 'user') {
    // 只读源：内置与插件提供的组件不落在用户目录里，导入与编辑都另存为一个新的 id（技术契约 4）。
    throw new Refusal(403, `${request.id} 是${existing.source === 'builtin' ? '内置' : '插件提供'}的组件，不能就地改；另存为一个新的用户组件`, {
      code: 'readonly-source',
      source: existing.source,
    })
  }
  if (existing !== undefined) {
    if (request.expectedHash === undefined || request.expectedHash === '') {
      throw new Refusal(409, `更新 ${request.id} 要带上读到的 expectedHash`, { code: 'expected-hash-required' })
    }
    if (request.expectedHash !== existing.hash) {
      throw new Refusal(409, `${request.id} 在你编辑期间变过，重读之后再来`, {
        code: 'stale-hash',
        current: existing.hash,
      })
    }
  } else if (request.expectedHash !== undefined && request.expectedHash !== '') {
    throw new Refusal(409, `${request.id} 现在不在组件库里；先重读组件库再决定`, { code: 'stale-hash' })
  }

  const dir = join(root.dir, request.id)
  await mkdir(root.dir, { recursive: true })
  // 同父目录下的暂存目录：交换时目录项的改名是原子的，读库不会看到半写状态（D5）。
  const temporaryId = randomUUID()
  const staging = join(dirname(root.dir), `.widget-${temporaryId}.staging`)
  const retired = join(dirname(root.dir), `.widget-${temporaryId}.retired`)
  await writeTree(staging, all)
  // 先验证暂存目录：manifest 与必需文件不合格时不碰旧目录。
  let staged: WidgetRecord
  try {
    staged = await readWidget(staging, { source: 'user' })
    if (options.assets !== undefined) buildDocument(staged, options.assets, freshNonce(), { lang: 'zh-CN' })
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    throw new Refusal(400, (error as Error).message)
  }
  const created = existing === undefined
  if (created) {
    await rename(staging, dir)
  } else {
    await rename(dir, retired)
    try {
      await rename(staging, dir)
    } catch (error) {
      // 交换失败就把旧目录放回去：磁盘上不留半个组件（D11）。
      await rename(retired, dir)
      throw error
    }
    // 旧版本已经入版本库（`reload` 会记住它）之后才清理旧目录。
    try {
      await reload()
    } catch (error) {
      await rename(dir, staging)
      await rename(retired, dir)
      await rm(staging, { recursive: true, force: true })
      await reload()
      throw error
    }
    await rm(retired, { recursive: true, force: true })
  }
  await reload()
  const record = options.records().get(request.id)
  if (record === undefined) {
    throw new Refusal(500, `写完了，但组件库重读之后没有 ${request.id}；检查目录里的文件`)
  }
  return {
    id: request.id,
    hash: record.hash,
    created,
    dir: record.dir,
    files: all.map((file) => file.path),
  }
}

/**
 * 读一个组件类型的全部源码（技术契约 4）。
 *
 * 凭据值不在这里：manifest 只声明凭据的名字与用途，值由宿主的凭据服务保存（D27）。二进制资源
 * 按大小列出，不按文本读回——它们进编辑器没有意义。
 *
 * @param record - 组件库里的记录。
 * @param roots - 组件来源表；用来判断这个来源能不能就地改。
 * @returns 源码读模型。
 */
export function sourceModelOf(record: WidgetRecord, roots: readonly WidgetRoot[]): {
  id: string
  source: WidgetSource
  provider?: string
  title: WidgetManifest['title']
  hash: string
  manifest: string
  files: Record<string, string>
  assets: { path: string, bytes: number }[]
  binaryFiles: Record<string, string>
  writable: boolean
  suggestedId?: string
} {
  const manifestFile = record.files.get('widget.json')
  const manifestText = manifestFile === undefined ? '{}' : manifestFile.toString('utf8')
  const files: Record<string, string> = {}
  const assets: { path: string, bytes: number }[] = []
  const binaryFiles: Record<string, string> = {}
  for (const [path, content] of record.files) {
    if (path === 'widget.json') continue
    if (isTextual(path)) files[path] = content.toString('utf8')
    else {
      assets.push({ path, bytes: content.byteLength })
      binaryFiles[path] = content.toString('base64')
    }
  }
  const writable = record.source === 'user'
  return {
    id: record.manifest.id,
    source: record.source,
    ...(record.provider === undefined ? {} : { provider: record.provider }),
    title: record.manifest.title,
    hash: record.hash,
    manifest: manifestText,
    files,
    assets,
    binaryFiles,
    writable,
    ...(writable ? {} : { suggestedId: suggestedUserId(record.manifest.id, record.source) }),
  }
}

/** 二进制资源保持原始字节；所有入口仍执行同一份路径与额度检查。 */
export function binaryInputs(value: unknown): WidgetFileInput[] {
  if (value === undefined) return []
  if (!isRecord(value)) throw new Refusal(400, 'binaryFiles 要是 base64 文件表')
  return Object.entries(value).map(([path, content]) => {
    if (typeof content !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(content)) throw new Refusal(400, '资源不是合法 base64')
    return { path: normalizeWidgetPath(path), content: Buffer.from(content, 'base64') }
  })
}

/**
 * 一个文件是不是文本：编辑器只读文本文件，其余按资源列出。
 *
 * @param path - 组件目录里的相对路径。
 * @returns 是文本时为真。
 */
export function isTextual(path: string): boolean {
  const lower = path.toLowerCase()
  return ['.html', '.css', '.js', '.mjs', '.json', '.txt', '.md', '.svg'].some((extension) => lower.endsWith(extension))
}
