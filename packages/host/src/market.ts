/**
 * 市场提供方的注册与条目缓存（D8、D31）。
 *
 * 看板核心不认识任何市场实现：索引地址、搜索、安装确认都由提供方插件实现 `list` 与 `fetch` 交进来。
 * 这里管三件事：同一时刻一个提供方只注册一次、`list` 的超时与条数上限、把条目按 schema 逐条校验后
 * 摆进快照。提供方撤下时它的条目从快照里消失，已安装的组件保留在 `market` 来源里（D17）。
 */
import Ajv from 'ajv'
import type { MarketListing, WidgetMarketProviderRegistration } from '@dsh-widget-board/contracts'
import { MARKET_LISTING_SCHEMA } from '@dsh-widget-board/contracts'

/** `list` 最多等多久：再久就说明这个市场现在答不上来。 */
export const MARKET_LIST_TIMEOUT_MS = 15_000

/** 一个市场最多返回多少条：条目要进快照随页面走，不能没有头。 */
export const MARKET_LIST_MAX_ITEMS = 256

const ajv = new Ajv({ allErrors: true, strict: true })
const validate = ajv.compile(MARKET_LISTING_SCHEMA)

/** 快照里一个市场提供方的样子：它的条目与这次 `list` 的失败原因。 */
export interface MarketSection {
  /** 提供方的包名。 */
  provider: string
  /** 市场的名字。 */
  id: string
  title: WidgetMarketProviderRegistration['title']
  description?: WidgetMarketProviderRegistration['description']
  /** 校验合格的条目；不合格的在 `errors` 里。 */
  listings: MarketListing[]
  /** 逐条校验失败的原因：`索引第几条（id 如果有）：原因`。 */
  errors: string[]
  /** `list` 本身失败或超时的原因；成功时没有。 */
  error?: string
}

/** 一条注册在内部的样子。 */
interface Owned {
  registration: WidgetMarketProviderRegistration
  /** 最近一次 `list` 的结果；还没有读过时是 `undefined`。 */
  section?: MarketSection
}

/** 市场提供方注册表。 */
export interface MarketRegistry {
  /**
   * 注册一个市场提供方；返回释放函数。
   *
   * @param registration - 提供方与市场实现。
   * @returns 释放函数；撤下后这个提供方的条目从快照里消失。
   * @throws {Error} 同一个提供方已经注册过，或必填字段缺失。
   */
  register(registration: WidgetMarketProviderRegistration): () => void
  /** 刷新一个提供方的条目；`list` 失败记进它的 section，不影响别的提供方。 */
  refresh(provider: string): Promise<void>
  /**
   * 快照里的市场区：全部提供方的条目与失败原因。
   *
   * 校验不合格与超量的条目放在 `rejected` 里：安装路径仍能按 id 找到它们，给出「这一条不合格」的
   * 原因；界面只显示合格条目与失败原因。
   */
  sections(): MarketSection[]
  /** 按提供方与条目 id 找一条校验合格的条目。 */
  listing(provider: string, id: string): { registration: WidgetMarketProviderRegistration, listing: MarketListing } | undefined
  /** 撤下全部提供方；拆除时用。 */
  disposeAll(): void
}

/**
 * 一个提供方在还没有读到合格条目时的样子。
 *
 * @param registration - 提供方注册。
 * @returns 快照里的一节：名字、说明与空条目表。
 */
function sectionBase(registration: WidgetMarketProviderRegistration): MarketSection {
  return {
    provider: registration.provider,
    id: registration.id,
    title: registration.title,
    ...(registration.description === undefined ? {} : { description: registration.description }),
    listings: [],
    errors: [],
  }
}

/**
 * 把提供方给的一组条目校验成一个 section。
 *
 * @param registration - 提供方注册。
 * @param raw - `list` 的返回值。
 * @returns 快照里的那一节。
 */
function sectionOf(registration: WidgetMarketProviderRegistration, raw: unknown): MarketSection {
  const section = sectionBase(registration)
  if (!Array.isArray(raw)) {
    section.error = `市场 ${registration.id} 的 list 没有返回数组`
    return section
  }
  const items = raw.slice(0, MARKET_LIST_MAX_ITEMS)
  if (raw.length > MARKET_LIST_MAX_ITEMS) {
    section.errors.push(`市场返回了 ${raw.length} 条，超过 ${MARKET_LIST_MAX_ITEMS} 条上限，多出来的没有显示`)
  }
  items.forEach((item, index) => {
    if (validate(item)) {
      section.listings.push(item as MarketListing)
      return
    }
    const reasons = (validate.errors ?? []).map((error) => `${error.instancePath || '/'} ${error.message ?? ''}`.trim())
    const name = typeof (item as { id?: unknown })?.id === 'string' ? (item as { id: string }).id : `第 ${index + 1} 条`
    section.errors.push(`${name}：${reasons.join('；')}`)
  })
  return section
}

/**
 * 建一个市场注册表。
 *
 * @returns 注册表。
 */
export function createMarketRegistry(): MarketRegistry {
  const owned = new Map<string, Owned>()

  return {
    register(registration) {
      if (registration.provider.trim() === '' || registration.id.trim() === '') {
        throw new Error('registerMarketProvider 需要 provider 与 id')
      }
      if (owned.has(registration.provider)) {
        throw new Error(`${registration.provider} 已经注册过市场 ${owned.get(registration.provider)?.registration.id ?? ''}；先撤下再注册`)
      }
      const entry: Owned = { registration }
      owned.set(registration.provider, entry)
      return () => {
        if (owned.get(registration.provider) === entry) owned.delete(registration.provider)
      }
    },
    async refresh(provider) {
      const entry = owned.get(provider)
      if (entry === undefined) throw new Error(`没有市场提供方 ${provider}`)
      const { registration } = entry
      let timer: ReturnType<typeof setTimeout> | undefined
      let raw: unknown
      try {
        raw = await Promise.race([
          registration.list(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => { reject(new Error(`list 超过 ${MARKET_LIST_TIMEOUT_MS}ms 没有应答`)) }, MARKET_LIST_TIMEOUT_MS)
          }),
        ])
      } catch (error) {
        entry.section = {
          ...sectionBase(registration),
          error: `市场 ${registration.id} 读不出来：${(error as Error).message}`,
        }
        return
      } finally {
        clearTimeout(timer)
      }
      entry.section = sectionOf(registration, raw)
    },
    sections() {
      return [...owned.values()].map((entry) => entry.section ?? sectionBase(entry.registration))
    },
    listing(provider, id) {
      const entry = owned.get(provider)
      const listing = entry?.section?.listings.find((candidate) => candidate.id === id)
      if (entry === undefined || listing === undefined) return undefined
      return { registration: entry.registration, listing }
    },
    disposeAll() {
      owned.clear()
    },
  }
}
