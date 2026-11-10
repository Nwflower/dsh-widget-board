/** 共享分块读取器：任何一次元数据或长度不一致都停止组装。 */
import { MEDIA_CHUNK_BYTES, MEDIA_READ_CAPABILITY, type MediaChunk, type WidgetHandles } from '@dsh-widget-board/contracts'

export async function readMedia(call: WidgetHandles['call'], ref: string, signal: AbortSignal): Promise<Blob> {
  const chunks: Uint8Array<ArrayBuffer>[] = []
  let total: number | undefined
  let offset = 0
  do {
    signal.throwIfAborted()
    const raw = await call(MEDIA_READ_CAPABILITY, { ref, offset, length: MEDIA_CHUNK_BYTES }, { signal }) as MediaChunk
    if (!raw || raw.mime !== 'image/webp' || raw.offset !== offset || !Number.isSafeInteger(raw.total) || raw.total < 1 || raw.total > 2 * 1024 * 1024 || (total !== undefined && total !== raw.total) || typeof raw.base64 !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(raw.base64)) throw new Error('媒体分块元数据不一致')
    total = raw.total
    const decoded = atob(raw.base64)
    if (decoded.length !== Math.min(MEDIA_CHUNK_BYTES, total - offset)) throw new Error('媒体分块长度不一致')
    chunks.push(Uint8Array.from(decoded, char => char.charCodeAt(0)))
    offset += decoded.length
  } while (offset < total)
  signal.throwIfAborted()
  return new Blob(chunks, { type: 'image/webp' })
}
