/** 使用真实图片处理、磁盘和工作区验证媒体归属与事务。 */
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { MEDIA_CHUNK_BYTES, withinLimit } from '@dsh-widget-board/contracts'
import { createMediaStore } from '../src/media/store'
import { processImage } from '../src/media/process'
import { openWorkspace } from '../src/workspace'
import { emptyBoard, writeBoard } from '../src/state'
import { packBoard, unpackBoard } from '../src/package'
import { boardFromPackage } from '../src/media/board-package'
import { watch } from 'node:fs'
import { importTransaction } from '../src/media/import-transaction'
import { writeWidgetType } from '../src/widget-write/write'
import { contentHash, readWidget } from '../src/library'
import type { RouteContext } from '../src/routes'
import type { WidgetRecord } from '../src/library'

const homes: string[] = []
afterEach(async () => { for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true }) })
const png = async () => await sharp({ create: { width: 1800, height: 1000, channels: 3, background: '#7395ad' } }).png().toBuffer()
async function setup() {
  const root = resolve('.debug/media-unit')
  await mkdir(root, { recursive: true })
  const home = await mkdtemp(join(root, 'case-'))
  homes.push(home)
  const board = emptyBoard('媒体测试')
  board.instances = ['one', 'two'].map(id => ({ id, widget: 'image', hash: 'a'.repeat(64), props: {}, data: null, state: null, layout: { x: 0, y: 0, w: 1, h: 18 } }))
  await writeBoard(join(home, 'boards', `${board.id}.json`), board)
  await writeFile(join(home, 'boards.json'), JSON.stringify({ version: 1, active: board.id, boards: [board.id] }))
  const workspace = await openWorkspace(home, new Map(), () => {})
  let time = Date.now()
  const store = createMediaStore(join(home, 'media'), workspace, () => time)
  const bind = async (id: string, binding: Parameters<typeof store.bind>[1]) => await store.bind(id, binding, async media => await workspace.save(board.id, current => ({ ...current, instances: current.instances.map(instance => instance.id === id ? { ...instance, media } : instance) }), { event: () => ({ type: 'board' }) }))
  const upload = async (id = 'one') => {
    const session = store.session(id)
    const image = await store.upload(session, 'background', await png(), 'image/png')
    return { image, binding: { media: { background: image.ref }, mediaSession: session, mediaTickets: { background: image.uploadTicket } } }
  }
  return { home, store, workspace, board, bind, upload, advance: (ms: number) => { time += ms } }
}

describe('图片处理', () => {
  it.each(['png', 'jpeg', 'webp'] as const)('真实解码 %s 并转静态 WebP', async format => {
    const input = await sharp({ create: { width: 1800, height: 1000, channels: 3, background: '#123456' } }).toFormat(format).withMetadata().toBuffer()
    const result = await processImage(input, `image/${format}`, 'background')
    const metadata = await sharp(result.bytes).metadata()
    expect(result.width).toBe(1600)
    expect(metadata.format).toBe('webp')
    expect(metadata.exif).toBeUndefined()
    expect(metadata.icc).toBeUndefined()
    expect(result.bytes.length).toBeLessThanOrEqual(2 * 1024 * 1024)
  })
  it('图标最长边不超过 256px', async () => {
    const result = await processImage(await png(), 'image/png', 'icon')
    expect(result.width).toBe(256)
    expect(result.bytes.length).toBeLessThanOrEqual(128 * 1024)
  })
  it('拒绝伪造 MIME、损坏输入、SVG 和过大原图', async () => {
    await expect(processImage(await png(), 'image/jpeg', 'background')).rejects.toThrow(/MIME/)
    await expect(processImage(Buffer.from('<svg/>'), 'image/png', 'background')).rejects.toThrow()
    await expect(processImage((await png()).subarray(0, 40), 'image/png', 'background')).rejects.toThrow(/解码/)
    await expect(processImage(Buffer.alloc(10 * 1024 * 1024 + 1), 'image/png', 'background')).rejects.toThrow(/10MiB/)
    const wide = await sharp({ create: { width: 8193, height: 1, channels: 3, background: '#fff' } }).png().toBuffer()
    await expect(processImage(wide, 'image/png', 'background')).rejects.toThrow(/8192/)
  })
  it('拒绝动画 WebP', async () => {
    const pixels = Buffer.from([...Array.from({ length: 4 }, () => [255, 0, 0]).flat(), ...Array.from({ length: 4 }, () => [0, 0, 255]).flat()])
    const animated = await sharp(pixels, { raw: { width: 2, height: 4, pageHeight: 2, channels: 3 } }).webp({ loop: 0, delay: [100, 100] }).toBuffer()
    expect((await sharp(animated, { animated: true }).metadata()).pages).toBe(2)
    await expect(processImage(animated, 'image/webp', 'background')).rejects.toThrow(/动画/)
  })
})

