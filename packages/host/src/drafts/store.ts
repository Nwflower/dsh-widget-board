/**
 * 草稿（技术契约 4、C5）：人在编辑器的草稿，住在插件自己的 `drafts/` 目录里。
 *
 * 草稿是「还没保存的那一份」：源码与表单值各存一份，目标与基础版本记在里面，恢复时按它核对。
 * 凭据值不进草稿——字段里只有凭据的名字和它配没配，密钥由宿主的凭据服务保存（C12）。
 *
 * 最多二十份：满了就明确告诉人要先清理哪一份，不静默删掉旧的（C13）。
 */
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { WidgetDraft, WidgetDraftSummary } from '@dsh-widget-board/contracts'
import { isRecord } from '../guards'
import { Refusal } from '../refusal'
import { binaryInputs, checkWidgetFiles, normalizeWidgetPath } from '../widget-write/write'

/** 草稿目录里最多存几份。 */
export const DRAFT_LIMIT = 20

/** 一份草稿最多多少字节：按一个组件目录的上限算（技术契约 4）。 */
export const DRAFT_BYTES_LIMIT = 16 * 1024 * 1024
const pendingWrites = new Map<string, Promise<void>>()

/** 草稿的存储。 */
export interface DraftStore {
  /** 全部草稿的摘要，按更新时间从新到旧。 */
  list(): Promise<WidgetDraftSummary[]>
  /**
   * 读一份草稿。
   *
   * @param id - 草稿 id。
   * @returns 那份草稿；没有时是 `undefined`。
   */
  get(id: string): Promise<WidgetDraft | undefined>
  /**
   * 写一份草稿：给的是新内容，返回的是存下来的那一份。
   *
   * @param draft - 草稿内容；`draftId` 省略时新造一个。
   * @returns 存下的草稿。
   * @throws {Refusal} 超过上限或数量已满。
   */
  save(draft: Omit<WidgetDraft, 'draftId' | 'updatedAt'> & { draftId?: string }): Promise<WidgetDraft>
  /**
   * 删掉一份草稿。
   *
   * @param id - 草稿 id。
   * @returns 删掉了没有。
   */
  remove(id: string): Promise<boolean>
  /** 目录的绝对路径。 */
  readonly dir: string
}

/** 草稿 id 的形状：只认安全字符，路径由它拼出来。 */
const DRAFT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

/**
 * 一份草稿的形状对不对；读盘时用它挡掉手改坏的记录。
 *
 * @param value - 从磁盘读出来的值。
 * @returns 是草稿时为真。
 */
function isDraft(value: unknown): value is WidgetDraft {
  if (!isRecord(value)) return false
  if (typeof value.draftId !== 'string' || !DRAFT_ID_PATTERN.test(value.draftId)) return false
  if (typeof value.updatedAt !== 'string') return false
  if (!isRecord(value.target)) return false
  const target = value.target
  if (target.kind !== 'instance' && target.kind !== 'widget') return false
  if (typeof target.instanceId !== 'string' && typeof target.widgetId !== 'string') return false
  return true
}

/**
 * 草稿里有没有凭据值：字段里出现密钥形状的内容就拒绝写下去（C12）。
 *
 * 凭据的名字是 manifest 里声明的 `ref`（例如 `DEEPSEEK_API_KEY`），值是另一回事。这里查的是常见的
 * 密钥形状，而不是字段名——字段名可以自己定，值的形状不会。
 *
 * @param draft - 草稿内容。
 * @returns 含有疑似凭据值时为真。
 */
export function holdsCredentialValue(draft: WidgetDraft): boolean {
  const text = JSON.stringify(draft.files ?? {}) + JSON.stringify(draft.form ?? {})
  return /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/.test(text)
    || /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|sk-[A-Za-z0-9]{20,})\b/.test(text)
}

/**
 * 打开草稿目录。
 *
 * @param dir - `$DSH_HOME/widget-board/drafts`。
 * @returns 草稿的存储。
 */
