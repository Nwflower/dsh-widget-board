/**
 * 一份能力面的只读投影（D32）：沙箱的 init 与原生组件的参数都由它来，两种写法拿到的是同一份。
 *
 * 快照里那三份能力面由宿主同时填充：`capabilities` 是 manifest 声明的白名单，`availableCapabilities`
 * 是其中当下解析得到的那些，`capabilityMetadata` 逐项带着标题、说明与 schema。交下去的是副本：
 * 组件改自己手里的数组或某一项，改不到快照里那一份。
 *
 * 声明白名单本身不往下发：声明过的能力不一定现在能调，把它当可用发出去等于教组件去撞一次注定失败的
 * 请求（D24）。
 */
import type { CapabilityMetadata, WidgetSummary } from '@dsh-widget-board/contracts'

/** 交给组件的能力面；这一侧没有投影过的那一份缺席，组件按空能力面处理。 */
export interface CapabilityFace {
  /** manifest 声明过、当下解析得到的能力名。 */
  capabilities?: readonly string[]
  /** 声明过的每一项，现在不可用的那些也在里面，按 manifest 的声明次序。 */
  capabilityMetadata?: readonly CapabilityMetadata[]
}

/**
 * 从快照里的一张组件投影出能力面（D32）。
 *
 * @param widget - 快照里这张卡的组件元信息。
 * @returns 沙箱 init 与原生组件参数共用的那一份。
 */
export function capabilityFaceOf(widget: Pick<WidgetSummary, 'availableCapabilities' | 'capabilityMetadata'>): CapabilityFace {
  const available = widget.availableCapabilities
  const metadata = widget.capabilityMetadata
  return {
    ...(available === undefined ? {} : { capabilities: Object.freeze([...available]) }),
    ...(metadata === undefined
      ? {}
      : { capabilityMetadata: Object.freeze(metadata.map((item) => Object.freeze({ ...item }))) }),
  }
}
