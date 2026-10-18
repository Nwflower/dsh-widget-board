/**
 * 检查器（D9、D13）：在组件自己的 iframe 里量一次排版，收集脚本错误与 CSP 违规。
 *
 * 判定只有一份，在 `contracts` 的 {@link inspectionProblems}；这里只管量。两个调用方都用它：
 * 尺寸矩阵经 {@link INSPECT_GLOBAL} 调 {@link installInspector} 装好的那个函数，`widget_define`
 * 的自检经桥上的 `inspect` 消息调同一个。判定只看用户能观察到的结果——横向滚出盒子、文字与可见
 * 控件被截掉、画面空白、脚本出错、资源被 CSP 拦下。
 */
import type { InspectionReport } from '@dsh-widget-board/contracts'
import { INSPECT_GLOBAL, inspectionProblems } from '@dsh-widget-board/contracts'

/** 一份报告里最多列几个被截掉的元素：够看出是哪一处，又不至于把消息撑大。 */
const SAMPLE_LIMIT = 3

/** 元素在报告里怎么称呼：标签名加类名，截短。 */
function nameOf(element: Element): string {
  const classes = typeof element.className === 'string' && element.className !== '' ? `.${element.className.trim().split(/\s+/).slice(0, 2).join('.')}` : ''
  return `${element.tagName.toLowerCase()}${classes}`.slice(0, 48)
}

/** 元素自己在可滚动的区域里：滚出去不算被截掉。 */
function inScroller(element: Element): boolean {
  for (let node = element.parentElement; node !== null; node = node.parentElement) {
    const style = getComputedStyle(node)
    if (/(auto|scroll)/.test(`${style.overflowX} ${style.overflowY}`)) return true
  }
  return false
}

/** 元素看得见：不是 display: none、visibility: hidden，也没有尺寸为零。 */
function shown(element: Element): boolean {
  const style = getComputedStyle(element)
  return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0
}

/** 元素是否伸出了视口（给一个像素的余量）。 */
function beyond(element: Element): boolean {
  const box = element.getBoundingClientRect()
  return box.left < -1 || box.top < -1 || box.right > innerWidth + 1 || box.bottom > innerHeight + 1
}

/**
 * 装饰性的文字：读屏跳过、键盘也到不了的元素与它们的子树。
 *
 * 艺术图案、刻度这些只负责好看，被盒子裁掉不算用户读不到什么（D13 只判用户能观察到的结果）。
 */
function decorative(element: Element): boolean {
  return element.closest('[aria-hidden="true"]') !== null
}

/**
 * 在"井"里：最近一个把纵向溢出裁掉的祖先容器自己并没有撑满视口。
 *
 * 组件把内容收进一个高度有限的盒子里（例如迷你图、刻度条），里面的字被那个盒子裁掉是组件自己的
 * 排版选择；整张卡片的内容溢出视口才是问题。
 */
function inWell(element: Element): boolean {
  for (let node = element.parentElement; node !== null && node !== document.body; node = node.parentElement) {
    const style = getComputedStyle(node)
    if (style.overflowY !== 'hidden' && style.overflow !== 'hidden') continue
    return node.getBoundingClientRect().height < innerHeight - 1
  }
  return false
}

/**
 * 被盒子截掉的文字：文字压出了视口、又没有地方滚的时候，用户看到的就是半行。
 *
 * 只算自己直接装着文字的节点：父节点的盒子由子节点决定，报父节点没有意义。
 */
function clippedText(): string[] {
  const found: string[] = []
  for (const element of document.body.querySelectorAll('*')) {
    if (found.length >= SAMPLE_LIMIT) break
    if (!shown(element) || !beyond(element) || inScroller(element) || decorative(element) || inWell(element)) continue
    const own = Array.from(element.childNodes).some((node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== '')
    if (own) found.push(nameOf(element))
  }
  return found
}

/** 可见的交互控件被盒子截掉的：用户可以点却点不到的那些。 */
function clippedControls(): string[] {
  const controls = document.body.querySelectorAll('button, input, select, textarea, a[href], [role="button"], [role="tab"]')
  const found: string[] = []
  for (const element of controls) {
    if (found.length >= SAMPLE_LIMIT) break
    if (shown(element) && !inScroller(element) && beyond(element)) found.push(nameOf(element))
  }
  return found
}

/**
 * 量一次当前画面。
 *
 * @param errors - 这一帧收集到的脚本错误。
 * @param csp - 这一帧被 CSP 拦下的加载。
 * @returns 报告。
 */
export function measure(errors: readonly string[], csp: readonly string[]): InspectionReport {
  const root = document.documentElement
  const body = document.body
  const media = document.querySelectorAll('canvas, img, svg, video').length
  return {
    w: innerWidth,
    h: innerHeight,
    overflowX: root.scrollWidth > root.clientWidth + 1 || body.scrollWidth > root.clientWidth + 1,
    clippedText: clippedText(),
    clippedControls: clippedControls(),
    blank: (body.innerText ?? '').trim() === '' && media === 0,
    errors: [...errors].slice(-3),
    csp: [...csp].slice(-3),
  }
}

/**
 * 装好检查器：收集这一帧的故障，并在窗口上留一个随时可量的全局函数。
 *
 * 故障只在这一帧发生，所以收集必须从文档一开始就在——运行时启动时最先调用它，组件的脚本在那之后才跑。
 *
 * @param report - 组件自己报上来的错误往哪儿交（运行时传给父页面的那条路）。
 * @returns 量一次的函数。
 */
export function installInspector(report: (message: string) => void): () => InspectionReport {
  const errors: string[] = []
  const csp: string[] = []
  const note = (message: string): void => {
    if (errors.includes(message)) return
    errors.push(message)
    report(message)
  }
  window.addEventListener('error', (event) => {
    note(event.message || (event.error instanceof Error ? event.error.message : '脚本出错'))
  })
  window.addEventListener('unhandledrejection', (event) => {
    note(event.reason instanceof Error ? event.reason.message : String(event.reason))
  })
  document.addEventListener('securitypolicyviolation', (event) => {
    const blocked = `${event.violatedDirective} ${event.blockedURI === '' ? '' : event.blockedURI}`.trim()
    if (!csp.includes(blocked)) csp.push(blocked)
  })
  const inspect = (): InspectionReport => measure(errors, csp)
  ;(window as unknown as Record<string, unknown>)[INSPECT_GLOBAL] = inspect
  return inspect
}

/**
 * 一份报告读成问题；与调用方用同一个判定。
 *
 * @param report - 量到的报告。
 * @returns 问题；空数组表示通过。
 */
export function problemsOf(report: InspectionReport): string[] {
  return inspectionProblems(report)
}
