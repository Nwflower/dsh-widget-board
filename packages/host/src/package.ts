/**
 * 组件与看板的交换格式（D8）。
 *
 * 只有一种组件包：`.dshw`，是组件目录原样打成的 zip；只有一种看板包：`.dshboard`，是看板加上它用到
 * 的全部组件（按内容哈希内嵌）。解包前先校验：路径不越出目录、扩展名在白名单里、文件数、总大小与
 * 单个文件都不超上限。校验不过就整包拒绝，不留半个组件。
 *
 * 格式用成熟的实现（zip 用 fflate），不自己拼字节。
 */
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import type { WidgetManifest } from '@dsh-widget-board/contracts'

/** 组件包里允许出现的扩展名。 */
export const PACKAGE_EXTENSIONS = ['.html', '.css', '.js', '.json', '.svg', '.png', '.webp', '.woff2', '.md', '.txt']

/** 一个组件包最多几个文件。 */
export const PACKAGE_MAX_FILES = 64

/** 一个文件解压后最多多少字节。 */
export const PACKAGE_MAX_FILE_BYTES = 4 * 1024 * 1024

/** 一个包解压后总共最多多少字节。 */
export const PACKAGE_MAX_TOTAL_BYTES = 16 * 1024 * 1024

/** 压缩后的包最大多少字节（超过就不必解了）。 */
export const PACKAGE_MAX_COMPRESSED_BYTES = 8 * 1024 * 1024

/** 组件包里的一个文件。 */
export interface PackageFile {
  /** 组件目录内的相对路径（正斜杠）。 */
  path: string
  content: Uint8Array
}

/** 解开的组件包。 */
export interface UnpackedWidget {
  manifest: WidgetManifest
  files: PackageFile[]
}

/**
 * 把一个路径规范化成组件包里的相对路径。
 *
 * @param path - 包里的原始路径。
 * @returns 规范化的路径。
 * @throws {Error} 绝对路径、回到上一层，或空路径。
 */
function normalizePath(path: string): string {
  const normalized = path.replaceAll('\\', '/')
  if (normalized === '') throw new Error('包里有一个空路径')
  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) throw new Error(`它是绝对路径：${path}`)
  if (normalized.split('/').includes('..')) throw new Error(`它回到上一层：${path}`)
  return normalized
}

/**
 * 检查一组文件能不能装进一个组件包。
 *
 * @param files - 要打包的文件。
 * @throws {Error} 文件数、大小或扩展名不合格。
 */
export function checkFiles(files: readonly PackageFile[]): void {
  if (files.length === 0) throw new Error('组件包里一个文件都没有')
  if (files.length > PACKAGE_MAX_FILES) throw new Error(`组件包最多 ${PACKAGE_MAX_FILES} 个文件，这里有 ${files.length} 个`)
  let total = 0
  for (const file of files) {
    const path = normalizePath(file.path)
    const lower = path.toLowerCase()
    if (!PACKAGE_EXTENSIONS.some((extension) => lower.endsWith(extension))) {
      throw new Error(`不允许的文件类型：${path}（${PACKAGE_EXTENSIONS.join('、')}）`)
    }
    if (file.content.byteLength > PACKAGE_MAX_FILE_BYTES) throw new Error(`${path} 超过 ${PACKAGE_MAX_FILE_BYTES} 字节`)
    total += file.content.byteLength
  }
  if (total > PACKAGE_MAX_TOTAL_BYTES) throw new Error(`组件包解开之后超过 ${PACKAGE_MAX_TOTAL_BYTES} 字节`)
}

/**
 * 把一个组件目录打成 `.dshw`。
 *
 * @param files - 组件目录里的全部文件。
 * @returns zip 的字节。
 * @throws {Error} 文件不合格。
 */
export function packWidget(files: readonly PackageFile[]): Uint8Array {
  checkFiles(files)
  const tree: Record<string, Uint8Array> = {}
  for (const file of files) tree[normalizePath(file.path)] = file.content
  return zipSync(tree, { level: 6 })
}

/** 解压量超限：与「不是有效的组件包」分开报。 */
class TooLarge extends Error {}

/**
 * 解开一个 `.dshw`：先量压缩后的大小，再解压、逐项校验、读 manifest。
 *
 * 解压按 zip 里声明的大小逐项拦截：高压缩比的包在内容进内存之前就被拒绝，不会先把整包解开
 * 再量（D3 的组件包是不可信输入）。
 *
 * @param bytes - zip 的字节。
 * @returns manifest 与文件表。
 * @throws {Error} 超过上限、不是 zip、路径或扩展名不合格、或没有 manifest。
 */
export function unpackWidget(bytes: Uint8Array): UnpackedWidget {
  if (bytes.byteLength > PACKAGE_MAX_COMPRESSED_BYTES) throw new Error(`组件包超过 ${PACKAGE_MAX_COMPRESSED_BYTES} 字节`)
  let tree: Record<string, Uint8Array>
  try {
    let declared = 0
    tree = unzipSync(bytes, {
      filter(file) {
        if (file.originalSize > PACKAGE_MAX_FILE_BYTES) {
          throw new TooLarge(`包里的 ${file.name} 解开之后超过 ${PACKAGE_MAX_FILE_BYTES} 字节`)
        }
        declared += file.originalSize
        if (declared > PACKAGE_MAX_TOTAL_BYTES) throw new TooLarge(`组件包解开之后超过 ${PACKAGE_MAX_TOTAL_BYTES} 字节`)
        return true
      },
    })
  } catch (error) {
    if (error instanceof TooLarge) throw error
    throw new Error(`这个文件不是有效的组件包：${(error as Error).message}`)
  }
  const files: PackageFile[] = []
  for (const [rawPath, content] of Object.entries(tree)) {
    // 目录条目在 zip 里以斜杠结尾，跳过它们。
    if (rawPath.endsWith('/')) continue
    if (content.byteLength === 0) continue
    files.push({ path: normalizePath(rawPath), content })
  }
  checkFiles(files)
  const manifestFile = files.find((file) => file.path === 'widget.json')
  if (manifestFile === undefined) throw new Error('组件包里没有 widget.json（D7）')
  let manifest: WidgetManifest
  try {
    manifest = JSON.parse(strFromU8(manifestFile.content)) as WidgetManifest
  } catch (error) {
    throw new Error(`组件包里的 widget.json 不是合法 JSON：${(error as Error).message}`)
  }
  return { manifest, files }
}

