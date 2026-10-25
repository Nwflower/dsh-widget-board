/**
 * 城市名与当前位置：设置弹窗把城市解析成坐标，卡片的数据源再去取天气。
 *
 * 组件跑在沙箱里，自己出不了网（D3），所以城市到坐标这一步只发生在人的一次明确操作里——按下
 * 「定位」，或保存一个改过的城市名。这里的地址是常量，不来自任何组件；卡片自己的天气请求仍走
 * manifest 里声明的 `request`（D28）。
 *
 * 定位先问浏览器，拿不到时退回按网络出口问城市；解析出的双语地名、纬度与经度一起交给调用方，
 * 由它写进 manifest 用 `fills` 指明的那几个 props。
 */
import { isChinese, t } from './copy'

/** 一次查城市或定位最多等多久。 */
const TIMEOUT_MS = 9000

/** Open-Meteo 的城市检索：名字与坐标。 */
const CITY_ENDPOINT = 'https://geocoding-api.open-meteo.com/v1/search'

/** 同一个城市按 id 换一种语言的名字。 */
const CITY_BY_ID_ENDPOINT = 'https://geocoding-api.open-meteo.com/v1/get'

/** 按网络出口给出所在的城市：两家独立服务，一家限流时还有另一家。 */
const IPINFO_ENDPOINT = 'https://ipinfo.io/json'
const FREEIPAPI_ENDPOINT = 'https://freeipapi.com/api/json'

/** 由坐标反查地名。 */
const REVERSE_ENDPOINT = 'https://api.bigdatacloud.net/data/reverse-geocode-client'

/** 一个解析好的城市：显示用的双语名字与天气要的坐标。 */
export interface CityFix {
  /** 写回设置里那一个字段的城市名。 */
  city: string
  /** 卡片上显示的双语地名。 */
  place: { zh: string, en: string }
  latitude: number
  longitude: number
}

/** 一份城市检索结果里用得到的字段。 */
interface Found {
  id?: number
  name: string
  latitude: number
  longitude: number
  /** 地区名，例如「北京市」。 */
  admin?: string
  /** 国家名。 */
  country?: string
  /** 国家代码。 */
  countryCode?: string
  /** IANA 时区。 */
  timezone?: string
}

/** 一条候选：给人看的名字、给机器用的坐标。 */
export interface CityCandidate {
  /** 地点 id；同一座城在两种语言下共用它。 */
  id?: number
  /** 中文名。 */
  zh: string
  /** 英文名。 */
  en: string
  /** 英文的地区与国家，用来把同名城市分开。 */
  detail: string
  latitude: number
  longitude: number
}

/** 一次候选检索最多等多久：输入框边打字边查，等太久不如放弃。 */
const SUGGEST_TIMEOUT_MS = 5000

/** 候选只列前几条，下拉不占满整屏。 */
const SUGGEST_LIMIT = 5

/** 同一个前缀的候选只查一次，删一个字再打回来不必重来。 */
const suggested = new Map<string, Promise<CityCandidate[]>>()

/** 一对坐标。 */
interface Coordinates {
  latitude: number
  longitude: number
}

/** 同一个城市名只查一次：按过「定位」之后保存时不用再问一遍。 */
const known = new Map<string, CityFix>()

/**
 * 请求一份 JSON。
 *
 * @param url - 完整的地址。
 * @param subject - 出错时写在消息前面的说法。
 * @returns 解出来的对象。
 * @throws {Error} 请求失败、状态不是 2xx，或响应不是对象。
 */
async function responseJson(url: string, subject: string, timeoutMs: number = TIMEOUT_MS): Promise<Record<string, unknown>> {
  let response: Response
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  } catch (error) {
    throw new Error(`${subject}：${(error as Error).message}`)
  }
  if (!response.ok) throw new Error(`${subject}：HTTP ${response.status}`)
  const body: unknown = await response.json()
  if (typeof body !== 'object' || body === null) throw new Error(`${subject}：响应不是一个对象`)
  return body as Record<string, unknown>
}

