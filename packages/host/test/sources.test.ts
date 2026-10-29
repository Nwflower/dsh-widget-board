/**
 * 数据源、动作与能力的注册表（D6、D31、D24）：名字全局唯一，释放之后空出来，带提供方的名字只认那一个。
 */
import { describe, expect, it } from 'vitest'
import { createRegistries } from '../src/sources'

describe('数据源、动作与能力的注册表', () => {
  it('同名跨提供方后到者抛出，并说明已有提供方', () => {
    const registries = createRegistries()
    registries.registerDataSource({ apiVersion: 3, provider: 'acme', id: 'count', read: () => 1 })
    expect(() => registries.registerDataSource({ apiVersion: 3, provider: 'beta', id: 'count', read: () => 2 }))
      .toThrow(/数据源 count 已经由 acme 注册过/)
    expect(registries.resolveDataSource('count')?.provider).toBe('acme')
  })

  it('释放之后名字空出来，另一个提供方可以注册', () => {
    const registries = createRegistries()
    const release = registries.registerAction({ apiVersion: 2, provider: 'acme', id: 'touch', run: () => undefined })
    release()
    release()
    expect(registries.resolveAction('touch')).toBeUndefined()
    expect(registries.registerAction({ apiVersion: 3, provider: 'beta', id: 'touch', run: () => undefined })).toBeTypeOf('function')
    expect(registries.resolveAction('touch')?.provider).toBe('beta')
  })

  it('带提供方的名字只认那一个提供方', () => {
    const registries = createRegistries()
    registries.registerCapability({ apiVersion: 3, provider: 'acme', id: 'ping', call: () => 'pong' })
    expect(registries.resolveCapability('acme:ping')?.provider).toBe('acme')
    expect(registries.resolveCapability('beta:ping')).toBeUndefined()
    expect(registries.resolveCapability('ping')?.provider).toBe('acme')
  })

  it('读不到的名字抛出，说提供它的插件可能没有安装', async () => {
    const registries = createRegistries()
    await expect(registries.readSource('missing', { id: 'card', widget: 'w', props: {} })).rejects.toThrow(/没有数据源 missing/)
    await expect(registries.runAction('missing', { id: 'card', widget: 'w', props: {} }, undefined)).rejects.toThrow(/没有动作 missing/)
    await expect(registries.callCapability('missing', { id: 'card', widget: 'w', props: {} }, undefined, new AbortController().signal))
      .rejects.toThrow(/没有能力 missing/)
  })

  it('读数据、跑动作与调能力都交给注册的那一份', async () => {
    const registries = createRegistries()
    registries.registerDataSource({ apiVersion: 3, provider: 'acme', id: 'count', read: (instance) => instance.id })
    registries.registerAction({ apiVersion: 3, provider: 'acme', id: 'touch', run: (_instance, payload) => payload })
    registries.registerCapability({ apiVersion: 3, provider: 'acme', id: 'ping', call: () => 'pong' })
    expect(await registries.readSource('count', { id: 'card', widget: 'w', props: {} })).toBe('card')
    expect(await registries.runAction('acme:touch', { id: 'card', widget: 'w', props: {} }, 'payload')).toBe('payload')
    expect(await registries.callCapability('ping', { id: 'card', widget: 'w', props: {} }, undefined, new AbortController().signal)).toBe('pong')
  })

  it('能力列表按注册顺序，供握手用', () => {
    const registries = createRegistries()
    registries.registerCapability({ apiVersion: 3, provider: 'acme', id: 'second', call: () => 0 })
    registries.registerCapability({ apiVersion: 3, provider: 'beta', id: 'first', call: () => 0 })
    expect(registries.listCapabilities()).toEqual(['second', 'first'])
    expect(registries.namesOf('acme')).toEqual({ dataSources: [], actions: [], capabilities: ['second'] })
  })

  it('提供方为空时抛出', () => {
    const registries = createRegistries()
    expect(() => registries.registerDataSource({ apiVersion: 3, provider: ' ', id: 'count', read: () => 0 })).toThrow(/要写明提供方/)
  })
})