/**
 * 把文本编成 UTF-8 字节：打包时用。
 *
 * @param text - 文本。
 * @returns 字节。
 */
export function bytesOf(text: string): Uint8Array {
  return strToU8(text)
}

/** 看板包的格式版本。 */
export const BOARD_PACKAGE_FORMAT = 1

/** 看板包里的一张卡。 */
export interface BoardPackageCard {
  widget: string
  props: Record<string, unknown>
  layout: { x: number, y: number, w: number, h: number }
  /** 勾了「带上数据」时才有。 */
  data?: unknown
  /** 勾了「带上状态」时才有。 */
  state?: unknown
}

/** 看板包里的一个组件版本：按内容哈希内嵌。 */
export interface BoardPackageWidget {
  hash: string
  manifest: WidgetManifest
  /** 相对路径到 base64 的内容。 */
  files: Record<string, string>
}

/** 一个看板包。 */
export interface BoardPackage {
  format: number
  title: string
  cards: BoardPackageCard[]
  widgets: BoardPackageWidget[]
}

/**
 * 把一块看板打成 `.dshboard`（JSON 文本，D8）。
 *
 * 卡片只带组件 id、props 与盒子；`data` 与 `state` 由调用方决定要不要带上。用到的组件按内容哈希
 * 内嵌，同一个版本只写一份。
 *
 * @param title - 看板标题。
 * @param cards - 卡片。
 * @param widgets - 用到的组件版本。
 * @returns 文本的字节。
 */
export function packBoard(title: string, cards: readonly BoardPackageCard[], widgets: readonly BoardPackageWidget[]): Uint8Array {
  const pkg: BoardPackage = { format: BOARD_PACKAGE_FORMAT, title, cards: [...cards], widgets: [...widgets] }
  return strToU8(JSON.stringify(pkg))
}

/**
 * 检查看板包里内嵌的组件文件（D8）。
 *
 * 内嵌文件与 `.dshw` 同一组上限：路径不越出目录、扩展名在白名单里、文件数与大小都有头。base64
 * 内容按解码后的字节计量，写盘之前就整包拒绝。
 *
 * @param id - 组件 id，报错时点名。
 * @param files - 相对路径到 base64 内容。
 * @throws {Error} 路径、扩展名、数量或大小不合格。
 */
function checkEmbeddedFiles(id: string, files: Record<string, unknown>): void {
  const decoded: PackageFile[] = []
  for (const [path, content] of Object.entries(files)) {
    if (typeof content !== 'string') throw new Error(`${id} 的 ${path} 不是 base64 文本`)
    decoded.push({ path, content: Buffer.from(content, 'base64') })
  }
  try {
    checkFiles(decoded)
  } catch (error) {
    throw new Error(`${id} 的内嵌文件：${(error as Error).message}`)
  }
}

/**
 * 解开一块 `.dshboard` 并校验它的形状。
 *
 * @param bytes - 文本的字节。
 * @returns 看板包。
 * @throws {Error} 不是合法 JSON、格式版本不认识、或卡片的字段不合格。
 */
export function unpackBoard(bytes: Uint8Array): BoardPackage {
  if (bytes.byteLength > PACKAGE_MAX_TOTAL_BYTES * 4) throw new Error('看板包太大')
  let parsed: unknown
  try {
    parsed = JSON.parse(strFromU8(bytes)) as unknown
  } catch (error) {
    throw new Error(`这个文件不是有效的看板包：${(error as Error).message}`)
  }
  if (typeof parsed !== 'object' || parsed === null) throw new Error('看板包不是一个对象')
  const pkg = parsed as Partial<BoardPackage>
  if (pkg.format !== BOARD_PACKAGE_FORMAT) throw new Error(`看板包的格式版本是 ${String(pkg.format)}，这个宿主只认 ${BOARD_PACKAGE_FORMAT}`)
  if (typeof pkg.title !== 'string') throw new Error('看板包没有标题')
  if (!Array.isArray(pkg.cards) || !Array.isArray(pkg.widgets)) throw new Error('看板包缺少 cards 或 widgets')
  for (const card of pkg.cards) {
    if (typeof card?.widget !== 'string' || card.widget === '') throw new Error('看板包里有一张卡没有组件 id')
    if (typeof card.props !== 'object' || card.props === null || Array.isArray(card.props)) throw new Error('看板包里有一张卡的 props 不是对象')
    const layout = card.layout as Record<string, unknown> | undefined
    for (const key of ['x', 'y', 'w', 'h']) {
      if (typeof layout?.[key] !== 'number') throw new Error(`看板包里有一张卡的 layout.${key} 不是数`)
    }
  }
  for (const widget of pkg.widgets) {
    if (typeof widget?.hash !== 'string' || typeof widget.manifest?.id !== 'string') throw new Error('看板包里有一个组件版本没有哈希或 id')
    if (typeof widget.files !== 'object' || widget.files === null) throw new Error(`看板包里的 ${widget.manifest.id} 没有文件`)
    checkEmbeddedFiles(widget.manifest.id, widget.files)
  }
  return pkg as BoardPackage
}