describe('媒体归属与提交', () => {
  it('失败不消费 ticket，成功后不能用于另一次绑定', async () => {
    const test = await setup()
    const { image, binding } = await test.upload()
    await expect(test.store.preview('other-session', image.uploadTicket)).rejects.toThrow(/预览会话/)
    expect((await test.store.preview(binding.mediaSession, image.uploadTicket)).length).toBe(image.bytes)
    await expect(test.store.bind('one', binding, async () => { throw new Error('保存失败') })).rejects.toThrow('保存失败')
    await test.bind('one', binding)
    await expect(test.store.preview(binding.mediaSession, image.uploadTicket)).rejects.toThrow(/预览会话/)
    expect(test.workspace.findInstance('one')?.instance.media?.background).toBe(image.ref)
    await test.bind('one', { media: {} })
    await expect(test.bind('one', binding)).rejects.toThrow(/归属/)
  })
  it('跨实例 hash、角色及会话均不能绑定或读取', async () => {
    const test = await setup()
    const { image, binding } = await test.upload()
    await expect(test.bind('two', binding)).rejects.toThrow(/归属/)
    await expect(test.bind('one', { media: { background: image.ref } })).rejects.toThrow(/归属/)
    await expect(test.bind('one', { ...binding, media: { icon: image.ref } })).rejects.toThrow(/归属/)
    await test.bind('one', binding)
    await expect(test.store.read('two', image.ref, 0, 1)).rejects.toThrow('媒体不可读取')
    await expect(test.store.read('missing', image.ref, 0, 1)).rejects.toThrow('媒体不可读取')
    await expect(test.store.read('two', '../one', 0, 1)).rejects.toThrow('媒体不可读取')
  })
  it('显式复制只授权当前图片到新看板，原上传仍可重试', async () => {
    const test = await setup()
    const { binding, image } = await test.upload()
    const copy = await test.store.copy('one', `board:${test.board.id}`, binding)
    await expect(test.bind('two', copy)).rejects.toThrow(/归属/)
    const copied = await test.store.bind(`board:${test.board.id}`, copy, async media => media)
    expect(copied?.background).toBe(image.ref)
    await test.bind('one', binding)
    expect(test.workspace.findInstance('one')?.instance.media?.background).toBe(image.ref)
  })
  it('十分钟过期，重新启动后已绑定图片仍可读取', async () => {
    const test = await setup()
    const first = await test.upload()
    test.advance(10 * 60 * 1000 + 1)
    await expect(test.bind('one', first.binding)).rejects.toThrow(/归属/)
    const second = await test.upload()
    await test.bind('one', second.binding)
    const workspace = await openWorkspace(test.home, new Map(), () => {})
    const store = createMediaStore(join(test.home, 'media'), workspace)
    expect((await store.read('one', 'background', 0, 1)).base64).toBeTruthy()
  })
  it('分块 ≤24KiB，包络合规，范围错误拒绝', async () => {
    const test = await setup()
    const { image, binding } = await test.upload()
    await test.bind('one', binding)
    const chunk = await test.store.read('one', image.ref, 0, MEDIA_CHUNK_BYTES)
    expect(Buffer.from(chunk.base64, 'base64').length).toBeLessThanOrEqual(MEDIA_CHUNK_BYTES)
    expect(withinLimit({ type: 'call-result', requestId: 'test', result: chunk })).toBe(true)
    for (const [offset, length] of [[-1, 1], [0.5, 1], [0, MEDIA_CHUNK_BYTES + 1], [chunk.total, 1]]) await expect(test.store.read('one', image.ref, offset!, length!)).rejects.toThrow(/分块/)
  })
  it('清理只删除超过24小时且无引用无有效ticket的媒体', async () => {
    const test = await setup()
    const { image, binding } = await test.upload()
    const file = join(test.home, 'media', `${image.ref}.webp`)
    await utimes(file, new Date(0), new Date(0))
    expect(await test.store.collect()).toBe(0)
    await test.bind('one', binding)
    test.advance(25 * 60 * 60 * 1000)
    expect(await test.store.collect()).toBe(0)
    await test.bind('one', { media: {} })
    expect(await test.store.collect()).toBe(1)
    await expect(readFile(file)).rejects.toThrow()
  })
  it('导入事务失败不留下本次媒体，不删除已有资源', async () => {
    const test = await setup()
    const { image } = await test.upload()
    const prior = await test.store.bytes(image.ref)
    const bytes = (await processImage(await sharp({ create: { width: 2, height: 2, channels: 3, background: '#000' } }).png().toBuffer(), 'image/png', 'background')).bytes
    const { createHash } = await import('node:crypto')
    const ref = createHash('sha256').update(bytes).digest('hex')
    await expect(test.store.import(new Map([[image.ref, prior], [ref, bytes]]), async () => { throw new Error('失败') })).rejects.toThrow('失败')
    expect(await test.store.bytes(image.ref)).toEqual(prior)
    await expect(test.store.bytes(ref)).rejects.toThrow()
  })
})

