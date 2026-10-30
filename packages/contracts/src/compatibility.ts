/**
 * 看板对外的兼容表（D31、D30）：看板版本、服务面接受的注册版本、功能清单与最低 DSH 版本。
 *
 * 组件 manifest 的 `requires` 与市场索引的 `requires` 都对着这一份判定。版本集合与功能清单直接引用
 * 服务面的常量，兼容表里不再抄第二份；看板版本与 DSH 下限要和根 `package.json` 相同，漂移由
 * `packages/contracts/test/compatibility.test.ts` 与 `scripts/market.mjs --check` 一起检查。
 */
import type { WidgetBoardFeature } from './service-types'
import { WIDGET_BOARD_FEATURES, WIDGET_BOARD_SUPPORTED_API_VERSIONS } from './service'

/** 一份兼容表：组件与市场版本按它判定自己能不能装在这一份看板上。 */
export interface BoardCompatibility {
  /** 看板自己的版本，形如 `0.1.6`；与根 `package.json` 的 `version` 相同。 */
  readonly boardVersion: string
  /** 服务面接受的注册版本，升序；与 `WIDGET_BOARD_SUPPORTED_API_VERSIONS` 是同一份。 */
  readonly serviceApiVersions: readonly number[]
  /** 服务面提供的功能；与 `WIDGET_BOARD_FEATURES` 是同一份。 */
  readonly features: readonly WidgetBoardFeature[]
  /** 最低 DSH 版本（一条 semver 范围）；与根 `package.json` 的 `dsh.engines.dsh` 相同。 */
  readonly dsh: string
}

/** 看板的兼容表；看板版本与 DSH 下限随根 `package.json` 一起改。 */
export const BOARD_COMPATIBILITY: BoardCompatibility = Object.freeze({
  boardVersion: '0.1.6',
  serviceApiVersions: WIDGET_BOARD_SUPPORTED_API_VERSIONS,
  features: WIDGET_BOARD_FEATURES,
  dsh: '>=0.2.1-rc.1',
})

/**
 * 一个组件要求的服务版本这一侧接不接受（D31、D30）。
 *
 * @param version - `requires.serviceApiVersion`；省略表示不要求。
 * @param supported - 这一侧接受的版本集合；默认取兼容表里的那一份。
 * @returns 不接受时的原因；接受或没有要求时为 `undefined`。
 */
export function serviceVersionProblem(version: number | undefined, supported: readonly number[] = BOARD_COMPATIBILITY.serviceApiVersions): string | undefined {
  if (version === undefined) return undefined
  if (supported.includes(version)) return undefined
  return `组件要求的服务面版本是 ${String(version)}，这一侧只接受 ${supported.join('、')}`
}
