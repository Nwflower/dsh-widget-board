/**
 * 预览会话（技术契约 5）。
 *
 * 预览是「还没写进组件库的那一份代码」：它跑在真实的组件文档里，用同一套 `buildDocument`、同一份
 * 运行时与同一套 CSP，但它的一切都只留在一个内存会话里——不写正式的 widgets、versions、boards 或
 * grants。
 *
 * 预览端口只提供预览状态、尺寸、主题与错误：动作、能力调用与通知一律拒绝，预览里按下去不能产生
 * 正式副作用（C15）。会话十分钟过期，关闭时释放，同时最多四个。
 */
import { randomBytes } from 'node:crypto'
import type { PreviewSession, WidgetManifest } from '@dsh-widget-board/contracts'
import { PARENT_MESSAGE_LIMIT } from '@dsh-widget-board/contracts'
import type { DocumentAssets } from '../document'
import { buildDocument, contentSecurityPolicy, freshNonce } from '../document'
import { isRecord } from '../guards'
import type { WidgetRecord } from '../library'
import { Refusal } from '../refusal'
import { contentHash, manifestProblem } from '../library'
import { binaryInputs, checkWidgetFiles, normalizeWidgetPath } from '../widget-write/write'
import { contentIssues, handshakeBytes } from '../content/validate'

/** 一个预览会话活多久：十分钟（C6）。 */
export const PREVIEW_TTL_MS = 10 * 60 * 1000

/** 同时最多几个预览会话（C6）。 */
export const PREVIEW_LIMIT = 4

/** 预览的文件与数据加在一起的上限：与一个组件目录同量。 */
export const PREVIEW_BYTES_LIMIT = 16 * 1024 * 1024

/** 预览握手里 props、data 与 state 各自的上限：跟着桥与状态额度走（技术契约 5）。 */
export const PREVIEW_STATE_LIMIT = 64 * 1024

/** 预览会话的一份内容。 */
export interface PreviewContent {
  files: Record<string, string>
  binaryFiles?: Record<string, string>
  props: Record<string, unknown>
  data: unknown
  state: unknown
}

/** 预览会话的管理处。 */
export interface PreviewStore {
  /**
   * 新建一个预览会话。
   *
   * @param content - 预览的文件与数据。
   * @param assets - 共用资产：令牌、套件与运行时。
   * @returns 会话。
   * @throws {Refusal} 文件不合法、超过上限或同时的会话已满。
   */
  create(content: PreviewContent, assets: DocumentAssets): Promise<PreviewSession>
  /**
   * 取一个会话的内容。
   *
   * @param id - 预览 id。
   * @returns 会话；没有或已过期时是 `undefined`。
   */
  get(id: string): PreviewContent | undefined
  /**
   * 取一个会话的组件记录：它不是正式组件，来源是 `user`，只活在这个会话里。
   *
   * @param id - 预览 id。
   * @returns 组件记录；没有或已过期时是 `undefined`。
   */
  record(id: string): WidgetRecord | undefined
  /**
   * 拼一份预览文档。
   *
   * @param id - 预览 id。
   * @param assets - 共用资产。
   * @param lang - 界面语言。
   * @returns 文档与它的 CSP 头。
   * @throws {Refusal} 没有这一份预览。
   */
  document(id: string, assets: DocumentAssets, lang: string): { html: string, nonce: string }
  /**
   * 释放一个会话。
   *
   * @param id - 预览 id。
   * @returns 释放了没有。
   */
  release(id: string): boolean
  /** 现在有几个会话。 */
  size(): number
}

/** 一个会话在内存里的样子。 */
interface Session {
  id: string
  content: PreviewContent
  record: WidgetRecord
  expiresAt: number
  timer: ReturnType<typeof setTimeout>
}

/**
 * 一个不可猜测的预览 id。
 *
 * @returns 预览 id。
 */
function previewId(): string {
  return randomBytes(16).toString('hex')
}

/**
 * 把预览的文件读成一份组件记录：它不落盘，只活在这个会话里（技术契约 5）。
 *
 * @param files - 组件目录里的文件。
 * @returns 组件记录。
 * @throws {Refusal} manifest 不合格或缺少必需的文件。
 */
