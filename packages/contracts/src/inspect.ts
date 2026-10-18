/**
 * 检查器与自检（D9、D13）。
 *
 * 检查器只有一份：它住在组件运行时里，在组件自己的 iframe 中量排版、收集脚本错误与 CSP 违规；
 * 尺寸矩阵经 {@link INSPECT_GLOBAL} 调它，`widget_define` 的自检经桥上的 `inspect` 消息调它。
 * 判定也只有一份：{@link inspectionProblems} 把一份报告读成给人看的问题，运行时把结果连同报告
 * 一起交出去，两个调用方都不自己判。
 */
import type { WidgetMinBox } from './widget'

/** 一个盒子里量到的排版与故障。 */
export interface InspectionReport {
  /** 视口的像素宽高。 */
  w: number
  h: number
  /** 文档横向滚了出去。 */
  overflowX: boolean
  /** 文字被盒子截掉（超出视口、又不在可滚动的区域里）的元素，最多几条。 */
  clippedText: string[]
  /** 可见的交互控件被盒子截掉的元素，最多几条。 */
  clippedControls: string[]
  /** 既没有文字也没有图形。 */
  blank: boolean
  /** 未捕获的异常与组件自己报告的错误。 */
  errors: string[]
  /** 被 CSP 拦下的加载。 */
  csp: string[]
}

/** 一份报告与它读出的问题；问题为空就是通过。 */
export interface InspectionResult {
  report: InspectionReport
  problems: string[]
}

/**
 * 尺寸矩阵在组件文档里读检查器的全局名。
 *
 * 检查器是运行时的一部分，挂在组件自己的窗口上；组件改写它只会改坏自己的报告。
 */
export const INSPECT_GLOBAL = '__dshWidgetInspect'

/**
 * 把一份报告读成问题。
 *
 * @param report - 运行时量到的报告。
 * @returns 给人看的问题；空数组表示通过。
 */
export function inspectionProblems(report: InspectionReport): string[] {
  const problems: string[] = []
  const box = `${String(Math.round(report.w))}×${String(Math.round(report.h))}px`
  if (report.overflowX) problems.push(`${box}：内容横向超出了盒子`)
  if (report.clippedText.length > 0) problems.push(`${box}：文字被截掉（${report.clippedText.join('、')}）；收掉次要信息或放进 .w-scroll`)
  if (report.clippedControls.length > 0) problems.push(`${box}：可见的控件被截掉（${report.clippedControls.join('、')}）`)
  if (report.blank) problems.push(`${box}：画面是空白的`)
  for (const error of report.errors) problems.push(`脚本错误：${error}`)
  for (const blocked of report.csp) problems.push(`CSP 拦下了：${blocked}（组件不能联网，资源要放进组件目录）`)
  return problems
}

/** 自检放的一个盒子：宽度按看板列数，高度按 D16 的档位（rem）。 */
export interface SelfCheckBox {
  cols: number
  h: number
}

/**
 * 自检用的代表性盒子：一列的矮、中、高，两列的中档，四列的高档。
 *
 * 与尺寸矩阵取的是同一组档位的子集；低于组件 `minBox` 的盒子跳过（D20）。
 */
export const SELF_CHECK_BOXES: readonly SelfCheckBox[] = [
  { cols: 1, h: 10 },
  { cols: 1, h: 22 },
  { cols: 2, h: 14 },
  { cols: 4, h: 30 },
]

/** 自检里一列的宽度（rem）：看板一列至少 18rem，宽屏四列时约 20rem（D16）。 */
export const SELF_CHECK_COLUMN_REM = 20

/** 看板的列间距（rem），与 D16 一致。 */
export const SELF_CHECK_GAP_REM = 0.75

/** 宿主等一份自检报告的上限；没有在线页面接手时到点给出 `unverified`。 */
export const SELF_CHECK_TIMEOUT_MS = 20_000

/**
 * 按组件的下限挑出自检要放的盒子。
 *
 * @param minBox - 组件声明的最小盒子。
 * @returns 不低于下限的盒子。
 */
export function selfCheckBoxes(minBox: WidgetMinBox | undefined): SelfCheckBox[] {
  return SELF_CHECK_BOXES.filter((box) => minBox === undefined || (box.cols >= minBox.w && box.h >= minBox.h))
}

/** 交给在线页面的一次自检：画哪个版本、用什么 props 与 data、放进哪些盒子。 */
export interface SelfCheckJob {
  widget: string
  hash: string
  props: Record<string, unknown>
  data: unknown
  boxes: SelfCheckBox[]
}

/** 页面交回的一个盒子的结果。 */
export interface SelfCheckBoxResult {
  box: SelfCheckBox
  /** 组件在这个盒子里没有应答时写原因，报告缺席。 */
  failure?: string
  report?: InspectionReport
  problems: string[]
}

/**
 * 一次自检的结论。
 *
 * `unverified`：没有在线页面接手，或页面没在时限内交回报告——组件写下了，但没人看过它。
 */
export interface SelfCheckResult {
  status: 'passed' | 'failed' | 'unverified'
  /** 每个盒子的结果；`unverified` 时为空。 */
  boxes: SelfCheckBoxResult[]
  /** 汇总的问题，去重之后给模型读。 */
  problems: string[]
  /** `unverified` 的原因。 */
  reason?: string
}

/**
 * 判断页面交回的盒子结果形状对不对。
 *
 * @param value - 外来值。
 * @returns 形状对时为真。
 */
export function isSelfCheckBoxResults(value: unknown): value is SelfCheckBoxResult[] {
  if (!Array.isArray(value) || value.length > SELF_CHECK_BOXES.length) return false
  return value.every((entry) => {
    if (typeof entry !== 'object' || entry === null) return false
    const { box, failure, report, problems } = entry as Record<string, unknown>
    const boxOk = typeof box === 'object' && box !== null
      && typeof (box as SelfCheckBox).cols === 'number' && typeof (box as SelfCheckBox).h === 'number'
    const listOk = Array.isArray(problems) && problems.every((problem) => typeof problem === 'string')
    return boxOk && listOk
      && (failure === undefined || typeof failure === 'string')
      && (report === undefined || isInspectionReport(report))
  })
}

/**
 * 判断一份报告的形状。
 *
 * @param value - 外来值。
 * @returns 形状对时为真。
 */
export function isInspectionReport(value: unknown): value is InspectionReport {
  if (typeof value !== 'object' || value === null) return false
  const report = value as Record<string, unknown>
  const strings = (list: unknown): boolean => Array.isArray(list) && list.every((item) => typeof item === 'string')
  return typeof report.w === 'number' && typeof report.h === 'number'
    && typeof report.overflowX === 'boolean' && typeof report.blank === 'boolean'
    && strings(report.clippedText) && strings(report.clippedControls)
    && strings(report.errors) && strings(report.csp)
}
