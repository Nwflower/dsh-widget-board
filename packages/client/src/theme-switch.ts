/**
 * 浏览器半边的主题能力（D29）：接管 `dsh.theme`，把主题切换包进一次整页的圆点揭示。
 *
 * 组件在卡片里按下开关时，圆心留在卡片里的那一点；父页面知道这张 iframe 在视口里的位置，把组件
 * 报来的坐标换算成整页坐标。旧画面原地不动，新画面从圆心以 `clip-path: circle()` 展开——只动一层
 * 快照的裁剪，不重排、不重绘组件，也不逐帧计算。浏览器没有 View Transitions 时退回直接切换；系统
 * 要求减弱动效时同样直接切换。
 *
 * 这里没有按组件分支：任何声明了 `dsh.theme` 的组件都走同一条调用。
 */
import tokens from '@dsh-widget-board/contracts/tokens.json'
import { registerClientCapability } from './capabilities'
import type { ClientCapabilityCall } from './capabilities'
import { frameHostOf } from './page-frames'

/** 主题能力的名字；与宿主半边登记的同一个（D24）。 */
export const THEME_CAPABILITY = 'dsh.theme'

/** 目标偏好。 */
type Preference = 'light' | 'dark' | 'system'

/** 主题服务里本文件用到的一面；形状按 `ThemeRuntime` 记一次（D1）。 */
interface ThemeRuntime {
  getTheme(): ThemeSnapshot
  setTheme(id: string): void
}

/** 主题快照里用到的那几项。 */
interface ThemeSnapshot {
  preference: string
  active: { colorScheme: string }
}

/** `tokens.json` 的动效组：键到 CSS 值。 */
const MOTION = tokens.motion as Record<string, string>

/** 已经开始的圆点转场；连续按两次时后一次直接换主题，避免两层快照打架。 */
let running = false

/** 视图切换的根节点变量，只在一次转场期间存在。 */
const VT_ATTRIBUTE = 'dshWidgetBoardVt'
const VT_X = '--dsh-widget-board-vt-x'
const VT_Y = '--dsh-widget-board-vt-y'
const VT_RADIUS = '--dsh-widget-board-vt-r'
const VT_DURATION = '--dsh-widget-board-vt-duration'
const VT_EASE = '--dsh-widget-board-vt-ease'

/** 系统是否要求减弱动效。 */
function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** 从宿主上下文取主题服务；没有时让这次调用落到宿主路由上。 */
function themeOf(context: unknown): ThemeRuntime | undefined {
  const get = (context as { get?: (name: string) => unknown }).get
  if (typeof get !== 'function') return undefined
  const theme = get.call(context, 'theme')
  return theme as ThemeRuntime | undefined
}

/** 参数里的目标偏好；组件传的是 schema 校验过的值，这里再收窄一次类型。 */
function preferenceOf(args: unknown): Preference {
  const preference = (args as { preference?: unknown } | undefined)?.preference
  if (preference !== 'light' && preference !== 'dark' && preference !== 'system') {
    throw new Error('主题切换要写明 preference：light、dark 或 system')
  }
  return preference
}

/** 把组件视口里的圆心换算成整页坐标；没有坐标时用卡片中心。 */
function originOf(call: ClientCapabilityCall): { x: number, y: number } {
  const rect = call.frame?.getBoundingClientRect()
  if (rect === undefined) return { x: window.innerWidth / 2, y: window.innerHeight / 2 }
  const raw = (call.args as { origin?: { x?: unknown, y?: unknown } } | undefined)?.origin
  const localX = typeof raw?.x === 'number' && Number.isFinite(raw.x) ? raw.x : rect.width / 2
  const localY = typeof raw?.y === 'number' && Number.isFinite(raw.y) ? raw.y : rect.height / 2
  return {
    x: rect.left + Math.min(Math.max(localX, 0), rect.width),
    y: rect.top + Math.min(Math.max(localY, 0), rect.height),
  }
}

/** 盖住整个视口需要的半径，多留一点余量，展开到底时不留一道细边。 */
function radiusOf(point: { x: number, y: number }): number {
  const across = Math.max(point.x, window.innerWidth - point.x)
  const down = Math.max(point.y, window.innerHeight - point.y)
  return Math.ceil(Math.hypot(across, down) + 32)
}

/**
 * 把像素半径换成 `circle()` 的百分比。
 *
 * 圆半径的百分比按参考框的对角线归一化（`sqrt(w²+h²)/sqrt(2)`）；参考框换成设备像素尺寸时，
 * 归一化后的百分比不变，视觉半径因此不随像素密度漂移。
 */
