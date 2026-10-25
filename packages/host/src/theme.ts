/**
 * 主题能力（D29）：把宿主的主题偏好包装成一张通用能力，任何组件都能经 `widget.call` 读与写。
 *
 * 组件在沙箱里碰不到浏览器的 `ctx.theme`，看板也不为某个组件开一条专用接口。这里登记的是
 * `dsh.theme`：参数是目标偏好，结果是落定后的偏好；浏览器半边用同一个名字接管调用，好把整页的
 * 圆点转场包在主题切换外面。这里保留一条宿主持久化写入的路径，浏览器半边缺席时仍能改主题。
 *
 * 宿主偏好存在 `ui-theme` 这个配置入口的 `preference` 字段里，与设置页的外观行同一处；写入带修订号，
 * 冲突时重读一次再试，避免两个人同时按开关时后一次覆盖掉前一次的答复。
 */
import type { CapabilityRegistration, InstanceFace } from '@dsh-widget-board/contracts'
import { WIDGET_BOARD_API_VERSION, settingsOf } from '@dsh-widget-board/contracts'
import type { Registries } from './sources'

/** 能力名；组件 manifest 用它声明（D24）。 */
export const THEME_CAPABILITY = 'dsh.theme'

/** 能力的提供方名；设置弹窗用它标注归属。 */
export const THEME_PROVIDER = 'dsh-widget-board'

/** 主题偏好所在的配置入口。 */
export const THEME_NAMESPACE = 'ui-theme'

/** 主题偏好在入口里的字段。 */
export const THEME_FIELD = 'preference'

/** 可写入的三种偏好；`system` 跟随系统。 */
export const THEME_PREFERENCES = ['light', 'dark', 'system'] as const

/** 一种主题偏好。 */
export type ThemePreference = (typeof THEME_PREFERENCES)[number]

/** 一次切换的返回值；`scheme` 在偏好是 `system` 时省略，浏览器半边知道当时解析成了哪一档。 */
interface ThemeAnswer {
  preference: ThemePreference
  scheme?: 'light' | 'dark'
}

/** 参数 schema：目标偏好，加一个可选的转场圆心（组件视口内的坐标）。 */
const INPUT = {
  type: 'object',
  additionalProperties: false,
  required: ['preference'],
  properties: {
    preference: { enum: [...THEME_PREFERENCES] },
    origin: {
      type: 'object',
      additionalProperties: false,
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
      },
    },
  },
} as const

/** 结果 schema：落定的偏好，加可选的解析结果。 */
const OUTPUT = {
  type: 'object',
  additionalProperties: false,
  required: ['preference'],
  properties: {
    preference: { enum: [...THEME_PREFERENCES] },
    scheme: { enum: ['light', 'dark'] },
  },
} as const

/** 偏好的运行时判定；`args` 已经过 schema 校验，这里只把类型收窄。 */
function preferenceOf(args: unknown): ThemePreference {
  const preference = (args as { preference?: unknown } | undefined)?.preference
  if (!THEME_PREFERENCES.includes(preference as ThemePreference)) {
    throw new Error('主题切换要写明 preference：light、dark 或 system')
  }
  return preference as ThemePreference
}

/** 从一份设置描述里读出当前偏好与它的修订号。 */
function readTheme(
  settings: NonNullable<ReturnType<typeof settingsOf>>,
): { preference: ThemePreference, revision: number } {
  const descriptor = settings.describe().find((entry) => entry.ns === THEME_NAMESPACE)
  if (descriptor === undefined) throw new Error(`宿主的设置里没有 ${THEME_NAMESPACE} 这一项`)
  const value = (descriptor.value as Record<string, unknown> | undefined)?.[THEME_FIELD]
  if (!THEME_PREFERENCES.includes(value as ThemePreference)) {
    throw new Error(`宿主设置 ${THEME_NAMESPACE}.${THEME_FIELD} 不是可识别的主题偏好`)
  }
  return { preference: value as ThemePreference, revision: descriptor.revision }
}

/** 一次写入的答案：偏好的落定值，加能确定的配色。 */
function answerOf(preference: ThemePreference): ThemeAnswer {
  return preference === 'system' ? { preference } : { preference, scheme: preference }
}

/**
 * 建出主题能力。
 *
 * @param context - 宿主上下文，用来取设置服务。
 * @returns 主题能力。
 */
export function themeCapability(context: unknown): CapabilityRegistration {
  return {
    apiVersion: WIDGET_BOARD_API_VERSION,
    provider: THEME_PROVIDER,
    id: THEME_CAPABILITY,
    title: { zh: '外观主题', en: 'Appearance theme' },
    description: {
      zh: '读或写 DSH 的外观主题偏好（浅色、深色或跟随系统）。组件只传目标偏好，不需要知道主题存在哪里。',
      en: 'Reads or writes the DSH appearance preference (light, dark or system). A widget passes the target preference only.',
    },
    input: INPUT,
    output: OUTPUT,
    // 不声明权限：改的是界面偏好，不碰账户、文件或网络；组件仍然要用 manifest 声明这项能力（D6）。
    async call(_instance: InstanceFace, args: unknown, signal: AbortSignal): Promise<ThemeAnswer> {
      const settings = settingsOf(context)
      if (settings === undefined) throw new Error('宿主没有设置服务，切不了主题')
      if (signal.aborted) throw new Error('主题切换已取消')
      const wanted = preferenceOf(args)
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const current = readTheme(settings)
        if (current.preference === wanted) return answerOf(wanted)
        try {
          await settings.update(THEME_NAMESPACE, { [THEME_FIELD]: wanted }, current.revision)
          return answerOf(wanted)
        } catch (error) {
          // 修订号过期说明别人刚写过：重读一次再按新的修订号试一次；其余失败原样交给调用方（D11）。
          if (attempt === 1 || (error as { code?: unknown }).code !== 'SETTINGS_CONFLICT') throw error
        }
      }
      throw new Error('主题偏好没有写进宿主')
    },
  }
}

/**
 * 把主题能力注册进看板的注册表。
 *
 * @param sources - 看板的注册表。
 * @param context - 宿主上下文。
 * @returns 撤下这次注册的函数。
 */
export function registerTheme(sources: Registries, context: unknown): () => void {
  return sources.registerCapability(themeCapability(context))
}