/**
 * 从一份地点对象里取名字与坐标。
 *
 * @param value - 一项地点。
 * @returns 能找到的那一项；形状不对时为 `undefined`。
 */
function placeOf(value: unknown): Found | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const entry = value as Record<string, unknown>
  if (typeof entry.name !== 'string' || typeof entry.latitude !== 'number' || typeof entry.longitude !== 'number') return undefined
  return {
    ...(typeof entry.id === 'number' ? { id: entry.id } : {}),
    name: entry.name,
    latitude: entry.latitude,
    longitude: entry.longitude,
    ...(typeof entry.admin1 === 'string' ? { admin: entry.admin1 } : {}),
    ...(typeof entry.country === 'string' ? { country: entry.country } : {}),
    ...(typeof entry.country_code === 'string' ? { countryCode: entry.country_code } : {}),
    ...(typeof entry.timezone === 'string' ? { timezone: entry.timezone } : {}),
  }
}

/**
 * 从一份检索响应里取第一个地点。
 *
 * @param body - 响应正文。
 * @returns 地名与坐标；没有结果时为 `undefined`。
 */
function foundOf(body: Record<string, unknown>): Found | undefined {
  const results = body.results
  if (!Array.isArray(results) || results.length === 0) return undefined
  return placeOf(results[0])
}

/**
 * 按一种语言检索一个城市名。
 *
 * @param name - 城市名。
 * @param language - 返回哪一种语言的名字。
 * @returns 找到的地点；没有时是 `undefined`。
 */
async function search(name: string, language: 'zh' | 'en'): Promise<Found | undefined> {
  const url = `${CITY_ENDPOINT}?name=${encodeURIComponent(name)}&count=1&language=${language}&format=json`
  return foundOf(await responseJson(url, t('cityLookupFailed')))
}

/**
 * 按地点 id 换一种语言的名字。
 *
 * @param id - 检索结果里的地点 id。
 * @param language - 要哪一种语言。
 * @returns 同一个地点在那一种语言下的名字；查不到时为 `undefined`。
 */
async function byId(id: number, language: 'zh' | 'en'): Promise<Found | undefined> {
  const url = `${CITY_BY_ID_ENDPOINT}?id=${String(id)}&language=${language}`
  return placeOf(await responseJson(url, t('cityLookupFailed')))
}

/**
 * 一条候选的说明：地区与国家，把同名的城市分开。
 *
 * @param found - 检索结果。
 * @returns 例如「北京市 · 中国」。
 */
function detailOf(found: Found): string {
  return [found.admin, found.country].filter((part): part is string => part !== undefined && part !== '').join(' · ')
}

/**
 * 按输入给出候选城市。
 *
 * 两种语言各查一份再按 id 合并：中文名在英文索引里查不到，反之亦然；同一个地点只留一条。
 *
 * @param query - 输入框里的文字，中文、英文或拼音都可以。
 * @returns 候选列表，最多 {@link SUGGEST_LIMIT} 条。
 * @throws {Error} 请求失败。
 */
