/** 图片解码与去元数据；输入、像素与输出额度分别校验。 */
import sharp from 'sharp'
import { MEDIA_INPUT_BYTES, type MediaRole } from '@dsh-widget-board/contracts'
import { Refusal } from '../refusal'

/** 只识别批准的三种文件签名；解码器还会独立校验实际格式。 */
export function imageFormat(bytes: Buffer): 'png' | 'jpeg' | 'webp' | undefined {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png'
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpeg'
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'webp'
  return undefined
}

/** 校验并转换为静态 WebP，默认输出不携带输入元数据。 */
export async function processImage(bytes: Buffer, mime: string, role: MediaRole): Promise<{ bytes: Buffer, width: number, height: number }> {
  if (bytes.length === 0 || bytes.length > MEDIA_INPUT_BYTES) throw new Refusal(413, '原图必须在 10MiB 以内')
  const format = imageFormat(bytes)
  if (format === undefined || mime !== `image/${format}`) throw new Refusal(400, '只支持签名与 MIME 一致的 PNG、JPEG、WebP')
  try {
    const image = sharp(bytes, { limitInputPixels: 8192 * 8192, failOn: 'warning', animated: true })
    const metadata = await image.metadata()
    if (metadata.format !== format || (metadata.pages ?? 1) !== 1) throw new Refusal(400, '不支持动画或格式不一致的图片')
    if (!metadata.width || !metadata.height || Math.max(metadata.width, metadata.height) > 8192) throw new Refusal(413, '原图最长边不能超过 8192px')
    const edge = role === 'icon' ? 256 : 1600
    const result = await image.rotate().resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer({ resolveWithObject: true })
    if (result.data.length > (role === 'icon' ? 128 * 1024 : 2 * 1024 * 1024)) throw new Refusal(413, '处理后的图片超过该角色的体积上限')
    return { bytes: result.data, width: result.info.width, height: result.info.height }
  } catch (error) {
    if (error instanceof Refusal) throw error
    throw new Refusal(400, `图片解码失败：${error instanceof Error ? error.message : String(error)}`)
  }
}
