/**
 * 图片解码器的按需加载。
 *
 * sharp 带平台原生二进制，是可选的图片能力：静态导入会让缺少二进制的环境连插件都加载不了，
 * 所以推迟到第一次处理图片时再取。取不到时由调用方回一条可见的原因（D3、D11）。
 */
import type sharp from 'sharp'
import { Refusal } from '../refusal'

type SharpFactory = typeof sharp

let pending: Promise<SharpFactory> | null = null

/**
 * 取 sharp 的调用入口；同一个进程里只尝试一次，失败后下一次请求重新尝试。
 *
 * @returns sharp 函数。
 * @throws {Refusal} 原生二进制不可用。
 */
export async function sharpOf(): Promise<SharpFactory> {
  if (pending === null) {
    pending = import('sharp').then((loaded: unknown) => {
      const factory = (loaded as { default?: SharpFactory }).default ?? loaded as SharpFactory
      if (typeof factory !== 'function') throw new Refusal(503, '图片处理不可用：sharp 模块没有导出解码函数')
      return factory
    }).catch((error: unknown) => {
      pending = null
      if (error instanceof Refusal) throw error
      throw new Refusal(503, `图片处理不可用：${error instanceof Error ? error.message : String(error)}`)
    })
  }
  return await pending
}
