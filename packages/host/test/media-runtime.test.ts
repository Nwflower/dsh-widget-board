/** 共享 runtime 在真实分块协议边界拒绝截断、变化和取消。 */
import { expect, it } from 'vitest'
import type { WidgetHandles } from '@dsh-widget-board/contracts'
import { MEDIA_CHUNK_BYTES, MEDIA_READ_CAPABILITY } from '@dsh-widget-board/contracts'
import { readMedia } from '../../runtime/src/media/read'

it('runtime 顺序读取并精确组装 Blob', async () => {
  const bytes = Buffer.alloc(MEDIA_CHUNK_BYTES + 17, 123)
  const offsets: number[] = []
  const call: WidgetHandles['call'] = async (capability, raw) => {
    expect(capability).toBe(MEDIA_READ_CAPABILITY)
    const args = raw as { offset: number, length: number }
    offsets.push(args.offset)
    return { mime: 'image/webp', total: bytes.length, offset: args.offset, base64: bytes.subarray(args.offset, args.offset + args.length).toString('base64') }
  }
  const blob = await readMedia(call, 'background', new AbortController().signal)
  expect(offsets).toEqual([0, MEDIA_CHUNK_BYTES])
  expect(Buffer.from(await blob.arrayBuffer())).toEqual(bytes)
})

it.each([
  { mime: 'image/png', total: 1, offset: 0, base64: 'AA==' },
  { mime: 'image/webp', total: 3, offset: 1, base64: 'AAAA' },
  { mime: 'image/webp', total: 3, offset: 0, base64: 'AA==' },
  { mime: 'image/webp', total: 1e9, offset: 0, base64: 'AA==' },
  { mime: 'image/webp', total: 1, offset: 0, base64: '!@==' },
])('拒绝异常分块 %j', async value => {
  await expect(readMedia(async () => value, 'background', new AbortController().signal)).rejects.toThrow(/媒体分块/)
})

it('取消后不再请求后续分块', async () => {
  const controller = new AbortController()
  let calls = 0
  await expect(readMedia(async () => { calls++; controller.abort(); return { mime: 'image/webp', total: MEDIA_CHUNK_BYTES + 1, offset: 0, base64: Buffer.alloc(MEDIA_CHUNK_BYTES).toString('base64') } }, 'background', controller.signal)).rejects.toThrow()
  expect(calls).toBe(1)
})
