/**
 * 外壳的主题：令牌的计算值、界面语言与动画档位（D10）。
 *
 * 组件跑在不透明来源的 iframe 里，宿主的 `--dsw-*` 变量传不过去，所以外壳把它们解析成字面值，
 * 握手时递进去，之后宿主换主题、换语言或系统改动画偏好时再推一次。解析在一处，推给每张卡片。
 */
import type { MotionLevel } from '@dsh-widget-board/contracts'
import tokens from '@dsh-widget-board/contracts/tokens.json'
import { activeLang } from './copy'

/** 一次解析的结果。 */
export interface ShellTheme {
  /** 令牌的字面值，键是 `组-名`；解析不出来的项不在其中。 */
  tokens: Record<string, string>
  /** 宿主的界面语言。 */
  lang: string
  /** 动画档位。 */
  motion: MotionLevel
}

/** tokens.json 的形状：组名到令牌名的两级表。 */
type TokenTable = Record<string, Record<string, string>>

/** 一个 `var(--name)` 引用里的变量名。 */
const REFERENCE = /^var\((--[a-z0-9-]+)/

/** 系统是否要求减弱动效。 */
function motionOf(): MotionLevel {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'reduced' : 'full'
}

/** 把令牌解析成字面值：引用宿主变量的项读 body 的计算值。 */
function resolveTokens(): Record<string, string> {
  const style = getComputedStyle(document.body)
  const resolved: Record<string, string> = {}
  for (const [group, entries] of Object.entries(tokens as TokenTable)) {
    for (const [name, value] of Object.entries(entries)) {
      const reference = REFERENCE.exec(value)
      if (reference === null) {
        resolved[`${group}-${name}`] = value
        continue
      }
      const computed = style.getPropertyValue(reference[1]).trim()
      if (computed !== '') resolved[`${group}-${name}`] = computed
    }
  }
  return resolved
}

/**
 * 解析一次当前的主题。
 *
 * @returns 令牌、语言与动画档位。
 */
export function resolveTheme(): ShellTheme {
  return { tokens: resolveTokens(), lang: activeLang(), motion: motionOf() }
}

/**
 * 跟随主题变化。
 *
 * 宿主提供主题服务时跟它的事件，皮肤换配色、用户切浅色深色都能收到；没有这项服务时退到系统
 * 的配色与动画偏好，皮肤引起的变化这时收不到。
 *
 * @param context - 浏览器半边的根上下文。
 * @param onChange - 每次变化时收到一份新的主题。
 * @returns 停止跟随的函数。
 */
export function watchTheme(context: unknown, onChange: (theme: ShellTheme) => void): () => void {
  const disposers: Array<() => void> = []
  let live = true
  const fire = (): void => {
    if (live) onChange(resolveTheme())
  }
  const get = (context as { get?: (name: string) => unknown }).get
  const on = (context as { on?: (name: string, listener: () => void) => unknown }).on
  const theme = typeof get === 'function' ? get.call(context, 'theme') : undefined
  if (theme !== undefined && typeof on === 'function') {
    const off = on.call(context, 'theme/change', fire)
    if (typeof off === 'function') disposers.push(off as () => void)
  }
  for (const query of ['(prefers-color-scheme: dark)', '(prefers-reduced-motion: reduce)']) {
    const media = window.matchMedia(query)
    media.addEventListener('change', fire)
    disposers.push(() => media.removeEventListener('change', fire))
  }
  return () => {
    live = false
    for (const dispose of disposers.splice(0)) dispose()
  }
}