export function suggestCities(query: string): Promise<CityCandidate[]> {
  const trimmed = query.trim()
  if (trimmed.length === 0) return Promise.resolve([])
  const cached = suggested.get(trimmed.toLowerCase())
  if (cached !== undefined) return cached
  const pending = (async (): Promise<CityCandidate[]> => {
    // 按输入的语言去查：中文名只有用中文索引才查得到，英文索引会返回空结果。
    const wantsChinese = /[一-鿿]/.test(trimmed)
    const body = await responseJson(
      `${CITY_ENDPOINT}?name=${encodeURIComponent(trimmed)}&count=${String(SUGGEST_LIMIT)}&language=${wantsChinese ? 'zh' : 'en'}&format=json`,
      t('cityLookupFailed'),
      SUGGEST_TIMEOUT_MS,
    )
    const results = Array.isArray(body.results) ? body.results : []
    const merged: CityCandidate[] = []
    const seen = new Set<number>()
    const labels = new Set<string>()
    for (const raw of results) {
      const found = placeOf(raw)
      if (found === undefined) continue
      if (found.id !== undefined) {
        if (seen.has(found.id)) continue
        seen.add(found.id)
      }
      // 同名同地区的重复条目（不同 id）对选城市没有意义，只留一条。
      const label = `${found.name}|${detailOf(found)}`
      if (labels.has(label)) continue
      labels.add(label)
      merged.push({
        ...(found.id === undefined ? {} : { id: found.id }),
        zh: found.name,
        en: found.name,
        detail: detailOf(found),
        latitude: found.latitude,
        longitude: found.longitude,
      })
      if (merged.length >= SUGGEST_LIMIT) break
    }
    // 中文输入已经在中文索引里拿到了中文名与中文地区，不必再按 id 一个个补。
    if (wantsChinese) return merged
    // 英文输入补中文名：有一条失败不影响其余的候选。
    const localised = await Promise.all(merged.map(async (candidate) => {
      if (candidate.id === undefined) return candidate
      try {
        const other = await byId(candidate.id, wantsChinese ? 'en' : 'zh')
        if (other === undefined) return candidate
        return wantsChinese
          ? { ...candidate, en: other.name, detail: detailOf(other) === '' ? candidate.detail : detailOf(other) }
          : { ...candidate, zh: other.name }
      } catch {
        return candidate
      }
    }))
    return localised
  })()
  suggested.set(trimmed.toLowerCase(), pending)
  // 失败的不留在缓存里，下一笔输入还能再试。
  pending.catch(() => { suggested.delete(trimmed.toLowerCase()) })
  return pending
}

/**
 * 把一条候选变成可以直接保存的城市。
 *
 * @param candidate - 下拉里选中的那一条。
 * @returns 城市名取中文名，地名给双语。
 */
export function fixOfCandidate(candidate: CityCandidate): CityFix {
  return {
    city: candidate.zh,
    place: { zh: candidate.zh, en: candidate.en },
    latitude: candidate.latitude,
    longitude: candidate.longitude,
  }
}

/**
 * 把一个城市名解析成坐标与双语地名。
 *
 * 两种语言各查一次：中文名在英文索引里查不到，英文名在中文索引里也未必查得到，缺的那一边
 * 按地点 id 再取一次名字。
 *
 * @param name - 城市名；中文、英文或拼音都可以。
 * @returns 解析好的城市。
 * @throws {Error} 名字为空、查不到，或请求失败。
 */
export async function geocodeCity(name: string): Promise<CityFix> {
  const query = name.trim()
  if (query === '') throw new Error(t('cityEmpty'))
  const cached = known.get(query.toLowerCase())
  if (cached !== undefined) return cached
  const [zh, en] = await Promise.all([search(query, 'zh'), search(query, 'en')])
  const base = zh ?? en
  if (base === undefined) throw new Error(t('cityNotFound'))
  const zhName = zh?.name ?? (en?.id === undefined ? base.name : (await byId(en.id, 'zh'))?.name ?? base.name)
  const enName = en?.name ?? (zh?.id === undefined ? base.name : (await byId(zh.id, 'en'))?.name ?? base.name)
  const fix: CityFix = {
    city: query,
    place: { zh: zhName, en: enName },
    latitude: base.latitude,
    longitude: base.longitude,
  }
  known.set(query.toLowerCase(), fix)
  return fix
}

/**
 * 浏览器现在的位置；没有定位服务或拿不到时是 `undefined`。
 *
 * 拿不到不算失败：调用方还有按网络出口问城市这条路。
 *
 * @returns 一对坐标。
 */
function currentPosition(): Promise<Coordinates | undefined> {
  if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return Promise.resolve(undefined)
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => { resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude }) },
      () => { resolve(undefined) },
      { enableHighAccuracy: false, timeout: TIMEOUT_MS, maximumAge: 600000 },
    )
  })
}

