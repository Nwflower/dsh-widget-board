/**
 * 能力的公开面（D32）：沙箱的 init 与原生组件的参数由同一份快照投影出来。
 *
 * 往下发的是可用子集与逐项元数据；manifest 的声明白名单不发——声明过不等于现在能调。交下去的是
 * 副本，组件改不到快照里那一份。
 */
import { describe, expect, it } from 'vitest'
import type { CapabilityMetadata } from '@dsh-widget-board/contracts'
import { capabilityFaceOf } from '../src/capability-face'

/** 一项现在能调的能力。 */
const AVAILABLE: CapabilityMetadata = {
  id: 'dsh-account:balance',
  provider: '@deepseek-ai/dsh-account',
  title: { zh: '余额', en: 'Balance' },
  input: { type: 'object', properties: { currency: { type: 'string' } } },
  available: true,
}

/** 一项现在解析不到的能力。 */
const ABSENT: CapabilityMetadata = { id: 'demo:absent', available: false }

describe('快照的能力面', () => {
  it('可用子集与逐项元数据一起交下去，声明次序不变', () => {
    const face = capabilityFaceOf({
      availableCapabilities: ['dsh-account:balance'],
      capabilityMetadata: [AVAILABLE, ABSENT],
    })
    expect(face.capabilities).toEqual(['dsh-account:balance'])
    expect(face.capabilityMetadata).toEqual([AVAILABLE, ABSENT])
  })

  it('只有元数据时可用子集缺席，不拿声明白名单顶替', () => {
    const face = capabilityFaceOf({ capabilityMetadata: [ABSENT] })
    expect(face.capabilities).toBeUndefined()
    expect(face.capabilityMetadata).toEqual([ABSENT])
  })

  it('快照里没有能力面时两个字段都缺席，组件按空能力面处理', () => {
    expect(capabilityFaceOf({})).toEqual({})
  })

  it('交下去的是副本：改快照里的数组不影响组件手里那一份', () => {
    const available = ['dsh-account:balance']
    const metadata = [{ ...AVAILABLE }]
    const face = capabilityFaceOf({ availableCapabilities: available, capabilityMetadata: metadata })
    available.push('demo:absent')
    metadata.push({ id: 'late', available: true })
    expect(face.capabilities).toEqual(['dsh-account:balance'])
    expect(face.capabilityMetadata?.map((item) => item.id)).toEqual(['dsh-account:balance'])
  })

  it('两个字段都冻住，同一个快照投影两次各自独立', () => {
    const first = capabilityFaceOf({ availableCapabilities: ['dsh-account:balance'], capabilityMetadata: [AVAILABLE] })
    expect(Object.isFrozen(first.capabilities)).toBe(true)
    expect(Object.isFrozen(first.capabilityMetadata)).toBe(true)
    expect(() => { (first.capabilities as unknown as string[]).push('demo:echo') }).toThrow(TypeError)
    const second = capabilityFaceOf({ availableCapabilities: ['dsh-account:balance'], capabilityMetadata: [AVAILABLE] })
    expect(second.capabilities).not.toBe(first.capabilities)
  })
})
