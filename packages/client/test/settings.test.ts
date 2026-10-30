/**
 * 设置页里的提供方健康表（D31）：全部字段、空状态、不可用与最后错误。
 *
 * 只渲染这一张表本身（`react-dom/server` 的静态标记），不挂 React 运行时，也不碰宿主。
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { WidgetProviderHealth, WorkspaceSnapshot } from '@dsh-widget-board/contracts'
import { t } from '../src/copy'
import { ProviderHealthTable, providerHealthOf } from '../src/settings'

/**
 * 文案按文档语言取（`copy.ts` 的 `currentLang`）；node 环境里没有 `document`，会退到
 * `navigator.language`，那个值跟着机器走。用例要的是中文，所以这一层临时借一份最小的 `document`。
 */
type Globals = Record<string, unknown>
const globals = globalThis as Globals
const hadDocument = 'document' in globals
beforeAll(() => {
  if (!hadDocument) globals.document = { documentElement: { lang: 'zh-CN' } }
})
afterAll(() => {
  if (!hadDocument) delete globals.document
})

/** 两行：一行可用、声明了用途；一行不可用并留下最后一次失败。 */
const ROWS: WidgetProviderHealth[] = [
  {
    provider: 'acme.widgets',
    features: ['pushData', 'marketProvider'],
    registrations: 12,
    failures: 3,
    timeouts: 1,
    available: true,
  },
  {
    provider: 'broken.widgets',
    features: [],
    registrations: 4,
    failures: 9,
    timeouts: 2,
    available: false,
    lastError: '读取超时：15000ms 内没有答复',
  },
]

/**
 * 一份最小的快照。
 *
 * @param providers - 带上的健康行；省略时快照上就没有 `providers` 这一项。
 * @returns 工作区快照。
 */
function snapshotWith(providers?: WidgetProviderHealth[]): WorkspaceSnapshot {
  const base: WorkspaceSnapshot = { revision: 1, active: 'board-1', boards: [], widgets: {}, library: [], grants: [] }
  return providers === undefined ? base : { ...base, providers }
}

/** 把一张表画成静态标记。 */
function markupOf(providers: readonly WidgetProviderHealth[]): string {
  return renderToStaticMarkup(createElement(ProviderHealthTable, { providers }))
}

describe('提供方健康表', () => {
  it('每个提供方一行，七个字段都在表头里', () => {
    const markup = markupOf(ROWS)
    for (const key of ['provider', 'providerState', 'providerFeatures', 'providerRegistrations', 'providerFailures', 'providerTimeouts', 'providerLastError'] as const) {
      expect(markup).toContain('>' + t(key) + '<')
    }
    expect(markup.match(/data-dsh-widget-board-provider="/g)).toHaveLength(2)
    expect(markup).toContain('data-dsh-widget-board-provider="acme.widgets"')
    expect(markup).toContain('>acme.widgets<')
    expect(markup).toContain('>pushData<')
    expect(markup).toContain('>marketProvider<')
    expect(markup).toContain('>' + t('providerAvailable') + '<')
    expect(markup).toContain('>' + t('providerUnavailable') + '<')
    expect(markup).toContain('>12<')
    expect(markup).toContain('>9<')
  })

  it('没有提供方时画空状态，不画表', () => {
    const markup = markupOf([])
    expect(markup).toContain('data-dsh-widget-board-provider-health=""')
    expect(markup).toContain('data-dsh-widget-board-provider-health-empty=""')
    expect(markup).toContain(t('providerHealthEmpty'))
    expect(markup).not.toContain('<table')
  })

  it('不可用的提供方、它的最后错误与没声明用途都看得见', () => {
    const markup = markupOf(ROWS)
    const broken = markup.slice(markup.indexOf('data-dsh-widget-board-provider="broken.widgets"'))
    expect(broken).toContain('data-available="false"')
    expect(broken).toContain(t('providerUnavailable'))
    expect(broken).toContain('读取超时：15000ms 内没有答复')
    expect(broken).toContain(t('providerNoFeatures'))
    expect(broken).toContain('>4<')
    expect(broken).toContain('>2<')
  })

  it('可用的那一行没有错误时，最后错误那一格是短横线', () => {
    const markup = markupOf(ROWS)
    const healthy = markup.slice(
      markup.indexOf('data-dsh-widget-board-provider="acme.widgets"'),
      markup.indexOf('data-dsh-widget-board-provider="broken.widgets"'),
    )
    expect(healthy).toContain('data-available="true"')
    expect(healthy).toContain('>—<')
    expect(healthy).not.toContain('读取超时')
  })

  it('快照换了，表就换成那一份的提供方', () => {
    const first = markupOf(providerHealthOf(snapshotWith(ROWS)))
    const second = markupOf(providerHealthOf(snapshotWith(ROWS.slice(0, 1))))
    expect(first).toContain('broken.widgets')
    expect(second).not.toContain('broken.widgets')
    expect(second).toContain('acme.widgets')
  })

  it('快照还没到、或宿主不带 providers 时按没有提供方处理', () => {
    expect(providerHealthOf(null)).toEqual([])
    expect(providerHealthOf(snapshotWith())).toEqual([])
    expect(providerHealthOf(snapshotWith(ROWS))).toBe(ROWS)
  })
})
