/**
 * 能力面的投影（D32）：握手带来的元数据与旧字符串数组都从这里出，两个公开字段不会说两套话。
 *
 * `capabilityMetadata` 按 manifest 的声明次序保留全部项，`capabilities` 是其中 `available` 为真的
 * 那些 id。只带字符串数组的旧 init 没有元数据，元数据于是为空。
 *
 * 交出去的是逐层拷贝并冻住的一份：组件改自己手里的数组或某一项，不会回到运行时里那一份。
 */
import type { CapabilityMetadata } from '@dsh-widget-board/contracts'

/** 一次握手能投影出来的能力面（D32）。 */
export interface CapabilityFace {
  /** 宿主当前解析得到的能力名；照旧读字符串数组的旧组件看这一份。 */
  readonly capabilities: readonly string[]
  /** 声明过的每一项，现在不可用的那些也在里面；旧 init 没有元数据时是空数组。 */
  readonly capabilityMetadata: readonly CapabilityMetadata[]
}

/** 投影只看这两个字段：新的 init 带元数据，旧的只带字符串数组。 */
export interface CapabilityFields {
  capabilities?: string[]
  capabilityMetadata?: CapabilityMetadata[]
}

/**
 * 从一个 init 投影出能力面（D32）。
 *
 * @param init - 握手带来的那两个字段。
 * @returns 可用的 id 与逐项的元数据，两者都按声明次序。
 */
export function capabilityFaceOf(init: CapabilityFields): CapabilityFace {
  const declared = init.capabilityMetadata
  if (declared === undefined) {
    return { capabilities: frozenCopy(init.capabilities ?? []), capabilityMetadata: frozenCopy([]) }
  }
  const items = declared.map(capabilityMetadataCopy)
  return {
    capabilities: frozenCopy(items.filter((item) => item.available).map((item) => item.id)),
    capabilityMetadata: frozenCopy(items),
  }
}

/**
 * 拷一份元数据项，只留公开的那些字段：不可用项不补占位值，也不带别的键。
 *
 * @param item - 从握手来的那一项。
 * @returns 独立的副本。
 */
function capabilityMetadataCopy(item: CapabilityMetadata): CapabilityMetadata {
  return frozenCopy({
    id: item.id,
    available: item.available,
    ...(item.provider === undefined ? {} : { provider: item.provider }),
    ...(item.title === undefined ? {} : { title: item.title }),
    ...(item.description === undefined ? {} : { description: item.description }),
    ...(item.input === undefined ? {} : { input: item.input }),
    ...(item.output === undefined ? {} : { output: item.output }),
    ...(item.permission === undefined ? {} : { permission: item.permission }),
  })
}

/**
 * 深拷一份 JSON 值并逐层冻住。
 *
 * 只冻最外层不够：schema 与权限是任意嵌套的对象，组件改得动里面一项就等于改到了运行时里那一份。
 *
 * @param value - 要拷的值。
 * @returns 形状相同、互相独立的一份。
 */
function frozenCopy<T>(value: T): T {
  if (Array.isArray(value)) return Object.freeze(value.map((item: unknown) => frozenCopy(item))) as T
  if (typeof value === 'object' && value !== null) {
    const copy: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) copy[key] = frozenCopy(item)
    return Object.freeze(copy) as T
  }
  return value
}
