/**
 * 原生组件的登记处（D17、D31）：按组件 id 登记、拒绝重名、撤下，版本与形状不对时拒绝。
 *
 * 旧入口一次一个组件、各自释放；新把手一个提供方只有一个，一次撤下名下全部组件。两条路不能混用，
 * 新把手的 id 必须带作者域。
 */
import { describe, expect, it } from 'vitest'
import type { WidgetNativeProviderHandle } from '@dsh-widget-board/contracts'
import { createClientService, NATIVE_WIDGETS_PER_PROVIDER, nativeWidgetOf } from '../src/native'

/** 一个最小的组件：登记处只认它是不是函数。 */
function component(): null {
  return null
}

/** 换一个具名函数，用来分辨登记进去的是哪一份。 */
function other(): null {
  return null
}

/** 一个提供方把手；服务上一定装了 `registerProvider` 时才拿得到，测试里取不到就算失败。 */
function openProvider(service: ReturnType<typeof createClientService>, provider: string, apiVersion = service.apiVersion): WidgetNativeProviderHandle {
  if (service.registerProvider === undefined) throw new Error('浏览器侧服务没有 registerProvider')
  return service.registerProvider({ apiVersion, provider })
}

describe('原生组件的登记', () => {
  it('登记之后按 id 找得到，释放之后消失', () => {
    const service = createClientService()
    const dispose = service.registerWidgetType({ apiVersion: service.apiVersion, provider: 'p', id: 'a', component })
    expect(nativeWidgetOf('a')?.provider).toBe('p')
    dispose()
    expect(nativeWidgetOf('a')).toBeUndefined()
  })

  it('版本对不上时抛出', () => {
    const service = createClientService()
    expect(() => service.registerWidgetType({ apiVersion: service.apiVersion + 1, provider: 'p', id: 'a', component }))
      .toThrow(/版本/)
  })

  it('缺 provider 或 id 时抛出', () => {
    const service = createClientService()
    expect(() => service.registerWidgetType({ apiVersion: service.apiVersion, provider: ' ', id: 'a', component })).toThrow(/provider/)
    expect(() => service.registerWidgetType({ apiVersion: service.apiVersion, provider: 'p', id: '', component })).toThrow(/provider/)
  })

  it('component 不是组件时抛出', () => {
    const service = createClientService()
    expect(() => service.registerWidgetType({ apiVersion: service.apiVersion, provider: 'p', id: 'a', component: 42 })).toThrow(/React 组件/)
  })

  it('再次登记同一个 id 时抛出，先到的那一个继续用', () => {
    const service = createClientService()
    const dispose = service.registerWidgetType({ apiVersion: service.apiVersion, provider: 'p', id: 'a', component })
    expect(() => service.registerWidgetType({ apiVersion: service.apiVersion, provider: 'q', id: 'a', component }))
      .toThrow(/已经由 p 注册/)
    expect(nativeWidgetOf('a')?.provider).toBe('p')
    dispose()
    expect(nativeWidgetOf('a')).toBeUndefined()
  })
})

describe('旧入口的版本', () => {
  it('接受 2 与 3，两个版本登记出来的行为一样', () => {
    const service = createClientService()
    const older = service.registerWidgetType({ apiVersion: 2, provider: 'legacy-two', id: 'legacy-two-widget', component })
    const newer = service.registerWidgetType({ apiVersion: 3, provider: 'legacy-three', id: 'legacy-three-widget', component })
    expect(nativeWidgetOf('legacy-two-widget')?.provider).toBe('legacy-two')
    expect(nativeWidgetOf('legacy-three-widget')?.provider).toBe('legacy-three')
    older()
    newer()
    expect(nativeWidgetOf('legacy-two-widget')).toBeUndefined()
    expect(nativeWidgetOf('legacy-three-widget')).toBeUndefined()
  })

  it('集合外的版本抛出，并说出这一侧是哪一个版本', () => {
    const service = createClientService()
    expect(service.supportedApiVersions).toEqual([2, 3])
    expect(() => service.registerWidgetType({ apiVersion: 1, provider: 'p', id: 'a', component })).toThrow(/版本是 3/)
  })
})

