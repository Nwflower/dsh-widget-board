/**
 * 冒烟用的 v3 提供方（宿主半边，D31、D17、D24、D30、D32）：一个 registerProvider 把手管完两个组件目录、
 * 数据源、动作、能力与市场提供方。
 *
 * 新入口只报身份与用途，目录这些经把手逐个挂上，子注册里不再写提供方名与版本。`inject` 让 cordis
 * 等到看板发布服务之后才调用 `apply`；`ctx.effect` 让把手在插件卸载（或设置页里被停用）时一次撤下
 * 这一侧的全部资源。
 *
 * 数据一侧按 D32 给两样东西：一张按名字读、白名单与授权各走一道的源表，一份把订阅计数记在卡片上的
 * 账本。账本让场景按确定性事件判生命周期（订阅、退订、推送各加一），不靠等时间。
 */
import { join } from 'node:path'

export const name = 'dsh-widget-board-test-provider-v3'

export const inject = ['widgetBoard']

/** 新入口接受的版本：只有 3。 */
const API_VERSION = 3

/** 这次注册声明的用途：只是用途，缺一项也不会被拒掉（D31）。 */
const FEATURES = ['capabilityMetadata', 'eventData', 'marketProvider']

/** 慢数据源多久答完：越过 15 秒的默认超时，之后把执行槽让出来（D31）。 */
const SLOW_ANSWER_MS = 16_000

/** 订阅成立时推的初值从哪个数起：场景按它认领这是订阅送来的那一条（D32）。 */
const SUBSCRIBE_BASE = 1000

/** 动作触发推送时从哪个数起：与订阅初值分开，两种来源各自可辨。 */
const PUSH_BASE = 2000

/**
 * 市场里只放一条测试条目：给冒烟看「市场提供方挂上了」，不实现具体业务市场（D30）。
 *
 * 包地址指向一个不存在的域：这一条只用来看条目进了快照，安装路径不在这条场景里。
 */
const TEST_LISTING = {
  id: 'testv3.sample',
  title: { zh: '测试条目', en: 'Test entry' },
  description: { zh: '冒烟用的市场条目', en: 'A market entry the smoke checks' },
  author: { name },
  versions: [
    {
      version: '0.0.1',
      sizes: ['s'],
      package: { url: 'https://example.invalid/testv3.sample-0.0.1.dshw', sha256: '0'.repeat(64), bytes: 1 },
    },
  ],
}

/** 每个卡片 id 一份订阅账本；卡片被移除后留在表里，便于场景读到它退订过。 */
const books = new Map()

/**
 * 一张卡的订阅账本。
 *
 * @param id - 卡片实例的 id。
 * @returns 账本，没有时先建出来。
 */
function bookOf(id) {
  let book = books.get(id)
  if (book === undefined) {
    book = { active: 0, subscribes: 0, unsubscribes: 0, pushes: 0 }
    books.set(id, book)
  }
  return book
}

/** 每张卡当前那次订阅的推送函数；同一张卡重订时换掉。 */
const emitters = new Map()

/**
 * 注册提供方，并把它名下的东西挂上去。
 *
 * @param ctx - 宿主上下文。
 */