it('format1 可读，format2 压缩往返保留媒体与组/排列的新id', () => {
  expect(unpackBoard(Buffer.from(JSON.stringify({ format: 1, title: '旧', cards: [], widgets: [] }))).format).toBe(1)
  const card = { widget: 'image', props: {}, layout: { x: 0, y: 0, w: 1, h: 18 } }
  const pkg = unpackBoard(packBoard('备份', [{ ...card, id: 'old', media: { background: 'a'.repeat(64) } }], [], { media: { ['a'.repeat(64)]: 'AA==' }, arrangement: { mode: 'aligned', aligned: { order: ['old'], boxes: { old: { w: 1, h: 18 } } } } }))
  expect(pkg.media?.['a'.repeat(64)]).toBe('AA==')
  const record = { manifest: { id: 'image', title: { zh: '图片', en: 'Image' }, version: '1', sizes: ['s' as const] }, source: 'builtin' as const, hash: 'b'.repeat(64), files: new Map(), dir: '' }
  const restored = boardFromPackage(emptyBoard('新'), pkg, new Map([['image', record]]))
  expect(restored.instances[0]?.id).not.toBe('old')
  expect(restored.arrangement?.aligned?.order).toEqual([restored.instances[0]?.id])
  expect(Object.keys(restored.arrangement?.aligned?.boxes ?? {})).toEqual([restored.instances[0]?.id])
})

it('导入回滚与源码保存交错时，不覆盖已经成功保存的新版本', async () => {
  const test = await setup()
  const root = { dir: join(test.home, 'widgets'), source: 'user' as const }
  const records = new Map<string, WidgetRecord>()
  const manifest = { id: 'race', title: { zh: '并发', en: 'Race' }, version: '0.1.0', sizes: ['s' as const] }
  const refresh = async () => { records.set('race', await readWidget(join(root.dir, 'race'), { source: 'user' })) }
  const write = async (html: string, expectedHash?: string, extra: { path: string, content: string }[] = [], reload = refresh) => await writeWidgetType({
    roots: [root], records: () => records, reload,
    request: { id: 'race', manifest, expectedHash, files: [{ path: 'index.html', content: html }, { path: 'style.css', content: '' }, ...extra] },
  })
  const original = await write('<p>原版</p>', undefined, Array.from({ length: 50 }, (_, index) => ({ path: `assets/${index}.txt`, content: 'x'.repeat(128 * 1024) })))
  const files = new Map([['widget.json', Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`)], ['index.html', Buffer.from('<p>导入版</p>')], ['style.css', Buffer.from('')]])
  const importedHash = contentHash(files)
  const context = { roots: [root], records, refresh } as unknown as RouteContext
  let concurrent: Promise<{ saved?: string, error?: unknown }> | undefined
  const observer = watch(test.home, (_event, filename) => {
    if (!String(filename).endsWith('.restore') || concurrent !== undefined) return
    concurrent = write('<p>另一窗口的新版本</p>', importedHash).then(result => ({ saved: result.hash }), error => ({ error }))
  })
  try {
    await expect(importTransaction(context, [{ manifest, hash: importedHash, files: Object.fromEntries([...files].map(([file, bytes]) => [file, bytes.toString('base64')])) }], async (_context, _id, _files, expectedHash, onSwapped) => {
      await write('<p>导入版</p>', expectedHash, [], async () => { onSwapped?.(); await refresh() })
    }, async () => { throw new Error('看板提交失败') })).rejects.toThrow('看板提交失败')
    expect(concurrent, '必须在实际恢复目录写入时触发另一窗口保存').toBeDefined()
    const result = await concurrent!
    const persisted = await readWidget(join(root.dir, 'race'), { source: 'user' })
    if (result.saved !== undefined) expect(persisted.hash).toBe(result.saved)
    else {
      expect(result.error).toMatchObject({ status: 409 })
      expect(persisted.hash).toBe(original.hash)
    }
  } finally { observer.close() }
})
