/**
 * 卡片动效模板的指针行为（D10）：3D 翻转、指针磁吸、全息高光。
 *
 * 套件里的类名只管几何与过渡，这里只做三件事：把指针位置写成 CSS 变量、在指针离开时复位、
 * 在触屏或键盘上切换翻面。元素由 `data-t-*` 属性认领，组件不需要自己的事件代码。
 */

/** 在事件目标上找最近的动效卡片。 */
function closestCard<T extends HTMLElement>(target: EventTarget | null, selector: string): T | null {
  return target instanceof Element ? target.closest<T>(selector) : null
}

/**
 * 装好卡片动效模板的指针行为。
 *
 * 指针移动只写变量，不直接改 transform：组件的样式表决定位移距离与过渡，减弱动效时整套停住。
 */
export function installMotionTemplates(): void {
  const root = document.documentElement
  const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  const reduced = (): boolean => root.dataset.motion === 'reduced' || reducedQuery.matches

  let magnetic: HTMLElement | null = null
  let holo: HTMLElement | null = null

  /** 读令牌里的像素或角度；动效令牌不随主题变，装好时读一次就够。 */
  const token = (name: string, fallback: number): number => {
    const value = Number.parseFloat(getComputedStyle(root).getPropertyValue(name))
    return Number.isFinite(value) ? value : fallback
  }
  const magneticDistance = token('--w-motion-magnetic-distance', 18)
  const magneticTilt = token('--w-motion-magnetic-tilt', 4)
  const holoShift = token('--w-motion-holo-shift', 24)
  const holoRotate = token('--w-motion-holo-rotate', 18)

  const resetMagnetic = (element: HTMLElement): void => {
    element.style.setProperty('--t-magnetic-x', '0px')
    element.style.setProperty('--t-magnetic-y', '0px')
    element.style.setProperty('--t-magnetic-tilt', '0deg')
    element.classList.remove('is-magnetic-active')
  }

  const resetHolo = (element: HTMLElement): void => {
    element.style.setProperty('--t-holo-x', '0px')
    element.style.setProperty('--t-holo-y', '0px')
    element.style.setProperty('--t-holo-gx', '50%')
    element.style.setProperty('--t-holo-gy', '50%')
    element.style.setProperty('--t-holo-rotate', '0deg')
  }

  const followMagnetic = (element: HTMLElement, event: PointerEvent): void => {
    const rect = element.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    const px = event.clientX - rect.left - rect.width / 2
    const py = event.clientY - rect.top - rect.height / 2
    element.style.setProperty('--t-magnetic-x', `${((px / rect.width) * magneticDistance * 2).toFixed(1)}px`)
    element.style.setProperty('--t-magnetic-y', `${((py / rect.height) * magneticDistance * 2).toFixed(1)}px`)
    element.style.setProperty('--t-magnetic-tilt', `${((px / rect.width) * magneticTilt * 2).toFixed(2)}deg`)
    element.classList.add('is-magnetic-active')
  }

  const followHolo = (element: HTMLElement, event: PointerEvent): void => {
    const rect = element.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    const x = (event.clientX - rect.left) / rect.width
    const y = (event.clientY - rect.top) / rect.height
    element.style.setProperty('--t-holo-x', `${((x - 0.5) * holoShift * 2).toFixed(1)}px`)
    element.style.setProperty('--t-holo-y', `${((y - 0.5) * holoShift * 2).toFixed(1)}px`)
    element.style.setProperty('--t-holo-gx', `${(x * 100).toFixed(1)}%`)
    element.style.setProperty('--t-holo-gy', `${(y * 100).toFixed(1)}%`)
    element.style.setProperty('--t-holo-rotate', `${((x - 0.5) * holoRotate).toFixed(2)}deg`)
  }

  const onPointerMove = (event: PointerEvent): void => {
    if (reduced()) {
      if (magnetic !== null) resetMagnetic(magnetic)
      if (holo !== null) resetHolo(holo)
      magnetic = null
      holo = null
      return
    }
    const nextMagnetic = closestCard<HTMLElement>(event.target, '[data-t-magnetic]')
    if (nextMagnetic !== magnetic) {
      if (magnetic !== null) resetMagnetic(magnetic)
      magnetic = nextMagnetic
    }
    if (magnetic !== null) followMagnetic(magnetic, event)
    const nextHolo = closestCard<HTMLElement>(event.target, '[data-t-holo]')
    if (nextHolo !== holo) {
      if (holo !== null) resetHolo(holo)
      holo = nextHolo
    }
    if (holo !== null) followHolo(holo, event)
  }

  /** 指针离开一张卡、或者离开这份文档时，把两个效果都放回原位。 */
  const onPointerOut = (event: PointerEvent): void => {
    const target = event.target
    const related = event.relatedTarget
    if (magnetic !== null && target instanceof Node && magnetic.contains(target)
      && (related === null || !(related instanceof Node) || !magnetic.contains(related))) {
      resetMagnetic(magnetic)
      magnetic = null
    }
    if (holo !== null && target instanceof Node && holo.contains(target)
      && (related === null || !(related instanceof Node) || !holo.contains(related))) {
      resetHolo(holo)
      holo = null
    }
  }

  document.addEventListener('pointermove', onPointerMove, { passive: true })
  document.addEventListener('pointerout', onPointerOut, { passive: true })

  /** 翻面：触屏与笔点一下切换，桌面交给悬停；键盘用 Enter 或空格。 */
  const toggleFlip = (element: HTMLElement): void => {
    const flipped = !element.classList.contains('is-flipped')
    element.classList.toggle('is-flipped', flipped)
    element.setAttribute('aria-pressed', String(flipped))
  }

  document.addEventListener('click', (event) => {
    // 鼠标点击交给 :hover；触屏与笔点一下翻面。键盘由下面的 keydown 处理。
    if ((event as PointerEvent).pointerType === 'mouse') return
    const flip = closestCard<HTMLElement>(event.target, '[data-t-flip]')
    if (flip !== null) toggleFlip(flip)
  })
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    const flip = closestCard<HTMLElement>(event.target, '[data-t-flip]')
    if (flip === null) return
    event.preventDefault()
    toggleFlip(flip)
  })
}