export async function apply(ctx) {
  const service = ctx.widgetBoard

  // 新入口只收版本 3：带 2 进来要被可见地拒绝，服务面的旧入口照旧接受 2（D31）。
  let refusedVersion = false
  try {
    await service.registerProvider({ apiVersion: 2, provider: `${name}-wrong-version` })
  } catch {
    refusedVersion = true
  }
  if (!refusedVersion) throw new Error('widgetBoard 的 registerProvider 没有拒绝版本 2')

  const provider = await service.registerProvider({ apiVersion: API_VERSION, provider: name, features: FEATURES })

  // 同一侧报出接哪些版本、有哪些功能；supports 逐项回答，名字写错要抛出来，不能静默当成不支持（D11）。
  if (!provider.supportedApiVersions.includes(API_VERSION)) {
    throw new Error(`提供方把手没有报出支持的版本：${provider.supportedApiVersions.join('、')}`)
  }
  for (const feature of FEATURES) {
    if (!provider.supports(feature)) throw new Error(`提供方把手没有报出 ${feature}`)
  }
  let refusedFeature = false
  try {
    provider.supports('no-such-feature')
  } catch {
    refusedFeature = true
  }
  if (!refusedFeature) throw new Error('supports 没有拒绝不认识的功能名')

  // 同一个提供方在同一侧只有一个活动把手：再注册一次要被拒绝，撤下之后才轮得到新的（D31）。
  let refusedTwice = false
  try {
    await service.registerProvider({ apiVersion: API_VERSION, provider: name })
  } catch {
    refusedTwice = true
  }
  if (!refusedTwice) throw new Error('widgetBoard 没有拒绝同一个提供方的第二个活动把手')

  // 两个组件目录挂在一个把手下，目录里的组件 id 都带作者域（D8、D17）。
  await provider.registerWidgets({ directory: join(import.meta.dirname, 'widgets-alpha') })
  await provider.registerWidgets({ directory: join(import.meta.dirname, 'widgets-beta') })
  if (provider.directories.length !== 2 || provider.widgets.length !== 2) {
    throw new Error(`一个把手下应有两个目录与两个组件：${provider.directories.length} / ${provider.widgets.length}`)
  }

  // 每读一次加一：冒烟据此核对数据源真的被读到（D6）。
  let count = 3
  // 子注册省掉版本与提供方名，两者由把手注入（D31）。
  provider.registerDataSource({
    id: 'testv3.count',
    read: () => ({ count: count++, from: 'default' }),
    // 订阅成立时推一条初值：D32 的约定是组件不主动读、实现自己在订阅里推一次。
    subscribe: (instance, emit) => {
      const book = bookOf(instance.id)
      book.active += 1
      book.subscribes += 1
      emitters.set(instance.id, emit)
      emit({ count: SUBSCRIBE_BASE + book.subscribes, from: 'subscribe' })
      return () => {
        book.active -= 1
        book.unsubscribes += 1
        emitters.delete(instance.id)
      }
    },
  })
  // 白名单里多出来的几个源：正常的一个、要授权的一个、数据与组件 schema 不符的一个。
  provider.registerDataSource({ id: 'testv3.extra', read: () => ({ count: 7001, from: 'extra' }) })
  provider.registerDataSource({
    id: 'testv3.gated',
    permission: { hosts: ['testv3.invalid'] },
    read: () => ({ count: 7002, from: 'gated' }),
  })
  provider.registerDataSource({ id: 'testv3.bad', read: () => ({ count: '不是数字', from: 'bad' }) })
  // 注册了却没有写进任何 manifest 的 sources：按需读白名单据此核对「未声明源被拒绝」。
  provider.registerDataSource({ id: 'testv3.hidden', read: () => ({ count: 7003, from: 'hidden' }) })
  // 慢数据源：忽略中止信号，16 秒才答完——执行槽跟提供方的 promise 走，不跟超时走（D31）。
  provider.registerDataSource({
    id: 'testv3.slow',
    read: () => new Promise((resolve) => { setTimeout(() => { resolve({ count: -1 }) }, SLOW_ANSWER_MS) }),
  })
  provider.registerAction({
    id: 'testv3.run',
    // 动作触发一次推送：动作仍然单向、没有返回值到组件（D6、D32），新数据走数据这一条路。
    run: (instance, payload) => {
      const book = bookOf(instance.id)
      const emit = emitters.get(instance.id)
      if (emit !== undefined) {
        book.pushes += 1
        emit({ count: PUSH_BASE + book.pushes, from: 'action' })
      }
      return { ran: true, payload, pushed: emit !== undefined }
    },
  })
  // 账本只经动作交出去：动作不写卡片，场景读它时不推动卡片的数据。
  provider.registerAction({ id: 'testv3.probe', run: (instance) => ({ ...bookOf(instance.id) }) })
  provider.registerCapability({
    id: 'testv3.echo',
    title: { zh: '回声', en: 'Echo' },
    description: { zh: '把送来的文字原样送回来', en: 'Returns the text it is given' },
    input: { type: 'object', additionalProperties: false, required: ['text'], properties: { text: { type: 'string' } } },
    output: { type: 'object', additionalProperties: false, required: ['echo'], properties: { echo: { type: 'string' } } },
    call: (_instance, args) => ({ echo: args.text }),
  })
  provider.registerMarketProvider({
    id: 'testv3-market',
    title: { zh: '测试市场', en: 'Test market' },
    description: { zh: '只放一条测试条目', en: 'One test entry only' },
    list: async () => [TEST_LISTING],
    fetch: async () => new Uint8Array([0]),
  })

  ctx.effect(() => () => {
    void provider.dispose()
  })
}