function radiusPercent(radius: number): string {
  const reference = Math.hypot(window.innerWidth, window.innerHeight) / Math.SQRT2
  return `${((radius / reference) * 100).toFixed(3)}%`
}

/** 清掉这次转场写在根节点上的变量与标记。 */
function clearTransition(root: HTMLElement): void {
  delete (root.dataset as DOMStringMap)[VT_ATTRIBUTE]
  for (const name of [VT_X, VT_Y, VT_RADIUS, VT_DURATION, VT_EASE]) root.style.removeProperty(name)
  running = false
}

/**
 * 装上主题能力。
 *
 * @param context - 浏览器半边的根上下文。
 * @returns 撤下这次登记的函数。
 */
export function installThemeCapability(context: unknown): () => void {
  return registerClientCapability(THEME_CAPABILITY, {
    available() {
      return themeOf(context) !== undefined
    },
    async call(call: ClientCapabilityCall): Promise<{ preference: Preference, scheme: 'light' | 'dark' }> {
      const theme = themeOf(context)
      if (theme === undefined) throw new Error('宿主没有主题服务，切不了主题')
      const wanted = preferenceOf(call.args)
      const settle = (): { preference: Preference, scheme: 'light' | 'dark' } => {
        const snapshot = theme.getTheme()
        return {
          preference: snapshot.preference as Preference,
          scheme: snapshot.active.colorScheme === 'dark' ? 'dark' : 'light',
        }
      }
      // 宿主页面可能跑在不支持 View Transitions 的浏览器里：能力仍然可用，只是没有整页揭示。
      const start = typeof document.startViewTransition === 'function'
        ? document.startViewTransition.bind(document)
        : undefined
      if (running || start === undefined || reducedMotion() || call.preview) {
        theme.setTheme(wanted)
        return settle()
      }
      const root = document.documentElement
      const point = originOf(call)
      // 圆心用百分比写：快照层的坐标按设备像素缩放，写 px 会在 1.5 倍屏上按比例缩到左上角；
      // 百分比相对快照自己的盒子，换任何像素密度都落在同一个视觉位置（D29）。
      root.dataset[VT_ATTRIBUTE] = 'circle'
      root.style.setProperty(VT_X, `${((point.x / window.innerWidth) * 100).toFixed(3)}%`)
      root.style.setProperty(VT_Y, `${((point.y / window.innerHeight) * 100).toFixed(3)}%`)
      const radius = radiusOf(point)
      root.style.setProperty(VT_RADIUS, radiusPercent(radius))
      root.style.setProperty(VT_DURATION, MOTION['theme-circle'])
      root.style.setProperty(VT_EASE, MOTION['ease-smooth'])
      running = true
      const frames = frameHostOf()
      // 卡片的 iframe 不在整页快照里；新主题按圆点扫到卡片的时刻分批推，圆外的卡片才能停在旧模式。
      frames.stageTheme(call.frame, {
        origin: point,
        radius,
        duration: Number.parseFloat(MOTION['theme-circle']),
        easing: MOTION['ease-smooth'],
      })
      let resume: (() => void) | undefined
      let transition
      try {
        transition = start(() => {
          // 旧快照已经拍完，这时才停其它卡片：按下的一刻画面不变，旧画面里不会先跳一下（D29）。
          // 发起这次切换的卡片自己不暂停，它的圆环要跟着这一次按下走。
          resume = frames.suspend(call.frame)
          theme.setTheme(wanted)
        })
      } catch (error) {
        frames.endThemeReveal()
        clearTransition(root)
        resume?.()
        throw error
      }
      // 转场被跳过、页面切走或宿主卡住时，不能让根节点标记、卡片暂停与扣住的令牌留在原地。
      const safety = window.setTimeout(() => {
        frames.endThemeReveal()
        clearTransition(root)
        resume?.()
      }, 4000)
      transition.finished.catch(() => undefined).finally(() => {
        window.clearTimeout(safety)
        frames.endThemeReveal()
        clearTransition(root)
        resume?.()
      })
      // 只等转场准备好；桌面壳里 ready 迟迟不来时，一秒后照样把结果交回组件，圆环由令牌触发。
      await Promise.race([
        transition.ready.catch(() => { theme.setTheme(wanted) }),
        new Promise<void>((resolve) => { window.setTimeout(resolve, 1000) }),
      ])
      frames.startThemeReveal()
      return settle()
    },
  })
}
