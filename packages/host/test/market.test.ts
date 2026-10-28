/**
 * 市场（D8 之后的市场契约）：提供方注册、条目校验与安装前的包核对。
 *
 * 安装用真的包字节（`packWidget` 打出来的），哈希按内容现算；这一层判定的是看板的行为——逐条
 * schema 校验、失败只影响自己的那一节、撤下后条目消失。
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { MarketListing, WidgetMarketProviderRegistration } from '@dsh-widget-board/contracts'
import { createMarketRegistry } from '../src/market'
import { readWidget, writeWidgetDirectory } from '../src/library'
import { packWidget, unpackWidget } from '../src/package'
import { bytesOf } from '../src/package'

/** 这一轮建出来的目录，测试结束一并删掉。 */
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(async (dir) => { await rm(dir, { recursive: true, force: true }) }))
})

/** 一个合格的市场条目。 */
function listing(id = 'acme.weather', version = '1.0.0'): MarketListing {
  return {
    id,
    title: { zh: '天气', en: 'Weather' },
    author: { name: 'acme' },
    versions: [{
      version,
      sizes: ['s'],
      package: { url: 'https://example.invalid/pkg.dshw', sha256: '0'.repeat(64), bytes: 1 },
    }],
  }
}

/** 一个市场提供方注册。 */
function provider(over: Partial<WidgetMarketProviderRegistration> = {}): WidgetMarketProviderRegistration {
  return {
    apiVersion: 3,
    provider: 'acme-market',
    id: 'acme',
    title: { zh: 'acme 市场', en: 'Acme market' },
    list: async () => [listing()],
    fetch: async () => new Uint8Array(),
    ...over,
  }
}

/** 一个真的 `.dshw`：manifest 与两份文件打包，回出字节与它的哈希。 */
function realPackage(id: string, extra: Record<string, unknown> = {}): { bytes: Uint8Array, sha256: string } {
  const manifest = JSON.stringify({
    id,
    title: { zh: id, en: id },
    version: '1.0.0',
    sizes: ['s'],
    ...extra,
  })
  const bytes = packWidget([
    { path: 'widget.json', content: bytesOf(manifest) },
    { path: 'index.html', content: bytesOf('<p></p>') },
    { path: 'style.css', content: bytesOf('p{}') },
  ])
  return { bytes, sha256: createHash('sha256').update(bytes).digest('hex') }
}

describe('市场提供方的注册与条目', () => {
  it('注册后 refresh 读出校验合格的条目', async () => {
    const market = createMarketRegistry()
    market.register(provider())
    await market.refresh('acme-market')
    const sections = market.sections()
    expect(sections).toHaveLength(1)
    expect(sections[0]?.listings.map((entry) => entry.id)).toEqual(['acme.weather'])
    expect(sections[0]?.errors).toEqual([])
  })

  it('同一个提供方重复注册被拒绝', () => {
    const market = createMarketRegistry()
    market.register(provider())
    expect(() => { market.register(provider()) }).toThrow(/已经注册过/)
  })

  it('list 失败只影响它自己那一节', async () => {
    const market = createMarketRegistry()
    market.register(provider({ list: async () => { throw new Error('索引超时') } }))
    market.register(provider({ provider: 'other', id: 'other', list: async () => [listing('other.clock')] }))
    await market.refresh('acme-market')
    await market.refresh('other')
    const [bad, good] = market.sections()
    expect(bad?.error).toMatch(/索引超时/)
    expect(bad?.listings).toEqual([])
    expect(good?.listings).toHaveLength(1)
  })

  it('不合格的条目进 errors，合格的照常列出', async () => {
    const market = createMarketRegistry()
    const broken = { id: 'ACME.bad', title: { zh: '坏', en: 'bad' }, author: { name: 'a' }, versions: [] }
    market.register(provider({ list: async () => [listing(), broken as unknown as MarketListing] }))
    await market.refresh('acme-market')
    const section = market.sections()[0]
    expect(section?.listings).toHaveLength(1)
    expect(section?.errors).toHaveLength(1)
    expect(section?.errors[0]).toMatch(/ACME\.bad/)
  })

  it('撤下后条目从快照消失；已安装的组件由市场来源目录保留，不由这里管', async () => {
    const market = createMarketRegistry()
    const release = market.register(provider())
    await market.refresh('acme-market')
    expect(market.sections()[0]?.listings).toHaveLength(1)
    release()
    expect(market.sections()).toEqual([])
  })

  it('listing 按提供方与 id 找到校验过的条目', async () => {
    const market = createMarketRegistry()
    market.register(provider())
    await market.refresh('acme-market')
    expect(market.listing('acme-market', 'acme.weather')?.listing.id).toBe('acme.weather')
    expect(market.listing('acme-market', 'acme.nope')).toBeUndefined()
    expect(market.listing('other', 'acme.weather')).toBeUndefined()
  })
})

describe('市场安装的包核对', () => {
  it('真实包的 sha256 与 unpackWidget 合用', () => {
    const pkg = realPackage('acme.weather')
    expect(createHash('sha256').update(pkg.bytes).digest('hex')).toBe(pkg.sha256)
    const unpacked = unpackWidget(pkg.bytes)
    expect(unpacked.manifest.id).toBe('acme.weather')
    expect(unpacked.files.map((file) => file.path).sort()).toEqual(['index.html', 'style.css', 'widget.json'])
  })

  it('声明了凭据的包能读出凭据声明', () => {
    const pkg = realPackage('acme.weather', { credentials: [{ ref: 'ACME_KEY', label: { zh: '密钥', en: 'Key' } }] })
    expect(unpackWidget(pkg.bytes).manifest.credentials?.[0]?.ref).toBe('ACME_KEY')
  })

  it('原型市场里的包能走完安装：解包、写目录、从市场来源读回来', async () => {
    await mkdir(join(process.cwd(), '.debug', 'tests'), { recursive: true })
    const dir = await mkdtemp(join(process.cwd(), '.debug', 'tests', 'market-install-'))
    roots.push(dir)
    const bytes = new Uint8Array(readFileSync(new URL('../../../market/packages/nwflower.example-basic-1.0.0.dshw', import.meta.url)))
    const unpacked = unpackWidget(bytes)
    expect(unpacked.manifest.id).toBe('nwflower.example-basic')
    await writeWidgetDirectory(join(dir, 'nwflower.example-basic'), unpacked.files)
    const record = await readWidget(join(dir, 'nwflower.example-basic'), { source: 'market', authorDomain: true })
    expect(record.manifest.id).toBe('nwflower.example-basic')
    expect(record.source).toBe('market')
    expect(record.manifest.sizes.length).toBeGreaterThan(0)
  })
})