/**
 * 由坐标反查一种语言的地名。
 *
 * @param coords - 一对坐标。
 * @param language - 返回哪一种语言的名字。
 * @returns 城市、城区或省份里能用的那一个。
 * @throws {Error} 请求失败，或结果里没有地名。
 */
async function reverseName(coords: Coordinates, language: 'zh' | 'en'): Promise<string> {
  const url = `${REVERSE_ENDPOINT}?latitude=${coords.latitude}&longitude=${coords.longitude}&localityLanguage=${language}`
  const body = await responseJson(url, t('locateFailed'))
  for (const key of ['city', 'locality', 'principalSubdivision']) {
    const value = body[key]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  throw new Error(t('locateFailed'))
}

/** 网络出口给的城市与坐标。 */
type NetworkPlace = Coordinates & { city: string }

/**
 * 问 ipinfo.io：`city` 与 `loc` 里的坐标。
 *
 * @returns 城市与坐标；答得不对时是 `undefined`。
 */
async function fromIpinfo(): Promise<NetworkPlace | undefined> {
  try {
    const body = await responseJson(IPINFO_ENDPOINT, t('locateFailed'))
    const city = typeof body.city === 'string' ? body.city.trim() : ''
    const parts = typeof body.loc === 'string' ? body.loc.split(',') : []
    const latitude = Number(parts[0])
    const longitude = Number(parts[1])
    if (city === '' || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return undefined
    return { city, latitude, longitude }
  } catch {
    return undefined
  }
}

/**
 * 问 freeipapi.com：`cityName` 与两个坐标字段。
 *
 * @returns 城市与坐标；答得不对时是 `undefined`。
 */
async function fromFreeIpApi(): Promise<NetworkPlace | undefined> {
  try {
    const body = await responseJson(FREEIPAPI_ENDPOINT, t('locateFailed'))
    const city = typeof body.cityName === 'string' ? body.cityName.trim() : ''
    if (city === '' || typeof body.latitude !== 'number' || typeof body.longitude !== 'number') return undefined
    return { city, latitude: body.latitude, longitude: body.longitude }
  } catch {
    return undefined
  }
}

/**
 * 按网络出口问所在的城市与坐标。
 *
 * 网络出口只是后备：它是「现在可能是谁」。两家按顺序问，一家限流时另一家还能答；都问不到时交给
 * 调用方给一句能读的失败原因。
 *
 * @returns 城市与坐标；问不到时为 `undefined`。
 */
async function networkPlace(): Promise<NetworkPlace | undefined> {
  return (await fromIpinfo()) ?? (await fromFreeIpApi())
}

/**
 * 把一次定位的结果记进缓存，并把城市名留在当前语言下。
 *
 * @param fix - 解析好的城市。
 * @returns 同一个城市，城市名换成当前语言下能显示的那个。
 */
function remember(fix: CityFix): CityFix {
  const localized: CityFix = { ...fix, city: isChinese() ? fix.place.zh : fix.place.en }
  known.set(localized.city.toLowerCase(), localized)
  return localized
}

/**
 * 按当前位置找一个城市。
 *
 * @returns 解析好的城市。
 * @throws {Error} 浏览器与网络两边都给不出位置。
 */
export async function locateCity(): Promise<CityFix> {
  const precise = await currentPosition()
  if (precise !== undefined) {
    const [zh, en] = await Promise.all([reverseName(precise, 'zh'), reverseName(precise, 'en')])
    return remember({ city: zh, place: { zh, en }, latitude: precise.latitude, longitude: precise.longitude })
  }
  const network = await networkPlace()
  if (network === undefined) throw new Error(t('locateFailed'))
  // 问到了城市名就用它查一次双语名字；查不到时退回网络给的那个名字与坐标，天气仍然是当地那一片。
  const found = await geocodeCity(network.city).catch(() => undefined)
  if (found !== undefined) return remember(found)
  return remember({ city: network.city, place: { zh: network.city, en: network.city }, latitude: network.latitude, longitude: network.longitude })
}