export function openDrafts(dir: string): DraftStore {
  /** 草稿 id 到文件名的映射；id 就是文件名的一部分。 */
  const fileOf = (id: string): string => join(dir, `${id}.json`)

  const list = async (): Promise<WidgetDraftSummary[]> => {
    let names: string[]
    try {
      names = await readdir(dir)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    const drafts: WidgetDraft[] = []
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      try {
        const parsed = JSON.parse(await readFile(join(dir, name), 'utf8')) as unknown
        if (isDraft(parsed)) drafts.push(parsed)
      } catch {
        // 读不出来的草稿不算数：它只是一份坏文件，不挡住别的草稿（D11）。
        continue
      }
    }
    drafts.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    return drafts.map((draft) => ({
      draftId: draft.draftId,
      target: draft.target,
      updatedAt: draft.updatedAt,
      kind: draft.files === undefined ? 'form' : 'source',
    }))
  }

  return {
    dir,
    list,
    async get(id) {
      if (!DRAFT_ID_PATTERN.test(id)) return undefined
      try {
        const parsed = JSON.parse(await readFile(fileOf(id), 'utf8')) as unknown
        return isDraft(parsed) ? parsed : undefined
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
        throw error
      }
    },
    async save(draft) {
      const previous = pendingWrites.get(dir) ?? Promise.resolve()
      let unlock: () => void = () => {}
      const pending = new Promise<void>((resolve) => { unlock = resolve })
      pendingWrites.set(dir, pending)
      await previous
      try {
      const id = draft.draftId ?? randomUUID()
      if (!DRAFT_ID_PATTERN.test(id)) throw new Refusal(400, `草稿 id 不合法：${id}`)
      const existing = await this.get(id)
      if (existing === undefined) {
        const count = (await list()).length
        if (count >= DRAFT_LIMIT) {
          throw new Refusal(409, `草稿最多 ${String(DRAFT_LIMIT)} 份，已经满了；先删掉一份再保存`, { code: 'draft-limit' })
        }
      }
      const stored: WidgetDraft = { ...draft, draftId: id, updatedAt: new Date().toISOString() }
      const files = Object.entries(stored.files ?? {}).map(([path, content]) => {
        if (typeof content !== 'string') throw new Refusal(400, '草稿文件内容要是字符串')
        return { path: normalizeWidgetPath(path), content }
      })
      checkWidgetFiles([...files, ...binaryInputs(stored.binaryFiles)])
      if (holdsCredentialValue(stored)) {
        throw new Refusal(400, '草稿里不能带凭据的值；密钥只由宿主的凭据服务保存', { code: 'credential-in-draft' })
      }
      const text = `${JSON.stringify(stored, null, 2)}\n`
      const bytes = Buffer.byteLength(text, 'utf8')
      if (bytes > DRAFT_BYTES_LIMIT) {
        throw new Refusal(413, `草稿超过 ${String(DRAFT_BYTES_LIMIT)} 字节`)
      }
      await mkdir(dir, { recursive: true })
      const file = fileOf(id)
      const temporary = `${file}.${randomUUID()}.tmp`
      await writeFile(temporary, text, 'utf8')
      await rename(temporary, file)
      return stored
      } finally {
        unlock()
        if (pendingWrites.get(dir) === pending) pendingWrites.delete(dir)
      }
    },
    async remove(id) {
      if (!DRAFT_ID_PATTERN.test(id)) return false
      try {
        await rm(fileOf(id), { force: true })
        return true
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
        throw error
      }
    },
  }
}

/**
 * 草稿的路径：它只住在插件自己的目录里，客户端给的文件路径一律不接受（技术契约 4）。
 *
 * @param dir - 草稿目录。
 * @param id - 草稿 id。
 * @returns 这一份草稿的路径。
 */
export function draftFileOf(dir: string, id: string): string {
  return join(dir, `${id}.json`)
}

/**
 * 草稿目录的父目录：它在 `$DSH_HOME/widget-board/` 下面。
 *
 * @param home - `$DSH_HOME/widget-board`。
 * @returns 草稿目录。
 */
export function draftsDirOf(home: string): string {
  return join(home, 'drafts')
}

/**
 * 清掉一个空目录：草稿目录不存在时不算错。
 *
 * @param dir - 目录。
 */
export async function ensureDraftsDir(dir: string): Promise<void> {
  await mkdir(dirname(join(dir, 'x')), { recursive: true })
  await mkdir(dir, { recursive: true })
}
