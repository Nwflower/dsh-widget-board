/**
 * DSH 账户余额能力（D24）：把宿主的 `ctx.deepseekAccount.getBalance` 包成一张能力。
 *
 * 这里用替身账户服务，不碰真实登录；几项判据只针对包装层的输入输出与失败说法。
 */
import { describe, expect, it } from 'vitest'
import type { AccountBalance, InstanceFace } from '@dsh-widget-board/contracts'
import { DSH_ACCOUNT_CAPABILITY, DSH_ACCOUNT_PROVIDER, dshAccountCapability } from '../src/dsh-account'

const FACE: InstanceFace = { id: 'card', widget: 'dsh-balance', props: {} }

/** 一个假宿主上下文：只回应 deepseekAccount。 */
function contextWith(account: unknown): unknown {
  return {
    get(name: string): unknown {
      return name === 'deepseekAccount' ? account : undefined
    },
  }
}

const READY: AccountBalance = {
  status: 'ready',
  value: [{ currency: 'CNY', balance: '128.00' }],
  bonusWallets: [{ currency: 'CNY', balance: '20.00' }],
}

describe('DSH 余额能力', () => {
  it('声明提供方、标题与一次授权', () => {
    const capability = dshAccountCapability(contextWith({ getBalance: async () => READY }))
    expect(capability.provider).toBe(DSH_ACCOUNT_PROVIDER)
    expect(capability.id).toBe(DSH_ACCOUNT_CAPABILITY)
    expect(capability.permission).toBeUndefined()
    expect(capability.output).toBeDefined()
  })

  it('把账户服务返回的钱包原样交给调用方', async () => {
    const capability = dshAccountCapability(contextWith({ getBalance: async () => READY }))
    await expect(capability.call(FACE, {}, new AbortController().signal)).resolves.toEqual(READY)
  })

  it('未登录与没有账户服务都按 failed 回', async () => {
    const signedOut = dshAccountCapability(contextWith({ getBalance: async () => null }))
    await expect(signedOut.call(FACE, {}, new AbortController().signal)).resolves.toEqual({ status: 'failed' })
    const missing = dshAccountCapability(contextWith(undefined))
    await expect(missing.call(FACE, {}, new AbortController().signal)).resolves.toEqual({ status: 'failed' })
  })

  it('中止信号让在途查询立刻失败', async () => {
    const capability = dshAccountCapability(contextWith({ getBalance: () => new Promise<never>(() => {}) }))
    const controller = new AbortController()
    const running = capability.call(FACE, {}, controller.signal)
    controller.abort()
    await expect(running).rejects.toThrow(/取消/)
  })
})
