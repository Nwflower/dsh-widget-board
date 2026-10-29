/**
 * 兼容表（D31、D30）：看板版本、服务版本集合、功能清单与 DSH 下限，以及组件写这些要求时的形状。
 *
 * 表里的几个数要与根 `package.json` 和服务面的常量一致；这里判的正是它们会不会对不上。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import Ajv from 'ajv'
import {
  BOARD_COMPATIBILITY,
  MARKET_LISTING_SCHEMA,
  WIDGET_BOARD_FEATURES,
  WIDGET_BOARD_SUPPORTED_API_VERSIONS,
  WIDGET_MANIFEST_SCHEMA,
  WIDGET_REQUIRES_SCHEMA,
  serviceVersionProblem,
} from '@dsh-widget-board/contracts'

const PACKAGE = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as {
  version: string
  dsh?: { engines?: { dsh?: string } }
}
const validateManifest = new Ajv({ allErrors: true, strict: true }).compile(WIDGET_MANIFEST_SCHEMA)

/** 一份最小的 manifest。 */
function manifest(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: 'clock', title: { zh: '时钟', en: 'Clock' }, version: '1.0.0', sizes: ['s'], ...over }
}

describe('兼容表与仓库', () => {
  it('看板版本与 package.json 的 version 相同', () => {
    expect(BOARD_COMPATIBILITY.boardVersion).toBe(PACKAGE.version)
  })

  it('DSH 下限与 package.json 的 dsh.engines.dsh 相同', () => {
    expect(BOARD_COMPATIBILITY.dsh).toBe(PACKAGE.dsh?.engines?.dsh)
  })

  it('服务版本集合是 [2, 3]，与服务器那份常量是同一份', () => {
    expect([...BOARD_COMPATIBILITY.serviceApiVersions]).toEqual([2, 3])
    expect([...BOARD_COMPATIBILITY.serviceApiVersions]).toEqual([...WIDGET_BOARD_SUPPORTED_API_VERSIONS])
  })

  it('功能清单是那四项，与服务面那份常量是同一份', () => {
    expect([...BOARD_COMPATIBILITY.features]).toEqual(['capabilityMetadata', 'eventData', 'marketProvider', 'pushData'])
    expect([...BOARD_COMPATIBILITY.features]).toEqual([...WIDGET_BOARD_FEATURES])
  })
})

describe('服务版本判定', () => {
  it('2 与 3 接受', () => {
    expect(serviceVersionProblem(2)).toBeUndefined()
    expect(serviceVersionProblem(3)).toBeUndefined()
  })

  it('4 被拒，原因里说出这一侧接受哪些版本', () => {
    expect(serviceVersionProblem(4)).toMatch(/只接受 2、3/)
  })

  it('没有声明时不判', () => {
    expect(serviceVersionProblem(undefined)).toBeUndefined()
  })
})

describe('manifest 的 requires', () => {
  it('不写 requires 的旧 manifest 照旧通过', () => {
    expect(validateManifest(manifest())).toBe(true)
  })

  it('写 requires 通过', () => {
    expect(validateManifest(manifest({ requires: { serviceApiVersion: 3, dsh: '>=0.2.1-rc.1' } }))).toBe(true)
  })

  it('requires 里多出来的字段被拒', () => {
    expect(validateManifest(manifest({ requires: { serviceApiVersion: 3, board: '1' } }))).toBe(false)
  })

  it('manifest 与市场条目用同一份 requires schema', () => {
    const listingRequires = (MARKET_LISTING_SCHEMA.properties.versions.items.properties as Record<string, unknown>).requires
    expect(listingRequires).toBe(WIDGET_REQUIRES_SCHEMA)
    expect(WIDGET_MANIFEST_SCHEMA.properties.requires).toBe(WIDGET_REQUIRES_SCHEMA)
  })
})
