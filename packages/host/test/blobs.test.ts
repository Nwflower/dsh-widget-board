/**
 * 版本库（D7、D23）：已经写在磁盘上的版本在启动重读时不再重写。
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { createVersionStore } from '../src/blobs'
import type { WidgetRecord } from '../src/library'
import { contentHash } from '../src/library'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const HASH = 'c'.repeat(64)

/** 这一轮起的临时目录，测试结束一并删掉。 */
const homes: string[] = []

afterEach(async () => {
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true })
})

/** 一份最小的组件记录。 */
function record(): WidgetRecord {
  return {
    manifest: { id: 'demo', title: { zh: '示例', en: 'Demo' }, version: '0.1.0', sizes: ['s'] },
    source: 'user',
    dir: '/widgets/demo',
    hash: HASH,
    files: new Map([['widget.json', Buffer.from('{}')]]),
  }
}

describe('版本库', () => {
  it('文件已经在时不重写，坏内容交给读取时的哈希校验', async () => {
    await mkdir(join(ROOT, '.debug'), { recursive: true })
    const home = await mkdtemp(join(ROOT, '.debug', 'blobs-test-'))
    homes.push(home)
    const dir = join(home, 'blobs')
    await mkdir(dir, { recursive: true })
    const file = join(dir, `${HASH}.json`)
    await writeFile(file, 'sentinel', 'utf8')
    const store = createVersionStore(dir)
    await store.remember(record())
    expect(await readFile(file, 'utf8')).toBe('sentinel')
  })

  it('文件不在时写一份，换一个版本库实例也能读回来', async () => {
    await mkdir(join(ROOT, '.debug'), { recursive: true })
    const home = await mkdtemp(join(ROOT, '.debug', 'blobs-test-'))
    homes.push(home)
    const dir = join(home, 'blobs')
    const files = new Map([['widget.json', Buffer.from(JSON.stringify({ id: 'demo', title: { zh: '示例', en: 'Demo' }, version: '0.1.0', sizes: ['s'] }))]])
    const hash = contentHash(files)
    await createVersionStore(dir).remember({ ...record(), hash, files })
    const loaded = await createVersionStore(dir).get(hash)
    expect(loaded?.hash).toBe(hash)
    expect(loaded?.manifest.id).toBe('demo')
  })
})
