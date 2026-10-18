/**
 * DSH 账户余额能力（D24）：把宿主的 `ctx.deepseekAccount.getBalance` 包装成一张能力，让余额卡经
 * `widget.call` 直接读当前登录账号的钱包。
 *
 * 这里只认 DSH 的 Host 侧账户服务：值没有 token，卡片拿到的只是钱包数组。能力本身仍然向人问一次
 * 授权（`permission: {}`），跟数据源与动作一样绑在组件的当前版本上（D6）。
 */
import type { AccountBalance, CapabilityRegistration, InstanceFace } from '@dsh-widget-board/contracts'
import { WIDGET_BOARD_API_VERSION, accountOf } from '@dsh-widget-board/contracts'
import type { Registries } from './sources'

/** 余额能力的名字；组件 manifest 用它声明（D24）。 */
export const DSH_ACCOUNT_CAPABILITY = 'dsh.account.balance'

/** 能力的提供方名；设置弹窗与授权记录用它标注归属。 */
export const DSH_ACCOUNT_PROVIDER = 'dsh-account'

/** 钱包余额的形状；与 `AccountWallet` 一致，宿主在返回前按它校验。 */
const WALLET = {
  type: 'object',
  additionalProperties: false,
  required: ['currency', 'balance'],
  properties: {
    currency: { enum: ['CNY', 'USD'] },
    balance: { type: 'string' },
  },
} as const

/** 能力返回值的 schema。 */
const OUTPUT = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['status', 'value', 'bonusWallets'],
      properties: {
        status: { const: 'ready' },
        value: { type: 'array', items: WALLET },
        bonusWallets: { type: 'array', items: WALLET },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['status'],
      properties: { status: { const: 'failed' } },
    },
  ],
} as const

/**
 * 在途账户查询与中止信号之间赛跑：宿主请求超时或组件取消时，调用方不必等平台请求回来。
 *
 * @param work - 平台查询。
 * @param signal - 中止信号。
 * @returns 查询结果。
 */
async function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new Error('账户查询已取消')
  return await Promise.race([
    work,
    new Promise<never>((_, reject) => {
      signal.addEventListener('abort', () => { reject(new Error('账户查询已取消')) }, { once: true })
    }),
  ])
}

/**
 * 建出余额能力。
 *
 * @param context - 宿主上下文，用来取账户服务。
 * @returns 余额能力。
 */
export function dshAccountCapability(context: unknown): CapabilityRegistration {
  return {
    apiVersion: WIDGET_BOARD_API_VERSION,
    provider: DSH_ACCOUNT_PROVIDER,
    id: DSH_ACCOUNT_CAPABILITY,
    title: { zh: 'DSH 账号余额', en: 'DSH account balance' },
    description: {
      zh: '读取当前 DeepSeek Harness 账号的充值钱包与赠送钱包；不需要 API key。',
      en: 'Reads the recharge and bonus wallets of the signed-in DeepSeek Harness account; no API key needed.',
    },
    input: { type: 'object', additionalProperties: false, properties: {} },
    output: OUTPUT,
    // 不声明权限：读的是当前已登录的 DSH 账号，登录本身就是授权；第三方能力仍可声明权限（D6、D24）。
    async call(_instance: InstanceFace, _args: unknown, signal: AbortSignal): Promise<AccountBalance> {
      const account = accountOf(context)
      // 服务缺席、未登录与查询期间账号变化都是「现在读不到」，按 failed 回；调用失败才是异常。
      if (account === undefined) return { status: 'failed' }
      const client = {
        version: process.env.DSH_CLIENT_VERSION ?? '0.0.0',
        locale: 'zh-CN',
        timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
      }
      const balance = await untilAborted(account.getBalance(client), signal)
      return balance === null ? { status: 'failed' } : balance
    },
  }
}

/**
 * 把余额能力注册进看板的注册表。
 *
 * @param sources - 看板的注册表。
 * @param context - 宿主上下文。
 * @returns 撤下这次注册的函数。
 */
export function registerDshAccount(sources: Registries, context: unknown): () => void {
  return sources.registerCapability(dshAccountCapability(context))
}
