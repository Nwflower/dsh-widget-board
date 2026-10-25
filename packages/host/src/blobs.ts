/**
 * 版本库：出现过的每个组件版本留一份，按内容哈希寻址（D7）。
 *
 * 卡片文档按哈希取，会话里内联显示过的组件也要按当时的版本重画，所以版本要跨重启留着。每个版本
 * 存成 `blobs/<hash>.json`：来源与 base64 的文件表。内存只留最近用到的若干份，其余从磁盘读。
 */
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { WidgetSource } from '@dsh-widget-board/contracts'
import { contentHash, type WidgetRecord } from './library'

/** 版本库。 */
export interface VersionStore {
  /** 记下一个版本：进内存，并写到磁盘（已经写过的不再写）。 */
  remember(record: WidgetRecord): Promise<void>
  /** 按哈希取一个版本：先查内存，再从磁盘读。 */
  get(hash: string): Promise<WidgetRecord | undefined>
  /** 磁盘上保存的版本数：成本卡片报组件库的历史体积时读它。 */
  count(): Promise<number>
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
  /** 上一次数过的版本数；remember 之后再数一遍。 */
  let savedCount: number | undefined

  /** 内存里只留最近用到的几份（D7）：remember 与 get 读回之后都按它裁剪。 */
  const trim = (): void => {
    for (const hash of memory.keys()) {
      if (memory.size <= limit) break
      memory.delete(hash)
    }
  }

  const remember = async (record: WidgetRecord): Promise<void> => {
    savedCount = undefined
    memory.delete(record.hash)
    memory.set(record.hash, record)
    trim()
    if (written.has(record.hash)) return
    const stored: StoredVersion = {
      source: record.source,
      ...(record.provider === undefined ? {} : { provider: record.provider }),
      files: Object.fromEntries([...record.files].map(([path, content]) => [path, content.toString('base64')])),
    }
    const file = join(dir, `${record.hash}.json`)
    await mkdir(dirname(file), { recursive: true })
    try {
      await stat(file)
      // 文件已经在就不再写：不把每个版本在每次启动时重写一遍；坏内容在读取时按哈希校验报错。
      written.add(record.hash)
      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    // 先写临时文件再改名，崩溃不会留下半份 JSON（与 state、grants 同一套写法）。
    const temporary = `${file}.tmp`
    await writeFile(temporary, `${JSON.stringify(stored)}\n`, { encoding: 'utf8' })
    try {
      await rename(temporary, file)
    } catch (error) {
      // 同一个哈希并发写完把临时文件改名走了：内容按哈希寻址是一样的，当作写完。
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
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
    trim()
    return record
  }

  /**
   * 磁盘上的版本数：一次读先数一遍，下一次 remember 之后重新数。
   *
   * @returns 版本文件的个数；目录还不存在时是 0。
   */
  const count = async (): Promise<number> => {
    if (savedCount !== undefined) return savedCount
    let names: string[]
    try {
      names = await readdir(dir)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      names = []
    }
    savedCount = names.filter((name) => /^[0-9a-f]{64}\.json$/.test(name)).length
    return savedCount
  }

  return { remember, get, count }
}
