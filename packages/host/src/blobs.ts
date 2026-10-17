/**
 * 版本库：出现过的每个组件版本留一份，按内容哈希寻址（D7）。
 *
 * 卡片文档按哈希取，会话里内联显示过的组件也要按当时的版本重画，所以版本要跨重启留着。每个版本
 * 存成 `blobs/<hash>.json`：来源与 base64 的文件表。内存只留最近用到的若干份，其余从磁盘读。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { WidgetSource } from '@dsh-widget-board/contracts'
import { contentHash, type WidgetRecord } from './library'

/** 版本库。 */
export interface VersionStore {
  /** 记下一个版本：进内存，并写到磁盘（已经写过的不再写）。 */
  remember(record: WidgetRecord): Promise<void>
  /** 按哈希取一个版本：先查内存，再从磁盘读。 */
  get(hash: string): Promise<WidgetRecord | undefined>
}

/** 磁盘上一份版本的样子。 */
interface StoredVersion {
  source: WidgetSource
  provider?: string
  /** 相对路径到 base64 内容。 */
  files: Record<string, string>
}

/**
 * 建一个版本库。
 *
 * @param dir - `blobs/` 目录。
 * @param limit - 内存里最多留几份。
 * @returns 版本库。
 */
export function createVersionStore(dir: string, limit = 32): VersionStore {
  const memory = new Map<string, WidgetRecord>()
  /** 这一进程里已经写到磁盘的哈希：同一次启动内不重复写。 */
  const written = new Set<string>()

  const remember = async (record: WidgetRecord): Promise<void> => {
    memory.delete(record.hash)
    memory.set(record.hash, record)
    for (const hash of memory.keys()) {
      if (memory.size <= limit) break
      memory.delete(hash)
    }
    if (written.has(record.hash)) return
    const stored: StoredVersion = {
      source: record.source,
      ...(record.provider === undefined ? {} : { provider: record.provider }),
      files: Object.fromEntries([...record.files].map(([path, content]) => [path, content.toString('base64')])),
    }
    const file = join(dir, `${record.hash}.json`)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, `${JSON.stringify(stored)}\n`, 'utf8')
    written.add(record.hash)
  }

  const get = async (hash: string): Promise<WidgetRecord | undefined> => {
    const cached = memory.get(hash)
    if (cached !== undefined) {
      // 读一次就把它挪到最近使用的那一头。
      memory.delete(hash)
      memory.set(hash, cached)
      return cached
    }
    let raw: string
    try {
      raw = await readFile(join(dir, `${hash}.json`), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
    const stored = JSON.parse(raw) as StoredVersion
    const files = new Map(Object.entries(stored.files).map(([path, content]) => [path, Buffer.from(content, 'base64')]))
    // 哈希与内容对不上说明这份 blob 坏了：报出来，不把一份改过的文档发给卡片（D11）。
    if (contentHash(files) !== hash) throw new Error(`${join(dir, `${hash}.json`)} 的内容与哈希对不上`)
    const manifestFile = files.get('widget.json')
    if (manifestFile === undefined) throw new Error(`${join(dir, `${hash}.json`)} 里没有 widget.json`)
    const record: WidgetRecord = {
      manifest: JSON.parse(manifestFile.toString('utf8')),
      source: stored.source,
      ...(stored.provider === undefined ? {} : { provider: stored.provider }),
      dir: dir,
      hash,
      files,
    }
    memory.set(hash, record)
    return record
  }

  return { remember, get }
}
