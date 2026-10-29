/**
 * 提供方调用的执行器与健康记录（D31、D17）：读取、动作与能力共用一套超时与并发，失败按提供方分开记。
 *
 * 这些用例盯着三件容易写错的事：超时之后槽有没有放掉、忽略中止信号的提供方能不能突破 8 个槽、一个
 * 提供方出错时别的提供方还跑不跑。
 */
import { describe, expect, it } from 'vitest'
import type { InstanceFace } from '@dsh-widget-board/contracts'
import {
  PROVIDER_CONCURRENCY,
  PROVIDER_TIMEOUT_MS,
  capabilityTimeoutOf,
  createProviderHealth,
} from '../src/provider-health'
import { createRegistries } from '../src/sources'

/** 一张不在看板上的卡片：执行器只看它怎样交给提供方。 */
const FACE: InstanceFace = { id: 'card', widget: 'w', props: {} }

/** 一直不答的提供方；它不看中止信号。 */
function never(): Promise<never> {
  return new Promise<never>(() => {})
}

describe('超时', () => {
  it('读取超时对调用方立即失败，计一次超时，原因码写进 lastError', async () => {
    const health = createProviderHealth({ timeoutMs: 10 })
    const registries = createRegistries(health)
    registries.registerDataSource({ apiVersion: 3, provider: 'acme', id: 'slow', read: () => never() })
    const started = Date.now()
    await expect(registries.readSource('slow', FACE)).rejects.toMatchObject({ code: 'provider-timeout', provider: 'acme' })
    expect(Date.now() - started).toBeLessThan(1_000)
    expect(health.snapshot()[0]).toMatchObject({ failures: 0, timeouts: 1, available: true })
    expect(health.snapshot()[0]?.lastError).toMatch(/^provider-timeout：数据源 slow 在 10 毫秒内没有答完/)
  })

  it('动作超时走同一个执行器', async () => {
    const health = createProviderHealth({ timeoutMs: 10 })
    const registries = createRegistries(health)
    registries.registerAction({ apiVersion: 3, provider: 'acme', id: 'hang', run: () => never() })
    await expect(registries.runAction('hang', FACE, undefined)).rejects.toMatchObject({ code: 'provider-timeout' })
    expect(health.snapshot()[0]?.timeouts).toBe(1)
  })

  it('能力的等待范围是 1–25 秒，缺省 15 秒', () => {
    expect(PROVIDER_TIMEOUT_MS).toBe(15_000)
    expect(capabilityTimeoutOf(undefined)).toBe(15_000)
    expect(capabilityTimeoutOf(0)).toBe(15_000)
    expect(capabilityTimeoutOf(10)).toBe(1_000)
    expect(capabilityTimeoutOf(2_000)).toBe(2_000)
    expect(capabilityTimeoutOf(60_000)).toBe(25_000)
  })

  it('能力按注册声明的 timeoutMs 计时，超时对调用方失败', async () => {
    const health = createProviderHealth()
    const registries = createRegistries(health)
    registries.registerCapability({ apiVersion: 3, provider: 'acme', id: 'hang', timeoutMs: 1_000, call: () => never() })
    await expect(registries.callCapability('hang', FACE, undefined, new AbortController().signal))
      .rejects.toMatchObject({ code: 'provider-timeout' })
    expect(health.snapshot()[0]?.timeouts).toBe(1)
  }, 5_000)

  it('调用方自己中止时立刻停掉调用，并把它交给提供方的信号置为已中止', async () => {
    const health = createProviderHealth()
    const registries = createRegistries(health)
    let received: AbortSignal | undefined
    registries.registerDataSource({
      apiVersion: 3,
      provider: 'acme',
      id: 'slow',
      read: (_instance, signal) => { received = signal; return never() },
    })
    const controller = new AbortController()
    const running = registries.readSource('slow', FACE, controller.signal)
    controller.abort()
    await expect(running).rejects.toMatchObject({ code: 'provider-cancelled' })
    expect(received?.aborted).toBe(true)
    // 调用方自己走了不算提供方的失败。
    expect(health.snapshot()[0]).toMatchObject({ failures: 0, timeouts: 0 })
  })
})

