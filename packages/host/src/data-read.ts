/**
 * 按需读能力 `widget-board:data.read`（D32）：组件给一个源名，宿主把数据读回来交给它。
 *
 * 读一次能力只是把读取路径搬到桥上：白名单之后仍然是 `loadData` 那一条——源在不在、要不要授权、
 * 超时与并发、data schema 校验都只有一处（D6、D31）。返回的只是数据，卡片不因此被改写：写卡片仍然
 * 由人按刷新、定时链或数据源推送决定。
 *
 * 白名单是 manifest 的内容：默认源（`source`，以及卡片当前绑定的那个）总可读，额外的源必须列进
 * `sources`。改白名单就改了组件的内容哈希，已有授权随之失效。
 */
import type { CapabilityRegistration, InstanceFace, WidgetManifest } from '@dsh-widget-board/contracts'
import { REGISTRATION_NAME_PATTERN, WIDGET_BOARD_API_VERSION } from '@dsh-widget-board/contracts'
import { isRecord } from './guards'
import { loadData } from './instance-operations'
import { locate } from './lookup'
import { Refusal } from './refusal'
import type { RouteContext } from './routes'
import type { Registries } from './sources'

/** 能力的名字：组件在 manifest 的 `capabilities` 里声明 `widget-board:data.read`。 */
export const DATA_READ_CAPABILITY = 'data.read'

/** 提供方：看板自己（D3），与内置数据源同一个来源。 */
export const DATA_READ_PROVIDER = 'widget-board'

/** 参数：一个可选的源名；不给时读卡片自己绑定的那个。 */
const INPUT = {
  type: 'object',
  additionalProperties: false,
  properties: { source: { type: 'string', pattern: REGISTRATION_NAME_PATTERN } },
} as const

/**
 * 这个源名在不在 manifest 允许读的那几个里（D32）。
 *
 * 默认源总可读：`manifest.source`，以及卡片当前绑定的那个（不给参数时读的就是它）。额外的源必须列进
 * `sources`，否则这一次读取在发出之前就被拒绝，错误回给组件。
 *
 * @param manifest - 组件的 manifest。
 * @param bound - 卡片当前绑定的源名。
 * @param asked - 这次要读的源名。
 * @returns 允许读时为真。
 */
function isReadable(manifest: WidgetManifest, bound: string | undefined, asked: string): boolean {
  return asked === manifest.source || asked === bound || manifest.sources?.includes(asked) === true
}

/**
 * 读一次这张卡的一个源，只把数据交回去。
 *
 * @param context - 路由上下文。
 * @param instance - 发起调用的这张卡片。
 * @param args - 已经按 input schema 校验过的参数。
 * @param signal - 调用方取消或超时时中止提供方。
 * @returns 数据源读出来的数据。
 * @throws {Refusal} 组件不在库里、没有可读的源、源不在白名单、源没有安装、没有授权、超时、并发已满、
 * 数据与组件的 data schema 不符，或数据源读取失败（502）。
 */
async function dataReadOf(context: RouteContext, instance: InstanceFace, args: unknown, signal: AbortSignal): Promise<unknown> {
  const { instance: card } = locate(context, instance.id)
  const manifest = context.records.get(card.widget)?.manifest
  if (manifest === undefined) throw new Refusal(400, '这张卡的组件不在组件库里，先把它装回来')
  const wanted = isRecord(args) && typeof args.source === 'string' ? args.source : undefined
  const bound = card.source ?? manifest.source
  const asked = wanted ?? bound
  if (asked === undefined) {
    throw new Refusal(400, '这张卡没有数据源：组件没有声明 source，参数里也没有给出一个', { code: 'source-unavailable' })
  }
  if (!isReadable(manifest, bound, asked)) {
    throw new Refusal(400, `组件没有声明数据源 ${asked}：manifest 的 source 与 sources 里都没有它`, { code: 'source-unavailable', source: asked })
  }
  const { data } = await loadData(context, card.id, asked, signal).catch((error: unknown) => readFailure(asked, error))
  return data
}

/**
 * 数据源抛出来的读取异常在读取边界翻成宿主拒绝（D31）。
 *
 * 提供方抛出的异常已经由它自己的执行槽记过一次失败；翻成 {@link Refusal} 之后，路由照旧回 502，看板
 * 这一层的执行槽看到的是宿主拒绝，不再记第二次。只包住 `loadData` 一次调用：白名单、授权、schema、
 * 超时与并发各自带着自己的状态码原样抛出，能力自己判定里的其他错误也不归到这里。
 *
 * @param asked - 这次读的源名。
 * @param error - `loadData` 抛出来的那一个。
 * @throws {Refusal} 非宿主拒绝的读取异常，502。
 */
function readFailure(asked: string, error: unknown): never {
  if (error instanceof Refusal) throw error
  throw new Refusal(502, `数据源 ${asked} 读取失败：${error instanceof Error ? error.message : String(error)}`, { source: asked })
}

/**
 * 建出按需读能力。
 *
 * 能力自己不声明权限：要读的源由它自己的注册项决定要不要授权，那一道闸门在 `loadData` 里。
 *
 * 返回值就是数据本身，不套一层信封；也不声明 `output`：这份数据该长什么样由组件自己的 `data`
 * schema 说了算，而 `loadData` 已经按它核对过了，再写一份 schema 只会多一处会过期的说法。
 *
 * @param context - 路由上下文。
 * @returns 按需读能力。
 */
export function dataReadCapability(context: RouteContext): CapabilityRegistration {
  return {
    apiVersion: WIDGET_BOARD_API_VERSION,
    provider: DATA_READ_PROVIDER,
    id: DATA_READ_CAPABILITY,
    title: { zh: '按需读数据', en: 'Read data on demand' },
    description: {
      zh: '读这张卡的一个数据源，只把数据交回来，不改写卡片；不给源名时读卡片自己绑定的那个。',
      en: 'Reads one data source of this card and returns the data without rewriting the card; without a source name it reads the one the card is bound to.',
    },
    input: INPUT,
    async call(instance, args, signal) {
      return await dataReadOf(context, instance, args, signal)
    },
  }
}

/**
 * 把按需读能力注册进看板的注册表。
 *
 * @param sources - 看板的注册表。
 * @param context - 路由上下文。
 * @returns 撤下这次注册的函数。
 */
export function registerDataRead(sources: Registries, context: RouteContext): () => void {
  return sources.registerCapability(dataReadCapability(context))
}
