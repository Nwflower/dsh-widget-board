/**
 * 组件文档的拼装（D3、D7、D10）：CSP、nonce、内联的资源与结束标签的拦截。
 *
 * 文档里内联着运行时与组件代码，任何一处让文档提前截断的写法都必须在这里被拒绝，而不是变成一张
 * 画不出来的卡片。
 */
import { describe, expect, it } from 'vitest'
import type { WidgetRecord } from '../src/library'
import { buildDocument, contentSecurityPolicy } from '../src/document'

/** 共用资产。 */
const ASSETS = { tokensCss: ':root{--w-color-bg:#fff}', suiteCss: '.t-tab{}', runtimeJs: 'window.widget={}', libs: {} }

/**
 * 一个组件记录。
 *
 * @param files - 组件目录里的文件。
 * @returns 组件记录。
 */
function record(files: Record<string, string>): WidgetRecord {
  return {
    manifest: { id: 'weather', title: { zh: '天气', en: 'Weather' }, version: '0.1.0', sizes: ['s'] },
    source: 'builtin',
    dir: '/widgets/weather',
    hash: 'a'.repeat(64),
    files: new Map(Object.entries(files).map(([path, content]) => [path, Buffer.from(content)])),
  }
}

describe('文档', () => {
  it('按语言写 lang 与标题', () => {
    const zh = buildDocument(record({ 'index.html': '<p></p>', 'style.css': 'p{}' }), ASSETS, 'nonce', { lang: 'zh-CN' })
    expect(zh).toContain('<html lang="zh-CN">')
    expect(zh).toContain('<title>天气</title>')
    const en = buildDocument(record({ 'index.html': '<p></p>', 'style.css': 'p{}' }), ASSETS, 'nonce', { lang: 'en-US' })
    expect(en).toContain('<html lang="en-US">')
    expect(en).toContain('<title>Weather</title>')
  })

  it('运行时与组件脚本都用同一个 nonce 内联', () => {
    const html = buildDocument(record({ 'index.html': '<p></p>', 'style.css': 'p{}', 'main.js': 'go()' }), ASSETS, 'n1', { lang: 'zh-CN' })
    expect(html.match(/nonce="n1"/g)).toHaveLength(2)
    expect(html).toContain('go()')
  })

  it('manifest 点名的库在组件脚本之前内联', () => {
    const widget = record({ 'index.html': '<p></p>', 'style.css': 'p{}', 'main.js': 'go()' })
    widget.manifest.libs = ['marked']
    const html = buildDocument(widget, { ...ASSETS, libs: { marked: 'window.marked={}' } }, 'n1', { lang: 'zh-CN' })
    expect(html.match(/nonce="n1"/g)).toHaveLength(3)
    expect(html.indexOf('window.marked={}')).toBeLessThan(html.indexOf('go()'))
  })

  it('manifest 点名了没有随包提供的库时拒绝拼装', () => {
    const widget = record({ 'index.html': '<p></p>', 'style.css': 'p{}' })
    widget.manifest.libs = ['ghost']
    expect(() => buildDocument(widget, ASSETS, 'n1', { lang: 'zh-CN' })).toThrow(/没有随包提供/)
  })

  it('组件自己的额外脚本排在 main.js 之前', () => {
    const widget = record({
      'index.html': '<p></p>',
      'style.css': 'p{}',
      'world.js': 'window.WxWorld={}',
      'glass.js': 'window.WxGlass={}',
      'main.js': 'go()',
    })
    widget.manifest.scripts = ['world.js', 'glass.js']
    const html = buildDocument(widget, ASSETS, 'n1', { lang: 'zh-CN' })
    expect(html.match(/nonce="n1"/g)).toHaveLength(4)
    expect(html.indexOf('window.WxWorld')).toBeLessThan(html.indexOf('window.WxGlass'))
    expect(html.indexOf('window.WxGlass')).toBeLessThan(html.indexOf('go()'))
  })

  it('点名了不存在的额外脚本时拒绝拼装', () => {
    const widget = record({ 'index.html': '<p></p>', 'style.css': 'p{}', 'main.js': 'go()' })
    widget.manifest.scripts = ['gone.js']
    expect(() => buildDocument(widget, ASSETS, 'n1', { lang: 'zh-CN' })).toThrow(/不在组件目录里/)
  })

  it('样式的结束标签让文档拒绝拼装', () => {
    expect(() => buildDocument(record({ 'index.html': '<p></p>', 'style.css': 'p{} </style><b>' }), ASSETS, 'n', { lang: 'zh-CN' }))
      .toThrow(/<\/style/)
  })

  it('脚本的结束标签让文档拒绝拼装', () => {
    expect(() => buildDocument(record({ 'index.html': '<p></p>', 'style.css': 'p{}', 'main.js': 'x() </script>' }), ASSETS, 'n', { lang: 'zh-CN' }))
      .toThrow(/<\/script/)
  })

  it('资源占位符换成 data 地址', () => {
    const html = buildDocument(
      record({ 'index.html': '<img src="{{asset:logo.svg}}">', 'style.css': 'p{}', 'logo.svg': '<svg/>' }),
      ASSETS,
      'n',
      { lang: 'zh-CN' },
    )
    expect(html).toContain('src="data:image/svg+xml;base64,')
  })

  it('占位符指向不存在的资源时拒绝拼装', () => {
    expect(() => buildDocument(record({ 'index.html': '<img src="{{asset:gone.png}}">', 'style.css': 'p{}' }), ASSETS, 'n', { lang: 'zh-CN' }))
      .toThrow(/不在组件目录里/)
  })

  it('占位符不能走出组件目录', () => {
    expect(() => buildDocument(record({ 'index.html': '<img src="{{asset:../secret.png}}">', 'style.css': 'p{}' }), ASSETS, 'n', { lang: 'zh-CN' }))
      .toThrow(/不在组件目录内/)
  })

  it('标题里的尖括号被转义', () => {
    const html = buildDocument(
      { ...record({ 'index.html': '<p></p>', 'style.css': 'p{}' }), manifest: { id: 'x', title: { zh: '<b>标题</b>', en: 'x' }, version: '0.1.0', sizes: ['s'] } },
      ASSETS,
      'n',
      { lang: 'zh-CN' },
    )
    expect(html).toContain('<title>&lt;b&gt;标题&lt;/b&gt;</title>')
  })
})

describe('CSP', () => {
  it('只放行同一个 nonce 的脚本，网络一律关掉', () => {
    const policy = contentSecurityPolicy('abc')
    expect(policy).toContain("script-src 'nonce-abc'")
    expect(policy).toContain("connect-src 'none'")
    expect(policy).toContain("default-src 'none'")
    expect(policy).toContain('img-src data: blob:')
  })
})