describe('并发', () => {
  it('同时最多 8 个调用，第 9 个立即报错不排队', async () => {
    const health = createProviderHealth({ timeoutMs: 10 })
    const registries = createRegistries(health)
    const resolvers: ((value: unknown) => void)[] = []
    registries.registerDataSource({
      apiVersion: 3,
      provider: 'acme',
      id: 'slow',
      read: () => new Promise<unknown>((resolve) => { resolvers.push(resolve) }),
    })
    const running = Array.from({ length: PROVIDER_CONCURRENCY }, () => registries.readSource('slow', FACE))
    const settled = await Promise.allSettled(running)
    expect(settled.every((outcome) => outcome.status === 'rejected'
      && (outcome.reason as { code?: string }).code === 'provider-timeout')).toBe(true)
    expect(health.snapshot()[0]?.timeouts).toBe(PROVIDER_CONCURRENCY)
    // 8 个提供方 promise 都还没结束：槽仍然占着，忽略中止信号的提供方不能靠超时多占一个。
    const busy = registries.readSource('slow', FACE)
    await expect(busy).rejects.toMatchObject({ code: 'provider-busy' })
    await expect(busy).rejects.toThrow(/不排队/)
    // 提供方自己结束之后槽才放出来。
    for (const resolve of resolvers) resolve('late')
    await new Promise((done) => { setTimeout(done, 0) })
    registries.registerDataSource({ apiVersion: 3, provider: 'acme', id: 'quick', read: () => 'ok' })
    await expect(registries.readSource('quick', FACE)).resolves.toBe('ok')
  })
})

describe('隔离与计数', () => {
  it('一个提供方失败只记在它自己名下，另一个照常跑', async () => {
    const health = createProviderHealth()
    const registries = createRegistries(health)
    registries.registerDataSource({ apiVersion: 3, provider: 'acme', id: 'broken', read: () => { throw new Error('网络断了') } })
    registries.registerDataSource({ apiVersion: 3, provider: 'beta', id: 'fine', read: () => 7 })
    await expect(registries.readSource('broken', FACE)).rejects.toThrow('网络断了')
    await expect(registries.readSource('fine', FACE)).resolves.toBe(7)
    const [acme, beta] = health.snapshot()
    expect(acme).toEqual({
      provider: 'acme',
      features: [],
      registrations: 1,
      failures: 1,
      timeouts: 0,
      available: true,
      lastError: 'provider-failure：数据源 broken 失败：网络断了',
    })
    expect(beta).toEqual({ provider: 'beta', features: [], registrations: 1, failures: 0, timeouts: 0, available: true })
  })

  it('撤下之后不可用，重新注册恢复，计数不清零', () => {
    const health = createProviderHealth()
    const registries = createRegistries(health)
    const release = registries.registerDataSource({ apiVersion: 3, provider: 'acme', id: 'count', read: () => 1 })
    expect(health.snapshot()[0]).toMatchObject({ registrations: 1, available: true })
    release()
    release()
    expect(health.snapshot()[0]).toMatchObject({ registrations: 1, available: false })
    registries.registerDataSource({ apiVersion: 3, provider: 'acme', id: 'count', read: () => 1 })
    expect(health.snapshot()[0]).toMatchObject({ registrations: 2, available: true })
  })

  it('把手在场就算可用但不计入注册数，功能声明进记录', () => {
    const health = createProviderHealth()
    const release = health.present('acme', ['marketProvider'])
    expect(health.snapshot()).toEqual([
      { provider: 'acme', features: ['marketProvider'], registrations: 0, failures: 0, timeouts: 0, available: true },
    ])
    release()
    expect(health.snapshot()[0]?.available).toBe(false)
  })

  it('failed 记一次失败，原因码与原因一起写进 lastError', () => {
    const health = createProviderHealth()
    health.failed('acme', 'provider-output', '能力 ping 的结果与 output schema 不符')
    expect(health.snapshot()[0]).toEqual({
      provider: 'acme',
      features: [],
      registrations: 0,
      failures: 1,
      timeouts: 0,
      available: false,
      lastError: 'provider-output：能力 ping 的结果与 output schema 不符',
    })
  })

  it('注册、失败与超时都通知一次，退订之后不再通知', async () => {
    const health = createProviderHealth({ timeoutMs: 10 })
    const registries = createRegistries(health)
    const seen: number[] = []
    const stop = health.onChange(() => { seen.push(1) })
    const release = health.registered('acme')
    expect(seen).toHaveLength(1)
    health.failed('acme', 'provider-output', '结果不合 schema')
    expect(seen).toHaveLength(2)
    release()
    expect(seen).toHaveLength(3)
    stop()
    registries.registerDataSource({ apiVersion: 3, provider: 'acme', id: 'gone', read: () => { throw new Error('断了') } })
    await expect(registries.readSource('gone', FACE)).rejects.toThrow('断了')
    expect(seen).toHaveLength(3)
  })
})