function recordOf(files: Record<string, string>, binaryFiles?: Record<string, string>): WidgetRecord {
  const manifestFile = files['widget.json']
  if (manifestFile === undefined) throw new Refusal(400, '预览的文件里没有 widget.json（D7）')
  let manifest: WidgetManifest
  try {
    manifest = JSON.parse(manifestFile) as WidgetManifest
  } catch (error) {
    throw new Refusal(400, `预览的 widget.json 不是合法 JSON：${(error as Error).message}`)
  }
  const problem = manifestProblem(manifest)
  if (problem !== undefined) throw new Refusal(400, problem)
  checkWidgetFiles(Object.entries(files).map(([path, content]) => ({ path: normalizeWidgetPath(path), content })))
  const table = new Map<string, Buffer>()
  for (const [path, content] of Object.entries(files)) {
    table.set(path, Buffer.from(content, 'utf8'))
  }
  for (const file of binaryInputs(binaryFiles)) {
    if (table.has(file.path)) throw new Refusal(400, '资源路径重复')
    table.set(file.path, file.content as Buffer)
  }
  checkWidgetFiles([...table].map(([path, content]) => ({ path, content })))
  for (const required of ['index.html', 'style.css']) {
    if (!table.has(required)) throw new Refusal(400, `预览缺少 ${required}（D7）`)
  }
  return {
    manifest,
    source: 'user',
    dir: '',
    hash: contentHash(table),
    files: table,
  }
}

/**
 * 一份数据的字节数。
 *
 * @param value - 值。
 * @returns 字节数。
 */
function bytesOf(value: unknown): number {
  if (value === undefined || value === null) return 0
  const text = JSON.stringify(value)
  return text === undefined ? 0 : Buffer.byteLength(text, 'utf8')
}

/**
 * 建一个预览会话的管理处。
 *
 * @returns 预览会话的管理处。
 */
export function createPreviews(): PreviewStore {
  const sessions = new Map<string, Session>()

  /** 顺手清掉过期的会话：过期的不再占位置（C16）。 */
  const sweep = (): void => {
    const now = Date.now()
    for (const [id, session] of sessions) {
      if (session.expiresAt <= now) sessions.delete(id)
    }
  }

  /** 取一个活着的会话。 */
  const live = (id: string): Session | undefined => {
    const session = sessions.get(id)
    if (session === undefined) return undefined
    if (session.expiresAt <= Date.now()) {
      sessions.delete(id)
      return undefined
    }
    return session
  }

  return {
    async create(content, assets) {
      sweep()
      if (!isRecord(content.files)) throw new Refusal(400, '预览的文件要是一个对象')
      const record = recordOf(content.files, content.binaryFiles)
      contentIssues('props', record.manifest.props, content.props)
      if (content.data !== null) contentIssues('data', record.manifest.data, content.data)
      if (content.state !== null) contentIssues('state', record.manifest.state, content.state)
      const total = Object.values(content.files).reduce((sum, text) => sum + Buffer.byteLength(text, 'utf8'), 0)
      if (total > PREVIEW_BYTES_LIMIT) {
        throw new Refusal(413, `预览的文件超过 ${String(PREVIEW_BYTES_LIMIT)} 字节`)
      }
      if (bytesOf(content.state) > PREVIEW_STATE_LIMIT) {
        throw new Refusal(413, `预览的状态超过 ${String(PREVIEW_STATE_LIMIT)} 字节`)
      }
      if (handshakeBytes(record.manifest, content) + 8192 > PARENT_MESSAGE_LIMIT) {
        throw new Refusal(413, `预览的内容超过 ${String(PARENT_MESSAGE_LIMIT)} 字节`)
      }
      if (sessions.size >= PREVIEW_LIMIT) {
        throw new Refusal(429, `同时最多 ${String(PREVIEW_LIMIT)} 个预览；关掉一个再试`, { code: 'preview-limit' })
      }
      // 令牌、套件与运行时在这里读一次：预览用真实的资产，与正式卡片同一份（D3）。
      try {
        buildDocument(record, assets, freshNonce(), { lang: 'zh-CN' })
      } catch (error) {
        throw new Refusal(400, (error as Error).message)
      }
      const id = previewId()
      const session: Session = {
        id,
        content,
        record,
        expiresAt: Date.now() + PREVIEW_TTL_MS,
        timer: setTimeout(() => { sessions.delete(id) }, PREVIEW_TTL_MS),
      }
      session.timer.unref()
      sessions.set(id, session)
      return { previewId: id, expiresAt: new Date(session.expiresAt).toISOString() }
    },
    get(id) {
      return live(id)?.content
    },
    record(id) {
      return live(id)?.record
    },
    document(id, assets, lang) {
      const session = live(id)
      if (session === undefined) throw new Refusal(404, `没有这一份预览：${id}`)
      const nonce = freshNonce()
      const html = buildDocument(session.record, assets, nonce, { lang })
      return { html, nonce }
    },
    release(id) {
      const session = sessions.get(id)
      if (session !== undefined) clearTimeout(session.timer)
      return sessions.delete(id)
    },
    size() {
      sweep()
      return sessions.size
    },
  }
}
