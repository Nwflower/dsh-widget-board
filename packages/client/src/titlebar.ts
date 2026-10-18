/**
 * Windows 桌面端的窗口标题栏。
 *
 * 桌面壳打开 Window Controls Overlay，页面因此能从浏览器读到标题栏的高度与系统窗口按钮的起点；
 * 宿主又把标题栏那一条让给页面，看板这一栏的顶边落在标题栏下沿。两样都成立时，标题栏里有一条
 * 真正空着的横向位置，标签条可以挂上去；只有标题栏可见、宿主没让出那一条时，挂上去会压住内容。
 *
 * 标签条靠左：从看板这一栏的左缘再让开一点，但不会进到 Desktop 自己的菜单底下。收起侧栏时，
 * 展开按钮在 12–40px，新会话在 48–76px；Desktop preload 的菜单从 84px 起排，「应用」「编辑」两个
 * 按钮连同内边距到 300px 左右。插件不查那个菜单的节点，左端按 300px 让开。
 */

/** 标题栏左端留给宿主控件与 Desktop 菜单的地方。 */
const LEADING_CLEARANCE = 300

/** 标签条与看板左缘、窗口按钮之间留出的空隙。 */
const AIR = 12

/** 窗口控制层还没量出标题栏时的兜底：宿主给的标题栏高度。 */
const FALLBACK_HEIGHT = 40

/** 窗口控制层还没量出控件宽度时的兜底：Windows 三个窗口按钮连同间距。 */
const FALLBACK_CONTROLS = 140

/** 一次位置判定的输入，单位是视口像素。 */
export interface TitlebarReading {
  /** 看板这一栏的盒子。 */
  container: { left: number, top: number }
  /** 标题栏的高度。 */
  height: number
  /** 系统窗口按钮的起点。 */
  controlsLeft: number
  /** 标签条的自然宽度。 */
  stripWidth: number
  /** 页面是不是 Windows 桌面端。 */
  windows: boolean
}

/** 标题栏里给标签条的一块位置。 */
export interface TitlebarSeat {
  /** 标题栏的高度。 */
  height: number
  /** 标签条靠左放置的横坐标。 */
  left: number
  /** 右侧最多到这个位置。 */
  right: number
}

/**
 * 标题栏里能不能放下标签条。
 *
 * @param reading - 看板这一栏的盒子、标题栏的高度、窗口按钮的起点、标签条宽度与平台。
 * @returns 放得下时靠左的位置；宿主没有让出标题栏或宽度不够时是 `null`。
 */
export function seatInTitlebar(reading: TitlebarReading): TitlebarSeat | null {
  if (!reading.windows) return null
  const height = Math.round(reading.height)
  if (height <= 0 || reading.stripWidth <= 0) return null
  // 看板这一栏的顶边在标题栏下沿时，宿主已经把那条让出来了；否则挂上去会压住内容。
  if (reading.container.top < height - 1) return null
  const left = Math.max(reading.container.left + AIR, LEADING_CLEARANCE)
  const right = reading.controlsLeft - AIR
  if (reading.stripWidth > right - left) return null
  return { height, left, right }
}

/** Window Controls Overlay 里本插件用到的部分；旧浏览器可以没有这项。 */
interface WindowControlsOverlayLike {
  visible: boolean
  getTitlebarAreaRect?: () => { width: number, height: number, right: number }
}

/**
 * 读一次标题栏里给标签条的位置。
 *
 * @param container - 看板这一栏的根节点。
 * @param stripWidth - 标签条的自然宽度。
 * @returns 位置；不在 Windows 桌面端、窗口没有标题栏或没有空位时是 `null`。
 */
export function titlebarSeat(container: HTMLElement, stripWidth: number): TitlebarSeat | null {
  const overlay = (navigator as Navigator & { windowControlsOverlay?: WindowControlsOverlayLike }).windowControlsOverlay
  if (overlay === undefined || overlay.visible !== true) return null
  const band = typeof overlay.getTitlebarAreaRect === 'function' ? overlay.getTitlebarAreaRect() : null
  const box = container.getBoundingClientRect()
  return seatInTitlebar({
    container: { left: box.left, top: box.top },
    height: band !== null && band.height > 0 ? band.height : FALLBACK_HEIGHT,
    controlsLeft: band !== null && band.width > 0 && band.right > 0 ? band.right : window.innerWidth - FALLBACK_CONTROLS,
    stripWidth,
    windows: navigator.userAgent.includes('Windows'),
  })
}
