/** 实例媒体的受限上传、绑定与分块读取（技术契约 6）。 */
export const MEDIA_READ_CAPABILITY = 'widget-board:media.read'
export const MEDIA_CHUNK_BYTES = 24 * 1024
export const MEDIA_INPUT_BYTES = 10 * 1024 * 1024
export const MEDIA_TOTAL_BYTES = 16 * 1024 * 1024
export type MediaRole = 'background' | 'icon'
export type InstanceMedia = Partial<Record<MediaRole, string>>
export interface MediaBinding {
  media?: InstanceMedia
  mediaSession?: string
  mediaTickets?: Partial<Record<MediaRole, string>>
}
export interface MediaUploaded {
  ref: string
  mime: 'image/webp'
  width: number
  height: number
  bytes: number
  uploadTicket: string
}
export interface MediaChunk {
  mime: 'image/webp'
  total: number
  offset: number
  base64: string
}
