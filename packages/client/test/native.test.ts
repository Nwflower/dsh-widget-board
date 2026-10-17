/**
 * 原生组件的登记处（D17）：按组件 id 登记、替换、撤下，版本与形状不对时拒绝。
 */
import { describe, expect, it } from 'vitest'
import { createClientService, nativeWidgetOf } from '../src/native'

/** 一个最小的组件：登记处只认它是不是函数。 */
function component(): null {
  return null
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

  it('再次登记同一个 id 时用新的，旧登记的释放不动它', () => {
    const service = createClientService()
    const dispose = service.registerWidgetType({ apiVersion: service.apiVersion, provider: 'p', id: 'a', component })
    const other = (): null => null
    const disposeOther = service.registerWidgetType({ apiVersion: service.apiVersion, provider: 'q', id: 'a', component: other })
    dispose()
    expect(nativeWidgetOf('a')?.provider).toBe('q')
    disposeOther()
    expect(nativeWidgetOf('a')).toBeUndefined()
  })
})
