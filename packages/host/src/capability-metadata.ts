/**
 * 能力元数据（D32）：manifest 声明过的每一项能力，按声明次序解析出能不能调、谁提供的、它的形状。
 *
 * 一份声明解析一次，工作区快照、内联视图与原生组件拿的都是同一次解析的结果：三处各写一遍时，
 * 「可用」的判定会在某处退化成按名字比对，点名提供方的 `提供方:名字` 就永远判不出来。
 *
 * 声明里的名字可以写成裸名，由注册表按全局唯一解；解不出来时不算可用，但保留声明的样子。
 */
import type { CapabilityMetadata, LocalizedText } from '@dsh-widget-board/contracts'
import type { ResolvedCapability } from './sources'

/** 按声明里的名字解析一项能力；这个会话里解析不到时是 `undefined`。 */
export type CapabilityResolver = (id: string) => ResolvedCapability | undefined

/**
 * 交出去的一段说明的码点上限（D32）。
 *
 * 注册项的说明可以任意长，而元数据只随 `init` 给一次：整条消息受 `PARENT_MESSAGE_LIMIT` 约束，
 * 一项说明把预算吃光时组件连 props 都收不到。按码点算，中文、英文与 emoji 用同一个尺度。
 */
export const DESCRIPTION_CODE_POINT_LIMIT = 512

/** 截断处的省略号；加上它之后仍是 {@link DESCRIPTION_CODE_POINT_LIMIT} 个码点。 */
const ELLIPSIS = '…'

/**
 * 按码点截断一段说明。
 *
 * 按码点切而不是按 UTF-16 单元切：emoji 占两个单元，切在中间会留下一个孤立代理项。另起一份对象交出去，
 * 注册项本身不动——设置弹窗读的是注册项里的完整说明。
 *
 * @param text - 注册项里的说明。
 * @returns 交给组件的说明：上限之内原样，超出时留前 511 个码点加一个省略号。
 */
function truncatedDescription(text: string): string {
  const codePoints = Array.from(text)
  if (codePoints.length <= DESCRIPTION_CODE_POINT_LIMIT) return text
  return codePoints.slice(0, DESCRIPTION_CODE_POINT_LIMIT - 1).join('') + ELLIPSIS
}

/**
 * 两种语言各自截断；两段都没超长时原样交回注册项里那一个。
 *
 * @param description - 注册项里的说明。
 * @returns 交给组件的说明。
 */
function descriptionWithinLimit(description: LocalizedText): LocalizedText {
  const zh = truncatedDescription(description.zh)
  const en = truncatedDescription(description.en)
  return zh === description.zh && en === description.en ? description : { zh, en }
}

/**
 * 一个声明里的名字能解出的提供方：只有点名提供方的 `提供方:名字` 给得出。
 *
 * 裸名要问注册表，而注册表里没有这一项时不该编一个提供方出来——元数据里省略这一项，不填占位值。
 *
 * @param id - manifest 里声明的名字。
 * @returns 提供方；裸名是 `undefined`。
 */
export function providerOfDeclaredId(id: string): string | undefined {
  const separator = id.indexOf(':')
  return separator === -1 ? undefined : id.slice(0, separator)
}

/**
 * 把 manifest 声明过的能力逐项解析成元数据（D32）。
 *
 * 可用项取注册项的实值，字段与 `CapabilityRegistration` 同名、可省略的那几项也一起省略；不可用项
 * 只留声明的名字与 `available: false`。次序跟声明走，不跟注册顺序走：组件要按自己写的次序画。
 *
 * 说明按 {@link DESCRIPTION_CODE_POINT_LIMIT} 截断后才交出去，注册项里的那一份保持完整。
 *
 * @param declared - manifest 的 `capabilities`；省略时是空表。
 * @param resolve - 按名字解析能力，通常是注册表的 `resolveCapability`。
 * @returns 与声明同长的元数据。
 */
export function capabilityMetadataOf(declared: readonly string[] | undefined, resolve: CapabilityResolver): CapabilityMetadata[] {
  const metadata: CapabilityMetadata[] = []
  for (const id of declared ?? []) {
    const resolved = resolve(id)
    if (resolved === undefined) {
      const provider = providerOfDeclaredId(id)
      metadata.push({ id, ...(provider === undefined ? {} : { provider }), available: false })
      continue
    }
    const registration = resolved.registration
    metadata.push({
      id,
      provider: resolved.provider,
      ...(registration.title === undefined ? {} : { title: registration.title }),
      ...(registration.description === undefined ? {} : { description: descriptionWithinLimit(registration.description) }),
      ...(registration.input === undefined ? {} : { input: registration.input }),
      ...(registration.output === undefined ? {} : { output: registration.output }),
      ...(registration.permission === undefined ? {} : { permission: registration.permission }),
      available: true,
    })
  }
  return metadata
}
