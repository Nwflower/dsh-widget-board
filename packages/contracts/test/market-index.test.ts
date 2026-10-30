/**
 * 市场索引的 schema（D30）：提交的索引通过校验，写坏的索引给出具体路径与原因。
 *
 * 校验器与 `scripts/market.mjs --check` 读同一份 schema；这里判的是 schema 本身能不能挑出问题。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import Ajv from 'ajv'
import { MARKET_INDEX_SCHEMA } from '@dsh-widget-board/contracts'

const INDEX = JSON.parse(readFileSync(new URL('../../../market/index.json', import.meta.url), 'utf8')) as Record<string, unknown>
const validate = new Ajv({ allErrors: true, strict: true }).compile(MARKET_INDEX_SCHEMA)

/** 一份最小的合格索引。 */
function index(): Record<string, unknown> {
  return {
    format: 1,
    market: { title: { zh: '市场', en: 'Market' } },
    widgets: [{
      id: 'acme.clock',
      title: { zh: '时钟', en: 'Clock' },
      author: { name: 'acme' },
      versions: [{
        version: '1.0.0',
        package: { url: 'packages/acme.clock-1.0.0.dshw', sha256: 'a'.repeat(64), bytes: 1024 },
        sizes: ['s'],
      }],
    }],
  }
}

describe('市场索引', () => {
  it('仓库里的索引通过校验', () => {
    const problems = validate(INDEX)
    expect(validate.errors ?? []).toEqual([])
    expect(problems).toBe(true)
  })

  it('格式版本不对时拒绝', () => {
    const broken = index()
    broken.format = 2
    expect(validate(broken)).toBe(false)
    expect(validate.errors?.[0]?.instancePath).toBe('/format')
  })

  it('扁平 id 被拒：市场条目必须带作者域', () => {
    const broken = index()
    ;(broken.widgets as { id: string }[])[0]!.id = 'clock'
    expect(validate(broken)).toBe(false)
    expect(validate.errors?.some((error) => error.instancePath === '/widgets/0/id')).toBe(true)
  })

  it('哈希不是 64 位小写十六进制时拒绝', () => {
    const broken = index()
    const version = (broken.widgets as { versions: { package: { sha256: string } }[] }[])[0]!.versions[0]!
    version.package.sha256 = 'ABC'
    expect(validate(broken)).toBe(false)
    expect(validate.errors?.some((error) => error.instancePath.endsWith('/package/sha256'))).toBe(true)
  })

  it('多出来的字段被拒：格式只增不减要按迁移规则走', () => {
    const broken = index()
    ;(broken.widgets as Record<string, unknown>[])[0]!.extra = true
    expect(validate(broken)).toBe(false)
  })
})
