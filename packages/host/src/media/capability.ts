/** 能力处理器只相信 Workspace 中由真实调用 id 找到的实例。 */
import { MEDIA_CHUNK_BYTES, WIDGET_BOARD_API_VERSION, type CapabilityRegistration } from '@dsh-widget-board/contracts'
import type { MediaStore } from './store'

export function mediaCapability(store: MediaStore): CapabilityRegistration {
  return {
    apiVersion: WIDGET_BOARD_API_VERSION,
    provider: 'widget-board', id: 'media.read',
    title: { zh: '读取本卡图片', en: 'Read this card’s images' },
    input: { type: 'object', additionalProperties: false, required: ['ref', 'offset', 'length'], properties: {
      ref: { type: 'string', maxLength: 64 }, offset: { type: 'integer', minimum: 0 }, length: { type: 'integer', minimum: 1, maximum: MEDIA_CHUNK_BYTES },
    } },
    output: { type: 'object', additionalProperties: false, required: ['mime', 'total', 'offset', 'base64'], properties: {
      mime: { const: 'image/webp' }, total: { type: 'integer', minimum: 1, maximum: 2 * 1024 * 1024 }, offset: { type: 'integer', minimum: 0 }, base64: { type: 'string', maxLength: 32768 },
    } },
    async call(instance, args, signal) {
      signal.throwIfAborted()
      const request = args as { ref: string, offset: number, length: number }
      const result = await store.read(instance.id, request.ref, request.offset, request.length)
      signal.throwIfAborted()
      return result
    },
  }
}
