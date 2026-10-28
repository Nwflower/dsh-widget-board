/**
 * 组件市场索引的形状（D30）。
 *
 * 索引是一份静态 JSON，挂在 Pages 的 `market/index.json` 上：市场区、原型浏览页与 CI 的校验读同一份
 * schema。包本身的地址与哈希写在每个版本里；`declares` 只是安装前给人看的摘要，安装时以包内
 * manifest 的实际声明为准。
 */

/** 索引的格式版本；字段只增不减，删除字段要按组件格式的迁移规则走（D7）。 */
export const MARKET_INDEX_FORMAT = 1

/** 索引顶部的市场说明。 */
export interface MarketIndexHead {
  title: { zh: string, en: string }
  description?: { zh: string, en: string }
  /** 索引最后更新的时刻（ISO 8601）；缓存按它判断要不要重读。 */
  updatedAt?: string
}

/** 索引里的一个组件：作者、仓库、许可证与全部版本。 */
export interface MarketIndexEntry {
  id: string
  title: { zh: string, en: string }
  description?: { zh: string, en: string }
  author: { name: string, url?: string }
  repo?: string
  license?: string
  tags?: string[]
  versions: MarketIndexVersion[]
}

/** 索引里的一个版本：分发说明与依赖声明。 */
export interface MarketIndexVersion {
  version: string
  package: { url: string, sha256: string, bytes: number }
  sizes: string[]
  requires?: { serviceApiVersion?: number, dsh?: string }
  declares?: { capabilities?: string[], credentials?: string[], hosts?: string[] }
  changelog?: string
  publishedAt?: string
}

/** 一份市场索引。 */
export interface MarketIndex {
  format: number
  market: MarketIndexHead
  widgets: MarketIndexEntry[]
}

/** 校验市场索引用的 JSON Schema；与 `MarketIndex` 一一对应，脚本与测试读同一份。 */
export { default as MARKET_INDEX_SCHEMA } from '../market-index.schema.json'