describe('这一侧声明的版本与功能', () => {
  it('服务只列自己真有的功能，supports 逐项回答', () => {
    const service = createClientService()
    expect(service.features).toEqual(['eventData', 'pushData'])
    expect(service.supports?.('eventData')).toBe(true)
    expect(service.supports?.('pushData')).toBe(true)
    // 能力的元数据只有宿主那一侧有，市场提供方也只发布在宿主那一侧（D24、D30）。
    expect(service.supports?.('capabilityMetadata')).toBe(false)
    expect(service.supports?.('marketProvider')).toBe(false)
  })

  it('功能名不认识时抛出，静默回答「不支持」会盖住拼写错误', () => {
    const service = createClientService()
    expect(() => service.supports?.('nope' as never)).toThrow(/未知的功能/)
  })

  it('把手报出与这一侧同样的版本与功能', () => {
    const service = createClientService()
    const handle = openProvider(service, 'acme-surface')
    expect(handle.supportedApiVersions).toEqual([2, 3])
    expect(handle.features).toEqual(['eventData', 'pushData'])
    expect(handle.supports('marketProvider')).toBe(false)
    handle.dispose()
  })

  it('注册时声明了 v3 没有的功能名就抛出', () => {
    const service = createClientService()
    expect(() => service.registerProvider?.({ apiVersion: 3, provider: 'acme-bad-feature', features: ['nope' as never] }))
      .toThrow(/未知的功能/)
  })
})

describe('新把手的原生组件', () => {
  it('多个组件一次撤下，dispose 幂等', () => {
    const service = createClientService()
    const handle = openProvider(service, 'acme-multi')
    handle.registerNativeWidget({ id: 'acme.clock', component })
    handle.registerNativeWidget({ id: 'acme.panel', component: other })
    expect(nativeWidgetOf('acme.clock')?.provider).toBe('acme-multi')
    expect(handle.widgets).toEqual(['acme.clock', 'acme.panel'])
    handle.dispose()
    expect(nativeWidgetOf('acme.clock')).toBeUndefined()
    expect(nativeWidgetOf('acme.panel')).toBeUndefined()
    expect(handle.widgets).toEqual([])
    handle.dispose()
  })

  it('单个释放函数只撤自己的那一个组件', () => {
    const service = createClientService()
    const handle = openProvider(service, 'acme-single')
    const release = handle.registerNativeWidget({ id: 'acme.first', component })
    handle.registerNativeWidget({ id: 'acme.second', component: other })
    release()
    expect(nativeWidgetOf('acme.first')).toBeUndefined()
    expect(nativeWidgetOf('acme.second')?.provider).toBe('acme-single')
    release()
    expect(nativeWidgetOf('acme.second')?.provider).toBe('acme-single')
    handle.dispose()
    expect(nativeWidgetOf('acme.second')).toBeUndefined()
  })

  it('撤下之后把手不能再挂组件', () => {
    const service = createClientService()
    const handle = openProvider(service, 'acme-dead')
    handle.dispose()
    expect(() => handle.registerNativeWidget({ id: 'acme.late', component })).toThrow(/已经撤下/)
  })

  it('同一个提供方重复 registerProvider 时抛出，dispose 之后可以重新注册', () => {
    const service = createClientService()
    const handle = openProvider(service, 'acme-again')
    handle.registerNativeWidget({ id: 'acme.once', component })
    expect(() => openProvider(service, 'acme-again')).toThrow(/已经有一个活动的把手/)
    handle.dispose()
    const again = openProvider(service, 'acme-again')
    again.registerNativeWidget({ id: 'acme.again', component })
    expect(nativeWidgetOf('acme.again')?.provider).toBe('acme-again')
    again.dispose()
  })

  it('只接受版本 3，别的一律抛出', () => {
    const service = createClientService()
    expect(() => openProvider(service, 'acme-v2', 2)).toThrow(/只接受版本 3/)
  })

  it('component 不是组件时照样抛出', () => {
    const service = createClientService()
    const handle = openProvider(service, 'acme-shape')
    expect(() => handle.registerNativeWidget({ id: 'acme.broken', component: 42 })).toThrow(/React 组件/)
    handle.dispose()
  })
})

