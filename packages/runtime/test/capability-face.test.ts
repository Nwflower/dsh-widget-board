/**
 * 能力面的投影（D32）：握手带来的元数据与旧的字符串数组都由同一处投影出来。
 *
 * 新的 init 带元数据时，元数据保留声明次序里的全部项（含现在不可用的），旧的字符串数组取其中可用
 * 的那些 id；只带字符串数组的旧 init 照旧，元数据为空。交出去的是独立的一份，组件改不动运行时里
 * 那一份。
 */
import { describe, expect, it } from 'vitest'
import type { CapabilityMetadata } from '@dsh-widget-board/contracts'
import { capabilityFaceOf } from '../src/capability-face'

/** 一项现在能调的能力：注册项的标题、schema 与权限都在。 */
const AVAILABLE: CapabilityMetadata = {
  id: 'dsh-account:balance',
  provider: '@deepseek-ai/dsh-account',
  title: { zh: '余额', en: 'Balance' },
  description: { zh: '读账户余额', en: 'Read the account balance' },
  input: { type: 'object', properties: { currency: { type: 'string' } } },
  output: { type: 'object', properties: { total: { type: 'number' } } },
  permission: { hosts: ['api.example.com'] },
  available: true,
}

/** 一项现在解析不到的能力：只有 id 与 available。 */
const ABSENT: CapabilityMetadata = { id: 'demo:absent', available: false }

describe('能力面的投影', () => {
  it('新的 init 保留全部项，旧字符串数组只取可用的那些 id', () => {
    const face = capabilityFaceOf({ capabilityMetadata: [AVAILABLE, ABSENT] })
    expect(face.capabilityMetadata).toEqual([AVAILABLE, ABSENT])
    expect(face.capabilityMetadata.map((item) => item.id)).toEqual(['dsh-account:balance', 'demo:absent'])
    expect(face.capabilities).toEqual(['dsh-account:balance'])
  })

  it('可用的 id 跟着声明次序，不按可用与否重排', () => {
    const echo: CapabilityMetadata = { id: 'demo:echo', available: true }
    const face = capabilityFaceOf({ capabilityMetadata: [AVAILABLE, ABSENT, echo] })
    expect(face.capabilities).toEqual(['dsh-account:balance', 'demo:echo'])
    expect(face.capabilityMetadata).toHaveLength(3)
  })

  it('不可用项只留 id 与 available，不补占位值', () => {
    const [item] = capabilityFaceOf({ capabilityMetadata: [ABSENT] }).capabilityMetadata
    expect(Object.keys(item ?? {}).sort()).toEqual(['available', 'id'])
    expect(item).toEqual(ABSENT)
  })

  it('旧 init 的字符串数组照旧，元数据为空', () => {
    const face = capabilityFaceOf({ capabilities: ['demo:echo', 'dsh-account:balance'] })
    expect(face.capabilities).toEqual(['demo:echo', 'dsh-account:balance'])
    expect(face.capabilityMetadata).toEqual([])
  })

  it('两者都没有时是空能力面', () => {
    const face = capabilityFaceOf({})
    expect(face.capabilities).toEqual([])
    expect(face.capabilityMetadata).toEqual([])
  })

  it('带元数据时旧的字符串数组不再说话，两份不会说两套话', () => {
    const face = capabilityFaceOf({ capabilities: ['demo:absent'], capabilityMetadata: [AVAILABLE] })
    expect(face.capabilities).toEqual(['dsh-account:balance'])
  })

  it('输入数组被改动不影响投影出来的那一份', () => {
    const declared: CapabilityMetadata[] = [{ ...AVAILABLE }, { ...ABSENT }]
    const legacy = ['demo:echo']
    const face = capabilityFaceOf({ capabilityMetadata: declared, capabilities: legacy })
    declared[0] = { id: 'late', available: true }
    declared.push({ id: 'later', available: true })
    legacy.push('dsh-board:refresh')
    expect(face.capabilities).toEqual(['dsh-account:balance'])
    expect(face.capabilityMetadata.map((item) => item.id)).toEqual(['dsh-account:balance', 'demo:absent'])
  })

  it('交出去的是冻住的一份，组件改它改不到运行时里', () => {
    const face = capabilityFaceOf({ capabilityMetadata: [AVAILABLE, ABSENT] })
    expect(Object.isFrozen(face.capabilities)).toBe(true)
    expect(Object.isFrozen(face.capabilityMetadata)).toBe(true)
    const first = face.capabilityMetadata[0]
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first?.input)).toBe(true)
    expect(Object.isFrozen(first?.permission)).toBe(true)
    expect(() => { (face.capabilityMetadata as CapabilityMetadata[]).push(ABSENT) }).toThrow(TypeError)
    expect(() => { (first as CapabilityMetadata).available = false }).toThrow(TypeError)
  })
})
