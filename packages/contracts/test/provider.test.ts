/**
 * 提供方 SDK 与 v3 的版本、功能集合（D31）：形状构造、版本只认新入口的那一个数、功能名拼错就抛出。
 */
import { describe, expect, it } from 'vitest'
import {
  actionRegistration,
  capabilityRegistration,
  defineProvider,
  marketRegistration,
  nativeProviderRegistration,
  nativeRegistration,
  providerRegistration,
  sourceRegistration,
} from '../src/provider'
import type { ProviderIdentity } from '../src/provider'
import { WIDGET_BOARD_FEATURES, WIDGET_BOARD_PROVIDER_API_VERSION, WIDGET_BOARD_SUPPORTED_API_VERSIONS, requireFeatures, supportsFeature } from '../src/service'

describe('版本集合与功能清单', () => {
  it('旧入口接受 2 与 3', () => {
    expect([...WIDGET_BOARD_SUPPORTED_API_VERSIONS]).toEqual([2, 3])
  })

  it('新入口只接受 3', () => {
    expect(WIDGET_BOARD_PROVIDER_API_VERSION).toBe(3)
  })

  it('首版四项功能按清单次序', () => {
    expect([...WIDGET_BOARD_FEATURES]).toEqual(['capabilityMetadata', 'eventData', 'marketProvider', 'pushData'])
  })
})

describe('功能声明与支持判定', () => {
  it('声明省略时是空清单，重复的去掉、次序按声明', () => {
    expect(requireFeatures(undefined)).toEqual([])
    expect(requireFeatures(['pushData', 'eventData', 'pushData'])).toEqual(['pushData', 'eventData'])
    expect(Object.isFrozen(requireFeatures(['pushData']))).toBe(true)
  })

  it('声明里有拼错的功能名就抛出', () => {
    expect(() => requireFeatures(['nope' as never])).toThrow(/未知的功能 nope/)
  })

  it('支持判定先校验名字，再问这一侧的功能集合', () => {
    expect(supportsFeature(WIDGET_BOARD_FEATURES, 'marketProvider')).toBe(true)
    expect(supportsFeature(['eventData'], 'marketProvider')).toBe(false)
    expect(supportsFeature(['eventData'], 'eventData')).toBe(true)
    expect(() => supportsFeature(WIDGET_BOARD_FEATURES, 'nope' as never)).toThrow(/未知的功能 nope/)
  })
})

describe('提供方 SDK', () => {
  it('身份默认带上当前版本，功能去重', () => {
    const identity = defineProvider({ provider: 'demo', features: ['pushData', 'pushData', 'eventData'] })
    expect(identity).toEqual({ provider: 'demo', apiVersion: 3, features: ['pushData', 'eventData'] })
    expect(Object.isFrozen(identity)).toBe(true)
  })

  it('版本只认新入口的那一个数', () => {
    expect(() => defineProvider({ provider: 'demo', apiVersion: 2 })).toThrow(/只接受版本 3/)
  })

  it('未知的功能名抛出', () => {
    expect(() => defineProvider({ provider: 'demo', features: ['nope' as never] })).toThrow(/未知的功能/)
  })

  it('空的提供方名抛出', () => {
    expect(() => defineProvider({ provider: ' ' })).toThrow(/不能为空/)
  })

  it('注册只报身份与用途，资源走把手', () => {
    const identity = defineProvider({ provider: 'demo', features: ['marketProvider'] })
    const registration = providerRegistration(identity)
    expect(registration).toEqual({ apiVersion: 3, provider: 'demo', features: ['marketProvider'] })
    expect(Object.isFrozen(registration)).toBe(true)
    for (const field of ['directories', 'sources', 'actions', 'capabilities', 'markets']) {
      expect(field in registration).toBe(false)
    }
  })

  it('浏览器侧的注册同样只报身份与用途', () => {
    const identity = defineProvider({ provider: 'demo' })
    const registration = nativeProviderRegistration(identity)
    expect(registration).toEqual({ apiVersion: 3, provider: 'demo', features: [] })
    expect('widgets' in registration).toBe(false)
  })

  it('手工构造的身份也要重新校验', () => {
    const handmade = (fields: Partial<ProviderIdentity>): ProviderIdentity => ({ provider: 'demo', apiVersion: 3, features: [], ...fields })
    expect(() => providerRegistration(handmade({ features: ['nope' as never] }))).toThrow(/未知的功能/)
    expect(() => nativeProviderRegistration(handmade({ apiVersion: 2 }))).toThrow(/只接受版本 3/)
    expect(() => providerRegistration(handmade({ provider: ' ' }))).toThrow(/不能为空/)
  })

  it('子注册省略版本与提供方名', () => {
    const source = sourceRegistration({ id: 'clock', read: () => 1 })
    const native = nativeRegistration({ id: 'native', component: () => null })
    expect('provider' in source).toBe(false)
    expect('apiVersion' in source).toBe(false)
    expect('provider' in native).toBe(false)
    expect(Object.isFrozen(source)).toBe(true)
  })

  it('子注册少了行为就抛出', () => {
    expect(() => sourceRegistration({ id: 'broken' } as never)).toThrow(/必须是一个函数/)
    expect(() => actionRegistration({ id: '', run: () => 0 })).toThrow(/不能为空/)
  })

  it('能力的参数与结果的 schema 原样带上', () => {
    const capability = capabilityRegistration({ id: 'echo', input: { type: 'object' }, call: () => 1 })
    expect(capability.input).toEqual({ type: 'object' })
  })

  it('市场提供方的列举与取包原样带上', () => {
    const market = marketRegistration({ id: 'local', title: { zh: '本地', en: 'Local' }, list: async () => [], fetch: async () => new Uint8Array() })
    expect(market.title).toEqual({ zh: '本地', en: 'Local' })
  })
})