describe('作者域与重名', () => {
  it('新把手的 id 必须带作者域', () => {
    const service = createClientService()
    const handle = openProvider(service, 'acme-domain')
    expect(() => handle.registerNativeWidget({ id: 'flat', component })).toThrow(/作者域/)
    expect(() => handle.registerNativeWidget({ id: 'acme.clock', component })).not.toThrow()
    handle.dispose()
  })

  it('旧入口的 id 保持扁平，带点的让给新把手', () => {
    const service = createClientService()
    expect(() => service.registerWidgetType({ apiVersion: 3, provider: 'legacy-flat', id: 'acme.clock', component }))
      .toThrow(/registerProvider/)
    const dispose = service.registerWidgetType({ apiVersion: 3, provider: 'legacy-flat', id: 'clock-flat', component })
    dispose()
  })

  it('两个提供方抢同一个 id 时先到者胜，错误写明已有提供方', () => {
    const service = createClientService()
    const first = openProvider(service, 'acme-first')
    first.registerNativeWidget({ id: 'acme.shared', component })
    const second = openProvider(service, 'acme-second')
    expect(() => second.registerNativeWidget({ id: 'acme.shared', component: other })).toThrow(/已经由 acme-first 注册/)
    expect(nativeWidgetOf('acme.shared')?.component).toBe(component)
    second.dispose()
    first.dispose()
  })

  it('旧入口与旧入口之间的重名也照这条规则', () => {
    const service = createClientService()
    const dispose = service.registerWidgetType({ apiVersion: 2, provider: 'legacy-a', id: 'shared-flat', component })
    expect(() => service.registerWidgetType({ apiVersion: 3, provider: 'legacy-b', id: 'shared-flat', component }))
      .toThrow(/已经由 legacy-a 注册/)
    dispose()
  })
})

describe('新旧入口混用', () => {
  it('有活动把手时旧入口抛出', () => {
    const service = createClientService()
    const handle = openProvider(service, 'acme-mixed')
    expect(() => service.registerWidgetType({ apiVersion: 3, provider: 'acme-mixed', id: 'mixed-flat', component }))
      .toThrow(/新旧入口不能混用/)
    handle.dispose()
    const dispose = service.registerWidgetType({ apiVersion: 3, provider: 'acme-mixed', id: 'mixed-flat', component })
    expect(nativeWidgetOf('mixed-flat')?.provider).toBe('acme-mixed')
    dispose()
    expect(nativeWidgetOf('mixed-flat')).toBeUndefined()
  })

  it('旧入口还挂着组件时 registerProvider 抛出，全部释放之后可以注册', () => {
    const service = createClientService()
    const dispose = service.registerWidgetType({ apiVersion: 2, provider: 'acme-old', id: 'old-flat', component })
    expect(() => openProvider(service, 'acme-old')).toThrow(/新旧入口不能混用/)
    dispose()
    const handle = openProvider(service, 'acme-old')
    handle.registerNativeWidget({ id: 'acme.old', component })
    expect(nativeWidgetOf('acme.old')?.provider).toBe('acme-old')
    handle.dispose()
  })
})

describe('每个提供方的原生组件上限', () => {
  it(`挂满 ${NATIVE_WIDGETS_PER_PROVIDER} 个之后下一个抛出`, () => {
    const service = createClientService()
    const handle = openProvider(service, 'acme-quota')
    for (let index = 0; index < NATIVE_WIDGETS_PER_PROVIDER; index += 1) {
      handle.registerNativeWidget({ id: `acme.q${index}`, component })
    }
    expect(handle.widgets).toHaveLength(NATIVE_WIDGETS_PER_PROVIDER)
    expect(() => handle.registerNativeWidget({ id: 'acme.overflow', component })).toThrow(/上限是 128/)
    expect(nativeWidgetOf('acme.overflow')).toBeUndefined()
    handle.dispose()
    expect(nativeWidgetOf('acme.q0')).toBeUndefined()
  })

  it('释放一个之后又有位置', () => {
    const service = createClientService()
    const handle = openProvider(service, 'acme-quota-slot')
    const release = handle.registerNativeWidget({ id: 'acme.only', component })
    for (let index = 1; index < NATIVE_WIDGETS_PER_PROVIDER; index += 1) {
      handle.registerNativeWidget({ id: `acme.s${index}`, component })
    }
    expect(() => handle.registerNativeWidget({ id: 'acme.full', component })).toThrow(/上限/)
    release()
    expect(() => handle.registerNativeWidget({ id: 'acme.full', component })).not.toThrow()
    handle.dispose()
  })
})
